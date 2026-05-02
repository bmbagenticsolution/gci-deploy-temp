// /api/ai-checker
// Lightweight AI-content checker. Asks Claude Haiku to estimate the probability
// the supplied text was machine-generated and to flag stylistic tells. The
// front-end uses this for an after-the-fact sanity check; it never blocks the UI.

const ANTHROPIC_HEADERS = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01'
};

const SYSTEM = `You are an AI content detector. Given a text sample, return ONLY a strict JSON object of the form:
{"ai_probability": 0-1 number, "verdict": "human" | "mixed" | "ai", "tells": ["short phrase", ...]}
No prose. No markdown. No code fences.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const text = (body.text || '').toString().trim();
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

    const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
      method: 'POST',
      headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: 'user', content: text.substring(0, 12000) }]
      })
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Anthropic error' });

    const raw = (data.content && data.content[0] && data.content[0].text) || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { parsed = { ai_probability: 0.5, verdict: 'mixed', tells: [], raw: raw.substring(0, 500) }; }
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: 'ai-checker error: ' + (err && err.message ? err.message : String(err)) });
  }
}
// cold-start trigger 1776807133
