// /api/admin-hubspot-lists
// Creates the GCI segmented contact lists in HubSpot.
// Idempotent. Safe to call repeatedly.
//
// Lists created:
//   1. GCI Customers              (lifecyclestage = customer)
//   2. GCI MQL Users              (lifecyclestage = marketingqualifiedlead AND gci_source = signup)
//   3. GCI Newsletter Subscribers (gci_source = newsletter)
//   4. GCI Mandate Submitters     (gci_mandate_brief HAS_PROPERTY)
//   5. GCI Deal Health Hot Zone   (gci_deal_health_score >= 70)
//
// Auth: x-admin-token header must match ADMIN_API_TOKEN.

const TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN || '';
const HS_API = 'https://api.hubapi.com';

async function hsFetch(path, init = {}) {
  if (!TOKEN) return { ok: false, status: 0, body: null };
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

// HubSpot v3 lists API uses "filterBranch" with operations.
// We use ACTIVE lists so they auto-refresh as contacts change.
// HubSpot v3 Lists API requires the root filterBranch to be OR with nested
// AND branches. Each AND branch holds the actual property filters.
function wrap(filters) {
  return {
    filterBranchType: 'OR',
    filterBranchOperator: 'OR',
    filterBranches: [
      {
        filterBranchType: 'AND',
        filterBranchOperator: 'AND',
        filterBranches: [],
        filters
      }
    ],
    filters: []
  };
}

const LISTS = [
  {
    name: 'GCI Customers',
    processingType: 'DYNAMIC',
    objectTypeId: '0-1',
    filterBranch: wrap([{
      filterType: 'PROPERTY',
      property: 'lifecyclestage',
      operation: { operationType: 'ENUMERATION', operator: 'IS_ANY_OF', values: ['customer'] }
    }])
  },
  {
    name: 'GCI MQL Users',
    processingType: 'DYNAMIC',
    objectTypeId: '0-1',
    filterBranch: wrap([
      {
        filterType: 'PROPERTY',
        property: 'lifecyclestage',
        operation: { operationType: 'ENUMERATION', operator: 'IS_ANY_OF', values: ['marketingqualifiedlead'] }
      },
      {
        filterType: 'PROPERTY',
        property: 'gci_source',
        operation: { operationType: 'STRING', operator: 'IS_EQUAL_TO', value: 'signup' }
      }
    ])
  },
  {
    name: 'GCI Newsletter Subscribers',
    processingType: 'DYNAMIC',
    objectTypeId: '0-1',
    filterBranch: wrap([{
      filterType: 'PROPERTY',
      property: 'gci_source',
      operation: { operationType: 'STRING', operator: 'IS_EQUAL_TO', value: 'newsletter' }
    }])
  },
  {
    name: 'GCI Mandate Submitters',
    processingType: 'DYNAMIC',
    objectTypeId: '0-1',
    filterBranch: wrap([{
      filterType: 'PROPERTY',
      property: 'gci_mandate_brief',
      operation: { operationType: 'STRING', operator: 'IS_NOT_EQUAL_TO', value: '' }
    }])
  },
  {
    name: 'GCI Deal Health Hot Zone',
    processingType: 'DYNAMIC',
    objectTypeId: '0-1',
    filterBranch: wrap([{
      filterType: 'PROPERTY',
      property: 'gci_deal_health_score',
      operation: { operationType: 'NUMBER', operator: 'IS_GREATER_THAN_OR_EQUAL_TO', value: 70 }
    }])
  }
];

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const adminToken = process.env.ADMIN_API_TOKEN || '';
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-admin-token header.' });
  }
  if (!TOKEN) return res.status(400).json({ error: 'HUBSPOT_PRIVATE_APP_TOKEN not set' });

  const results = {};
  for (const def of LISTS) {
    // Try create
    const r = await hsFetch('/crm/v3/lists/', {
      method: 'POST',
      body: JSON.stringify(def)
    });
    if (r.ok) {
      results[def.name] = { status: 'created', id: r.body && r.body.list && r.body.list.listId };
    } else if (r.status === 409 || (r.body && /already exists|duplicate/i.test(JSON.stringify(r.body)))) {
      results[def.name] = { status: 'exists' };
    } else {
      results[def.name] = { status: 'error', code: r.status, body: r.body };
    }
  }

  return res.status(200).json({ ok: true, results });
}
