// api/careers-weekly.js — Weekly intelligence email to all career applicants
// Cron: Every Monday at 06:00 UTC (10:00 Dubai / 09:00 Riyadh)

const { kvGet, getRedisClient } = require('../redis-client');
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL  = 'GCI Careers <difc@gulfcapitalintelligence.com>';
const ADMIN_EMAIL = 'difc@gulfcapitalintelligence.com';

async function kvSmembers(key) {
  const redis = getRedisClient();
  return await redis.smembers(key);
}

async function sendEmail(to, subject, html) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
  });
  return r.ok;
}

function getWeeklyContent() {
  const now = new Date();
  const week = Math.ceil(now.getDate() / 7);
  const month = now.toLocaleString('en-GB', { month: 'long', timeZone: 'Asia/Dubai' });
  const year = now.getFullYear();

  // Rotating intelligence themes (4 weeks cycle)
  const themes = [
    {
      headline: 'GCC Private Credit: The Conviction Gap',
      summary: `Private credit deployment across the GCC has accelerated sharply in ${year}, with family offices and sovereign vehicles increasingly bypassing traditional bank lending in favour of direct issuance. The analytical challenge is separating genuine covenant quality from headline yield compression. GCI\'s conviction engine has processed over forty private credit mandates this quarter, flagging structuring risk in 60% of cases where the sponsor narrative outpaced the operational cash flow data.`,
      insight: 'Sponsors with sub-4x EBITDA coverage presenting 18-month payback timelines are the most consistent red flag across our GCC deal pipeline this cycle.',
      cta: 'Our Private Credit Analyst and Due Diligence Analyst positions are open across Dubai DIFC and Riyadh.'
    },
    {
      headline: 'Dubai Real Estate: Intelligence vs. Sentiment',
      summary: `The off-plan market in Dubai continues to attract institutional interest from South Asian family offices and European HNWIs, but deal-level conviction remains difficult to establish without granular absorption data. GCI\'s real estate agent benchmarks developer delivery risk, regulatory compliance under RERA, and secondary market liquidity against comparable international benchmarks. Most platforms provide market data. GCI provides investment conviction.`,
      insight: 'Projects with developer-to-registrar title transfer timelines exceeding 36 months are carrying meaningful completion risk that headline brochures do not reflect.',
      cta: 'We are building our Real Estate Sector Intelligence team. The role is based in Dubai DIFC.'
    },
    {
      headline: 'Riyadh and the New Capital Intelligence Mandate',
      summary: `Vision 2030 has created a structurally different investment environment in Saudi Arabia. The megaproject layer (NEOM, Qiddiya, Diriyah) sits above a growing mid-market of technology, healthcare, and logistics transactions that require genuine analytical infrastructure. GCI deploys dedicated coverage agents for the Saudi private market, tracking regulatory shifts, PIF mandate alignment, and foreign ownership structures under the updated investment law.`,
      insight: 'Healthcare and education are the two sectors where Vision 2030 alignment is clearest and where private capital faces the least regulatory friction in the current cycle.',
      cta: 'GCI is actively recruiting for Investment Research Analyst (Riyadh) and DD Analyst (Riyadh) roles.'
    },
    {
      headline: 'AI-Native Investment Research: What the GCC Requires',
      summary: `The deployment of AI in investment analysis has bifurcated into two camps: surface-level summarisation tools that process documents faster than analysts, and genuine conviction architectures that model risk, identify principal misalignment, and synthesise across data sources to produce a defensible investment view. GCI operates exclusively in the second camp. Our six-agent system was built for the GCC specifically because the region\'s opacity, relationship-driven deal flow, and regulatory asymmetry require a different analytical framework than developed markets.`,
      insight: 'The most consistent failure point in GCC due diligence is regulatory risk assessment. Most mandates underweight DIFC, ADGM, and SAMA compliance considerations in their investment thesis.',
      cta: 'We are recruiting across all tracks. Technology and Venture Intelligence Analyst is open for exceptional candidates.'
    }
  ];

  return themes[(week - 1) % 4];
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Allow both cron (GET) and manual trigger (POST with admin secret)
  if (req.method === 'POST') {
    const { secret } = req.body || {};
    const ADMIN_SECRET = process.env.ADMIN_SECRET;
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
      return res.status(401).json({ error: 'Unauthorised' });
    }
  }

  if (!RESEND_API_KEY) {
    return res.status(500).json({ error: 'Email service not configured' });
  }

  const content = getWeeklyContent();
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' });

  // Fetch all subscriber emails
  const emails = await kvSmembers('gci:career:emails');
  if (!emails || emails.length === 0) {
    return res.status(200).json({ sent: 0, message: 'No subscribers yet' });
  }

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const email of emails) {
    // Get applicant name for personalisation
    const nameRaw = await kvGet(`gci:career:emailname:${email.toLowerCase().trim()}`);
    const name = nameRaw ? nameRaw.replace(/^"|"$/g, '') : 'there';
    const firstName = name.split(' ')[0];

    const unsubToken = Buffer.from(email).toString('base64url');
    const unsubLink = `https://gulfcapitalintelligence.com/api/careers-unsubscribe?t=${unsubToken}`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 0;">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

      <!-- Header -->
      <tr><td style="background:#0B1D35;padding:28px 36px;border-radius:8px 8px 0 0;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td><span style="color:#C8A84B;font-size:20px;font-weight:700;letter-spacing:0.5px;">Gulf Capital Intelligence</span><br>
            <span style="color:#8a9db5;font-size:12px;">DIFC | Dubai | Riyadh</span></td>
            <td align="right"><span style="color:#fff;font-size:11px;opacity:0.5;">${dateStr}</span></td>
          </tr>
        </table>
      </td></tr>

      <!-- Label -->
      <tr><td style="background:#C8A84B;padding:8px 36px;">
        <span style="color:#0B1D35;font-size:11px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;">GCC Intelligence Weekly</span>
      </td></tr>

      <!-- Body -->
      <tr><td style="background:#fff;padding:36px 36px 28px;border:1px solid #e8e8e8;border-top:none;">

        <p style="margin:0 0 8px;font-size:14px;color:#555;">Dear ${firstName},</p>

        <h2 style="margin:0 0 20px;font-size:22px;color:#0B1D35;line-height:1.3;">${content.headline}</h2>

        <p style="margin:0 0 20px;font-size:14px;line-height:1.8;color:#333;">${content.summary}</p>

        <div style="background:#f8f9fb;border-left:3px solid #C8A84B;padding:16px 20px;margin:0 0 24px;">
          <p style="margin:0 0 6px;font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;">GCI Intelligence Signal</p>
          <p style="margin:0;font-size:14px;color:#222;line-height:1.7;font-style:italic;">"${content.insight}"</p>
        </div>

        <div style="background:#0B1D35;border-radius:6px;padding:20px 24px;margin:0 0 24px;">
          <p style="margin:0 0 10px;font-size:12px;color:#C8A84B;text-transform:uppercase;letter-spacing:1px;">Open Roles at GCI</p>
          <p style="margin:0 0 14px;font-size:14px;color:#d8e0ea;line-height:1.7;">${content.cta}</p>
          <a href="https://gulfcapitalintelligence.com/careers" style="display:inline-block;background:#C8A84B;color:#0B1D35;text-decoration:none;padding:10px 22px;border-radius:4px;font-size:13px;font-weight:700;">View All Roles</a>
        </div>

        <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;padding-top:20px;margin-top:4px;">
          <tr>
            <td style="vertical-align:top;padding-right:20px;">
              <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px;">Platform Access</p>
              <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">Run a live conviction analysis on any GCC deal at:</p>
              <a href="https://gulfcapitalintelligence.com/app" style="color:#C8A84B;font-size:13px;font-weight:600;">gulfcapitalintelligence.com/app</a>
            </td>
            <td style="vertical-align:top;width:160px;text-align:right;">
              <p style="margin:0 0 8px;font-size:12px;color:#999;text-transform:uppercase;letter-spacing:1px;">Contact</p>
              <a href="mailto:difc@gulfcapitalintelligence.com" style="color:#555;font-size:13px;">difc@gulfcapitalintelligence.com</a>
            </td>
          </tr>
        </table>

      </td></tr>

      <!-- Footer -->
      <tr><td style="background:#f1f3f5;padding:16px 36px;border-radius:0 0 8px 8px;border:1px solid #e8e8e8;border-top:none;text-align:center;">
        <p style="margin:0 0 6px;font-size:11px;color:#aaa;">You are receiving this because you applied for a role at Gulf Capital Intelligence.</p>
        <p style="margin:0;font-size:11px;color:#aaa;">
          <a href="${unsubLink}" style="color:#aaa;">Unsubscribe</a> | Gulf Capital Intelligence | Gate Village, DIFC, Dubai
        </p>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

    const ok = await sendEmail(email, `GCI Intelligence Weekly | ${content.headline}`, html);
    if (ok) { sent++; } else { failed++; errors.push(email); }
  }

  // Send admin summary
  await sendEmail(
    ADMIN_EMAIL,
    `GCI Weekly Send Complete: ${sent} sent, ${failed} failed`,
    `<p>Weekly career intelligence email dispatched.</p><p>Sent: ${sent}<br>Failed: ${failed}</p>${errors.length ? `<p>Failed addresses: ${errors.join(', ')}</p>` : ''}`
  );

  console.log(`careers-weekly: sent=${sent}, failed=${failed}`);
  return res.status(200).json({ sent, failed, total: emails.length });
}
