// api/verify-reset-token.js
// Verifies a HMAC-signed password reset token (no external dependencies)

const crypto = require('crypto');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { token, email } = req.body || {};
  if (!token || !email) {
    return res.status(400).json({ valid: false, error: 'Token and email required' });
  }

  try {
    const secret = process.env.ADMIN_SECRET || 'gci-reset-secret';
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return res.status(400).json({ valid: false });

    // Verify signature
    const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
    if (sig !== expectedSig) {
      return res.status(400).json({ valid: false, error: 'Invalid token' });
    }

    // Verify payload
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ valid: false, error: 'Email mismatch' });
    }
    if (Date.now() > data.exp) {
      return res.status(400).json({ valid: false, error: 'Token expired' });
    }

    return res.status(200).json({ valid: true });
  } catch (err) {
    return res.status(400).json({ valid: false, error: 'Invalid token format' });
  }
}
