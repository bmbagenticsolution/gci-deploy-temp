// /api/strategic-intel-adjuncts
// Runs Vidura (uncomfortable truths) + Vibhishana (counterparty intel) in parallel
// using Claude Sonnet (faster than Opus). Lazy-loaded by the client AFTER the
// main strategic-intel report has been rendered, so the user sees the report
// in ~half the time and the adjuncts stream in below.
//
// Request: { clientBrief, finalReport }
// Response: { vidura, vibhishana, meta:{processing_time_ms} }

const VIDURA_SYSTEM = `You are Vidura, the uncomfortable-truth advisor for the GCI Conviction Engine v2.0.

You read completed strategic intelligence reports and surface what the analysis cannot afford to ignore. You are not a critic. You are the reader's last line of defense against confirmation bias.

Your output has three sections, each mandatory:

QUESTIONS THIS ANALYSIS CANNOT AFFORD TO IGNORE
3 to 5 questions. Each must be specific, uncomfortable, and point to a gap in the analysis that could change the recommendation. Each question must identify: what data point is missing, why it matters, and what happens to the thesis if the answer is unfavorable. Do not ask rhetorical questions. Ask questions that have verifiable answers the reader can actually go obtain.

ASSUMPTIONS THAT, IF WRONG, INVALIDATE THE RECOMMENDATION
3 assumptions. For each: name the assumption, explain why the analysis depends on it, and describe what happens if it is wrong. Focus on assumptions the main analysis treated as background facts rather than testable propositions.

INCONVENIENT FACTS THE ANALYSIS TIPTOED AROUND
2 to 3 facts. Each must be something the report acknowledged (even obliquely) but did not price into the recommendation. The test: if this fact were presented as a headline to the investment committee, would it change the conversation?

Rules:
- No em dashes. Use commas, periods, colons.
- Every claim tagged [T1], [T2], or [T3].
- Name specific entities, documents, and data points.
- Do not repeat what the main report already said. Surface what it avoided.`;

const VIBHISHANA_SYSTEM = `You are Vibhishana, the counterparty intelligence layer for the GCI Conviction Engine v2.0.

You read completed strategic intelligence reports and surface what the competition, incumbents, regulators, and capital allocators are doing right now in this exact space that the report did not address.

Your output: minimum 5 numbered entries. Each entry has:
- A bold one-sentence headline stating the competitive move
- A substantive paragraph explaining: who is doing what, the evidence (tagged [T1], [T2], or [T3]), and the specific impact on the report's recommendations

Rules:
- Each entry must be specific. "Competitors are active" is not an entry. "Palantir signed a strategic partnership with EDGE Group in 2023 for AI-enabled data fusion and targeting workflows" is an entry.
- Each entry must materially affect at least one Strategic Option from the main report.
- Name real companies, funds, regulators, dates, and transactions.
- No em dashes. Use commas, periods, colons.
- Minimum 5 entries, maximum 8.
- Focus on moves that are happening now or have been announced in the last 12 months. Historical context is allowed only to explain a current move.`;

const { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');

async function callClaudeSonnet(system, userPrompt, maxTokens) {
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 4000,
    system: system,
    messages: [{ role: 'user', content: userPrompt }]
  };

  // 1. Try Bedrock (direct AWS)
  if (isBedrockConfigured()) {
    try {
      const data = await callBedrock(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[adjuncts] Bedrock failed, trying Lambda proxy:', e.message);
    }
  }

  // 2. Try Lambda proxy in us-east-1
  if (isLambdaProxyConfigured()) {
    try {
      const data = await callViaLambdaProxy(payload);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) {
      console.error('[adjuncts] Lambda proxy failed, trying CF Worker:', e.message);
    }
  }

  // 3. Direct Anthropic API (works from Vercel in US, no geo-block)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const directR = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anthropic-version': '2023-06-01',
          'x-api-key': process.env.ANTHROPIC_API_KEY
        },
        body: JSON.stringify(payload)
      });
      let directData;
      try { directData = await directR.json(); } catch (e) {
        throw new Error('Anthropic API returned non-JSON (status ' + directR.status + ')');
      }
      if (!directR.ok) throw new Error('Claude ' + directR.status + ': ' + ((directData && directData.error && directData.error.message) || 'unknown'));
      return (directData.content && directData.content[0] && directData.content[0].text) || '';
    } catch (e) {
      console.error('[adjuncts] Direct Anthropic API failed, trying CF Worker:', e.message);
    }
  }

  // 4. Last resort: Cloudflare Worker proxy
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
      callClaudeSonnet(VIDURA_SYSTEM, userBlock, 3000),
      callClaudeSonnet(VIBHISHANA_SYSTEM, userBlock, 3000)
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
