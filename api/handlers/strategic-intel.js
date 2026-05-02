// /api/strategic-intel
// GCI Strategic Intelligence pipeline. Front-end calls this with:
//   { clientBrief, hypothesis?, constraints?, horizon? }
// and expects back:
//   { report, vidura?, vibhishana?, version, meta:{processing_time_ms, engines, doctrine_version, stage_timings} }
//
// This v1 implementation runs the doctrine through Claude Opus 4.6 (lead),
// optionally OpenAI GPT-4.1 + Gemini 2.5 Pro (cross-check engines, in parallel),
// then a Claude synthesis pass that produces the final report. It also asks
// Claude to produce two short adjunct sections: Uncomfortable Truths (Vidura)
// and Counterparty Intelligence (Vibhishana). Each engine failure is tolerated
// gracefully — the pipeline succeeds as long as at least the lead engine returns.

const DOCTRINE_VERSION = '1.0';

const SI_DOCTRINE = `# GCI STRATEGIC INTELLIGENCE DOCTRINE v1.0

You are the GCI Strategic Intelligence engine. You produce top-down strategic reasoning, not market research. Your job is to surface what the decision maker cannot see on their own.

You operate in 5 internal stages and you deliver the final report only after completing all 5:

STAGE 1 - ASSUMPTION EXTRACTION & TESTING
List every assumption embedded in the question and the user's stated hypothesis. Flag which are load-bearing. For each load-bearing assumption, give a probability it is true and the strongest evidence against it.

STAGE 2 - CROSS-VARIABLE SYNTHESIS
Identify the variables that actually drive the outcome (regulatory, capital flow, demographic, geopolitical, technological, behavioral). Show how at least 3 variables interact in non-obvious ways.

STAGE 3 - LINKAGE MAPPING
Connect signals from at least 3 different domains (macro, sector, regulatory, geopolitical, capital flow) to surface a non-obvious pattern. Explain WHY this linkage matters and why it is not obvious.

STAGE 4 - CONTRARIAN PRESSURE TEST
For each major recommendation, present the strongest case AGAINST it. Quantify the bear case where possible. Identify the precise condition that would cause you to flip your view.

STAGE 5 - EVIDENCE-CHAIN REPORT
Deliver the final report. Every claim must trace to evidence or be marked ESTIMATE. Every recommendation must include the trigger conditions for re-evaluation.

OUTPUT STRUCTURE (use these markdown headings exactly):

## Strategic Question Restated
Restate the question in the sharpest possible form, including any reframing.

## Load-Bearing Assumptions
List each load-bearing assumption with a probability and the strongest counter-evidence.

## Driving Variables
List the variables that actually move the outcome and how they interact.

## Non-Obvious Pattern
The single most important linkage the user is unlikely to see on their own. Explain why it matters.

## Strategic Options (Ranked)
For each option: thesis, evidence, capital required, time to first signal, kill criteria.

## Contrarian Pressure Test
For the top option, the strongest case against and the trigger that would flip the view.

## Recommendation
A single clear recommendation with specific next 90-day actions and the decision the user should bring to their committee.

## Confidence & Provenance
Per section: HIGH / MEDIUM / ESTIMATE.

RULES:
- GCC and UAE context is the primary lens.
- Name real funds, regulators, transactions, and entities. Cite DIFC, ADGM, DHA, DOH, MOHAP, SAMA, CBUAE, CMA, ADGM FSRA, DFSA where relevant.
- No generic statements. Every paragraph must be falsifiable.
- Mark every numeric claim as CONFIRMED or ESTIMATE.
- Investment committee quality output. No filler.`;

const VIDURA_SYSTEM = `You are Vidura, the uncomfortable-truth advisor. After reading a strategic intelligence report, surface in 4-6 bullets the questions this analysis cannot afford to ignore — the assumptions that, if wrong, would invalidate the recommendation, and the inconvenient facts the analysis tiptoed around. Be direct. No hedging. Each bullet is one sentence.`;

