// api/capture-lead.js
// Captures Deal Health Score leads, stores in KV and emails Gaurav instantly
const { hsUpsertContact, hsLogTimelineNote, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, email, phone, score, answers, source, ts } = req.body || {};
  if (!email || !name) return res.status(400).json({ error: 'Name and email required' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const NOTIFY_EMAIL = 'difc@gulfcapitalintelligence.com';

  // Determine zone
  const zone = score >= 71 ? 'STRONG POSITION' : score >= 46 ? 'MODERATE GAPS' : 'HIGH RISK ZONE';
  const zoneEmoji = score >= 71 ? '🟢' : score >= 46 ? '🟡' : '🔴';
  const priority = score <= 45 ? 'HOT LEAD' : score <= 70 ? 'WARM LEAD' : 'ENGAGED LEAD';

  // Format answers for email
  const answerLines = Object.entries(answers || {}).map(([k, v]) => `  ${k}: score_weight=${v}`).join('\n');

  // 1. Notify Gaurav immediately
  if (RESEND_KEY) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'GCI Lead Capture <leads@gulfcapitalintelligence.com>',
        to: [NOTIFY_EMAIL],
        subject: `${zoneEmoji} ${priority}: ${name} scored ${score}/100 — Deal Health Score`,
        html: `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#0B1D35;color:#fff;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#0B1D35,#0d2340);padding:28px 32px;border-bottom:2px solid #C8A84B">
    <div style="font-size:11px;letter-spacing:.1em;color:#C8A84B;text-transform:uppercase;margin-bottom:8px">GCI LEAD ALERT · DEAL HEALTH SCORE</div>
    <div style="font-size:2rem;font-weight:700;color:#fff">${name}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:4px">${email}${phone ? ' · ' + phone : ''}</div>
  </div>
  <div style="padding:28px 32px">
    <div style="display:flex;gap:16px;margin-bottom:24px;flex-wrap:wrap">
      <div style="background:rgba(200,168,75,.1);border:1px solid rgba(200,168,75,.3);border-radius:10px;padding:16px 20px;flex:1;min-width:120px;text-align:center">
        <div style="font-size:2.2rem;font-weight:700;color:#C8A84B">${score}</div>
        <div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-top:2px">Score / 100</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:16px 20px;flex:2;min-width:160px">
        <div style="font-size:13px;font-weight:600;color:#fff">${zoneEmoji} ${zone}</div>
        <div style="font-size:12px;color:rgba(255,255,255,.5);margin-top:6px">Priority: <strong style="color:#C8A84B">${priority}</strong></div>
        <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:4px">Source: ${source || 'deal-health-score'}</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:16px 20px;margin-bottom:20px">
      <div style="font-size:11px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Contact Details</div>
      <div style="font-size:13px;color:#fff;margin-bottom:4px">📧 <a href="mailto:${email}" style="color:#C8A84B">${email}</a></div>
      ${phone ? `<div style="font-size:13px;color:#fff;margin-bottom:4px">📱 <a href="https://wa.me/${phone.replace(/\D/g,'')}" style="color:#C8A84B">+${phone}</a></div>` : ''}
      <div style="font-size:11px;color:rgba(255,255,255,.3);margin-top:8px">Submitted: ${new Date(ts || Date.now()).toLocaleString('en-GB', {timeZone:'Asia/Dubai'})}</div>
    </div>
    <div style="text-align:center;margin-top:24px">
      <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(name)}" target="_blank" style="display:inline-block;background:#C8A84B;color:#0B1D35;font-weight:700;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;margin:0 6px 8px">Find on LinkedIn</a>
      ${phone ? `<a href="https://wa.me/${phone.replace(/\D/g,'')}" target="_blank" style="display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:13px;padding:12px 24px;border-radius:8px;text-decoration:none;margin:0 6px 8px">WhatsApp Now</a>` : ''}
    </div>
  </div>
  <div style="padding:14px 32px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:rgba(255,255,255,.25);text-align:center">Gulf Capital Intelligence · DIFC, Dubai · gulfcapitalintelligence.com</div>
</div>`
      })
    }).catch(() => {});

    // 2. Send personalised thank-you to the lead
    const scoreColor = score >= 71 ? '#22C55E' : score >= 46 ? '#F59E0B' : '#EF4444';
    const followUp = score <= 45
      ? 'Given your score, I would recommend a quick 20-minute call to walk through the 3 specific blind spots I can see in your answers — no pitch, just the gaps on a screen.'
      : score <= 70
        ? 'Your score shows a solid foundation with 2 clear upgrade points. A 20-minute call lets me show you exactly where the signal gaps are in your specific asset class.'
        : 'With a score in the strong zone, the conversation is about edge — the 1 upgrade that separates good GCC investors from the ones consistently ahead of the market.';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Gaurav Kumar · GCI <gaurav@gulfcapitalintelligence.com>',
        to: [email],
        reply_to: 'difc@gulfcapitalintelligence.com',
        subject: `Your GCC Deal Health Score: ${score}/100 — ${zone}`,
        html: `
<div style="font-family:'DM Sans',Arial,sans-serif;max-width:560px;margin:0 auto">
  <div style="background:#0B1D35;padding:28px 32px;border-radius:12px 12px 0 0;border-bottom:2px solid #C8A84B">
    <div style="font-size:11px;letter-spacing:.1em;color:#C8A84B;text-transform:uppercase;margin-bottom:14px">Gulf Capital Intelligence</div>
    <div style="font-size:1.8rem;font-weight:700;color:#fff;line-height:1.2">Your GCC Deal Health Score is <span style="color:${scoreColor}">${score}/100</span></div>
  </div>
  <div style="background:#f8f9fa;padding:28px 32px">
    <p style="font-size:15px;color:#1a2a3a;line-height:1.7;margin-bottom:16px">Hi ${name.split(' ')[0]},</p>
    <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:16px">Your score places you in the <strong>${zone}</strong> zone. ${followUp}</p>
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:20px 24px;margin:20px 0;text-align:center">
      <div style="font-size:3rem;font-weight:700;color:${scoreColor}">${score}</div>
      <div style="font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.06em">Out of 100 · ${zone}</div>
    </div>
    <p style="font-size:14px;color:#374151;line-height:1.7;margin-bottom:20px">Book a free 20-minute strategy call and I will pull up your 3 specific signal gaps — live, on screen, specific to your portfolio focus.</p>
    <div style="text-align:center;margin:24px 0">
      <a href="https://wa.me/971554639500?text=Hi%20Gaurav%2C%20I%20just%20completed%20the%20GCC%20Deal%20Health%20Score.%20I%27d%20like%20to%20book%20a%2020-minute%20strategy%20call." style="display:inline-block;background:#C8A84B;color:#0B1D35;font-weight:700;font-size:14px;padding:14px 32px;border-radius:9px;text-decoration:none">Book Free 20-Min Call on WhatsApp →</a>
    </div>
    <p style="font-size:13px;color:#6b7280;line-height:1.6">Or simply reply to this email — I read every response personally.</p>
  </div>
  <div style="background:#0B1D35;padding:16px 32px;border-radius:0 0 12px 12px;font-size:11px;color:rgba(255,255,255,.35);text-align:center">
    Gaurav Kumar · Founder, Gulf Capital Intelligence · DIFC Dubai<br>
    <a href="https://www.linkedin.com/in/gauravkumardubai" style="color:#C8A84B">LinkedIn</a> ·
    <a href="https://gulfcapitalintelligence.com" style="color:#C8A84B">gulfcapitalintelligence.com</a>
  </div>
</div>`
      })
    }).catch(() => {});
  }

  // Best-effort HubSpot mirror
  hsUpsertContact({
    email,
    name,
    phone,
    source: HS_SOURCE.DEAL_HEALTH,
    lifecycleStage: HS_LIFECYCLE.LEAD,
    extra: {
      gci_source: HS_SOURCE.DEAL_HEALTH,
      gci_deal_health_score: typeof score === 'number' ? String(score) : '',
      gci_deal_health_zone: zone
    }
  }).then(() => {
    // Append the answers as a timeline note for context
    return hsLogTimelineNote({
      email,
      body: `Deal Health Score: ${score}/100 (${zone}). Priority: ${priority}. Source: ${source || 'deal-health-score'}.\n\nAnswers:\n${answerLines || '(none)'}`
    });
  }).catch(() => {});

  return res.status(200).json({ ok: true, score });
}
