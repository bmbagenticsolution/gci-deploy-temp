// /api/admin-hubspot-backfill
// One-time sync of every GCI user from KV into HubSpot.
//
// Reads:
//   - users:all                    (master list of all signup emails)
//   - gci:user:<email>             (full user record per email)
//   - plan:<email>                 (subscription plan if any)
//   - gci:career:emails            (newsletter SET, lower-priority subscribers)
//
// Pushes each as a contact via the shared HubSpot helper. Rate-limited to avoid
// HubSpot's 100 requests / 10 sec ceiling.
//
// Auth: x-admin-token header must match ADMIN_API_TOKEN.
// GET  -> dry run, returns counts without pushing
// POST -> live run, pushes contacts
const { hsUpsertContact, hsConfigured, HS_LIFECYCLE, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, getRedisClient } = require('../redis-client');

async function kvSmembers(key) {
  const redis = getRedisClient();
  try {
    const members = await redis.smembers(key);
    return Array.isArray(members) ? members : [];
  } catch {
    return [];
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const dry = req.method === 'GET';

  if (!dry) {
    const adminToken = process.env.ADMIN_API_TOKEN || '';
    if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
      return res.status(401).json({ error: 'Unauthorized. Provide x-admin-token header.' });
    }
    if (!hsConfigured()) {
      return res.status(400).json({ error: 'HUBSPOT_PRIVATE_APP_TOKEN not set' });
    }
  }

  // Gather sources
  const userEmails = (await kvGet('users:all')) || [];
  const newsletterEmails = await kvSmembers('gci:career:emails');

  const seen = new Set();
  const work = [];

  for (const email of userEmails) {
    if (!email || seen.has(email)) continue;
    seen.add(email);
    work.push({ email, source: 'user' });
  }
  for (const email of newsletterEmails) {
    if (!email || seen.has(email)) continue;
    seen.add(email);
    work.push({ email, source: 'newsletter' });
  }

  if (dry) {
    return res.status(200).json({
      dryRun: true,
      total: work.length,
      breakdown: { users: userEmails.length, newsletter: newsletterEmails.length },
      sample: work.slice(0, 10)
    });
  }

  // Live run. Cap at 500 per request to stay within Vercel time limits.
  const cap = parseInt(req.query.cap || '500', 10);
  const batch = work.slice(0, cap);

  const results = { pushed: 0, errors: 0, skipped: 0 };
  for (const item of batch) {
    try {
      let user = null, plan = null;
      if (item.source === 'user') {
        user = (await kvGet('gci:user:' + item.email)) || {};
        plan = await kvGet('plan:' + item.email);
      } else {
        // Newsletter source: pull stored display name if available
        const nm = await kvGet('gci:career:emailname:' + item.email);
        user = { name: nm || '' };
      }

      const lifecycle = plan && plan.status === 'active'
        ? HS_LIFECYCLE.CUSTOMER
        : (item.source === 'user' ? HS_LIFECYCLE.MQL : HS_LIFECYCLE.SUBSCRIBER);

      const r = await hsUpsertContact({
        email: item.email,
        name: user.name || '',
        phone: user.mobile || '',
        company: user.company || '',
        source: item.source === 'user' ? HS_SOURCE.SIGNUP : HS_SOURCE.NEWSLETTER,
        lifecycleStage: lifecycle,
        extra: {
          gci_source: item.source === 'user' ? HS_SOURCE.SIGNUP : HS_SOURCE.NEWSLETTER,
          gci_user_id: item.email,
          gci_plan: plan ? (plan.plan || '') + (plan.status ? ' (' + plan.status + ')' : '') : '',
          gci_signup_date: user.created ? new Date(user.created).toISOString() : '',
          gci_admin_granted: user.adminGranted ? 'true' : 'false'
        }
      });
      if (r.ok) results.pushed++; else results.errors++;
    } catch {
      results.errors++;
    }
    // Stay well below HubSpot's 100/10s rate limit
    await sleep(120);
  }

  return res.status(200).json({
    ok: true,
    results,
    processed: batch.length,
    remaining: Math.max(0, work.length - batch.length),
    nextCap: 'POST again with ?cap=500&offset=' + batch.length + ' to continue.'
  });
}
