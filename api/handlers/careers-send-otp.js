// api/careers-send-otp.js — Send email OTP to verify applicant before final submission

const { kvGet, kvSet } = require('../redis-client');
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL = 'difc@gulfcapitalintelligence.com';
const OTP_TTL    = 600; // 10 minutes

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Service not configured' });
  }

  const { email, name, role } = req.body || {};

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Rate limit: check if an OTP was sent recently (within last 60 seconds)
  const rateLimitKey = `gci:otp:rl:${cleanEmail}`;
  const recentSend = await kvGet(rateLimitKey);
  if (recentSend) {
    return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code.' });
  }

  const otp = generateOTP();
  const firstName = (name || 'there').split(' ')[0];
  const roleLabel = role || 'a role at GCI';

  // Store OTP with 10-min expiry
  await kvSet(`gci:otp:${cleanEmail}`, otp, OTP_TTL);
  // Store rate limit marker with 60-sec expiry
  await kvSet(rateLimitKey, '1', 60);

  // Send OTP email
  const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
  <tr><td align="center">
    <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;">
      <tr><td style="background:#0B1D35;padding:24px 32px;border-radius:8px 8px 0 0;">
        <div style="color:#C8A84B;font-size:18px;font-weight:700;">Gulf Capital Intelligence</div>
        <div style="color:#8a9db5;font-size:12px;margin-top:4px;">Application Verification</div>
      </td></tr>
      <tr><td style="background:#fff;padding:36px 32px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 8px 8px;text-align:center;">
        <p style="margin:0 0 8px;font-size:14px;color:#333;text-align:left;">Dear ${firstName},</p>
        <p style="margin:0 0 28px;font-size:14px;color:#555;line-height:1.7;text-align:left;">To complete your application for <strong>${roleLabel}</strong>, please enter the verification code below. This code expires in 10 minutes.</p>
        <div style="background:#0B1D35;border-radius:10px;padding:28px 20px;margin:0 0 28px;">
          <div style="font-size:11px;color:#8a9db5;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px;">Your Verification Code</div>
          <div style="font-size:42px;font-weight:800;letter-spacing:10px;color:#C8A84B;font-family:monospace;">${otp}</div>
        </div>
        <p style="margin:0 0 8px;font-size:12px;color:#999;text-align:center;">Do not share this code with anyone. It will expire in 10 minutes.</p>
        <p style="margin:0;font-size:12px;color:#bbb;text-align:center;">If you did not apply to Gulf Capital Intelligence, please ignore this email.</p>
      </td></tr>
      <tr><td style="padding:16px;text-align:center;">
        <p style="margin:0;font-size:11px;color:#aaa;">Gulf Capital Intelligence | Gate Village, DIFC, Dubai</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: cleanEmail,
      subject: `${otp} is your GCI application verification code`,
      html
    })
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    console.error('Resend error:', errText);
    return res.status(500).json({ error: 'Failed to send verification email. Please check your email address.' });
  }

  return res.status(200).json({ success: true, message: 'Verification code sent. Please check your email.' });
}
