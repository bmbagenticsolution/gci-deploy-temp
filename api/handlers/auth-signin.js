// api/auth-signin.js , Validates GCI user credentials stored in KV
const crypto = require('crypto');
const { hsUpsertContact, HS_SOURCE } = require('../lib/hubspot.js');
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

  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const key = `gci:user:${email.toLowerCase().trim()}`;
  const raw = await kvGet(key);

  if (!raw) return res.status(401).json({ error: 'No account found. Please sign up first.' });

  let user;
  try { user = JSON.parse(raw); } catch { return res.status(500).json({ error: 'Account data error' }); }

  const hash = hashPassword(password, user.salt);
  if (hash !== user.hash) return res.status(401).json({ error: 'Incorrect password.' });

  const token = crypto.randomBytes(32).toString('hex');
  const sessionData = JSON.stringify({ email: user.email, created: Date.now() });
  await kvSet(`gci:session:${token}`, sessionData, 30 * 24 * 60 * 60);

  // Best-effort HubSpot last_login refresh
  hsUpsertContact({
    email: user.email,
    name: user.name,
    phone: user.mobile,
    company: user.company,
    source: HS_SOURCE.SIGNIN,
    extra: { gci_last_login: new Date().toISOString() }
  }).catch(() => {});

  return res.status(200).json({
    token,
    user: { email: user.email, name: user.name, company: user.company, plan: user.plan, adminGranted: user.adminGranted }
  });
}
