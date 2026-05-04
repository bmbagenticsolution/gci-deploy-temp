const { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');

async function callClaude(system, userPrompt, maxTokens) {
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 4000,
    system: system,
    messages: [{ role: 'user', content: userPrompt }]
  };
  // 1. Bedrock
  if (isBedrockConfigured()) {
    try { const data = await callBedrock(payload); return (data.content && data.content[0] && data.content[0].text) || ''; }
    catch (e) { console.error('[generate-deck] Bedrock failed:', e.message); }
  }
  // 2. Lambda proxy
  if (isLambdaProxyConfigured()) {
    try { const data = await callViaLambdaProxy(payload); return (data.content && data.content[0] && data.content[0].text) || ''; }
    catch (e) { console.error('[generate-deck] Lambda failed:', e.message); }
  }
  // 3. Direct Anthropic API
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': process.env.ANTHROPIC_API_KEY },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      if (!r.ok) throw new Error('Claude ' + r.status);
      return (data.content && data.content[0] && data.content[0].text) || '';
    } catch (e) { console.error('[generate-deck] Direct API failed:', e.message); }
  }
  // 4. CF Worker
  const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify(payload)
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Claude ' + r.status);
  return (data.content && data.content[0] && data.content[0].text) || '';
}

function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '');
  }
  try { return JSON.parse(cleaned); } catch (e) {}
  var first = cleaned.indexOf('{');
  var last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}

function truncateReport(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  var cut = text.slice(0, maxChars);
  var lastSection = cut.lastIndexOf('\n##');
  if (lastSection > maxChars * 0.7) cut = cut.slice(0, lastSection);
  return cut + '\n\n[Truncated for slide formatting.]';
}

async function generateDeck(req, res) {
  try {
    const { report, mode = 'full', vidura, vibhishana } = req.body;

    if (!report) {
      return res.status(400).json({ error: 'Missing report parameter' });
    }

    const isExecutive = mode === 'executive';
    const slideCount = isExecutive ? '6-7' : '15';
    const audienceContext = isExecutive
      ? 'C-suite executives and board members who need quick, actionable insights'
      : 'detailed audience of investors, analysts, and strategic planners';

    // Truncate to stay within token limits
    const truncatedReport = truncateReport(report, 20000);
    const truncatedVidura = vidura ? truncateReport(vidura, 3000) : '';
    const truncatedVibhishana = vibhishana ? truncateReport(vibhishana, 3000) : '';

    let systemPrompt = `You are a strategic intelligence expert creating a professional PowerPoint deck from an intelligence report.

Generate exactly ${slideCount} slides with a professional, data-driven design suitable for ${audienceContext}.

${truncatedVidura ? 'Vidura insights (competitive intelligence): ' + truncatedVidura + '\n' : ''}${truncatedVibhishana ? 'Vibhishana intelligence (stakeholder views): ' + truncatedVibhishana + '\n' : ''}

Each slide must have:
- title (required, concise)
- subtitle (optional, supporting text)
- layout (one of: title, content, two-column, table, key-metrics)
- bullets (array of bullet points for content layout)
- left_column / right_column (for two-column layout, each with heading and bullets)
- table (for table layout, with headers array and rows array)
- metrics (for key-metrics layout, array of {label, value, color})
- notes (speaker notes)

Response MUST be valid JSON only. No markdown, no code blocks. Valid JSON object with "slides" array.`;

    if (isExecutive) {
      systemPrompt += `

For EXECUTIVE mode, create a concise deck with 6-7 slides covering:
1. Title slide with key finding
2. Current state / situation
3. Top 3 strategic opportunities or risks
4. Financial/market impact
5. Recommended actions
6. Timeline and success metrics
7. (optional) Next steps

Use key-metrics layout for data. Keep bullets to 2-3 per slide max.`;
    } else {
      systemPrompt += `

For FULL mode, create a comprehensive 15-slide deck:
1. Title slide with executive summary
2. Context and scope
3-5. Competitive landscape (3 slides)
6-8. Market analysis (3 slides)
9-11. Opportunities and risks (3 slides)
12-13. Strategic recommendations (2 slides)
14. Financial projections
15. Implementation roadmap

Use varied layouts (content, two-column, table, key-metrics). Provide detailed bullets with supporting data.`;
    }

    systemPrompt += `

Respond ONLY with valid JSON. No preamble, no markdown, no explanation. JSON must be parseable immediately.`;

    const userPrompt = 'Generate the deck based on this strategic intelligence report:\n\n' + truncatedReport;

    console.log('[generate-deck] Generating ' + mode + ' deck (' + slideCount + ' slides, ' + truncatedReport.length + ' chars input)');
    const responseText = await callClaude(systemPrompt, userPrompt, 10000);

    const deckJson = extractJSON(responseText);
    if (!deckJson) {
      console.error('[generate-deck] JSON parse failed. Response starts with:', (responseText || '').slice(0, 200));
      return res.status(500).json({ error: 'Failed to parse deck JSON' });
    }

    if (!deckJson.slides || !Array.isArray(deckJson.slides)) {
      return res.status(500).json({ error: 'Invalid deck structure: missing slides array' });
    }

    res.json(deckJson);
  } catch (error) {
    console.error('[generate-deck] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate deck', details: error.message });
  }
}

module.exports = generateDeck;
