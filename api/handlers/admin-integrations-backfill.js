// /api/admin-integrations-backfill
// One shot push of every KV user into Apollo via lib/notify.js with the
// "GCI Inbound" label so they live in their own Apollo segment.
// Auth: x-admin-token header must match ADMIN_API_TOKEN.

const { apolloUpsertContact, notifySlack } = require('../lib/notify.js');
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

  const dryRun = req.method === 'GET';
  const emails = await kvSmembers('users:all');
  const results = { total: emails.length, apolloOk: 0, apolloFail: 0, sample: [] };

  for (const email of emails) {
    const u = (await kvGet('gci:user:' + email)) || {};
    const firstName = u.firstName || u.first_name || '';
    const lastName  = u.lastName  || u.last_name  || (email.split('@')[0]);
    const company   = u.company || u.organization || 'Gulf Capital Intelligence Lead';
    const phone     = u.phone || '';
    const linkedinUrl = u.linkedinUrl || u.linkedin_url || '';
    const title     = u.title || u.jobTitle || '';

    if (results.sample.length < 10) {
      results.sample.push({ email, firstName, lastName, company });
    }
    if (dryRun) continue;

    const a = await apolloUpsertContact({ email, firstName, lastName, title, company, linkedinUrl, phone, source: 'Backfill' });
    if (a.ok) results.apolloOk++; else results.apolloFail++;

    await new Promise(r => setTimeout(r, 100));
  }

  if (!dryRun) {
    notifySlack({
      title: 'GCI Apollo Backfill complete',
      summary: `Pushed ${emails.length} GCI contacts to Apollo with the GCI Inbound label.`,
      fields: [
        { label: 'Apollo OK',  value: String(results.apolloOk) },
        { label: 'Apollo Fail', value: String(results.apolloFail) }
      ]
    }).catch(() => {});
  }

  return res.status(200).json({ ok: true, dryRun, results });
}
