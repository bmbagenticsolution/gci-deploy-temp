// api/aria-voice.js — ARIA voice assistant: Claude reasoning + OpenAI TTS audio
// Front-end calls POST with {transcript, history, sessionLanguage, pageContext}
// Returns audio/mpeg blob with X-ARIA-Text header (base64 encoded reply text)

const ARIA_SYSTEM = `You are ARIA, the voice concierge for Gulf Capital Intelligence (GCI), a DIFC-registered investment intelligence platform serving GCC capital allocators. You speak briefly, like a senior analyst on a phone call: 1 to 3 short sentences, no lists, no markdown, no emojis. You answer questions about GCI plans, the GCC investment landscape, and how to use the platform. If asked something off-topic, gently bring it back to investment intelligence. If asked in Arabic, reply in Arabic.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-ARIA-Text');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!ANTHROPIC_KEY) return res.status(500).json({ error: 'ARIA unavailable: missing reasoning key' });

  const { transcript, history, sessionLanguage, pageContext } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript required' });
  }

  // Build messages array from history + current transcript
  const messages = [];
  if (Array.isArray(history)) {
    for (const m of history) {
      if (m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant')) {
        messages.push({ role: m.role, content: m.content });
      }
    }
  }
  messages.push({ role: 'user', content: transcript });

  let systemPrompt = ARIA_SYSTEM;
  if (pageContext && pageContext.title) {
    systemPrompt += `\nCurrent page: ${pageContext.title} (${pageContext.page || ''})`;
  }
  if (sessionLanguage === 'ar') {
    systemPrompt += '\nReply in Arabic, brief and natural.';
  }

  // 1) Get text reply from Claude (direct call; Anthropic has no regional blocks unlike OpenAI)
  const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
  let replyText;
  try {
    const r = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        system: systemPrompt,
        messages: messages.slice(-12)
      })
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[aria-voice] Claude error', r.status, errText);
      return res.status(502).json({ error: 'Reasoning service error', status: r.status, detail: errText.slice(0, 200) });
    }
    const data = await r.json();
    replyText = (data.content && data.content[0] && data.content[0].text) || '';
    if (!replyText) return res.status(502).json({ error: 'Empty reply from reasoning service' });
  } catch (e) {
    console.error('[aria-voice] Claude fetch failed', e.message);
    return res.status(502).json({ error: 'Reasoning service unreachable', detail: e.message });
  }

  // 2) Convert to speech via OpenAI TTS (if key available); otherwise return text-only response
  if (!OPENAI_KEY) {
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).json({ text: replyText, audio: null });
  }

  const OPENAI_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com') + '/v1/audio/speech';
  try {
    const ttsR = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: 'nova',
        input: replyText,
        response_format: 'mp3'
      })
    });
    if (!ttsR.ok) {
      const errText = await ttsR.text();
      console.error('[aria-voice] OpenAI TTS error', ttsR.status, errText);
      // Fall back to text-only
      res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
      return res.status(200).json({ text: replyText, audio: null });
    }
    const arrayBuf = await ttsR.arrayBuffer();
    const audioBuf = Buffer.from(arrayBuf);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).send(audioBuf);
  } catch (e) {
    console.error('[aria-voice] TTS fetch failed', e.message);
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).json({ text: replyText, audio: null });
  }
}
