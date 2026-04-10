// api/verify-magic-link.js
// GCI Subscriber Dashboard - Magic Link Verification
// GET ?token=xxx -> validates token, creates session, redirects to /app?token=SESSION_TOKEN
// One-time use: token is deleted after use.

const crypto = require('crypto');
const { kvGet, kvSet, kvDel } = require('../redis-client');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.query;
  const baseUrl   = process.env.APP_URL || 'https://gulfcapitalintelligence.com';

  if (!token) {
    return res.redirect(302, `${baseUrl}/app?auth_error=missing_token`);
  }

  // Look up the magic link token
  const magicData = await kvGet(`magic:${token}`);

  if (!magicData) {
    // Token not found or expired
    return res.redirect(302, `${baseUrl}/app?auth_error=invalid_or_expired`);
  }

  const email = typeof magicData === 'object' ? magicData.email : magicData;

  if (!email) {
    return res.redirect(302, `${baseUrl}/app?auth_error=invalid_token`);
  }

  // Delete magic link token immediately (one-time use)
  await kvDel(`magic:${token}`);

  // Create a 30-day session token
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const sessionData  = {
    email,
    createdAt:  new Date().toISOString(),
    via:        'magic-link',
    lastSeenAt: new Date().toISOString(),
  };

  // Store session (30 days TTL)
  await kvSet(`gci:session:${sessionToken}`, sessionData, 30 * 24 * 60 * 60);

  // Update user lastLogin
  const userKey = `gci:user:${email}`;
  const user = await kvGet(userKey);
  if (user && typeof user === 'object') {
    await kvSet(userKey, {
      ...user,
      lastLogin:  new Date().toISOString(),
      loginCount: (user.loginCount || 0) + 1,
    });
  }

  console.log(`[verify-magic-link] Session created for ${email}`);

  // Redirect to app with session token
  return res.redirect(302, `${baseUrl}/app?token=${sessionToken}&auth=magic`);
}
