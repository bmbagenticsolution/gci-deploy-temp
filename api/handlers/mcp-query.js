// /api/mcp-query (managed /api proxy)
// Forwards to the real engine on func-gci-prod-4792 where the MCP logic lives.
// Keeps public URL gulfcapitalintelligence.com/api/mcp-query working without
// duplicating the entitlement + Anthropic call logic.

const BACKEND_URL = 'https://func-gci-prod-4792.azurewebsites.net/api/mcp-query';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const fwdHeaders = { 'Content-Type': 'application/json' };
    if (req.headers && req.headers.authorization) fwdHeaders['Authorization'] = req.headers.authorization;
    if (req.headers && req.headers.cookie) fwdHeaders['Cookie'] = req.headers.cookie;

    const bodyStr = req.body
      ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
      : '{}';

    const upstream = await fetch(BACKEND_URL, {
      method: 'POST',
      headers: fwdHeaders,
      body: bodyStr,
    });

    const text = await upstream.text();
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/json';
    res.setHeader('Content-Type', ct);

    if (ct.includes('application/json')) {
      try { return res.json(JSON.parse(text)); } catch { return res.send(text); }
    }
    return res.send(text);
  } catch (err) {
    return res.status(502).json({
      error: 'Upstream unreachable',
      detail: err && err.message ? err.message : String(err),
    });
  }
};
