// api/magic-link.js
// GCI Subscriber Dashboard - Magic Link Login
// POST { email } -> sends a one-time login link to the subscriber's email
// The link expires in 30 minutes.
// Only sends if the email has an active or recently-cancelled subscription.

const crypto = require('crypto');
const { hsUpsertContact, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, kvSet } = require('../redis-client');

async function sendMagicLinkEmail(email, link) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.warn('[magic-link] RESEND_API_KEY not set'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Gulf Capital Intelligence <difc@gulfcapitalintelligence.com>',
        to: [email],
        subject: 'Your GCI login link',
        html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;max-width:560px;overflow:hidden">
      <tr><td style="background:#0B1D35;padding:28px 40px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:20px;color:#C8A84B;letter-spacing:0.04em">GULF CAPITAL INTELLIGENCE</div>
        <div style="font-size:10px;color:rgba(200,168,75,0.55);letter-spacing:0.15em;text-transform:uppercase;margin-top:5px">DIFC, Dubai</div>
      </td></tr>
      <tr><td style="padding:40px 40px 36px;text-align:center">
        <div style="font-size:40px;margin-bottom:16px">&#128273;</div>
        <div style="font-size:20px;font-weight:600;color:#0B1D35;margin-bottom:10px">Your login link</div>
        <div style="font-size:14px;color:#5a6a7e;line-height:1.7;margin-bottom:28px">Click below to sign in to your GCI subscriber dashboard. This link expires in 30 minutes and can only be used once.</div>
        <a href="${link}" style="display:inline-block;background:#0B1D35;color:#ffffff;font-size:14px;font-weight:600;padding:14px 32px;border-radius:8px;text-decoration:none;letter-spacing:0.02em">Sign In to GCI</a>
        <div style="margin-top:24px;font-size:12px;color:#a0aab8;line-height:1.8">
          If the button does not work, copy and paste this URL into your browser:<br>
          <span style="color:#0B1D35;font-size:11px;word-break:break-all">${link}</span>
        </div>
        <div style="margin-top:20px;padding-top:20px;border-top:1px solid #f0f2f5;font-size:11px;color:#a0aab8">
          If you did not request this link, ignore this email. Your account is secure.
        </div>
      </td></tr>
      <tr><td style="background:#f8f9fb;border-top:1px solid #e2e6ed;padding:16px 40px;text-align:center">
        <div style="font-size:11px;color:#a0aab8">Gulf Capital Intelligence &bull; DIFC, Dubai, UAE</div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('[magic-link] Email error:', e.message);
    return false;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email address required' });
  }

  const cleanEmail = email.toLowerCase().trim();

  // Check if this email has a plan record (subscriber or past subscriber)
  const planData = await kvGet(`plan:${cleanEmail}`);
  const hasAccount = await kvGet(`gci:user:${cleanEmail}`);

  if (!planData && !hasAccount) {
    // Return success anyway to prevent email enumeration
    console.log(`[magic-link] No account found for ${cleanEmail} - returning generic success`);
    return res.status(200).json({ success: true, message: 'If an account exists for this email, a login link has been sent.' });
  }

  // Generate magic link token (32 bytes = 64 hex chars)
  const token   = crypto.randomBytes(32).toString('hex');
  const baseUrl = process.env.APP_URL || 'https://gulfcapitalintelligence.com';
  const link    = `${baseUrl}/api/verify-magic-link?token=${token}`;

  // Store token with 30-minute TTL
  await kvSet(`magic:${token}`, { email: cleanEmail, createdAt: new Date().toISOString() }, 30 * 60);

  // Rate limit: max 5 magic links per hour per email
  const rateLimitKey = `magic:ratelimit:${cleanEmail}`;
  const rateData = await kvGet(rateLimitKey);
  const rateCount = rateData?.count || 0;
  if (rateCount >= 5) {
    return res.status(429).json({ error: 'Too many login requests. Please wait before trying again.' });
  }
  await kvSet(rateLimitKey, { count: rateCount + 1 }, 3600);

  const sent = await sendMagicLinkEmail(cleanEmail, link);
  if (!sent) {
    // If email fails, still return success (log internally)
    console.error(`[magic-link] Failed to send to ${cleanEmail}`);
  }

  console.log(`[magic-link] Sent magic link to ${cleanEmail}`);

  // Best-effort HubSpot mirror as a subscriber. Will not downgrade lifecycle if already higher.
  hsUpsertContact({
    email: cleanEmail,
    source: HS_SOURCE.MAGIC_LINK,
    lifecycleStage: HS_LIFECYCLE.SUBSCRIBER,
    extra: {
      gci_source: HS_SOURCE.MAGIC_LINK,
      gci_last_login: new Date().toISOString()
    }
  }).catch(() => {});

  return res.status(200).json({ success: true, message: 'If an account exists for this email, a login link has been sent.' });
}
