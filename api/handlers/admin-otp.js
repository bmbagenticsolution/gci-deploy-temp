// api/admin-otp.js — Email OTP login for GCI God Screen
// Sends a 6-digit code to verified admin emails via Resend, validates via KV

const { kvGet, kvSet, kvDel } = require('../redis-client');

const ADMIN_EMAILS = [
  'gaurav@boostmylocalbusiness.ai',
  'difc@gulfcapitalintelligence.com',
  'hemanthult@gmail.com'
];

const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const ADMIN_SECRET      = process.env.ADMIN_SECRET;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const action = req.query.action;
  const email  = (req.query.email || '').toLowerCase().trim();

  if (!ADMIN_EMAILS.includes(email)) {
    return res.status(403).json({ error: 'Not an authorised admin email.' });
  }

  // ── SEND ──────────────────────────────────────────────────────
  if (action === 'send') {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const kvKey = `admin_otp:${email}`;

    await kvSet(kvKey, code, 600); // 10 minutes

    const emailBody = {
      from: 'Gulf Capital Intelligence <difc@gulfcapitalintelligence.com>',
      to: [email],
      subject: 'Your GCI Admin Login Code',
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:400px;margin:0 auto;padding:32px">
          <div style="font-size:13px;color:#888;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px">Gulf Capital Intelligence</div>
          <div style="font-size:22px;font-weight:700;color:#0B1D35;margin-bottom:20px">Admin Login Code</div>
          <div style="background:#F5F7FB;border:1px solid #E2E8F0;border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
            <div style="font-family:monospace;font-size:36px;font-weight:700;letter-spacing:0.3em;color:#0B1D35">${code}</div>
            <div style="font-size:12px;color:#888;margin-top:8px">Valid for 10 minutes</div>
          </div>
          <div style="font-size:12px;color:#888;line-height:1.6">If you did not request this code, you can safely ignore this email. Do not share this code with anyone.</div>
          <div style="margin-top:20px;padding-top:16px;border-top:1px solid #E2E8F0;font-size:11px;color:#aaa">Gulf Capital Intelligence &middot; DIFC, Dubai &middot; Reg. 11954</div>
        </div>
      `
    };

    const sendResp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    });

    if (!sendResp.ok) {
      const errBody = await sendResp.json().catch(() => ({}));
      return res.status(500).json({ error: 'Failed to send email: ' + (errBody.message || sendResp.status) });
    }

    return res.status(200).json({ ok: true });
  }

  // ── VERIFY ────────────────────────────────────────────────────
  if (action === 'verify') {
    const code   = (req.query.code || '').trim();
    const kvKey  = `admin_otp:${email}`;
    const stored = await kvGet(kvKey);

    if (!stored || stored !== code) {
      return res.status(403).json({ error: 'Invalid or expired code. Request a new one.' });
    }

    await kvDel(kvKey);

    // Return ADMIN_SECRET so the session can authenticate against admin-dashboard as normal
    return res.status(200).json({ ok: true, secret: ADMIN_SECRET });
  }

  return res.status(400).json({ error: 'Unknown action.' });
}
