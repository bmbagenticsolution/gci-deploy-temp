// api/hubspot-webhook.js
// Two-way sync receiver: HubSpot calls this when a contact's properties
// change. We mirror lifecycle stage, lead status, and notes back into KV.
//
// To enable:
//   1. In HubSpot, create a Webhooks subscription on contact.propertyChange
//      pointing to https://gulfcapitalintelligence.com/api/hubspot-webhook
//   2. Set HUBSPOT_WEBHOOK_SECRET env var to the value HubSpot signs requests
//      with (X-HubSpot-Signature-v3 header), or leave empty to skip
//      verification (not recommended for production).
//
// Idempotent. Always returns 200 even on errors so HubSpot does not retry.

const crypto = require('crypto');
const { kvGet, kvSet, getRedisClient } = require('../redis-client');

const SECRET   = process.env.HUBSPOT_WEBHOOK_SECRET || '';
const HS_TOK   = process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';

async function kvLpush(key, value) {
  try {
    const redis = getRedisClient();
    const strVal = typeof value === 'string' ? value : JSON.stringify(value);
    await redis.lpush(key, strVal);
    await redis.ltrim(key, 0, 999);
    return true;
  } catch { return false; }
}

// Resolve a HubSpot contact id to its email + key properties.
async function fetchContactById(contactId) {
  if (!HS_TOK || !contactId) return null;
  try {
    const r = await fetch(
      `https://api.hubapi.com/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=email,lifecyclestage,hs_lead_status,gci_plan,gci_source,firstname,lastname,phone`,
      { headers: { Authorization: `Bearer ${HS_TOK}` } }
    );
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Read raw body so we can verify the HubSpot v3 signature.
async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    const t = setTimeout(() => reject(new Error('timeout')), 15000);
    req.on('data', c => { data += c; if (data.length > 1024 * 1024) { clearTimeout(t); reject(new Error('too large')); } });
    req.on('end', () => { clearTimeout(t); resolve(data); });
    req.on('error', e => { clearTimeout(t); reject(e); });
  });
}

export const config = { api: { bodyParser: false } };

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  let raw = '';
  try { raw = await getRawBody(req); }
  catch { return res.status(200).json({ ok: false, reason: 'body_read' }); }

  // Optional: verify HubSpot v3 signature
  if (SECRET) {
    try {
      const sig    = req.headers['x-hubspot-signature-v3'] || '';
      const ts     = req.headers['x-hubspot-request-timestamp'] || '';
      const method = (req.method || 'POST').toUpperCase();
      const proto  = (req.headers['x-forwarded-proto'] || 'https');
      const host   = req.headers['host'] || '';
      const url    = proto + '://' + host + (req.url || '/api/hubspot-webhook');
      const base   = method + url + raw + ts;
      const expect = crypto.createHmac('sha256', SECRET).update(base).digest('base64');
      if (!sig || expect !== sig) {
        console.warn('[hs-webhook] signature mismatch');
        return res.status(200).json({ ok: false, reason: 'sig' });
      }
    } catch (e) {
      console.warn('[hs-webhook] signature verify error:', e.message);
    }
  }

  let events = [];
  try { events = JSON.parse(raw); } catch { return res.status(200).json({ ok: false, reason: 'json' }); }
  if (!Array.isArray(events)) events = [events];

  let processed = 0, ignored = 0;
  for (const ev of events) {
    try {
      // We only handle contact property changes for now
      if (ev.subscriptionType !== 'contact.propertyChange' && ev.subscriptionType !== 'contact.creation') {
        ignored++;
        continue;
      }
      const contactId = ev.objectId;
      const contact   = await fetchContactById(contactId);
      const email     = contact?.properties?.email;
      if (!email) { ignored++; continue; }

      const props = contact.properties || {};
      const userKey = `gci:user:${email}`;
      const existing = (await kvGet(userKey)) || { email };

      const merged = { ...existing };
      if (props.firstname || props.lastname) {
        merged.name = [props.firstname, props.lastname].filter(Boolean).join(' ');
      }
      if (props.phone) merged.mobile = props.phone;
      merged.hubspotContactId = String(contactId);
      merged.hubspotLifecycleStage = props.lifecyclestage || merged.hubspotLifecycleStage || '';
      merged.hubspotLeadStatus     = props.hs_lead_status || merged.hubspotLeadStatus || '';
      merged.hubspotGciPlan        = props.gci_plan || merged.hubspotGciPlan || '';
      merged.hubspotSyncedAt       = new Date().toISOString();

      await kvSet(userKey, merged);

      // Add to recent HS events log
      await kvLpush('events:hubspot', {
        ts: new Date().toISOString(),
        email,
        contactId: String(contactId),
        change: ev.propertyName || ev.subscriptionType,
        value: ev.propertyValue || null
      });

      processed++;
    } catch (e) {
      console.error('[hs-webhook] event error:', e.message);
    }
  }

  return res.status(200).json({ ok: true, processed, ignored });
}
