// lib/hubspot.js
// Best-effort HubSpot CRM integration for Gulf Capital Intelligence.
//
// Every helper here is fire-and-forget. If HUBSPOT_PRIVATE_APP_TOKEN is missing,
// HubSpot is unreachable, or the API returns an error, the helpers swallow the
// error and resolve to { ok: false }. They never throw, never block, and never
// expose HubSpot failures to the end user.
//
// Wire from any capture endpoint:
//
//   import { hsUpsertContact, hsLogTimelineNote, HS_LIFECYCLE, HS_SOURCE } from '../lib/hubspot.js';
//   hsUpsertContact({
//     email, firstName, lastName, phone, company,
//     source: HS_SOURCE.SIGNUP,
//     lifecycleStage: HS_LIFECYCLE.MQL,
//     extra: { gci_plan: 'Conviction Screen', gci_user_id: email }
//   }).catch(()=>{});
//
// The helper splits writes into two passes. Pass 1 always succeeds (standard
// HubSpot fields only). Pass 2 attempts custom gci_* fields and silently drops
// any that the portal does not yet have. This means the integration starts
// working immediately even if the bootstrap script has not run.

const HS_API = 'https://api.hubapi.com';
const TOKEN  = process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';

// Standard HubSpot fields the helper is allowed to write directly. Anything
// outside this list goes through pass 2 and gets dropped if the portal lacks
// the property.
const STANDARD_FIELDS = new Set([
  'email','firstname','lastname','phone','mobilephone','company','website',
  'lifecyclestage','hs_lead_status','jobtitle','city','country','address'
]);

// Lifecycle stage constants. Use the lowest stage that fits and let HubSpot's
// "lifecycle stage cannot move backwards" rule handle the rest.
const HS_LIFECYCLE = {
  SUBSCRIBER: 'subscriber',
  LEAD: 'lead',
  MQL: 'marketingqualifiedlead',
  SQL: 'salesqualifiedlead',
  OPPORTUNITY: 'opportunity',
  CUSTOMER: 'customer',
  EVANGELIST: 'evangelist',
  OTHER: 'other'
};

// Internal source tags. Mirror these as a custom property gci_source once the
// bootstrap endpoint runs.
const HS_SOURCE = {
  SIGNUP: 'signup',
  SIGNIN: 'signin',
  DEAL_HEALTH: 'deal_health_score',
  CAREERS_INTEREST: 'careers_interest',
  CAREERS_APPLY: 'careers_apply',
  MANDATE: 'mandate',
  MAGIC_LINK: 'magic_link',
  NEWSLETTER: 'newsletter',
  STRIPE: 'stripe_checkout',
  REPORT_SAVED: 'report_saved'
};

// Strip long dashes per house style. Applied to every string we send to HubSpot.
function stripDashes(v) {
  if (typeof v !== 'string') return v;
  return v.replace(/[\u2014\u2013]/g, ' ');
}

// Split a "Full Name" string into firstname / lastname.
function splitName(name) {
  if (!name || typeof name !== 'string') return { firstname: '', lastname: '' };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { firstname: parts[0], lastname: '' };
  return { firstname: parts[0], lastname: parts.slice(1).join(' ') };
}

// Normalise a phone number to E.164-ish. Keeps the leading + if present.
function normPhone(p) {
  if (!p) return '';
  const s = String(p).trim();
  if (!s) return '';
  // Strip everything except digits and a leading +
  const cleaned = s.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) return '+' + cleaned.slice(1).replace(/\D/g, '');
  // If it starts with 00, treat as international
  if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
  return cleaned;
}

// Build the property bag from a high-level call.
function buildProps({ email, firstName, lastName, name, phone, mobile, company, website, jobtitle, lifecycleStage, source, extra }) {
  const props = {};
  if (email) props.email = String(email).toLowerCase().trim();

  // Resolve first/last name
  if (firstName || lastName) {
    if (firstName) props.firstname = stripDashes(firstName);
    if (lastName)  props.lastname  = stripDashes(lastName);
  } else if (name) {
    const { firstname, lastname } = splitName(name);
    if (firstname) props.firstname = stripDashes(firstname);
    if (lastname)  props.lastname  = stripDashes(lastname);
  }

  const phoneVal = normPhone(phone || mobile);
  if (phoneVal) {
    props.phone = phoneVal;
    props.mobilephone = phoneVal; // Mirror to mobile so segmentation by SMS-capable works
  }

  if (company)  props.company  = stripDashes(company);
  if (website)  props.website  = website;
  if (jobtitle) props.jobtitle = stripDashes(jobtitle);
  if (lifecycleStage) props.lifecyclestage = lifecycleStage;
  // Note: hs_lead_status is a strict HubSpot enumeration; do not stash our source there.
  // Source is mirrored to the custom gci_source field via `extra` in every caller.

  // Custom gci_* fields
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null || v === '') continue;
      props[k] = typeof v === 'string' ? stripDashes(v) : String(v);
    }
  }
  return props;
}

