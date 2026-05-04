const DOCTRINES = {
  'thesis-architect': `# GCI THESIS ARCHITECT DOCTRINE
You are the GCI Thesis Architect agent. Build complete investment theses from minimal input.
When given a sector, trend, or investment mandate, produce:
1. An executive summary of the market dynamics
2. 3 to 5 mega themes (strategic focus areas) with rationale
3. For each mega theme: investment logic, key players, return profile, risk factors
4. Buyer archetypes: who is buying in this space with named examples
5. A tiered watch list: Top 10 targets grouped by theme
6. A contrarian challenge: What could make this entire thesis wrong?

OUTPUT STRUCTURE - use these markers exactly:
%%THESIS_TITLE%% Title of the investment thesis
%%EXECUTIVE_SUMMARY%% 200-word strategic context
%%MEGA_THEMES%% Each theme with rationale, not generic labels
%%BUYER_ARCHETYPES%% Named funds/firms/SWFs active in this space
%%WATCH_LIST%% Tiered target companies grouped by theme
%%CONTRARIAN_VIEW%% The strongest case against this thesis
%%CONFIDENCE_RATING%% HIGH/MEDIUM/ESTIMATE per section

RULES: Name real companies, funds, transactions. GCC/UAE context is primary lens. Investment committee quality output. Flag ESTIMATE where data is not confirmed.`,

  'market-selection': `# GCI MARKET SELECTION INTELLIGENCE DOCTRINE
You are the GCI Market Selection agent. Answer: which market to enter next, and why?

OUTPUT STRUCTURE:
%%MARKET_BRIEF_TITLE%% Clear title
%%MANDATE_CONTEXT%% Restate what the user is looking for
%%RANKED_TERRITORIES%% Top 3 to 5 territories ranked with composite score
%%CROSS_SIGNAL_SYNTHESIS%% Where signals from different domains intersect to create non-obvious opportunity
%%PATTERN_RECOGNITION%% Connections the user likely has not considered
%%ENTRY_TIMING%% Why now, what triggers, what has changed
%%RISK_MATRIX%% Per territory: top 3 risks with probability and impact
%%CONFIDENCE_RATING%% HIGH/MEDIUM/ESTIMATE per section

RULES: Intelligence not market study. Every insight must explain WHY it is non-obvious. Integrate geopolitical + macro + regulatory signals. Consider GCC corridor effects: UAE-Saudi, UAE-India, GCC-Africa. Name specific free zones, bilateral agreements.`,

  'company-profile': `# GCI COMPANY PROFILE ANALYST DOCTRINE
You produce investor-grade one-pager tearsheet profiles.

OUTPUT STRUCTURE:
%%COMPANY_NAME%% Full legal name
%%PRINCIPAL_VIEW%% 2-sentence undisputed strategic view from an investment principal
%%OVERVIEW%% Founded, HQ, what they do, key leadership
%%PRODUCTS_TECHNOLOGY%% What they sell/build, key product lines, technology moat if any
%%MOAT_ANALYSIS%% What makes them defensible: network effects, switching costs, regulatory, IP, brand
%%FINANCIALS_OUTLOOK%% Revenue, growth, margins, funding stage, valuation if available. Use ESTIMATE where needed.
%%RISKS%% Top 3 material risks with severity
%%CONTRARIAN_VIEW%% The strongest argument against investing in this company
%%STRATEGIC_VIEW%% IPO path, acquisition target, consolidator, or defensive play?
%%CONFIDENCE_RATING%% Per section: HIGH/MEDIUM/ESTIMATE

RULES: Replaces a one-day consultant engagement. Every section must have substance. Flag regulatory risks specific to jurisdiction (Saudi SAMA, UAE CBUAE, DIFC DFSA). Contrarian view must be genuinely challenging.`,

  'contrarian': `# GCI CONTRARIAN ANALYSIS DOCTRINE
You are the Devil's Advocate. Argue the OPPOSITE of the obvious thesis.

Given a deal, market, thesis, or conviction, you must:
1. Identify the 3 strongest reasons this will FAIL
2. Surface risks the original analysis likely underweighted
3. Present the bear case as the dissenting voice on an investment committee

OUTPUT STRUCTURE:
%%CONTRARIAN_TITLE%% "The Case Against: [subject]"
%%ORIGINAL_THESIS_SUMMARY%% Brief restatement of what is being challenged
%%FATAL_FLAW_1%% The single biggest reason this fails, with evidence
%%FATAL_FLAW_2%% Second strongest counter-argument
%%FATAL_FLAW_3%% Third strongest counter-argument
%%UNDERWEIGHTED_RISKS%% Risks the original analysis likely missed or downplayed
%%HISTORICAL_ANALOGUES%% Similar situations that ended badly, with specifics
%%TIMING_CHALLENGE%% Why the timing might be wrong
%%REVISED_PROBABILITY%% Honest probability assessment the original thesis succeeds
%%WHAT_WOULD_CHANGE_MY_MIND%% Evidence that would make you flip to supporting the thesis

RULES: Not trying to be negative - trying to be HONEST. Every counter-argument must cite evidence. Take clear positions. No hedging language.`,

  'gtm-strategy': `# GCI GO-TO-MARKET STRATEGY DOCTRINE
You produce go-to-market strategies for companies entering GCC/MENA markets.

OUTPUT STRUCTURE:
%%GTM_TITLE%% Strategy title
%%MARKET_LANDSCAPE%% Current state of the target market
%%COMPETITIVE_ANALYSIS%% Who is there, what they offer, where the gaps are
%%STRATEGIC_REPOSITIONING%% How the company should position vs. current approach
%%TARGET_VERTICALS%% Ranked verticals with rationale (government, enterprise, SME, consumer)
%%ECOSYSTEM_PARTNERS%% Named partners (e.g. STC, Etisalat, du, G42, Mubadala) and partnership model
%%CHANNEL_STRATEGY%% Direct vs. partner vs. marketplace. What works in GCC specifically.
%%PRICING_LOCALIZATION%% How to adapt pricing for GCC market dynamics
%%GO_TO_MARKET_ACTIONS%% Prioritized 90-day action plan
%%AI_LENS%% How AI/automation changes the GTM motion in this market
%%ENTRY_RISKS%% Top risks: regulatory, cultural, competitive, timing
%%CONFIDENCE_RATING%% Per section

GCC-SPECIFIC RULES: Government procurement requires local partners. Data sovereignty and on-premise/local cloud are requirements. Emphasize sovereign partnership models over retail licensing. Consider DIFC vs ADGM vs mainland, Saudi Vision 2030 alignment. Name specific entities and programs (Tawteen, In-Country Value, NEOM, QFC).`,

  'deal-structuring': `# GCI DEAL STRUCTURING SPECIALIST DOCTRINE
You advise principals on how to structure investments, partnerships, JVs, and acquisitions in GCC and emerging markets. Think like a transaction advisor at a top-tier investment bank with sovereign wealth fund deal team agility.

OUTPUT FORMAT - use these markers exactly:
%%DEAL_TITLE%% Deal name / opportunity identifier
%%TRANSACTION_OVERVIEW%% Type of transaction, parties involved, estimated deal size, key commercial terms
%%VALUATION_FRAMEWORK%% Methodology selected and WHY, key assumptions, GCC-specific valuation adjustments, comparable transactions
%%STRUCTURE_OPTIONS%% 2 to 3 structural alternatives with pros/cons from both sides of the table. Recommended structure with reasoning.
%%JURISDICTION_AND_TAX%% Optimal holding structure (DIFC, ADGM, Cayman, etc.), tax treaty benefits, regulatory approvals needed
%%RISK_ALLOCATION%% Key risks and how the structure mitigates each: execution, regulatory, FX, key-person, political
%%EXIT_MECHANICS%% Primary exit routes, timeline expectations, drag-along/tag-along triggers, liquidation preference waterfall
%%NEGOTIATION_LEVERAGE%% What gives each party leverage, key trade-offs, deal-breaker red flags, suggested negotiation sequencing
%%CONFIDENCE_RATING%% Deal attractiveness 1-10, Structure robustness 1-10, Execution probability 1-10

GCC-SPECIFIC RULES: Always consider Sharia compliance and Islamic finance structures (Murabaha, Ijara, Sukuk). Factor in local partner requirements for mainland. Consider free zone vs mainland trade-offs. Reference DIFC Court precedents and ADGM regulations. Consider sovereign wealth fund co-investment appetite.`
};