const VIBHISHANA_SYSTEM = `You are Vibhishana, counterparty intelligence. After reading a strategic intelligence report, surface in 4-6 bullets what the competition (incumbents, new entrants, regulators, capital allocators) is doing right now in this exact space that the report did not address. Each bullet is one specific observation, not a generic risk. Name names where possible.`;

const { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');
const { callAzureOpenAI, isAzureOpenAIConfigured } = require('../lib/azure-openai');

const ANTHROPIC_HEADERS = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01'
};

// Fallback chain: Bedrock -> Lambda proxy -> Cloudflare Worker proxy
async function callClaude(system, userPrompt, maxTokens, model) {
  const payload = {
    model: model || 'claude-sonnet-4-6',
    max_tokens: maxTokens || 12000,
    system: system,
    messages: [{ role: 'user', content: userPrompt }]
  };

  // 1. Try Bedrock (direct AWS)
  if (isBedrockConfigured()) {
    try {
      const data = await callBedrock(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[strategic-intel] Bedrock failed, trying Lambda proxy:', e.message);
    }
  }

  // 2. Try Lambda proxy in us-east-1
  if (isLambdaProxyConfigured()) {
    try {
      const data = await callViaLambdaProxy(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[strategic-intel] Lambda proxy failed, trying CF Worker:', e.message);
    }
  }

  // 3. Last resort: Cloudflare Worker proxy
  const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
    method: 'POST',
    headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify(payload)
  });
  let data;
  try { data = await r.json(); } catch (e) {
    throw new Error('Proxy returned non-JSON (status ' + r.status + ')');
  }
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + ((data && data.error && data.error.message) || 'unknown'));
  return (data.content && data.content[0] && data.content[0].text) || '';
}

// Non-streaming variant that works with both Bedrock and the proxy.
// Bedrock InvokeModel is non-streaming, which is fine: the SWA gateway
// 230s timeout applies to IDLE connections, not total duration, and
// Bedrock returns the full response in one shot (typically 10-60s).
async function callClaudeStream(system, userPrompt, maxTokens, model) {
  // With Bedrock, we use non-streaming InvokeModel (simpler, equally fast)
  if (isBedrockConfigured()) {
    try {
      return await callClaude(system, userPrompt, maxTokens, model);
    } catch (e) {
      console.error('[strategic-intel] Bedrock stream fallback:', e.message);
    }
  }

  // 2. Try Lambda proxy in us-east-1 (US IP, bypasses geo-blocks)
  if (isLambdaProxyConfigured()) {
    try {
      const payload = {
        model: model || 'claude-sonnet-4-6',
        max_tokens: maxTokens || 12000,
        system: system,
        messages: [{ role: 'user', content: userPrompt }]
      };
      const data = await callViaLambdaProxy(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[strategic-intel] Lambda proxy stream fallback:', e.message);
    }
  }

  // 3. Last resort: streaming via CF Worker proxy
  const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
    method: 'POST',
    headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY, 'Accept': 'text/event-stream' },
    body: JSON.stringify({
      model: model || 'claude-sonnet-4-6',
      max_tokens: maxTokens || 12000,
      system: system,
      stream: true,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  if (!r.ok) {
    let errText = '';
    try { errText = await r.text(); } catch(e) {}
    throw new Error('Claude stream ' + r.status + ': ' + errText.slice(0, 300));
  }
  let acc = '';
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of r.body) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') {
          acc += ev.delta.text;
        } else if (ev.type === 'message_stop') {
          // done
        } else if (ev.type === 'error') {
          throw new Error('Claude stream error: ' + (ev.error && ev.error.message || 'unknown'));
        }
      } catch(e) {
        // ignore malformed SSE payload
      }
    }
  }
  return acc;
}

