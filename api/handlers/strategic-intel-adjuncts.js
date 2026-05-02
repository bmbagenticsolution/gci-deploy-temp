// /api/strategic-intel-adjuncts
// Runs Vidura (uncomfortable truths) + Vibhishana (counterparty intel) in parallel
// using Claude Sonnet (faster than Opus). Lazy-loaded by the client AFTER the
// main strategic-intel report has been rendered, so the user sees the report
// in ~half the time and the adjuncts stream in below.
//
// Request: { clientBrief, finalReport }
// Response: { vidura, vibhishana, meta:{processing_time_ms} }

const VIDURA_SYSTEM = `You are Vidura, the uncomfortable-truth advisor. After reading a strategic intelligence report, surface in 4-6 bullets the questions this analysis cannot afford to ignore, the assumptions that, if wrong, would invalidate the recommendation, and the inconvenient facts the analysis tiptoed around. Be direct. No hedging. Each bullet is one sentence.`;

const VIBHISHANA_SYSTEM = `You are Vibhishana, counterparty intelligence. After reading a strategic intelligence report, surface in 4-6 bullets what the competition (incumbents, new entrants, regulators, capital allocators) is doing right now in this exact space that the report did not address. Each bullet is one specific observation, not a generic risk. Name names where possible.`;

const { callBedrock, isBedrockConfigured } = require('../lib/bedrock');

async function callClaudeSonnet(system, userPrompt, maxTokens) {
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 1200,
    system: system,
    messages: [{ role: 'user', content: userPrompt }]
  };

  // Try Bedrock first (no geo-blocks)
  if (isBedrockConfigured()) {
    try {
      const data = await callBedrock(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[adjuncts] Bedrock failed, falling back:', e.message);
    }
  }

  // Fallback: Vercel proxy
  const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      'x-api-key': process.env.ANTHROPIC_API_KEY
    },
    body: JSON.stringify(payload)
  });
  let data;
  try { data = await r.json(); } catch (e) {
    throw new Error('Proxy returned non-JSON (status ' + r.status + ')');
  }
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + ((data && data.error && data.error.message) || 'unknown'));
  return (data.content && data.content[0] && data.content[0].text) || '';
}

function stripDashes(s){ return (s || '').replace(/\u2014/g, ', ').replace(/\u2013/g, '-'); }

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.ANTHROPIC_API_KEY && !isBedrockConfigured()) return res.status(500).json({ error: 'No AI backend configured' });

  const start = Date.now();
  try {
    const body = req.body || {};
    const clientBrief = (body.clientBrief || '').toString().trim();
    const finalReport = (body.finalReport || '').toString().trim();
    if (!finalReport) return res.status(400).json({ error: 'finalReport missing' });

    const userBlock = 'STRATEGIC QUESTION:\n' + clientBrief + '\n\nFINAL STRATEGIC INTELLIGENCE REPORT:\n' + finalReport;

    const out = await Promise.allSettled([
      callClaudeSonnet(VIDURA_SYSTEM, userBlock, 1200),
      callClaudeSonnet(VIBHISHANA_SYSTEM, userBlock, 1200)
    ]);

    const vidura = out[0].status === 'fulfilled' ? out[0].value : '';
    const vibhishana = out[1].status === 'fulfilled' ? out[1].value : '';

    return res.status(200).json({
      vidura: stripDashes(vidura),
      vibhishana: stripDashes(vibhishana),
      meta: { processing_time_ms: Date.now() - start }
    });
  } catch (err) {
    return res.status(500).json({ error: 'strategic-intel-adjuncts error: ' + (err && err.message ? err.message : String(err)) });
  }
}
