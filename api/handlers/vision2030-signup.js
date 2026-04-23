// api/handlers/vision2030-signup.js
// Handles the Vision 2030 AhAAN Moment campaign landing form.
// Validates, mails the lead the report download link, pings difc@ with a rich
// internal notification, and mirrors the contact into HubSpot with the
// vision2030_apr2026 campaign tag plus the decision horizon answer.

const { hsUpsertContact, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');

const REPORT_URL = 'https://gulfcapitalintelligence.com/reports/GCI-Vision-2030-14-Sectors-14-Verdicts.pdf';
const NOTIFY_EMAIL = 'difc@gulfcapitalintelligence.com';
const FREE_EMAIL_DOMAINS = new Set(['gmail.com','yahoo.com','hotmail.com','outlook.com','aol.com','icloud.com','live.com','msn.com','protonmail.com','ymail.com']);

const HORIZON_LABELS = {
  '60_days': 'Yes, in the next 60 days',
  '3_to_6_months': 'Within 3 to 6 months',
  'learning': 'No active decision, learning',
};

function escapeHtml(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handleVision2030(req, res, body) {
  const {
    first_name, last_name, email, organisation, role, decision_horizon, notes,
    campaign, form_id, lead_source_page, submitted_at
  } = body || {};

  // Validate required fields
  if (!first_name || !last_name || !email || !organisation || !role || !decision_horizon) {
    return res.status(400).json({ error: 'Please fill every required field.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return res.status(400).json({ error: 'Please use a valid email address.' });
  }

  const emailDomain = String(email).split('@')[1]?.toLowerCase() || '';
  const isFreeEmail = FREE_EMAIL_DOMAINS.has(emailDomain);
  const horizonLabel = HORIZON_LABELS[decision_horizon] || decision_horizon;
  const priority = decision_horizon === '60_days' ? 'HOT LEAD'
    : decision_horizon === '3_to_6_months' ? 'WARM LEAD'
    : 'LEARNING LEAD';
  const priorityEmoji = decision_horizon === '60_days' ? '🟢'
    : decision_horizon === '3_to_6_months' ? '🟡'
    : '⚪';
  const fullName = `${first_name} ${last_name}`.trim();
  const RESEND_KEY = process.env.RESEND_API_KEY;

  // 1. Internal notification to difc@
  if (RESEND_KEY) {
    const notesBlock = notes ? `<div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px 18px;margin:12px 0;font-size:13px;color:#fff"><div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Notes from lead</div>${escapeHtml(notes)}</div>` : '';
    const freeFlag = isFreeEmail ? '<div style="background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);border-radius:8px;padding:8px 12px;color:#FBBF24;font-size:11px;margin-bottom:10px">FLAG: free email domain (' + escapeHtml(emailDomain) + '). Slower triage.</div>' : '';

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'GCI Lead Capture <leads@gulfcapitalintelligence.com>',
        to: [NOTIFY_EMAIL],
        subject: `${priorityEmoji} ${priority}: ${fullName} downloaded Vision 2030 report`,
        html: `
<div style="font-family:'Instrument Sans',Arial,sans-serif;max-width:600px;margin:0 auto;background:#0B1D35;color:#fff;border-radius:12px;overflow:hidden">
  <div style="background:linear-gradient(135deg,#0B1D35,#0F2540);padding:28px 32px;border-bottom:2px solid #C8A84B">
    <div style="font-size:11px;letter-spacing:.12em;color:#C8A84B;text-transform:uppercase;margin-bottom:8px">Vision 2030 Campaign, AhAAN Moment</div>
    <div style="font-size:1.8rem;font-weight:600;color:#fff;font-family:'Cormorant Garamond',Georgia,serif">${escapeHtml(fullName)}</div>
    <div style="font-size:13px;color:rgba(255,255,255,.6);margin-top:4px">${escapeHtml(role)} at ${escapeHtml(organisation)}</div>
  </div>
  <div style="padding:26px 32px">
    ${freeFlag}
    <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
      <div style="background:rgba(200,168,75,.12);border:1px solid rgba(200,168,75,.3);border-radius:10px;padding:14px 18px;flex:1;min-width:140px">
        <div style="font-size:10px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em">Priority</div>
        <div style="font-size:15px;font-weight:700;color:#C8A84B;margin-top:4px">${priorityEmoji} ${priority}</div>
      </div>
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:14px 18px;flex:2;min-width:180px">
        <div style="font-size:10px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.08em">Decision horizon</div>
        <div style="font-size:13px;color:#fff;margin-top:4px">${escapeHtml(horizonLabel)}</div>
      </div>
    </div>
    <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:16px 20px;margin-bottom:16px">
      <div style="font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Contact</div>
      <div style="font-size:13px;color:#fff;margin-bottom:4px">Email: <a href="mailto:${escapeHtml(email)}" style="color:#C8A84B">${escapeHtml(email)}</a></div>
      <div style="font-size:13px;color:#fff;margin-bottom:4px">Organisation: ${escapeHtml(organisation)}</div>
      <div style="font-size:13px;color:#fff;margin-bottom:4px">Role: ${escapeHtml(role)}</div>
      <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:8px">Submitted: ${new Date(submitted_at || Date.now()).toLocaleString('en-GB', { timeZone: 'Asia/Dubai' })}</div>
    </div>
    ${notesBlock}
    <div style="text-align:center;margin-top:20px">
      <a href="https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(fullName + ' ' + organisation)}" style="display:inline-block;background:#C8A84B;color:#0B1D35;font-weight:700;font-size:13px;padding:11px 22px;border-radius:8px;text-decoration:none;margin:0 6px 6px">Find on LinkedIn</a>
      <a href="mailto:${escapeHtml(email)}?subject=${encodeURIComponent('Your Vision 2030 report, one follow up question')}" style="display:inline-block;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:13px;padding:11px 22px;border-radius:8px;text-decoration:none;margin:0 6px 6px">Reply by email</a>
    </div>
  </div>
  <div style="padding:14px 32px;border-top:1px solid rgba(255,255,255,.06);font-size:10px;color:rgba(255,255,255,.25);text-align:center">Gulf Capital Intelligence, DIFC, Dubai. Campaign tag vision2030_apr2026. Report ID GCI-AE66KN.</div>
</div>`
      })
    }).catch(() => {});

    // 2. Transactional email to the lead with the download link
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Gulf Capital Intelligence <reports@gulfcapitalintelligence.com>',
        to: [email],
        reply_to: NOTIFY_EMAIL,
        subject: 'Your Vision 2030 report: 14 Sectors, 14 Verdicts',
        html: `
<div style="font-family:'Instrument Sans',Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#0B1D35;padding:28px 32px;border-radius:12px 12px 0 0;border-bottom:2px solid #C8A84B">
    <div style="font-size:11px;letter-spacing:.12em;color:#C8A84B;text-transform:uppercase;margin-bottom:12px">Strategic Intelligence Report, Issue 01</div>
    <div style="font-size:1.6rem;font-weight:600;color:#fff;font-family:'Cormorant Garamond',Georgia,serif;line-height:1.25">Saudi Vision 2030. 14 Sectors. 14 Verdicts.</div>
  </div>
  <div style="padding:28px 32px;color:#1a2a3a;font-size:15px;line-height:1.7">
    <p style="margin:0 0 14px">Hi ${escapeHtml(first_name)},</p>
    <p style="margin:0 0 14px">Here is your free copy of the report.</p>
    <div style="text-align:center;margin:22px 0">
      <a href="${REPORT_URL}" style="display:inline-block;background:#C8A84B;color:#0B1D35;font-weight:700;font-size:14px;padding:14px 30px;border-radius:8px;text-decoration:none">Download the 13 page report</a>
    </div>
    <p style="margin:0 0 14px;font-size:14px;color:#374151">Two sectors are STRONG PROCEED. Four are PROCEED. Five are PROCEED WITH CONDITIONS. Three are AVOID. The contrarian finding is in Section 3 of the report.</p>
    <p style="margin:0 0 14px;font-size:14px;color:#374151">You told us your decision horizon is <strong>${escapeHtml(horizonLabel)}</strong>. ${decision_horizon === '60_days' ? 'Hemant will reach out within one business day. If you would rather skip the back and forth, reply to this email with the sector or question you want pressure tested, or WhatsApp +971 56 666 3137.' : decision_horizon === '3_to_6_months' ? 'If a specific sector needs a faster read, reply to this email and we will prioritise it.' : 'No follow up unless you ask for one. Reply to this email if anything in the report changes that.'}</p>
    <p style="margin:0 0 14px;font-size:13px;color:#4A5568">This report is Strategic Intelligence. It is not regulated investment advice.</p>
  </div>
  <div style="background:#0B1D35;padding:16px 32px;border-radius:0 0 12px 12px;font-size:11px;color:rgba(255,255,255,.55);text-align:center">
    Gulf Capital Intelligence, DIFC, Dubai. DIFC Trade Licence CL11954.<br>
    <a href="https://gulfcapitalintelligence.com" style="color:#C8A84B">gulfcapitalintelligence.com</a>
  </div>
</div>`
      })
    }).catch(() => {});
  }

  // 3. HubSpot mirror with campaign tag and decision horizon
  hsUpsertContact({
    email,
    firstName: first_name,
    lastName: last_name,
    company: organisation,
    source: HS_SOURCE.SIGNUP,
    lifecycleStage: decision_horizon === '60_days' ? HS_LIFECYCLE.MQL : HS_LIFECYCLE.LEAD,
    extra: {
      gci_campaign: 'vision2030_apr2026',
      gci_report_id: 'GCI-AE66KN',
      gci_role: role,
      gci_decision_horizon: horizonLabel,
      gci_notes: notes || '',
      gci_source_page: lead_source_page || '/vision2030',
      gci_free_email_flag: isFreeEmail ? 'true' : 'false',
    }
  }).catch(() => {});

  return res.status(200).json({
    ok: true,
    message: 'Download link sent. Check your inbox.',
    priority
  });
}

module.exports = { handleVision2030 };
