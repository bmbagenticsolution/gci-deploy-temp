// api/careers-apply.js , Stores job applications in KV and sends email notifications
const { hsUpsertContact, hsLogTimelineNote, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, kvSet, getRedisClient } = require('../redis-client');
const RESEND_API_KEY = process.env.RESEND_API_KEY;

const FROM_EMAIL  = 'difc@gulfcapitalintelligence.com';
const ADMIN_EMAIL = 'difc@gulfcapitalintelligence.com';

async function kvRpush(key, value) {
  const redis = getRedisClient();
  const strVal = typeof value === 'string' ? value : JSON.stringify(value);
  await redis.rpush(key, strVal);
  return true;
}

async function kvSadd(key, value) {
  const redis = getRedisClient();
  await redis.sadd(key, value);
  return true;
}

async function sendEmail({ to, subject, html, attachments }) {
  const body = { from: FROM_EMAIL, to, subject, html };
  if (attachments && attachments.length > 0) body.attachments = attachments;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });


  const {
    role,
    name,
    email,
    otp,
    whatsapp,
    linkedin,
    employer,
    title,
    firmType,
    city,
    experience,
    markets,
    dealAnswer,
    salaryExpectation,
    cvBase64,
    cvFilename,
    cvMimeType,
    consent
  } = req.body || {};

  if (!name || !email || !role) {
    return res.status(400).json({ error: 'Name, email, and role are required' });
  }
  if (!email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  if (!consent) {
    return res.status(400).json({ error: 'Consent required to process application' });
  }

  // Verify OTP before storing application
  if (!otp) {
    return res.status(400).json({ error: 'Email verification code required. Please verify your email first.' });
  }
  const cleanEmail = email.toLowerCase().trim();
  const storedOTP = await kvGet(`gci:otp:${cleanEmail}`);
  const storedRaw = storedOTP ? storedOTP.replace(/^"|"$/g, '') : null;
  if (!storedRaw || storedRaw !== otp.toString().trim()) {
    return res.status(401).json({ error: 'Invalid or expired verification code. Please request a new one.' });
  }
  // Invalidate the OTP after successful use (one-time use)
  const redis = getRedisClient();
  await redis.del(`gci:otp:${cleanEmail}`);

  const timestamp = Date.now();
  const appId = `gci-app-${timestamp}`;

  const application = {
    id: appId,
    role,
    name,
    email: email.toLowerCase().trim(),
    whatsapp: whatsapp || '',
    linkedin: linkedin || '',
    employer: employer || '',
    title: title || '',
    firmType: firmType || '',
    city: city || '',
    experience: experience || '',
    markets: markets || '',
    dealAnswer: dealAnswer || '',
    salaryExpectation: salaryExpectation || '',
    hasCV: !!cvBase64,
    cvFilename: cvFilename || '',
    submittedAt: new Date(timestamp).toISOString(),
    status: 'new'
  };

  // Store full application (without CV blob to keep manageable)
  await kvSet(`gci:career:app:${appId}`, JSON.stringify(application));

  // Push app ID to master list
  await kvRpush('gci:career:applications', appId);

  // Add email to weekly mailing set (deduped via SET)
  await kvSadd('gci:career:emails', email.toLowerCase().trim());

  // Store email->name mapping for personalisation
  await kvSet(`gci:career:emailname:${email.toLowerCase().trim()}`, name);

  // Best-effort HubSpot mirror
  hsUpsertContact({
    email: cleanEmail,
    name,
    phone: whatsapp,
    company: employer,
    jobtitle: title,
    source: HS_SOURCE.CAREERS_APPLY,
    lifecycleStage: HS_LIFECYCLE.LEAD,
    extra: {
      gci_source: HS_SOURCE.CAREERS_APPLY,
      gci_careers_track: role
    }
  }).then(() => hsLogTimelineNote({
    email: cleanEmail,
    body: `Career application for ${role}.\nFirm type: ${firmType||'n/a'} | City: ${city||'n/a'} | Experience: ${experience||'n/a'}\nLinkedIn: ${linkedin||'n/a'}\nSalary expectation: ${salaryExpectation||'n/a'}\n\nDeal answer:\n${(dealAnswer||'').slice(0,2000)}`
  })).catch(() => {});

  // Send notification to admin with CV attachment if provided
  const adminAttachments = [];
  if (cvBase64 && cvFilename) {
    adminAttachments.push({
      filename: cvFilename,
      content: cvBase64,
      type: cvMimeType || 'application/octet-stream',
      disposition: 'attachment'
    });
  }

  const adminHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <div style="background:#0B1D35;padding:24px 32px;">
    <img src="https://gulfcapitalintelligence.com/gci-logo-white.png" alt="GCI" style="height:36px;" onerror="this.style.display='none'">
    <h2 style="color:#C8A84B;margin:12px 0 0;font-size:20px;">New Career Application</h2>
  </div>
  <div style="padding:28px 32px;background:#fff;border:1px solid #e8e8e8;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr><td style="padding:6px 0;color:#666;width:160px;">Role Applied</td><td style="padding:6px 0;font-weight:600;color:#0B1D35;">${role}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Name</td><td style="padding:6px 0;">${name}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Email</td><td style="padding:6px 0;"><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td style="padding:6px 0;color:#666;">WhatsApp</td><td style="padding:6px 0;">${whatsapp ? `<a href="https://wa.me/${whatsapp.replace(/\D/g,'')}">${whatsapp}</a>` : 'Not provided'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">LinkedIn</td><td style="padding:6px 0;">${linkedin ? `<a href="${linkedin}">${linkedin}</a>` : 'Not provided'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Current Employer</td><td style="padding:6px 0;">${employer || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Current Title</td><td style="padding:6px 0;">${title || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Firm Type</td><td style="padding:6px 0;">${firmType || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Based In</td><td style="padding:6px 0;">${city || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Years Experience</td><td style="padding:6px 0;">${experience || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Markets Coverage</td><td style="padding:6px 0;">${markets || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">Salary Expectation</td><td style="padding:6px 0;">${salaryExpectation || 'Not stated'}</td></tr>
      <tr><td style="padding:6px 0;color:#666;">CV Attached</td><td style="padding:6px 0;">${cvBase64 ? `Yes (${cvFilename})` : 'No'}</td></tr>
    </table>
    ${dealAnswer ? `
    <div style="margin-top:20px;padding:16px;background:#f8f9fa;border-left:3px solid #C8A84B;">
      <div style="font-size:12px;color:#666;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px;">GCC Deal / Conviction Analysis</div>
      <div style="font-size:14px;color:#222;line-height:1.6;">${dealAnswer}</div>
    </div>` : ''}
    <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:12px;color:#999;">
      Application ID: ${appId} | Submitted: ${new Date(timestamp).toUTCString()}
    </div>
  </div>
</div>`;

  await sendEmail({
    to: ADMIN_EMAIL,
    subject: `GCI Application: ${name} for ${role}`,
    html: adminHtml,
    attachments: adminAttachments
  });

  // Send confirmation to applicant
  const confirmHtml = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;">
  <div style="background:#0B1D35;padding:24px 32px;">
    <h2 style="color:#C8A84B;margin:0;font-size:22px;">Gulf Capital Intelligence</h2>
    <p style="color:#8a9db5;margin:6px 0 0;font-size:13px;">DIFC | Dubai | Riyadh</p>
  </div>
  <div style="padding:32px;background:#fff;border:1px solid #e8e8e8;">
    <p style="font-size:15px;margin:0 0 16px;">Dear ${name},</p>
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Thank you for applying to the <strong>${role}</strong> position at Gulf Capital Intelligence.</p>
    <p style="font-size:14px;line-height:1.7;color:#444;margin:0 0 16px;">Your application has been received and is under review by our senior team. We evaluate all applications personally before responding, which means our process takes slightly longer than automated systems.</p>
    <p style="font-size:14px;line-height:1.7;color:#444;margin:0 0 24px;">As an introduction to how we work, we will send a sample GCI Conviction Report to your WhatsApp prior to any first conversation. This gives you a clear picture of the intelligence standard we hold our team to.</p>
    <div style="background:#f8f9fa;border-left:3px solid #C8A84B;padding:16px 20px;margin:0 0 24px;">
      <p style="margin:0;font-size:13px;color:#555;line-height:1.6;">GCI operates at the intersection of investment intelligence and technology. We deploy multi-agent AI systems to analyse GCC private deals across real estate, private credit, healthcare, and technology sectors. Our clients are family offices, sovereign funds, and private banks who make conviction decisions on the basis of our analysis.</p>
    </div>
    <p style="font-size:14px;line-height:1.7;color:#444;margin:0 0 8px;">In the meantime, you can explore our platform at:</p>
    <p style="margin:0 0 24px;"><a href="https://gulfcapitalintelligence.com" style="color:#C8A84B;font-weight:600;">gulfcapitalintelligence.com</a></p>
    <p style="font-size:14px;color:#444;margin:0 0 4px;">Warm regards,</p>
    <p style="font-size:14px;color:#444;margin:0;font-weight:600;">GCI Talent Team</p>
    <p style="font-size:13px;color:#999;margin:4px 0 0;">Gulf Capital Intelligence | difc@gulfcapitalintelligence.com</p>
  </div>
  <div style="padding:16px 32px;background:#f1f3f5;text-align:center;">
    <p style="font-size:11px;color:#999;margin:0;">This email was sent because you submitted a job application at gulfcapitalintelligence.com/careers. If this was not you, please disregard this message.</p>
  </div>
</div>`;

  await sendEmail({
    to: email,
    subject: `Your GCI Application: ${role}`,
    html: confirmHtml
  });

  return res.status(200).json({
    success: true,
    message: 'Application received. You will hear from us shortly.',
    id: appId
  });
}
