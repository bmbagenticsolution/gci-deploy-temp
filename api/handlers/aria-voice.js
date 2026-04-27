// api/aria-voice.js - ARIA voice assistant
// Reasoning: Azure OpenAI (GPT-4o) or Gemini (no regional IP blocks from Azure SWA)
// TTS: Azure Speech Service or OpenAI via Cloudflare proxy
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

  // Prefer Azure OpenAI (same Azure tenant, no geo-blocks), fall back to Gemini
  const AOAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
  const AOAI_KEY = process.env.AZURE_OPENAI_KEY;
  const AOAI_DEPLOY = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4o';
  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  if (!AOAI_ENDPOINT && !GEMINI_KEY) {
    return res.status(500).json({ error: 'ARIA unavailable: no reasoning backend configured' });
  }

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

  // 1) Get text reply from Azure OpenAI (preferred) or Gemini (fallback)
  let replyText;
  try {
    if (AOAI_ENDPOINT && AOAI_KEY) {
      replyText = await callAzureOpenAI(AOAI_ENDPOINT, AOAI_KEY, AOAI_DEPLOY, systemPrompt, messages);
    } else {
      replyText = await callGemini(GEMINI_KEY, systemPrompt, messages);
    }
    if (!replyText) return res.status(502).json({ error: 'Empty reply from reasoning service' });
  } catch (e) {
    console.error('[aria-voice] Reasoning failed', e.message);
    return res.status(502).json({ error: 'Reasoning service error', detail: e.message });
  }

  // 2) Convert to speech via Azure Speech Service or OpenAI TTS
  const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY;
  const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!AZURE_SPEECH_KEY && !OPENAI_KEY) {
    res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
    return res.status(200).json({ text: replyText, audio: null });
  }

  try {
    let audioBuf;
    if (AZURE_SPEECH_KEY && AZURE_SPEECH_REGION) {
      audioBuf = await azureTTS(AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, replyText, sessionLanguage);
    } else {
      audioBuf = await openaiTTS(OPENAI_KEY, replyText);
    }

    if (audioBuf) {
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
      return res.status(200).send(audioBuf);
    }
  } catch (e) {
    console.error('[aria-voice] TTS failed, returning text-only', e.message);
  }

  // Fallback: text-only
  res.setHeader('X-ARIA-Text', Buffer.from(replyText, 'utf-8').toString('base64'));
  return res.status(200).json({ text: replyText, audio: null });
};

// Azure OpenAI chat completion
async function callAzureOpenAI(endpoint, key, deployment, systemPrompt, messages) {
  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=2024-08-01-preview`;
  const body = {
    messages: [
      { role: 'system', content: systemPrompt },
      ...messages.slice(-12)
    ],
    max_tokens: 250,
    temperature: 0.7
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': key },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Azure OpenAI ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

// Gemini chat completion (fallback)
async function callGemini(apiKey, systemPrompt, messages) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  const contents = messages.slice(-12).map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }]
  }));
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { maxOutputTokens: 250, temperature: 0.7 }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(`Gemini ${r.status}: ${errText.slice(0, 200)}`);
  }
  const data = await r.json();
  return (data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] &&
    data.candidates[0].content.parts[0].text) || '';
}

// Azure Speech Service TTS
async function azureTTS(key, region, text, lang) {
  const voice = lang === 'ar' ? 'ar-AE-FatimaNeural' : 'en-US-JennyNeural';
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang === 'ar' ? 'ar-AE' : 'en-US'}"><voice name="${voice}">${escapeXml(text)}</voice></speak>`;
  const url = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-16khz-128kbitrate-mono-mp3'
    },
    body: ssml
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error('[aria-voice] Azure TTS error', r.status, errText.slice(0, 200));
    return null;
  }
  return Buffer.from(await r.arrayBuffer());
}

// OpenAI TTS via Cloudflare proxy (direct OpenAI is geo-blocked from Azure East Asia)
async function openaiTTS(apiKey, text) {
  const url = (process.env.OPENAI_BASE_URL || 'https://api.openai.com') + '/v1/audio/speech';
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'nova', input: text, response_format: 'mp3' })
  });
  if (!r.ok) {
    const errText = await r.text();
    console.error('[aria-voice] OpenAI TTS error', r.status, errText.slice(0, 200));
    return null;
  }
  return Buffer.from(await r.arrayBuffer());
}

function escapeXml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
