// api/aria-voice.js  Azure OpenAI reasoning + Azure/OpenAI TTS (bilingual EN/AR)
// Priority: Azure OpenAI > Direct OpenAI > Anthropic Claude
// TTS: Azure OpenAI TTS > Direct OpenAI TTS > text-only fallback
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

  // Azure OpenAI config (preferred - no geo restrictions)
  const AZURE_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || ''; // e.g. https://aoai-gci-prod.openai.azure.com
  const AZURE_KEY = process.env.AZURE_OPENAI_KEY || '';
  const AZURE_CHAT_DEPLOYMENT = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o'; // deployment name
  const AZURE_TTS_DEPLOYMENT = process.env.AZURE_OPENAI_TTS_DEPLOYMENT || 'tts'; // TTS deployment name
  const AZURE_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';

  // Direct OpenAI (fallback - may be geo-blocked)
  const OPENAI_KEY = process.env.OPENAI_API_KEY || '';

  // Anthropic Claude (last resort fallback)
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

  if (!AZURE_KEY && !OPENAI_KEY && !ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ARIA unavailable: no API keys configured' });
  }

  const { transcript, history, sessionLanguage, pageContext } = req.body || {};
  if (!transcript || typeof transcript !== 'string') {
    return res.status(400).json({ error: 'transcript required' });
  }

  // Check if this is a greeting request (widget just opened, no user speech yet)
  const isGreeting = transcript === '__greet__';

  // Detect Arabic from transcript or session setting
  const hasArabic = !isGreeting && /[\u0600-\u06FF]/.test(transcript);
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

  // For greeting requests, use a special user message that prompts a natural introduction
  if (isGreeting) {
    messages.push({ role: 'user', content: isArabic
      ? 'Please introduce yourself briefly in Arabic. The visitor just opened the voice widget.'
      : 'Please introduce yourself briefly. The visitor just opened the voice widget on the GCI website.' });
  } else {
    messages.push({ role: 'user', content: transcript });
  }

  let systemPrompt = isArabic ? ARIA_SYSTEM_AR : ARIA_SYSTEM_EN;
  if (pageContext && pageContext.title) {
    systemPrompt += `\nCurrent page: ${pageContext.title} (${pageContext.page || ''})`;
  }

  // ========== 1) GET TEXT REPLY ==========
  let replyText;
  let debugErrors = [];
  const gptMessages = [{ role: 'system', content: systemPrompt }, ...messages.slice(-12)];

  // --- Try 1: Azure OpenAI (no geo restrictions) ---
  if (!replyText && AZURE_ENDPOINT && AZURE_KEY) {
    try {
      const url = `${AZURE_ENDPOINT.replace(/\/+$/, '')}/openai/deployments/${AZURE_CHAT_DEPLOYMENT}/chat/completions?api-version=${AZURE_API_VERSION}`;
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': AZURE_KEY },
        body: JSON.stringify({ max_tokens: 250, temperature: 0.7, messages: gptMessages })
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error('[aria-voice] Azure OpenAI error', r.status, errText);
        debugErrors.push({ provider: 'azure-openai', deployment: AZURE_CHAT_DEPLOYMENT, status: r.status, detail: errText.substring(0, 200) });
      } else {
        const data = await r.json();
        replyText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      }
    } catch (e) {
      console.error('[aria-voice] Azure OpenAI fetch failed', e.message);
      debugErrors.push({ provider: 'azure-openai', error: e.message });
    }
  }

  // --- Try 2: Direct OpenAI API (may be geo-blocked from some Azure regions) ---
  if (!replyText && OPENAI_KEY) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 250, temperature: 0.7, messages: gptMessages })
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error('[aria-voice] Direct OpenAI error', r.status, errText);
        debugErrors.push({ provider: 'openai-direct', status: r.status, detail: errText.substring(0, 200) });
      } else {
        const data = await r.json();
        replyText = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      }
    } catch (e) {
      console.error('[aria-voice] Direct OpenAI fetch failed', e.message);
      debugErrors.push({ provider: 'openai-direct', error: e.message });
    }
  }

  // --- Try 3: Anthropic Claude (last resort) ---
  if (!replyText && ANTHROPIC_KEY) {
    try {
      const claudeModel = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: claudeModel, max_tokens: 250, system: systemPrompt, messages: messages.slice(-12) })
      });
      if (!r.ok) {
        const errText = await r.text();
        console.error('[aria-voice] Claude error', r.status, errText);
        debugErrors.push({ provider: 'anthropic', model: claudeModel, status: r.status, detail: errText.substring(0, 200) });
      } else {
        const data = await r.json();
        replyText = (data.content && data.content[0] && data.content[0].text) || '';
      }
    } catch (e) {
      console.error('[aria-voice] Claude fetch failed', e.message);
      debugErrors.push({ provider: 'anthropic', error: e.message });
    }
  }

  if (!replyText) {
    return res.status(502).json({ error: 'All reasoning providers failed', debug: debugErrors });
  }

  // ========== 2) CONVERT TO SPEECH (TTS) ==========
  res.setHeader('X-ARIA-Lang', lang);

  const ttsVoice = isArabic ? 'coral' : 'nova';
  const ttsInstructions = isArabic
    ? 'Speak in clear Modern Standard Arabic with a professional, calm tone. Pace should be moderate and articulate.'
    : 'Speak in a confident, professional tone like a senior financial analyst. Be warm but concise.';

  let audioBuf = null;

  // --- TTS Try 1: Azure OpenAI TTS ---
  if (!audioBuf && AZURE_ENDPOINT && AZURE_KEY && AZURE_TTS_DEPLOYMENT) {
    try {
      const ttsUrl = `${AZURE_ENDPOINT.replace(/\/+$/, '')}/openai/deployments/${AZURE_TTS_DEPLOYMENT}/audio/speech?api-version=${AZURE_API_VERSION}`;
      const ttsR = await fetch(ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': AZURE_KEY },
        body: JSON.stringify({
          model: AZURE_TTS_DEPLOYMENT,
          voice: ttsVoice,
          input: replyText,
          instructions: ttsInstructions,
          response_format: 'mp3',
          speed: 1.0
        })
      });
      if (ttsR.ok) {
        const arrayBuf = await ttsR.arrayBuffer();
        audioBuf = Buffer.from(arrayBuf);
      } else {
        const errText = await ttsR.text();
        console.error('[aria-voice] Azure TTS error', ttsR.status, errText);
      }
    } catch (e) {
      console.error('[aria-voice] Azure TTS fetch failed', e.message);
    }
  }

  // --- TTS Try 2: Direct OpenAI TTS ---
  if (!audioBuf && OPENAI_KEY) {
    try {
      const ttsR = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini-tts',
          voice: ttsVoice,
          input: replyText,
          instructions: ttsInstructions,
          response_format: 'mp3',
          speed: 1.0
        })
      });
      if (ttsR.ok) {
        const arrayBuf = await ttsR.arrayBuffer();
        audioBuf = Buffer.from(arrayBuf);
      } else {
        const errText = await ttsR.text();
        console.error('[aria-voice] Direct OpenAI TTS error', ttsR.status, errText);
      }
    } catch (e) {
      console.error('[aria-voice] Direct OpenAI TTS fetch failed', e.message);
    }
  }

  // --- Return audio or text-only fallback ---
  res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));

  if (audioBuf && audioBuf.length > 0) {
    res.setHeader('Content-Type', 'audio/mpeg');
    return res.status(200).send(audioBuf);
  }

  // No audio available, return text-only (front-end will use browser TTS)
  return res.status(200).json({ text: replyText, audio: null, lang });
}
