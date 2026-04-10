// api/auth-signup.js , Creates a new GCI user account stored in KV
const crypto = require('crypto');
const { hsUpsertContact, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, kvSet } = require('../redis-client');

function hashPassword(password, salt) {
  return crypto.createHmac('sha256', salt).update(password).digest('hex');
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, name, company, mobile } = req.body || {};

  if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const key = `gci:user:${email.toLowerCase().trim()}`;
  const existing = await kvGet(key);
  if (existing) return res.status(409).json({ error: 'Account already exists. Please sign in.' });

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  const user = {
    email: email.toLowerCase().trim(),
    name: name || '',
    company: company || '',
    mobile: mobile || '',
    created: Date.now(),
    salt,
    hash,
    plan: null,
    adminGranted: false
  };

  await kvSet(key, JSON.stringify(user));

  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = JSON.stringify({ email: user.email, created: Date.now() });
  await kvSet(`gci:session:${token}`, sessionData, 30 * 24 * 60 * 60);

  // Best-effort HubSpot mirror. Never blocks signup on HubSpot failure.
  hsUpsertContact({
    email: user.email,
    name: user.name,
    phone: user.mobile,
    company: user.company,
    source: HS_SOURCE.SIGNUP,
    lifecycleStage: HS_LIFECYCLE.MQL,
    extra: {
      gci_source: HS_SOURCE.SIGNUP,
      gci_user_id: user.email,
      gci_signup_date: new Date(user.created).toISOString(),
      gci_last_login: new Date(user.created).toISOString(),
      gci_admin_granted: 'false'
    }
  }).catch(() => {});

  return res.status(200).json({
    token,
    user: { email: user.email, name: user.name, company: user.company, plan: user.plan, adminGranted: user.adminGranted }
  });
}
