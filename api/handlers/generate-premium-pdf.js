const { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');

async function callClaude(system, userPrompt, maxTokens) {
  const payload = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens || 6000,
    system: system,
    messages: [{ role: 'user', content: userPrompt }]
  };
  // 1. Bedrock
  if (isBedrockConfigured()) {
    try { const data = await callBedrock(payload); return (data.content && data.content[0] && data.content[0].text) || ''; }
    catch (e) { console.error('[generate-premium-pdf] Bedrock failed:', e.message); }
  }
  // 2. Lambda proxy
  if (isLambdaProxyConfigured()) {
    try { const data = await callViaLambdaProxy(payload); return (data.content && data.content[0] && data.content[0].text) || ''; }
    catch (e) { console.error('[generate-premium-pdf] Lambda failed:', e.message); }
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
    } catch (e) { console.error('[generate-premium-pdf] Direct API failed:', e.message); }
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

const PREMIUM_PDF_SYSTEM = `You are a premium document formatter for Gulf Capital Intelligence (GCI), a McKinsey/BCG-tier strategic advisory firm based in DIFC, Dubai.

Your task: Transform the raw intelligence report into a structured JSON that defines a professionally formatted PDF document. DO NOT rewrite or polish the content. Keep ALL original text, data, and analysis exactly as written. Your job is LAYOUT and STRUCTURE only.

Output a JSON object with this schema:
{
  "title": "Report title extracted from content",
  "subtitle": "One-line summary",
  "date": "Today's date formatted nicely",
  "reportId": "GCI-XXXXXX format",
  "sections": [
    {
      "heading": "Section heading",
      "subheading": "Optional subtitle",
      "type": "prose|bullets|table|metrics|callout|verdict",
      "content": "For prose type: the paragraph text",
      "bullets": ["For bullets type: array of bullet points"],
      "table": { "headers": [...], "rows": [[...], [...]] },
      "metrics": [{ "label": "...", "value": "...", "trend": "up|down|neutral" }],
      "callout": { "type": "insight|warning|opportunity", "text": "..." },
      "verdict": { "rating": "HIGH|MEDIUM|LOW", "text": "..." },
      "color": "navy|gold|green|red|purple"
    }
  ],
  "footer_notes": ["Confidentiality statement", "Disclaimer"]
}

Rules:
- NEVER change the original wording, data, numbers, or analysis
- Break long sections into digestible subsections
- Identify tables in the markdown and convert them to proper table structures
- Identify key metrics and present them as metric cards
- Pull out important insights as callouts
- Use color coding: navy for primary, gold for highlights, green for positive, red for risks, purple for non-obvious patterns
- Maximum 25 sections to keep the PDF focused
- Every section MUST have real content from the report, never fabricate
- Do NOT use long dashes (em dashes or en dashes) anywhere

Respond ONLY with valid JSON. No markdown, no explanation, no code blocks.`;

function extractJSON(text) {
  if (!text) return null;
  let cleaned = text.trim();
  // Strip markdown code blocks
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?\s*```\s*$/, '');
  }
  // Try direct parse
  try { return JSON.parse(cleaned); } catch (e) {}
  // Try finding first { to last }
  var first = cleaned.indexOf('{');
  var last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try { return JSON.parse(cleaned.slice(first, last + 1)); } catch (e) {}
  }
  return null;
}

function truncateReport(text, maxChars) {
  if (!text || text.length <= maxChars) return text;
  // Keep the first maxChars characters, try to cut at a section boundary
  var cut = text.slice(0, maxChars);
  var lastSection = cut.lastIndexOf('\n##');
  if (lastSection > maxChars * 0.7) cut = cut.slice(0, lastSection);
  return cut + '\n\n[Report truncated for formatting. Full content preserved in PDF.]';
}

async function generatePremiumPdf(req, res) {
  try {
    const { report, vidura, vibhishana, agentLabel } = req.body;

    if (!report) {
      return res.status(400).json({ error: 'Missing report parameter' });
    }

    // Build full report text, truncate if very long to stay within token budget
    let fullText = truncateReport(report, 24000);
    if (vidura) {
      fullText += '\n\n---\n\nUNCOMFORTABLE TRUTHS - Questions this analysis cannot afford to ignore:\n\n' + truncateReport(vidura, 4000);
    }
    if (vibhishana) {
      fullText += '\n\n---\n\nCOUNTERPARTY INTELLIGENCE - What the competition is doing that you are not seeing:\n\n' + truncateReport(vibhishana, 4000);
    }

    const userPrompt = 'Format this strategic intelligence report into a premium PDF structure. Report type: ' + (agentLabel || 'Strategic Intelligence') + '\n\n' + fullText;

    console.log('[generate-premium-pdf] Generating premium PDF structure (' + fullText.length + ' chars input)');
    const responseText = await callClaude(PREMIUM_PDF_SYSTEM, userPrompt, 12000);

    const pdfJson = extractJSON(responseText);
    if (!pdfJson) {
      console.error('[generate-premium-pdf] JSON parse failed. Response starts with:', (responseText || '').slice(0, 200));
      return res.status(500).json({ error: 'Failed to parse PDF structure' });
    }

    if (!pdfJson.sections || !Array.isArray(pdfJson.sections)) {
      return res.status(500).json({ error: 'Invalid PDF structure: missing sections array' });
    }

    res.json(pdfJson);
  } catch (error) {
    console.error('[generate-premium-pdf] Error:', error.message);
    res.status(500).json({ error: 'Failed to generate premium PDF', details: error.message });
  }
}

module.exports = generatePremiumPdf;