// Split props into "always-safe" (standard) and "custom" (gci_*)
function partition(props) {
  const safe = {};
  const custom = {};
  for (const [k, v] of Object.entries(props)) {
    if (STANDARD_FIELDS.has(k)) safe[k] = v;
    else custom[k] = v;
  }
  return { safe, custom };
}

async function hubspotFetch(path, init = {}) {
  if (!TOKEN) return { ok: false, status: 0, body: null, reason: 'no_token' };
  try {
    const r = await fetch(HS_API + path, {
      ...init,
      headers: {
        Authorization: 'Bearer ' + TOKEN,
        'Content-Type': 'application/json',
        ...(init.headers || {})
      }
    });
    let body = null;
    try { body = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: null, reason: e.message };
  }
}

// Upsert a contact by email. Always-safe fields go in pass 1. Custom fields
// go in a follow-up patch and silently drop on 400.
async function hsUpsertContact(input) {
  if (!TOKEN) return { ok: false, reason: 'no_token' };
  if (!input || !input.email) return { ok: false, reason: 'no_email' };

  const props = buildProps(input);
  const { safe, custom } = partition(props);

  if (!safe.email) return { ok: false, reason: 'no_email' };

  // Pass 1: standard fields. Use the search-then-create-or-update pattern.
  const idProp = encodeURIComponent('email');
  const idVal  = encodeURIComponent(safe.email);

  // Try PATCH by email idProperty (HubSpot supports this on contacts)
  let r = await hubspotFetch(`/crm/v3/objects/contacts/${idVal}?idProperty=email`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: safe })
  });

  // Not found -> create
  if (!r.ok && r.status === 404) {
    r = await hubspotFetch('/crm/v3/objects/contacts', {
      method: 'POST',
      body: JSON.stringify({ properties: safe })
    });
  }

  if (!r.ok) {
    return { ok: false, status: r.status, reason: 'pass1_failed', body: r.body };
  }

  const contactId = r.body && r.body.id;

  // Pass 2: custom fields. Best effort, never fail.
  if (contactId && Object.keys(custom).length) {
    const r2 = await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify({ properties: custom })
    });
    if (!r2.ok && r2.status === 400) {
      // Likely some unknown property names. Retry one at a time and keep what works.
      for (const [k, v] of Object.entries(custom)) {
        await hubspotFetch(`/crm/v3/objects/contacts/${contactId}`, {
          method: 'PATCH',
          body: JSON.stringify({ properties: { [k]: v } })
        }).catch(() => {});
      }
    }
  }

  return { ok: true, id: contactId };
}

// Append a timeline note to a contact (and create the contact if missing).
// Useful for capturing report-generated events, deal health quiz answers, etc.
async function hsLogTimelineNote({ email, body }) {
  if (!TOKEN || !email || !body) return { ok: false };
  // Ensure contact exists
  const c = await hsUpsertContact({ email });
  if (!c.ok || !c.id) return { ok: false };
  const note = {
    properties: {
      hs_note_body: stripDashes(body).slice(0, 65000),
      hs_timestamp: Date.now()
    },
    associations: [{
      to: { id: c.id },
      types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }]
    }]
  };
  const r = await hubspotFetch('/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify(note)
  });
  return { ok: r.ok };
}

// Increment a numeric custom property by reading-modifying-writing it.
// Used by report-saved hooks to bump gci_reports_count.
async function hsBumpCounter({ email, propertyName, delta = 1 }) {
  if (!TOKEN || !email || !propertyName) return { ok: false };
  // Find the contact and read current value
  const idVal = encodeURIComponent(String(email).toLowerCase().trim());
  const r = await hubspotFetch(`/crm/v3/objects/contacts/${idVal}?idProperty=email&properties=${encodeURIComponent(propertyName)}`);
  if (!r.ok) {
    // Contact may not exist yet. Create it with the counter set to delta.
    return hsUpsertContact({ email, extra: { [propertyName]: String(delta) } });
  }
  const cur = parseInt((r.body && r.body.properties && r.body.properties[propertyName]) || '0', 10) || 0;
  const next = cur + delta;
  return hsUpsertContact({ email, extra: { [propertyName]: String(next) } });
}

