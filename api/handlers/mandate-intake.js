// api/mandate-intake.js
// GCI Deal Flow Mandate Intake
// Accepts mandate submissions from active subscribers only.
// Generates reference number GCI-2026-XXXX, stores in KV, emails both client and GCI team.
const { hsUpsertContact, hsLogTimelineNote, hsCreateDealForContact, HS_LIFECYCLE, HS_SOURCE, HS_STAGE } = require('../lib/hubspot.js');
const { fanOutLeadEvent } = require('../lib/notify.js');
const { kvGet, kvSet, kvIncr, kvLpushWithTrim } = require('../redis-client');

async function sendEmail({ to, subject, html }) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) { console.warn('[mandate] RESEND_API_KEY not set'); return false; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Gulf Capital Intelligence <difc@gulfcapitalintelligence.com>',
        to: [to],
        subject,
        html,
      }),
    });
    return r.ok;
  } catch (e) {
    console.error('[mandate] Email error:', e.message);
    return false;
  }
}

// Verify session token and return plan data
async function verifyAndGetPlan(token) {
  if (!token) return null;
  const sessionRaw = await kvGet(`gci:session:${token}`);
  if (!sessionRaw) return null;
  let session;
  try { session = typeof sessionRaw === 'object' ? sessionRaw : JSON.parse(sessionRaw); } catch { return null; }
  if (!session?.email) return null;
  const planData = await kvGet(`plan:${session.email}`);
  if (!planData) return null;
  return { email: session.email, planData };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


  const {
    token,
    name,
    company,
    email,
    mobile,
    mandateType,
    assetClass,
    geography,
    dealSize,
    timeline,
    notes,
  } = req.body || {};

  // Validate required fields
  if (!name || !email || !mandateType || !assetClass || !dealSize) {
    return res.status(400).json({ error: 'Required fields: name, email, mandateType, assetClass, dealSize' });
  }
  if (!email.includes('@')) return res.status(400).json({ error: 'Valid email required' });

  // Verify active subscription (token auth)
  const auth = token ? await verifyAndGetPlan(token) : null;
  const isSubscriber = auth && ['active'].includes(auth.planData?.status);

  // Allow unauthenticated mandates from Tier 4 / enterprise inquiries, but gate full submission
  if (!isSubscriber) {
    return res.status(403).json({
      error: 'Active subscription required to submit a mandate. Please subscribe at gulfcapitalintelligence.com.',
      code: 'SUBSCRIPTION_REQUIRED',
    });
  }

  // Generate reference number: GCI-2026-XXXX
  const counter    = await kvIncr('mandate:counter');
  const year       = new Date().getFullYear();
  const refNumber  = `GCI-${year}-${String(counter).padStart(4, '0')}`;
  const submittedAt = new Date().toISOString();

  const mandate = {
    refNumber,
    name,
    company:      company || '',
    email:        email.toLowerCase().trim(),
    mobile:       mobile || '',
    mandateType,
    assetClass,
    geography:    geography || '',
    dealSize,
    timeline:     timeline || '',
    notes:        notes || '',
    submittedBy:  auth.email,
    plan:         auth.planData?.plan || 'unknown',
    submittedAt,
    status:       'received',
  };

  // Store mandate
  await kvSet(`mandate:${refNumber}`, mandate);

  // Add to user's mandate list
  const userMandatesKey = `mandates:${auth.email}`;
  const existing = (await kvGet(userMandatesKey)) || [];
  const list = Array.isArray(existing) ? existing : [];
  list.unshift(refNumber);
  await kvSet(userMandatesKey, list);

  // Add to global mandate list
  await kvLpushWithTrim('mandates:all', refNumber, 1000);

  // Send confirmation to client
  await sendEmail({
    to: email.toLowerCase().trim(),
    subject: `GCI Mandate Received: ${refNumber}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:'Helvetica Neue',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 16px">
  <tr><td align="center">
    <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;max-width:600px;overflow:hidden">
      <tr><td style="background:#0B1D35;padding:28px 40px;text-align:center">
        <div style="font-family:Georgia,serif;font-size:20px;color:#C8A84B;letter-spacing:0.04em">GULF CAPITAL INTELLIGENCE</div>
        <div style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;color:rgba(200,168,75,0.55);letter-spacing:0.15em;text-transform:uppercase;margin-top:5px">DIFC, Dubai</div>
      </td></tr>
      <tr><td style="padding:40px">
        <div style="font-size:22px;font-weight:600;color:#0B1D35;margin-bottom:8px">Mandate received.</div>
        <div style="font-size:14px;color:#5a6a7e;margin-bottom:28px;line-height:1.7">Your mandate submission has been logged. Your reference number is below.</div>
        <!-- Ref number -->
        <div style="background:#f8f9fb;border:1px solid #e2e6ed;border-radius:10px;padding:20px 24px;margin-bottom:28px;text-align:center">
          <div style="font-size:11px;color:#8a9bb0;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:8px">Reference Number</div>
          <div style="font-family:Georgia,serif;font-size:28px;color:#0B1D35;font-weight:600;letter-spacing:0.05em">${refNumber}</div>
        </div>
        <!-- Details -->
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px">
          <tr style="border-bottom:1px solid #f0f2f5"><td style="padding:10px 0;font-size:12px;color:#8a9bb0;width:140px">Mandate Type</td><td style="padding:10px 0;font-size:13px;color:#0B1D35;font-weight:500">${mandateType}</td></tr>
          <tr style="border-bottom:1px solid #f0f2f5"><td style="padding:10px 0;font-size:12px;color:#8a9bb0">Asset Class</td><td style="padding:10px 0;font-size:13px;color:#0B1D35;font-weight:500">${assetClass}</td></tr>
          <tr style="border-bottom:1px solid #f0f2f5"><td style="padding:10px 0;font-size:12px;color:#8a9bb0">Deal Size</td><td style="padding:10px 0;font-size:13px;color:#0B1D35;font-weight:500">${dealSize}</td></tr>
          ${geography ? `<tr style="border-bottom:1px solid #f0f2f5"><td style="padding:10px 0;font-size:12px;color:#8a9bb0">Geography</td><td style="padding:10px 0;font-size:13px;color:#0B1D35;font-weight:500">${geography}</td></tr>` : ''}
          ${timeline ? `<tr><td style="padding:10px 0;font-size:12px;color:#8a9bb0">Timeline</td><td style="padding:10px 0;font-size:13px;color:#0B1D35;font-weight:500">${timeline}</td></tr>` : ''}
        </table>
        <div style="font-size:13px;color:#5a6a7e;line-height:1.8">
          The GCI team has been notified. You can track this mandate in your subscriber dashboard using your reference number.
        </div>
      </td></tr>
      <tr><td style="background:#f8f9fb;border-top:1px solid #e2e6ed;padding:20px 40px;text-align:center">
        <div style="font-size:11px;color:#a0aab8">Gulf Capital Intelligence &bull; DIFC, Dubai, UAE &bull; <a href="mailto:difc@gulfcapitalintelligence.com" style="color:#0B1D35">difc@gulfcapitalintelligence.com</a></div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`,
  });

  // Notify GCI team
  await sendEmail({
    to: 'difc@gulfcapitalintelligence.com',
    subject: `New Mandate: ${refNumber} - ${mandateType} - ${dealSize}`,
    html: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:'Helvetica Neue',Arial,sans-serif;padding:32px;background:#f4f5f7">
  <div style="background:#fff;border-radius:10px;padding:32px;max-width:640px;margin:0 auto;border:1px solid #e2e6ed">
    <div style="font-family:Georgia,serif;font-size:16px;color:#C8A84B;margin-bottom:4px">GULF CAPITAL INTELLIGENCE</div>
    <div style="font-size:20px;font-weight:700;color:#0B1D35;margin-bottom:20px">New Mandate Submission</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px">
      <tr style="background:#f8f9fb"><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;width:150px;font-weight:600">Reference</td><td style="padding:10px 14px;font-size:14px;color:#0B1D35;font-weight:700">${refNumber}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Submitted By</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${name} (${email})</td></tr>
      <tr style="background:#f8f9fb"><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Company</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${company || 'Not provided'}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Plan</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${auth.planData?.plan || 'unknown'}</td></tr>
      <tr style="background:#f8f9fb"><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Mandate Type</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35;font-weight:600">${mandateType}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Asset Class</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${assetClass}</td></tr>
      <tr style="background:#f8f9fb"><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Deal Size</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35;font-weight:600">${dealSize}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Geography</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${geography || 'Not specified'}</td></tr>
      <tr style="background:#f8f9fb"><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Timeline</td><td style="padding:10px 14px;font-size:13px;color:#0B1D35">${timeline || 'Not specified'}</td></tr>
      <tr><td style="padding:10px 14px;font-size:12px;color:#8a9bb0;font-weight:600">Submitted At</td><td style="padding:10px 14px;font-size:12px;color:#0B1D35">${submittedAt}</td></tr>
    </table>
    ${notes ? `<div style="background:#f8f9fb;border-radius:8px;padding:16px 18px;margin-bottom:12px"><div style="font-size:11px;color:#8a9bb0;font-weight:600;margin-bottom:8px;text-transform:uppercase;letter-spacing:0.1em">Notes</div><div style="font-size:13px;color:#0B1D35;line-height:1.7">${notes}</div></div>` : ''}
  </div>
</body>
</html>`,
  });

  console.log(`[mandate-intake] Submitted ${refNumber} by ${auth.email}`);

  // Best-effort HubSpot mirror
  hsUpsertContact({
    email: email.toLowerCase().trim(),
    name,
    phone: mobile,
    company,
    source: HS_SOURCE.MANDATE,
    lifecycleStage: HS_LIFECYCLE.SQL,
    extra: {
      gci_source: HS_SOURCE.MANDATE,
      gci_plan: auth.planData?.plan || '',
      gci_mandate_brief: `${mandateType} | ${assetClass} | ${dealSize} | ${geography||''} | ${timeline||''}\n${notes||''}`.slice(0, 2000)
    }
  }).then(() => hsLogTimelineNote({
    email: email.toLowerCase().trim(),
    body: `Mandate submitted: ${refNumber}\nType: ${mandateType}\nAsset class: ${assetClass}\nDeal size: ${dealSize}\nGeography: ${geography||'n/a'}\nTimeline: ${timeline||'n/a'}\n\nNotes:\n${(notes||'').slice(0,2000)}`
  })).catch(() => {});

  // Auto-create a HubSpot deal for the mandate. Stage = Mandate Received.
  hsCreateDealForContact({
    email: email.toLowerCase().trim(),
    dealname: `Mandate ${refNumber} - ${mandateType} - ${dealSize}`,
    stage: HS_STAGE.MANDATE,
    extra: {
      description: `${mandateType} | ${assetClass} | ${dealSize} | ${geography||''} | ${timeline||''}\n${notes||''}`.slice(0, 2000)
    }
  }).catch(() => {});

  fanOutLeadEvent({
    kind: 'Mandate Submitted',
    email: email.toLowerCase().trim(),
    firstName: clientName ? String(clientName).split(' ')[0] : '',
    lastName:  clientName ? String(clientName).split(' ').slice(1).join(' ') : '',
    company:   companyName || '',
    summary:   `New mandate ${refNumber} from ${clientName || email}.`,
    fields: [
      { label: 'Reference', value: refNumber },
      { label: 'Type',      value: mandateType },
      { label: 'Asset',     value: assetClass },
      { label: 'Size',      value: dealSize },
      { label: 'Geography', value: geography },
      { label: 'Timeline',  value: timeline }
    ]
  });

  return res.status(200).json({
    success:   true,
    refNumber,
    message:   `Your mandate has been received. Reference: ${refNumber}. A confirmation has been sent to ${email}.`,
  });
}