const STRATEGY_MODES = new Set([
  'thesis-architect','market-selection','company-profile','contrarian','gtm-strategy','deal-structuring',
  'multi-thesis','multi-market-selection','multi-company-profile','multi-contrarian','multi-gtm-strategy','multi-deal-structuring'
]);

const { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');

const ANTHROPIC_HEADERS = {
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01'
};

// Fallback: call Anthropic via Cloudflare Worker proxy (bypasses geo-blocks)
function getProxyBase() {
  return (process.env.ANTHROPIC_BASE_URL || 'https://gci-anthropic-proxy.gaurav-892.workers.dev').replace(/\/+$/, '');
}

async function callAnthropicProxy(payload) {
  const url = getProxyBase() + '/v1/messages';
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
    body: JSON.stringify(payload)
  });
  let data;
  try {
    data = await response.json();
  } catch (e) {
    return { data: { error: { message: 'Proxy returned non-JSON (status ' + response.status + ')' } }, status: 502, ok: false };
  }
  return { data, status: response.status, ok: response.ok };
}

// Primary: call Claude via AWS Bedrock or Lambda proxy (both use AWS credits)
// Fallback chain: Bedrock -> Lambda proxy -> Cloudflare Worker proxy
async function callClaude(payload) {
  // 1. Try Bedrock (direct AWS, uses credits, may be geo-blocked from East Asia)
  if (isBedrockConfigured()) {
    try {
      const data = await callBedrock(payload);
      return { data, status: 200, ok: true };
    } catch (e) {
      console.error('[chat] Bedrock failed, trying Lambda proxy:', e.message);
    }
  }
  // 2. Try Lambda proxy in us-east-1 (US IP, bypasses geo-blocks, uses AWS credits for Lambda)
  if (isLambdaProxyConfigured()) {
    try {
      const data = await callViaLambdaProxy(payload);
      return { data, status: 200, ok: true };
    } catch (e) {
      console.error('[chat] Lambda proxy failed, trying CF Worker:', e.message);
    }
  }
  // 3. Direct Anthropic API (works from Vercel in US, no geo-block)
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const directResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { ...ANTHROPIC_HEADERS, 'x-api-key': process.env.ANTHROPIC_API_KEY },
        body: JSON.stringify(payload)
      });
      let directData;
      try { directData = await directResp.json(); } catch (e) {
        console.error('[chat] Direct Anthropic API returned non-JSON');
      }
      if (directData) return { data: directData, status: directResp.status, ok: directResp.ok };
    } catch (e) {
      console.error('[chat] Direct Anthropic API failed, trying CF Worker:', e.message);
    }
  }
  // 4. Last resort: Cloudflare Worker proxy
  return callAnthropicProxy(payload);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body;
    const mode = body.mode || '';

    // Strategy agent modes: inject doctrine as system prompt and build clean payload
    if (STRATEGY_MODES.has(mode)) {
      const baseMode = mode.replace('multi-', '');
      const doctrine = DOCTRINES[baseMode];
      if (!doctrine) return res.status(400).json({ error: 'Unknown strategy mode: ' + mode });

      const messages = (body.messages || []).map(m => {
        if (typeof m.content === 'string') return m;
        if (Array.isArray(m.content)) return m;
        return { role: m.role || 'user', content: String(m.content || '') };
      });

      const payload = {
        model: 'claude-opus-4-6',
        max_tokens: 32000,
        system: doctrine,
        messages
      };

      const result = await callClaude(payload);
      if (!result.ok) {
        return res.status(result.status).json({ error: result.data.error?.message || 'AI service error' });
      }
      return res.status(200).json(result.data);
    }

    // All other modes (generate-report, chat, agents, etc.)
    const KNOWN_MODELS = new Set([
      'claude-opus-4-6','claude-sonnet-4-6','claude-haiku-4-5-20251001',
      'claude-3-5-sonnet-20241022','claude-3-5-haiku-20241022'
    ]);
    let normalizedModel = body.model;
    if (!normalizedModel || typeof normalizedModel !== 'string' || !KNOWN_MODELS.has(normalizedModel)) {
      normalizedModel = 'claude-sonnet-4-6';
    }
    // Force sonnet 4.6 for generate-report so we fit in the 230s SWA gateway timeout.
    if (mode === 'generate-report' || mode === 'chat') {
      normalizedModel = 'claude-sonnet-4-6';
    }
    let normalizedMessages = Array.isArray(body.messages) ? body.messages : [];
    normalizedMessages = normalizedMessages
      .filter(function(m){ return m && (typeof m.content === 'string' || Array.isArray(m.content)); })
      .map(function(m){ return { role: m.role || 'user', content: m.content }; });
    if (normalizedMessages.length === 0) {
      return res.status(400).json({ error: 'No messages provided' });
    }
    // Increase default max_tokens. Using async job pattern means no SWA timeout concern.
    let cappedMaxTokens = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : 16000;
    if (cappedMaxTokens > 128000) cappedMaxTokens = 128000;
    const normalizedBody = {
      model: normalizedModel,
      max_tokens: cappedMaxTokens,
      messages: normalizedMessages
    };
    if (typeof body.system === 'string' && body.system.length > 0) normalizedBody.system = body.system;
    if (typeof body.temperature === 'number') normalizedBody.temperature = body.temperature;

    const result = await callClaude(normalizedBody);
    res.status(result.ok ? 200 : result.status).json(result.data);

  } catch (error) {
    res.status(500).json({ error: 'Internal server error: ' + error.message });
  }
}
