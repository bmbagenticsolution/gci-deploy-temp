// api/careers-interest.js , Capture future opportunity interest (no full application required)
const { hsUpsertContact, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, kvSet, getRedisClient } = require('../redis-client');

const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL  = 'difc@gulfcapitalintelligence.com';
const ADMIN_EMAIL = 'difc@gulfcapitalintelligence.com';

async function kvSadd(key, value) {
  const redis = getRedisClient();
  await redis.sadd(key, value);
  return true;
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!KV_URL || !KV_TOKEN) return res.status(500).json({ error: 'Storage not configured' });

  const { name, email, track, mobile } = req.body || {};

  if (!name || !email || !email.includes('@')) {
    return res.status(400).json({ error: 'Name and valid email are required' });
  }

  const cleanEmail = email.toLowerCase().trim();
  const firstName = name.split(' ')[0];

  // Store in the shared weekly email set (same one used for applicants)
  await kvSadd('gci:career:emails', cleanEmail);
  // Store name mapping for personalisation
  await kvSet(`gci:career:emailname:${cleanEmail}`, name.trim());
  // Store interest record
  await kvSet(`gci:career:interest:${cleanEmail}`, JSON.stringify({
    name: name.trim(),
    email: cleanEmail,
    track: track || '',
    mobile: mobile || '',
    submittedAt: new Date().toISOString()
  }));

  // Best-effort HubSpot mirror
  hsUpsertContact({
    email: cleanEmail,
    name: name.trim(),
    phone: mobile,
    source: HS_SOURCE.CAREERS_INTEREST,
    lifecycleStage: HS_LIFECYCLE.SUBSCRIBER,
    extra: {
      gci_source: HS_SOURCE.CAREERS_INTEREST,
      gci_careers_track: track || ''
    }
  }).catch(() => {});
  // Add to interest-only set (separate from full applicants)
  await kvSadd('gci:career:interest:emails', cleanEmail);

  // Send confirmation to subscriber
  const confirmHtml = `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#222;">
  <div style="background:#0B1D35;padding:24px 32px;border-radius:8px 8px 0 0;">
    <div style="color:#C8A84B;font-size:18px;font-weight:700;">Gulf Capital Intelligence</div>
    <div style="color:#8a9db5;font-size:12px;margin-top:4px;">DIFC, Dubai | Riyadh</div>
  </div>
  <div style="background:#fff;padding:32px;border:1px solid #e8e8e8;border-top:none;border-radius:0 0 8px 8px;">
    <p style="margin:0 0 16px;font-size:15px;">Dear ${firstName},</p>
    <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 16px;">You are on our career interest list. We will contact you directly when a${track ? ' ' + track : ''} role opens, before any public announcement.</p>
    <p style="font-size:14px;line-height:1.7;color:#333;margin:0 0 24px;">In the meantime you will receive our weekly GCC investment intelligence briefing every Monday, covering deal analysis, sector trends, and market signals from across the region.</p>
    <div style="background:#f8f9fb;border-left:3px solid #C8A84B;padding:14px 18px;margin:0 0 24px;border-radius:0 6px 6px 0;">
      <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">Explore live conviction reports on the GCI platform at <a href="https://gulfcapitalintelligence.com/app" style="color:#C8A84B;font-weight:600;">gulfcapitalintelligence.com/app</a> to understand the quality of analysis we expect from our team.</p>
    </div>
    <p style="font-size:13px;color:#555;margin:0 0 4px;">Follow us on LinkedIn for role announcements:</p>
    <a href="https://www.linkedin.com/company/gulf-capital-intelligence" style="color:#0077b5;font-size:13px;font-weight:600;">linkedin.com/company/gulf-capital-intelligence</a>
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;">
      <p style="margin:0;font-size:13px;color:#555;">Gulf Capital Intelligence</p>
      <p style="margin:2px 0 0;font-size:12px;color:#999;">difc@gulfcapitalintelligence.com | Gate Village, DIFC, Dubai</p>
    </div>
  </div>
  <div style="padding:12px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#aaa;">You signed up for career updates at gulfcapitalintelligence.com/careers. <a href="https://gulfcapitalintelligence.com/api/careers-unsubscribe?t=${Buffer.from(cleanEmail).toString('base64url')}" style="color:#aaa;">Unsubscribe</a></p>
  </div>
</div>`;

  await sendEmail(cleanEmail, 'You are on the GCI career interest list', confirmHtml);

  // Notify admin
  await sendEmail(
    ADMIN_EMAIL,
    `GCI Career Interest: ${name}${track ? ' (' + track + ')' : ''}`,
    `<p><strong>${name}</strong> (${cleanEmail}) submitted a career interest form.</p><p>Track preference: ${track || 'Not specified'}</p>`
  );

  return res.status(200).json({ success: true });
}
