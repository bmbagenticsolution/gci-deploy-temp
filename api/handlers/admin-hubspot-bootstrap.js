// /api/admin-hubspot-bootstrap
// One-time setup endpoint that creates the 12 GCI custom contact properties in HubSpot.
// Idempotent. Safe to call repeatedly.
//
// Auth: x-admin-token header must match ADMIN_API_TOKEN env var.
//
// GET  -> { configured: true|false, hint: '...' }
// POST -> { ok: true, results: { gci_source: 'created'|'exists'|'error:...', ... } }
const { hsBootstrapProperties, hsConfigured } = require('../lib/hubspot.js');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'GET') {
    return res.status(200).json({
      configured: hsConfigured(),
      hint: hsConfigured()
        ? 'POST with x-admin-token to create custom GCI properties on contacts.'
        : 'Set HUBSPOT_PRIVATE_APP_TOKEN in Vercel env vars to enable.'
    });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const adminToken = process.env.ADMIN_API_TOKEN || '';
  if (!adminToken || req.headers['x-admin-token'] !== adminToken) {
    return res.status(401).json({ error: 'Unauthorized. Provide x-admin-token header.' });
  }

  if (!hsConfigured()) {
    return res.status(400).json({ error: 'HUBSPOT_PRIVATE_APP_TOKEN not set' });
  }

  try {
    const result = await hsBootstrapProperties();
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
