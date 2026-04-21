// /api/gemini-agent
// Proxies a Claude-shaped chat request to Google Gemini and returns
// a response in Anthropic shape: { content: [{ text: "..." }] }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const system = typeof body.system === 'string' ? body.system : '';
    const max_tokens = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? Math.min(body.max_tokens, 16000) : 4096;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) return res.status(400).json({ error: 'No messages provided' });
    if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

    // Convert to Gemini "contents" format
    const contents = [];
    for (const m of messages) {
      let text = '';
      if (typeof m.content === 'string') text = m.content;
      else if (Array.isArray(m.content)) {
        text = m.content
          .filter(function(b){ return b && b.type === 'text' && typeof b.text === 'string'; })
          .map(function(b){ return b.text; })
          .join('\n\n');
      }
      if (text) contents.push({ role: (m.role === 'assistant' ? 'model' : 'user'), parts: [{ text: text }] });
    }

    const model = body.model || 'gemini-2.5-pro';
    // Route via Cloudflare Worker proxy if GEMINI_BASE_URL is set (needed from
    // Azure UAE North, whose IPs Gemini region-blocks). Default to direct.
    const _gmBase = (process.env.GEMINI_BASE_URL || 'https://gci-vercel-proxy.vercel.app/gemini').replace(/\/+$/, '');
    const url = _gmBase + '/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(process.env.GEMINI_API_KEY);

    const payload = {
      contents: contents,
      generationConfig: {
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.4,
        maxOutputTokens: max_tokens
      }
    };
    if (system) payload.systemInstruction = { parts: [{ text: system }] };

    const _gmHeaders = { 'Content-Type': 'application/json' };
    if (process.env.PROXY_SHARED_SECRET) _gmHeaders['x-proxy-secret'] = process.env.PROXY_SHARED_SECRET;
    const r = await fetch(url, {
      method: 'POST',
      headers: _gmHeaders,
      body: JSON.stringify(payload)
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Gemini API error' });
    }

    let text = '';
    if (data.candidates && data.candidates[0] && data.candidates[0].content && Array.isArray(data.candidates[0].content.parts)) {
      text = data.candidates[0].content.parts.map(function(p){ return p.text || ''; }).join('');
    }

    return res.status(200).json({
      content: [{ type: 'text', text: text }],
      model: model,
      usage: data.usageMetadata || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'gemini-agent error: ' + (err && err.message ? err.message : String(err)) });
  }
}