async function callOpenAI(system, userPrompt) {
  const oaMessages = [
    { role: 'system', content: system },
    { role: 'user', content: userPrompt }
  ];

  // 1. Try Azure OpenAI Service (billed to Azure credits)
  if (isAzureOpenAIConfigured()) {
    try {
      const data = await callAzureOpenAI({
        model: 'gpt-4.1',
        messages: oaMessages,
        max_tokens: 16000,
        temperature: 0.4
      });
      return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    } catch (e) {
      console.error('[strategic-intel] Azure OpenAI failed:', e.message);
    }
  }

  // 2. Fallback: CF Worker proxy with OpenAI API key
  if (!process.env.OPENAI_API_KEY) throw new Error('No OpenAI backend configured');
  const _oaBase = 'https://gci-anthropic-proxy.gaurav-892.workers.dev/openai'.replace(/\/+$/, '');
  const _oaHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY };
  if (process.env.PROXY_SHARED_SECRET) _oaHeaders['x-proxy-secret'] = process.env.PROXY_SHARED_SECRET;
  const r = await fetch(_oaBase + '/v1/chat/completions', {
    method: 'POST',
    headers: _oaHeaders,
    body: JSON.stringify({
      model: 'gpt-4.1',
      messages: oaMessages,
      max_tokens: 16000,
      temperature: 0.4
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + ((data && data.error && data.error.message) || 'unknown'));
  return (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
}

async function callGemini(system, userPrompt) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
  const _gmBase = 'https://gci-anthropic-proxy.gaurav-892.workers.dev/gemini'.replace(/\/+$/, '');
  const url = _gmBase + '/v1beta/models/gemini-2.5-pro:generateContent?key=' + encodeURIComponent(process.env.GEMINI_API_KEY);
  const _gmHeaders = { 'Content-Type': 'application/json' };
  if (process.env.PROXY_SHARED_SECRET) _gmHeaders['x-proxy-secret'] = process.env.PROXY_SHARED_SECRET;
  const r = await fetch(url, {
    method: 'POST',
    headers: _gmHeaders,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8000 }
    })
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Gemini ' + r.status + ': ' + ((data && data.error && data.error.message) || 'unknown'));
  let text = '';
  if (data.candidates && data.candidates[0] && data.candidates[0].content && Array.isArray(data.candidates[0].content.parts)) {
    text = data.candidates[0].content.parts.map(function(p){ return p.text || ''; }).join('');
  }
  return text;
}

// Async job pattern: SWA functions cannot stream and time out after ~45s.
// The Lambda proxy takes 60-120s for full reports. Solution:
// 1. POST /api/strategic-intel -> kick off Lambda async, store jobId in Redis, return immediately
// 2. GET /api/strategic-intel?jobId=xxx -> poll Redis for result
const { kvGet, kvSet } = require('../redis-client');
const crypto = require('crypto');

function stripDashes(s){ return (s||'').replace(/\u2014/g,', ').replace(/\u2013/g,'-'); }

// Fire-and-forget: run the AI pipeline and store result in Redis
async function runPipeline(jobId, doctrine, userPrompt) {
  const start = Date.now();
  try {
    await kvSet('gci:si:' + jobId, JSON.stringify({ status: 'processing' }), 600);

    // Use Lambda proxy to call Claude via Bedrock (from us-east-1).
    // Try Opus 4.6 first (confirmed available on Bedrock), then Sonnet 4.6 as fallback.
    let report = '';
    const modelsToTry = ['claude-opus-4-6', 'claude-sonnet-4-6'];

    if (isLambdaProxyConfigured()) {
      for (const model of modelsToTry) {
        if (report) break;
        const payload = {
          model: model,
          max_tokens: 32000,
          system: doctrine,
          messages: [{ role: 'user', content: userPrompt }]
        };
        try {
          console.log('[strategic-intel] Trying Lambda proxy with model:', model);
          const data = await callViaLambdaProxy(payload);
          report = (data.content && data.content[0] && data.content[0].text) || '';
          if (report) console.log('[strategic-intel] Success with model:', model, 'length:', report.length);
        } catch (e) {
          console.error('[strategic-intel] Lambda proxy failed with ' + model + ':', e.message);
        }
      }
    }

    // Fallback to CF Worker proxy if all Lambda attempts failed
    if (!report) {
      const payload = {
        model: 'claude-opus-4-6',
        max_tokens: 32000,
        system: doctrine,
        messages: [{ role: 'user', content: userPrompt }]
      };
      const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
        method: 'POST',
        headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
        body: JSON.stringify(payload)
      });
      let data;
      try { data = await r.json(); } catch (e) {
        throw new Error('Proxy returned non-JSON (status ' + r.status + ')');
      }
      if (!r.ok) throw new Error('Claude ' + r.status + ': ' + ((data && data.error && data.error.message) || 'unknown'));
      report = (data.content && data.content[0] && data.content[0].text) || '';
    }

    const result = {
      status: 'complete',
      report: stripDashes(report),
      vidura: '',
      vibhishana: '',
      adjuncts_pending: true,
      version: DOCTRINE_VERSION,
      meta: {
        processing_time_ms: Date.now() - start,
        engines: ['claude-opus-4-6'],
        doctrine_version: DOCTRINE_VERSION
      }
    };
    await kvSet('gci:si:' + jobId, JSON.stringify(result), 600);
  } catch (err) {
    const errResult = { status: 'error', error: err.message || String(err) };
    try { await kvSet('gci:si:' + jobId, JSON.stringify(errResult), 600); } catch(e) {}
  }
}