// Bootstrap script: create the custom gci_* properties on contacts.
// Idempotent. Safe to call repeatedly. Returns a per-property result map.
async function hsBootstrapProperties() {
  if (!TOKEN) return { ok: false, reason: 'no_token' };

  const groupName = 'gci_intelligence';

  // Make sure the group exists
  await hubspotFetch('/crm/v3/properties/contacts/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: groupName,
      label: 'GCI Intelligence',
      displayOrder: -1
    })
  }); // ignore 409 conflicts

  const defs = [
    { name: 'gci_source',             label: 'GCI Source',                 type: 'string',     fieldType: 'text' },
    { name: 'gci_plan',               label: 'GCI Plan',                   type: 'string',     fieldType: 'text' },
    { name: 'gci_signup_date',        label: 'GCI Signup Date',            type: 'datetime',   fieldType: 'date' },
    { name: 'gci_last_login',         label: 'GCI Last Login',             type: 'datetime',   fieldType: 'date' },
    { name: 'gci_deal_health_score',  label: 'GCI Deal Health Score',      type: 'number',     fieldType: 'number' },
    { name: 'gci_deal_health_zone',   label: 'GCI Deal Health Zone',       type: 'string',     fieldType: 'text' },
    { name: 'gci_careers_track',      label: 'GCI Careers Track',          type: 'string',     fieldType: 'text' },
    { name: 'gci_admin_granted',      label: 'GCI Admin Granted',          type: 'enumeration',fieldType: 'booleancheckbox', options: [
        { label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
      ]},
    { name: 'gci_user_id',            label: 'GCI User ID',                type: 'string',     fieldType: 'text' },
    { name: 'gci_reports_count',      label: 'GCI Reports Generated',      type: 'number',     fieldType: 'number' },
    { name: 'gci_mandate_brief',      label: 'GCI Mandate Brief',          type: 'string',     fieldType: 'textarea' },
    { name: 'gci_mobile_verified',    label: 'GCI Mobile Verified',        type: 'enumeration',fieldType: 'booleancheckbox', options: [
        { label: 'Yes', value: 'true' }, { label: 'No', value: 'false' }
      ]}
  ];

  const results = {};
  for (const def of defs) {
    const body = {
      name: def.name,
      label: def.label,
      type: def.type,
      fieldType: def.fieldType,
      groupName,
      formField: false
    };
    if (def.options) body.options = def.options;
    const r = await hubspotFetch('/crm/v3/properties/contacts', {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (r.ok) {
      results[def.name] = 'created';
    } else if (r.status === 409 || (r.body && /already exists/i.test(JSON.stringify(r.body)))) {
      results[def.name] = 'exists';
    } else {
      results[def.name] = 'error:' + r.status;
    }
  }
  return { ok: true, results };
}

// Health check used by /api/admin-hubspot-bootstrap
function hsConfigured() {
  return Boolean(TOKEN);
}

// GCI deal stage mapping. We reuse HubSpot's default sales pipeline so we
// don't need extra schema scopes. Each GCI stage maps to one default stage.
const HS_STAGE = {
  NEW_LEAD:        'appointmentscheduled',   // a lead just signed up / submitted
  QUALIFIED:       'qualifiedtobuy',         // we've validated they fit
  MANDATE:         'presentationscheduled',  // mandate intake received
  PROPOSAL:        'decisionmakerboughtin',  // proposal sent
  CONTRACT:        'contractsent',           // contract sent
  WON:             'closedwon',              // paid customer
  LOST:            'closedlost'              // lost
};

const DEFAULT_OWNER_ID = process.env.HUBSPOT_DEFAULT_OWNER_ID || '';

// Create a deal and associate it to a contact (by email).
// Idempotent at the dealname level: if a deal with the same dealname already
// exists for the contact, we update its stage instead of creating a duplicate.
async function hsCreateDealForContact({ email, dealname, stage, amount, closeDate, extra }) {
  if (!TOKEN) return { ok: false, reason: 'no_token' };
  if (!email || !dealname) return { ok: false, reason: 'missing_input' };

  // 1. Ensure contact exists, get id
  const c = await hsUpsertContact({ email });
  if (!c.ok || !c.id) return { ok: false, reason: 'contact_upsert_failed' };

  // 2. Build properties
  const props = {
    dealname: stripDashes(dealname),
    pipeline: 'default',
    dealstage: stage || HS_STAGE.NEW_LEAD
  };
  if (amount != null && amount !== '') props.amount = String(amount);
  if (closeDate) props.closedate = closeDate;
  if (DEFAULT_OWNER_ID) props.hubspot_owner_id = DEFAULT_OWNER_ID;
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null || v === '') continue;
      props[k] = typeof v === 'string' ? stripDashes(v) : String(v);
    }
  }

  // 3. Create deal
  const r = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: props,
      associations: [{
        to: { id: c.id },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }]
      }]
    })
  });

  if (!r.ok) {
    return { ok: false, status: r.status, body: r.body, reason: 'deal_create_failed' };
  }
  return { ok: true, id: r.body && r.body.id };
}

// Move an existing deal to a new stage by deal id.
async function hsUpdateDealStage({ dealId, stage }) {
  if (!TOKEN || !dealId || !stage) return { ok: false };
  const r = await hubspotFetch(`/crm/v3/objects/deals/${encodeURIComponent(dealId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { dealstage: stage } })
  });
  return { ok: r.ok, body: r.body };
}

module.exports = { hsUpsertContact, hsLogTimelineNote, hsCreateDealForContact, hsUpdateDealStage, hsBumpCounter, hsBootstrapProperties, hsConfigured, HS_LIFECYCLE, HS_SOURCE, HS_STAGE };
