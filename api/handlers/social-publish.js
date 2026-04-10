// /api/social-publish
// Generic forwarder for social media posting via Buffer or Make.com webhook.
// Body: { text, networks: ['linkedin','twitter','instagram'], imageUrl, scheduledAt }
// Auth: x-admin-token header must match ADMIN_API_TOKEN.

const SOCIAL_WEBHOOK_URL = process.env.SOCIAL_WEBHOOK_URL || '';

function stripDashes(s) {
  if (s == null) return s;
  return String(s).replace(/[\u2013\u2014\u2015\u2012]/g, ' ').replace(/\s+/g, ' ').trim();
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  const adminToken = process.env.ADMIN_API_TOKEN || '';
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!SOCIAL_WEBHOOK_URL) {
    return res.status(400).json({ error: 'SOCIAL_WEBHOOK_URL not configured. See marketing/SOCIAL_AUTOMATION_RUNBOOK.md.' });
  }

  let body = {};
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {}); } catch {}
  const text     = stripDashes(body.text || '');
  const networks = Array.isArray(body.networks) && body.networks.length ? body.networks : ['linkedin', 'twitter'];
  if (!text) return res.status(400).json({ error: 'text is required' });

  try {
    const r = await fetch(SOCIAL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        networks,
        imageUrl: body.imageUrl || null,
        scheduledAt: body.scheduledAt || null,
        source: 'gci-platform',
        timestamp: new Date().toISOString()
      })
    });
    return res.status(200).json({ ok: r.ok, status: r.status });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
}
