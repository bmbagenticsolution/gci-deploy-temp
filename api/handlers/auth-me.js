// api/auth-me.js — Validates session token and returns user profile
const { kvGet } = require('../redis-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token } = req.body || {};
  if (!token) return res.status(401).json({ error: 'No token' });

  const sessionRaw = await kvGet(`gci:session:${token}`);
  if (!sessionRaw) return res.status(401).json({ error: 'Session expired or invalid' });

  let session;
  try { session = JSON.parse(sessionRaw); } catch { return res.status(401).json({ error: 'Session error' }); }

  const userRaw = await kvGet(`gci:user:${session.email}`);
  if (!userRaw) return res.status(401).json({ error: 'User not found' });

  let user;
  try { user = JSON.parse(userRaw); } catch { return res.status(500).json({ error: 'User data error' }); }

  return res.status(200).json({
    user: { email: user.email, name: user.name, company: user.company, plan: user.plan, adminGranted: user.adminGranted }
  });
}
