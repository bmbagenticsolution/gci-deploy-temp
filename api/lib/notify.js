// lib/notify.js
// Outbound integrations for GCI events.
// Slack alerts (incoming webhook) and Apollo lead enrichment.
// Every helper is fire and forget. Failures are swallowed and never block.
//
// IMPORTANT: Apollo is shared with the founder's other business but the GCI
// audience is strictly separate. Every Apollo write here uses the dedicated
// label "GCI Inbound" so these contacts can only be added to a GCI specific
// sequence in the Apollo UI. Never reuse BoostMyLocalBusiness sequences for
// GCI leads, the targeting and tone are completely different.

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || '';
const APOLLO_API_KEY    = (process.env.APOLLO_API_KEY || '').trim();

const GCI_APOLLO_LABEL  = 'GCI Inbound';

function stripDashes(s) {
  if (s == null) return s;
  return String(s).replace(/[\u2013\u2014\u2015\u2012]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Slack incoming webhook alert. Posts a single block kit message.
// payload = { title, summary, fields: [{label, value}], url }
async function notifySlack(payload) {
  if (!SLACK_WEBHOOK_URL || !payload) return { ok: false, reason: 'no_webhook' };
  const fields = (payload.fields || []).filter(f => f && f.value).map(f => ({
    type: 'mrkdwn',
    text: `*${stripDashes(f.label)}*\n${stripDashes(f.value)}`
  }));
  const body = {
    text: stripDashes(payload.title || 'GCI event'),
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: stripDashes(payload.title || 'GCI event').slice(0, 150) } },
      ...(payload.summary ? [{ type: 'section', text: { type: 'mrkdwn', text: stripDashes(payload.summary) } }] : []),
      ...(fields.length ? [{ type: 'section', fields: fields.slice(0, 10) }] : []),
      ...(payload.url ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: `<${payload.url}|Open in HubSpot>` }] }] : [])
    ]
  };
  try {
    const r = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Apollo contact upsert. Pushes the GCI lead into Apollo with the dedicated
// "GCI Inbound" label so it lives in its own segment, separate from any
// other business that shares the same Apollo workspace.
async function apolloUpsertContact({ email, firstName, lastName, title, company, linkedinUrl, phone, source }) {
  if (!APOLLO_API_KEY || !email) return { ok: false, reason: 'no_key_or_email' };
  const labels = [GCI_APOLLO_LABEL];
  if (source) labels.push('GCI ' + source);
  const body = {
    api_key: APOLLO_API_KEY,
    first_name: firstName || '',
    last_name: lastName || '',
    title: title || '',
    organization_name: company || 'Gulf Capital Intelligence Lead',
    email: email.toLowerCase().trim(),
    linkedin_url: linkedinUrl || '',
    direct_phone: phone || '',
    label_names: labels
  };
  try {
    const r = await fetch('https://api.apollo.io/api/v1/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      body: JSON.stringify(body)
    });
    let resp = null;
    try { resp = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, id: resp && resp.contact && resp.contact.id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// Convenience fan out used by capture endpoints. Fires Slack and Apollo in
// parallel and never throws.
function fanOutLeadEvent({ kind, email, firstName, lastName, phone, company, title, linkedinUrl, summary, url, fields }) {
  notifySlack({
    title: kind ? `GCI ${kind}` : 'GCI event',
    summary,
    url,
    fields: [
      { label: 'Email', value: email },
      { label: 'Name', value: [firstName, lastName].filter(Boolean).join(' ') },
      { label: 'Company', value: company },
      ...(fields || [])
    ]
  }).catch(() => {});
  apolloUpsertContact({ email, firstName, lastName, title, company, linkedinUrl, phone, source: kind }).catch(() => {});
}

module.exports = { fanOutLeadEvent, apolloUpsertContact, notifySlack };
