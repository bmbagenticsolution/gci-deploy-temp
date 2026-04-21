// /api/openai-agent
// Proxies a Claude-shaped chat request to OpenAI Chat Completions and
// returns a response in Anthropic shape: { content: [{ text: "..." }] }
// so the front-end can use the same extraction code path.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const system = typeof body.system === 'string' ? body.system : '';
    const max_tokens = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? Math.min(body.max_tokens, 16000) : 4096;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) return res.status(400).json({ error: 'No messages provided' });
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });

    // Convert Anthropic-style messages (string content or array of blocks) to OpenAI format.
    const oaMessages = [];
    if (system) oaMessages.push({ role: 'system', content: system });
    for (const m of messages) {
      let content = '';
      if (typeof m.content === 'string') content = m.content;
      else if (Array.isArray(m.content)) {
        content = m.content
          .filter(function(b){ return b && b.type === 'text' && typeof b.text === 'string'; })
          .map(function(b){ return b.text; })
          .join('\n\n');
      }
      if (content) oaMessages.push({ role: m.role || 'user', content: content });
    }

    // Route via Cloudflare Worker proxy if OPENAI_BASE_URL is set (needed from
    // Azure UAE North, whose IPs OpenAI region-blocks). Default to direct.
    const _oaBase = (process.env.OPENAI_BASE_URL || 'https://gci-vercel-proxy.vercel.app/openai').replace(/\/+$/, '');
    const _oaHeaders = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
    };
    if (process.env.PROXY_SHARED_SECRET) _oaHeaders['x-proxy-secret'] = process.env.PROXY_SHARED_SECRET;
    const r = await fetch(_oaBase + '/v1/chat/completions', {
      method: 'POST',
      headers: _oaHeaders,
      body: JSON.stringify({
        model: body.model || 'gpt-4.1',
        messages: oaMessages,
        max_tokens: max_tokens,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.4
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || 'OpenAI API error' });
    }
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return res.status(200).json({
      content: [{ type: 'text', text: text }],
      model: data.model || 'gpt-4.1',
      usage: data.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'openai-agent error: ' + (err && err.message ? err.message : String(err)) });
  }
}
// cold-start trigger 1776807133