module.exports = async function handler(req, res) {
  // GET: poll for job result
  if (req.method === 'GET' && req.query && req.query.jobId) {
    try {
      const raw = await kvGet('gci:si:' + req.query.jobId);
      if (!raw) return res.status(404).json({ error: 'Job not found or expired' });
      const data = JSON.parse(raw);
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: 'Poll error: ' + err.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY && !isBedrockConfigured()) return res.status(500).json({ error: 'No AI backend configured (need ANTHROPIC_API_KEY or AWS credentials)' });

  try {
    const body = req.body || {};
    const clientBrief = (body.clientBrief || '').toString().trim();
    if (clientBrief.length < 20) return res.status(400).json({ error: 'clientBrief too short (min 20 chars)' });

    const hypothesis = (body.hypothesis || '').toString().trim();
    const constraints = (body.constraints || '').toString().trim();
    const horizon = (body.horizon || '').toString().trim();

    let userPrompt = 'STRATEGIC QUESTION:\n' + clientBrief;
    if (hypothesis) userPrompt += '\n\nMY CURRENT HYPOTHESIS AND PRIORS:\n' + hypothesis;
    else userPrompt += '\n\nMY CURRENT HYPOTHESIS AND PRIORS:\nNone stated. Challenge any implicit assumptions in the question itself.';
    if (constraints) userPrompt += '\n\nCONSTRAINTS:\n' + constraints;
    if (horizon) userPrompt += '\n\nDECISION HORIZON: ' + horizon;
    userPrompt += '\n\nRun the full 5-stage Strategic Intelligence pipeline now. Produce the complete brief using the markdown headings specified in your doctrine. Remember: intelligence, not research. Surface what I cannot see on my own.';

    // Generate job ID and kick off pipeline (runs in background, survives past response)
    const jobId = crypto.randomBytes(12).toString('hex');
    await kvSet('gci:si:' + jobId, JSON.stringify({ status: 'processing' }), 600);

    // Fire and forget: the pipeline runs async, stores result in Redis.
    // We don't await it -- the SWA function returns immediately.
    runPipeline(jobId, SI_DOCTRINE, userPrompt).catch(function(e) {
      console.error('[strategic-intel] Pipeline error:', e.message);
    });

    // Return job ID immediately (< 1 second)
    return res.status(202).json({ jobId: jobId, status: 'processing', pollUrl: '/api/strategic-intel?jobId=' + jobId });

  } catch (err) {
    return res.status(500).json({ error: 'strategic-intel error: ' + (err && err.message ? err.message : String(err)) });
  }
}
