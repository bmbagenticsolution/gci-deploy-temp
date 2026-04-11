// api/aria-voice.js  GPT-4o reasoning + GPT-4o-mini TTS (bilingual EN/AR)
// Front-end calls POST with {transcript, history, sessionLanguage, pageContext}
// Returns audio/mpeg blob with X-ARIA-Text header (base64 encoded reply text)

const ARIA_SYSTEM_EN = `You are ARIA, the voice concierge for Gulf Capital Intelligence (GCI), a DIFC-registered investment intelligence platform serving GCC capital allocators. You speak briefly, like a senior analyst on a phone call: 1 to 3 short sentences, no lists, no markdown, no emojis. You answer questions about GCI plans, the GCC investment landscape, and how to use the platform. If asked something off-topic, gently bring it back to investment intelligence.`;

const ARIA_SYSTEM_AR = `You are ARIA (pronounced ah-ree-ah), the voice concierge for Gulf Capital Intelligence (GCI), a DIFC-registered investment intelligence platform. You MUST reply ONLY in Modern Standard Arabic (MSA). Speak briefly like a senior analyst on a phone call: 1 to 3 short sentences, no lists, no markdown, no emojis. You answer questions about GCI plans, the GCC investment landscape, and how to use the platform. If asked something off-topic, gently redirect to investment intelligence. Always reply in Arabic regardless of input language when the session language is Arabic.`;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'X-ARIA-Text, X-ARIA-Lang');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!OPENAI_KEY && !ANTHROPIC_KEY) return res.status(500).json({ error: 'ARIA unavailable: missing API key' });

  const { transcript, history, sessionLanguage, pageContext } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript required' });
  }

  // Detect Arabic from transcript or session setting
  const hasArabic = /[\u0600-\u06FF]/.test(transcript);
  const isArabic = sessionLanguage === 'ar' || hasArabic;
  const lang = isArabic ? 'ar' : 'en';

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

  let systemPrompt = isArabic ? ARIA_SYSTEM_AR : ARIA_SYSTEM_EN;
  if (pageContext && pageContext.title) {
    systemPrompt += `\nCurrent page: ${pageContext.title} (${pageContext.page || ''})`;
  }

  // 1) Get text reply from GPT-4o (primary) with Claude as fallback
  let replyText;

  if (OPENAI_KEY) {
    // Primary: GPT-4o via OpenAI for fastest voice response
    try {
      const gptMessages = [
        { role: 'system', content: systemPrompt },
        ...messages.slice(-12)
      ];
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 250,
          temperature: 0.7,
          messages: gptMessages
        })
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error('[aria-voice] GPT-4o error', r.status, errText);
        // Fall through to Claude fallback
      } else {
        const data = await r.json();
        replyText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      }
    } catch (e) {
      console.error('[aria-voice] GPT-4o fetch failed', e.message);
    }
  }

  // Fallback: Claude if GPT-4o unavailable or failed
  if (!replyText && ANTHROPIC_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
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
        return res.status(502).json({ error: 'Reasoning service error' });
      }
      const data = await r.json();
      replyText = (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[aria-voice] Claude fetch failed', e.message);
      return res.status(502).json({ error: 'Reasoning service unreachable' });
    }
  }

  if (!replyText) return res.status(502).json({ error: 'Empty reply from reasoning service' });

  // 2) Convert to speech via OpenAI TTS
  //    Use "coral" voice for Arabic (strong multilingual support), "nova" for English
  //    gpt-4o-mini-tts for best speed/quality balance
  res.setHeader('X-ARIA-Lang', lang);

  if (!OPENAI_KEY) {
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).json({ text: replyText, audio: null, lang });
  }

  const ttsVoice = isArabic ? 'coral' : 'nova';
  const ttsInstructions = isArabic
    ? 'Speak in clear Modern Standard Arabic with a professional, calm tone. Pace should be moderate and articulate.'
    : 'Speak in a confident, professional tone like a senior financial analyst. Be warm but concise.';

  try {
    const ttsR = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        voice: ttsVoice,
        input: replyText,
        instructions: ttsInstructions,
        response_format: 'mp3',
        speed: 1.0
      })
    });
    if (!ttsR.ok) {
      const errText = await ttsR.text();
      console.error('[aria-voice] OpenAI TTS error', ttsR.status, errText);
      res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
      return res.status(200).json({ text: replyText, audio: null, lang });
    }
    const arrayBuf = await ttsR.arrayBuffer();
    const audioBuf = Buffer.from(arrayBuf);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).send(audioBuf);
  } catch (e) {
    console.error('[aria-voice] TTS fetch failed', e.message);
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).json({ text: replyText, audio: null, lang });
  }
}
