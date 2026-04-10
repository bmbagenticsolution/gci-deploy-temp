// api/careers-verify-otp.js — Verify OTP without consuming it (used for live UI feedback)
// The OTP is consumed once during the actual careers-apply.js submission.

const { kvGet } = require('../redis-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email, otp } = req.body || {};
  if (!email || !otp) return res.status(400).json({ valid: false, error: 'Email and code required' });

  const cleanEmail = email.toLowerCase().trim();
  const stored = await kvGet(`gci:otp:${cleanEmail}`);
  const storedRaw = stored ? stored.replace(/^"|"$/g, '') : null;

  if (!storedRaw) {
    return res.status(200).json({ valid: false, error: 'Code expired. Please request a new one.' });
  }
  if (storedRaw !== otp.toString().trim()) {
    return res.status(200).json({ valid: false, error: 'Incorrect code. Please try again.' });
  }

  return res.status(200).json({ valid: true });
}
