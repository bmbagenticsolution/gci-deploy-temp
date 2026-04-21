// /api/synthesis
// Takes 2-3 reports from Claude / OpenAI / Gemini plus an optional Vidura legal
// opinion, and asks Claude Opus to synthesize them into a single best-of report.
// Returns Anthropic-shape: { content: [{ text: "..." }] }

const SYNTHESIS_SYSTEM = `You are the GCI Conviction Synthesizer. You receive 2 or 3 independent investment analysis reports produced by separate frontier reasoning engines, plus an optional legal opinion. Your job is NOT to summarize them. Your job is to produce ONE best-of-class conviction report that:

1. Keeps the strongest, most specific, most evidence-backed claims from each engine
2. Discards weaker or generic statements
3. Resolves contradictions explicitly: when engines disagree, state both views, judge which is stronger, and explain why
4. Surfaces points of consensus as high-confidence anchors
5. Integrates the legal opinion into the structuring and risk sections
6. Preserves the full report structure (executive summary, sector analysis, risks, verdict, etc.)
7. Issues a single clear verdict: PROCEED, PROCEED WITH CONDITIONS, or AVOID
8. Flags every estimate as ESTIMATE and every confirmed fact as CONFIRMED

Output the synthesized report in clean markdown. Do not mention the engines by name in the body of the report. Do not water down strong claims. The reader is an investment committee.`;

const ANTHROPIC_HEADERS = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01'
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const claudeReport = body.claudeReport || '';
    const openaiReport = body.openaiReport || '';
    const geminiReport = body.geminiReport || '';
    const viduraOpinion = body.viduraOpinion || '';
    const dealContext = body.dealContext || '';
    const originalSystem = body.originalSystem || '';

    if (!claudeReport && !openaiReport && !geminiReport) {
      return res.status(400).json({ error: 'At least one source report is required' });
    }
    if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });

    let userPrompt = 'DEAL CONTEXT:\n' + dealContext + '\n\n';
    if (originalSystem) userPrompt += 'ORIGINAL ANALYTICAL DOCTRINE (for reference, do not repeat):\n' + originalSystem.substring(0, 2000) + '\n\n';
    userPrompt += '====================\n';
    if (claudeReport) userPrompt += 'REPORT A (engine 1):\n' + claudeReport + '\n\n====================\n';
    if (openaiReport) userPrompt += 'REPORT B (engine 2):\n' + openaiReport + '\n\n====================\n';
    if (geminiReport) userPrompt += 'REPORT C (engine 3):\n' + geminiReport + '\n\n====================\n';
    if (viduraOpinion) userPrompt += 'LEGAL OPINION (Vidura):\n' + viduraOpinion + '\n\n====================\n';
    userPrompt += '\nProduce the synthesized conviction report now.';

    const r = await fetch((process.env.ANTHROPIC_BASE_URL||'https://api.anthropic.com')+'/v1/messages', {
      method: 'POST',
      headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
      body: JSON.stringify({
        model: 'claude-opus-4-6',
        max_tokens: 16000,
        system: SYNTHESIS_SYSTEM,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      return res.status(r.status).json({ error: (data && data.error && data.error.message) || 'Anthropic synthesis error' });
    }
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'synthesis error: ' + (err && err.message ? err.message : String(err)) });
  }
}
