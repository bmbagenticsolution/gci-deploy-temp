// api/auth-oauth-callback.js
// Handles OAuth2 authorization code callbacks for Google, Microsoft, and LinkedIn.
// Exchanges code for tokens, fetches user profile, creates/signs in GCI user,
// upserts to HubSpot (Contact + List), and redirects to app.html with session token.

const crypto = require('crypto');
const { kvGet, kvSet } = require('../redis-client');
const { hsUpsertContact, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');

// HubSpot list management helper
async function hsAddToList(email, listId) {
  const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';
  if (!TOKEN || !listId) return;
  try {
    // Search for contact by email to get ID
    const searchR = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: email }] }],
        properties: ['email'], limit: 1
      })
    });
    const searchData = await searchR.json();
    const contactId = searchData.results && searchData.results[0] && searchData.results[0].id;
    if (!contactId) return;

    // Add contact to static list (v1 API for lists)
    await fetch('https://api.hubapi.com/contacts/v1/lists/' + listId + '/add', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ vids: [parseInt(contactId, 10)] })
    });
  } catch (e) {
    console.error('[oauth] HubSpot list add error:', e.message);
  }
}

// Provider configs
function getProviderConfig(provider) {
  const base = {
    google: {
      tokenUrl: 'https://oauth2.googleapis.com/token',
      profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
      parseProfile: (data) => ({
        email: data.email,
        name: data.name || [data.given_name, data.family_name].filter(Boolean).join(' '),
        picture: data.picture || '',
        provider: 'google'
      })
    },
    microsoft: {
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
      profileUrl: 'https://graph.microsoft.com/v1.0/me',
      clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET || '',
      parseProfile: (data) => ({
        email: data.mail || data.userPrincipalName || '',
        name: data.displayName || '',
        title: data.jobTitle || '',
        company: data.companyName || '',
        provider: 'microsoft'
      })
    },
    linkedin: {
      tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
      profileUrl: 'https://api.linkedin.com/v2/userinfo',
      clientId: process.env.LINKEDIN_OAUTH_CLIENT_ID || '',
      clientSecret: process.env.LINKEDIN_OAUTH_CLIENT_SECRET || '',
      parseProfile: (data) => ({
        email: data.email || '',
        name: data.name || [data.given_name, data.family_name].filter(Boolean).join(' '),
        picture: data.picture || '',
        provider: 'linkedin'
      })
    }
  };
  return base[provider] || null;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { code, state } = req.query || {};
  if (!code || !state) {
    return res.status(400).json({ error: 'Missing authorization code or state' });
  }

  // Parse state to get provider info and redirect target
  let stateData;
  try {
    stateData = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
  } catch (e) {
    return res.status(400).json({ error: 'Invalid state parameter' });
  }

  const provider = stateData.provider;
  const redirectUrl = stateData.redirect || '/app.html';
  const config = getProviderConfig(provider);

  if (!config) {
    return res.status(400).json({ error: 'Unknown provider: ' + provider });
  }

  if (!config.clientId || !config.clientSecret) {
    return res.status(500).json({ error: provider + ' OAuth not configured. Set environment variables.' });
  }

  // Build the redirect URI (must match what was sent in the auth request)
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const redirectUri = proto + '://' + host + '/api/auth-oauth-callback';

  // 1. Exchange authorization code for access token
  let accessToken;
  try {
    const tokenParams = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret
    });

    const tokenR = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    });

    if (!tokenR.ok) {
      const errText = await tokenR.text();
      console.error('[oauth] Token exchange failed for ' + provider + ':', tokenR.status, errText);
      return res.status(502).json({ error: 'Token exchange failed' });
    }

    const tokenData = await tokenR.json();
    accessToken = tokenData.access_token;
    if (!accessToken) {
      return res.status(502).json({ error: 'No access token received' });
    }
  } catch (e) {
    console.error('[oauth] Token exchange error:', e.message);
    return res.status(502).json({ error: 'Token exchange error' });
  }

  // 2. Fetch user profile from the provider
  let profile;
  try {
    const profileR = await fetch(config.profileUrl, {
      headers: { Authorization: 'Bearer ' + accessToken }
    });

    if (!profileR.ok) {
      const errText = await profileR.text();
      console.error('[oauth] Profile fetch failed for ' + provider + ':', profileR.status, errText);
      return res.status(502).json({ error: 'Profile fetch failed' });
    }

    const profileData = await profileR.json();
    profile = config.parseProfile(profileData);

    if (!profile.email) {
      return res.status(400).json({ error: 'Could not retrieve email from ' + provider + '. Please use email signup.' });
    }
  } catch (e) {
    console.error('[oauth] Profile fetch error:', e.message);
    return res.status(502).json({ error: 'Profile fetch error' });
  }

  // 3. Create or update GCI user in Redis
  const email = profile.email.toLowerCase().trim();
  const key = 'gci:user:' + email;
  let user;
  const existing = await kvGet(key);

  if (existing) {
    // User exists, update with any new info from OAuth profile
    user = JSON.parse(existing);
    if (profile.name && !user.name) user.name = profile.name;
    if (profile.title && !user.title) user.title = profile.title;
    if (profile.company && !user.company) user.company = profile.company;
    user.lastOAuthProvider = provider;
    user.lastLogin = Date.now();
    await kvSet(key, JSON.stringify(user));
  } else {
    // New user
    user = {
      email: email,
      name: profile.name || '',
      title: profile.title || '',
      company: profile.company || '',
      mobile: '',
      created: Date.now(),
      salt: '',
      hash: '',
      plan: null,
      adminGranted: false,
      oauthProvider: provider,
      lastOAuthProvider: provider,
      lastLogin: Date.now()
    };
    await kvSet(key, JSON.stringify(user));
  }

  // 4. Create session token
  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = JSON.stringify({ email: email, created: Date.now(), provider: provider });
  await kvSet('gci:session:' + token, sessionData, 30 * 24 * 60 * 60); // 30 day session

  // 5. HubSpot upsert (best-effort, never blocks)
  const HS_LIST_ID = process.env.HUBSPOT_SOCIAL_SIGNUP_LIST_ID || '';

  hsUpsertContact({
    email: email,
    name: profile.name,
    jobtitle: profile.title || '',
    company: profile.company || '',
    source: HS_SOURCE.SIGNUP,
    lifecycleStage: HS_LIFECYCLE.MQL,
    extra: {
      gci_source: 'social_' + provider,
      gci_user_id: email,
      gci_signup_date: new Date(user.created).toISOString(),
      gci_last_login: new Date().toISOString(),
      gci_admin_granted: 'false'
    }
  }).then(function() {
    // After contact upsert, add to list
    if (HS_LIST_ID) {
      hsAddToList(email, HS_LIST_ID).catch(function() {});
    }
  }).catch(function() {});

  // 6. Redirect back to app.html with token
  const separator = redirectUrl.includes('?') ? '&' : '?';
  const finalUrl = redirectUrl + separator + 'token=' + encodeURIComponent(token) + '&auth=social';
  res.writeHead(302, { Location: finalUrl });
  return res.end();
}
