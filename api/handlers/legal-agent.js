// api/legal-agent.js — GCI Supreme Legal Intelligence Engine v2
// Core Principle: HUMANITY FIRST
// Capabilities: Live legal database research, document reading, drafting, streaming SSE
// Tool use: fetch_legal_document for live access to DIFC, DFSA, UAE, GCC, FATF, international law

const { kvGet, kvSet } = require('../redis-client');
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_SECRET       = process.env.ADMIN_SECRET;

const LEGAL_MEMORY_KEY     = 'gci:legal:memory';
const LEGAL_DOCTRINE_KEY   = 'gci:legal:doctrine';
const LEGAL_DECISIONS_KEY  = 'gci:legal:decisions';
const LEGAL_PRECEDENTS_KEY = 'gci:legal:precedents';

const MAX_TOOL_ITERATIONS = 5;

// ── Legal research tool definitions ───────────────────────────────────────────

const LEGAL_TOOLS = [
  {
    name: 'fetch_legal_document',
    description: `Fetch and read live content from an authoritative legal source, online library, or regulatory database.

AUTHORITATIVE SOURCES — USE FOR EVERY COMPLEX QUESTION:

DIFC / UAE / GCC:
- DIFC Laws Portal: https://www.difc.ae/business/laws-regulations/
- DFSA Rulebook (live): https://rulebook.dfsa.ae/
- UAE Ministry of Justice: https://elaws.moj.gov.ae/en
- UAE Central Bank: https://www.centralbank.ae/en/regulatory-framework
- ADGM Regulations: https://www.adgm.com/legal-and-regulatory/regulations
- ADGM Courts: https://www.adgmcourts.com/judgments
- Saudi CMA: https://cma.org.sa/en/RulesRegulations/Pages/default.aspx
- Bahrain CBB: https://www.cbb.gov.bh/regulatory-framework/
- Qatar QFCRA: https://www.qfca.com.qa/rules-and-regulations
- Kuwait CMA: https://www.cma.gov.kw/en/web/cma/legislations
- Oman CMA: https://www.cma.gov.om/Home/Legislations

INTERNATIONAL / CASE LAW:
- BAILII (UK/Commonwealth case law): https://www.bailii.org/
- DIFC Courts judgments: https://www.difccourts.ae/judgments/
- Cornell LII (US law): https://www.law.cornell.edu/
- EUR-Lex (EU law / GDPR): https://eur-lex.europa.eu/
- UK Legislation: https://www.legislation.gov.uk/
- UK FCA Handbook: https://www.handbook.fca.org.uk/
- ECHR judgments: https://hudoc.echr.coe.int/
- ICJ decisions: https://www.icj-cij.org/decisions
- ICSID cases: https://icsid.worldbank.org/cases/
- WTO disputes: https://www.wto.org/english/tratop_e/dispu_e/
- FATF: https://www.fatf-gafi.org/en/topics/fatf-recommendations.html
- IOSCO: https://www.iosco.org/library/pubdocs/
- BIS Basel: https://www.bis.org/bcbs/
- UN OHCHR: https://www.ohchr.org/en/instruments-and-mechanisms
- UNCITRAL: https://uncitral.un.org/en/texts/arbitration
- WIPO: https://www.wipo.int/portal/en/

Always cite every URL. If a source is inaccessible, state clearly and apply embedded knowledge.`,
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The exact URL of the legal source to fetch'
        },
        source_name: {
          type: 'string',
          description: 'Human-readable name of this source (e.g. "DFSA Rulebook", "FATF 40 Recommendations")'
        },
        section: {
          type: 'string',
          description: 'Specific section, rule, article, or provision to look for at this URL'
        }
      },
      required: ['url', 'source_name']
    }
  }
];

function parseJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Tool execution — fetches live legal content ────────────────────────────────

async function executeFetchLegalDocument(input) {
  const { url, source_name, section } = input;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const resp = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GCI-LegalResearch/2.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: controller.signal
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      return `Unable to access ${source_name} (${url}) — HTTP ${resp.status}. This source may require direct browser access. Applying embedded knowledge for this jurisdiction.`;
    }

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('application/pdf')) {
      return `${source_name} returned a PDF at ${url}. Using embedded knowledge for this source instead.`;
    }

    const html = await resp.text();

    // Strip HTML and extract meaningful legal text
    let text = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#[0-9]+;/g, ' ')
      .replace(/\s{3,}/g, '\n\n')
      .trim();

    // If section specified, try to locate it in the text
    if (section && text.length > 2000) {
      const sectionLower = section.toLowerCase();
      const idx = text.toLowerCase().indexOf(sectionLower.substring(0, 30));
      if (idx > 0) {
        text = text.substring(Math.max(0, idx - 200), idx + 3800);
      } else {
        text = text.substring(0, 4500);
      }
    } else {
      text = text.substring(0, 4500);
    }

    if (!text.trim()) {
      return `${source_name} at ${url} was fetched but no readable text was found (likely JavaScript-rendered). Using embedded knowledge.`;
    }

    return `LIVE SOURCE: ${source_name}
URL: ${url}${section ? '\nSearching for: ' + section : ''}

---
${text}
---
[Cite this source and its URL in your response.]`;

  } catch (err) {
    if (err.name === 'AbortError') {
      return `${source_name} (${url}) timed out. Using embedded knowledge for this source.`;
    }
    return `Could not fetch ${source_name} (${url}): ${err.message}. Using embedded knowledge.`;
  }
}

async function executeTool(toolName, toolInput) {
  if (toolName === 'fetch_legal_document') {
    return await executeFetchLegalDocument(toolInput);
  }
  return 'Unknown tool.';
}

// ── Gather all GCI agent intelligence ─────────────────────────────────────────

async function gatherAgentIntelligence() {
  const [
    krishnaSupplement,
    hanumanIntel,
    vishwakarmaStatus,
    krishnaHistory,
    legalMemory,
    legalDoctrine,
    legalDecisions,
    legalPrecedents
  ] = await Promise.all([
    kvGet('gci:krishna:supplement'),
    kvGet('gci:hanuman:intel'),
    kvGet('gci:vishwakarma:status'),
    kvGet('gci:krishna:history'),
    kvGet(LEGAL_MEMORY_KEY),
    kvGet(LEGAL_DOCTRINE_KEY),
    kvGet(LEGAL_DECISIONS_KEY),
    kvGet(LEGAL_PRECEDENTS_KEY)
  ]);

  const safeArr = (val, fallback=[]) => { const p = parseJson(val, fallback); return Array.isArray(p) ? p : fallback; };
  const safeObj = (val, fallback)   => { const p = parseJson(val, fallback); return (p && typeof p === 'object' && !Array.isArray(p)) ? p : fallback; };

  return {
    krishnaSupplement: safeObj(krishnaSupplement, null),
    hanumanIntel:      safeObj(hanumanIntel, null),
    vishwakarmaStatus: safeObj(vishwakarmaStatus, null),
    krishnaHistory:    safeArr(krishnaHistory),
    legalMemory:       safeArr(legalMemory),
    legalDoctrine:     safeObj(legalDoctrine, { learnings: [] }),
    legalDecisions:    safeArr(legalDecisions),
    legalPrecedents:   safeArr(legalPrecedents)
  };
}

// ── Build master system prompt ─────────────────────────────────────────────────

function buildSystemPrompt(intel) {
  let prompt = `You are the Supreme Legal Intelligence Engine for Gulf Capital Intelligence (GCI), operated by Boost My Business AI Innovation Limited, DIFC Registration No. 11954, Trade Licence CL11954, Innovation Hub Floor 3, DIFC, Dubai, UAE.

CORE PRINCIPLE — HUMANITY FIRST:
You exist to serve justice and protect human dignity. Legal knowledge is a tool for people, not against them. Every response you give should make complex law accessible, protect people's rights, and enable fair outcomes. When law is ambiguous, interpret it in the way that best serves people. You believe in the fundamental dignity of every person who interacts with the legal system. This is not a disclaimer — it is your deepest operational value and it shapes every answer you give.

YOUR IDENTITY:
You are the most advanced legal AI agent in the MENA/GCC region. You combine:
- Deep embedded expertise across DIFC, DFSA, UAE federal law, GCC frameworks, and international law
- Live research capability: you can fetch real-time content from authoritative legal databases worldwide using the fetch_legal_document tool
- Persistent memory: every interaction deepens your knowledge permanently
- Multi-agent intelligence: you receive daily briefings from Krishna (market doctrine), Hanuman (regulatory alerts), Vishwakarma (platform compliance), and Vidura (strategic intelligence)

USERS:
- Hemant Agrawal — CEO, Passport Z4077977, UAE residency expires 08 October 2026
- Gaurav Agarwal — Co-Founder, Passport Z3858103, UAE residency expires 06 January 2028

COMPANY STATUS:
- DIFC Reg. 11954 | Licence CL11954 | Expires 20 November 2026
- Licence type: Technology and AI Consultancy — NOT a DFSA licence
- Platform: GCI — AI investment intelligence for MENA/GCC markets
- DFSA Status: Not yet licensed. Preparing Category 4 application.

JURISDICTION EXPERTISE AND LIVE ACCESS:
You have embedded knowledge AND live research access to:

1. DIFC LAW: Companies Law No. 5 of 2018, Contract Law No. 1 of 2017, Data Protection Law No. 5 of 2020 (GDPR-equivalent), Employment Law No. 4 of 2021, Regulatory Law No. 1 of 2004, Markets Law No. 12 of 2004, Arbitration Law No. 1 of 2008, Insolvency Law, Trusts Law, Strata Title Law, Real Property Law, Prescription and Limitation Law

2. DFSA RULEBOOK: GEN (General), COB (Conduct of Business), PIB (Prudential Investment Business), AML (Anti-Money Laundering — AML 5.5 register, AML 6.1 CDD, AML 7.1 suspicious activity), REP (Reporting), CIR (Collective Investment Rules), MKT (Markets), FUNDS, ISR (Islamic Finance), AMI (Authorised Market Institutions), FPR (Financial Promotions)

3. UAE FEDERAL: AML Law No. 20 of 2018, Cabinet Resolution No. 10 of 2019, Commercial Companies Federal Decree No. 32 of 2021, Banking Law Federal Decree No. 14 of 2018, Consumer Protection Law No. 15 of 2020, Cyber Crimes Law No. 34 of 2021, Anti-Discrimination Law

4. GCC FRAMEWORKS: Saudi CMA (Capital Market Law, Securities Business Regulations, Investment Funds Regulations), Bahrain CBB Rulebook Vol. 6, Qatar QFCRA Financial Services Regulations, Kuwait CMA Securities Law No. 7 of 2010, Oman CMA Capital Market Law No. 80/98

5. INTERNATIONAL: FATF 40 Recommendations + 9 Special Recommendations, Basel III/IV, IOSCO Principles for Securities Regulation, GDPR (EU) 2016/679, UK FCA Handbook (SYSC, COBS, MAR), US SEC regulations, MAS (Singapore), ADGM, UNCITRAL, UNIDROIT Principles

6. HUMAN RIGHTS AND ETHICS: UN Human Rights frameworks (UDHR, ICCPR, ICESCR), ILO Core Labour Standards, UN Guiding Principles on Business and Human Rights (Ruggie Framework), ESG compliance, Corporate Social Responsibility standards

GLOBAL LEGAL MASTERY — EVERY COURT AND JURISDICTION ON EARTH:

COMMON LAW:
England & Wales: UK Supreme Court, Court of Appeal, High Court (King's Bench, Chancery, Commercial Court). CPR, Limitation Act 1980, Human Rights Act 1998, Companies Act 2006, Insolvency Act 1986, UCTA 1977. Key cases: Donoghue v Stevenson (negligence), Hadley v Baxendale (remoteness), Carlill v Carbolic (offer/acceptance), Salomon v Salomon (corporate veil).
United States: Supreme Court, Circuit Courts, District Courts, Delaware Court of Chancery. FRCP, FRE, UCC, Federal Arbitration Act, FCPA, Sherman Act, Dodd-Frank. Twombly/Iqbal pleading, Daubert standard, business judgment rule, fiduciary duties under Delaware law.
Singapore: SICC, Court of Appeal, High Court. Evidence Act, International Arbitration Act, PDPA. Preferred Asia-Pacific seat for international disputes.
Australia: High Court, Federal Court. Corporations Act 2001, Australian Consumer Law.
Canada: Supreme Court, Federal Court. Canadian Charter, Competition Act.
India: Supreme Court, 25 High Courts. CPC 1908, Indian Contract Act 1872, Companies Act 2013, IBC 2016, Arbitration and Conciliation Act 1996.
Hong Kong: Court of Final Appeal, Court of Appeal. Common law preserved. SFO, HKIAC arbitration.

CIVIL LAW:
France: Cour de Cassation, Conseil d'Etat. Code Civil, Code de Commerce. ICC arbitration (Paris).
Germany: BGH, BVerfG. BGB, HGB, ZPO. Foundation of EU private law. DIS arbitration.
Switzerland: Swiss Federal Tribunal. Code of Obligations, IPRG. Preferred neutral arbitration seat (Geneva, Zurich). Swiss Rules.
Netherlands: Hoge Raad, Netherlands Commercial Court. NAI arbitration.
Japan: Supreme Court. Civil Code, Companies Act.

INTERNATIONAL COURTS:
ICJ (The Hague): State-to-state disputes, advisory opinions, provisional measures (Art 41 ICJ Statute).
ICC Criminal Court (The Hague): Rome Statute — genocide, crimes against humanity, war crimes, aggression. Complementarity principle.
ECHR (Strasbourg): 46 states. Art 3 (absolute — torture), Art 5 (liberty), Art 6 (fair trial — most litigated), Art 8 (privacy), Art 10 (expression), Art 14 (non-discrimination), P1A1 (property). Pilot judgments.
CJEU (Luxembourg): Supremacy and direct effect of EU law, preliminary rulings (Art 267 TFEU), Francovich liability.
WTO DSB (Geneva): GATT, ADA (anti-dumping), SCM (subsidies), TBT, SPS, TRIPS, GATS, DSU.
ICSID (Washington DC): ICSID Convention, BIT/FTA investment arbitration. FET, FPS, expropriation, MFN. Key: Metalclad, Tecmed, CMS Gas. Self-enforcing awards under Art 54.
ITLOS (Hamburg): UNCLOS. Provisional measures, prompt release, deep seabed.
PCA (The Hague): Inter-state and investor-state ad hoc arbitration.

ARBITRATION MASTERY:
ICC Rules 2021, LCIA Rules 2020, SIAC Rules 2016, DIAC Rules 2022, AAA/ICDR Rules, HKIAC Rules 2018, SCC Rules 2017, UNCITRAL Rules 2013, Swiss Rules 2021. New York Convention 1958 (170+ states) — Art II (written agreement), Art V (limited refusal grounds). IBA Rules on Evidence. Emergency arbitrator procedure. Expedited arbitration. Multi-party and multi-contract arbitration. Third-party funding. Document production in arbitration.

INTELLECTUAL PROPERTY:
WIPO: Paris Convention, Berne Convention, TRIPS, PCT, Madrid System, Hague System, WIPO Copyright Treaty. USPTO, EPO (Unitary Patent 2023), UKIPO, CNIPA. IP litigation: infringement, passing off, trade secret, domain disputes (UDRP), SEP/FRAND. IP in the AI context.

COMPETITION / ANTITRUST:
EU: Arts 101/102 TFEU, EC Merger Regulation, leniency, private enforcement Directive 2014/104. US: Sherman Act ss1/2, Clayton Act, HSR. UK: Competition Act 1998, Enterprise Act 2002, CMA. UAE: Competition Law No. 4 of 2012.

CRIMINAL DEFENSE:
Presumption of innocence, right to silence, legal privilege, double jeopardy (ne bis in idem), extradition (dual criminality, specialty, political offense exception), MLAT framework, asset freezing/confiscation, Proceeds of Crime frameworks globally.

STRATEGIC LEGAL FRAMEWORKS:
IRAC and CREAC (legal reasoning). Toulmin model (claim, grounds, warrant, backing, qualifier, rebuttal). Chanakya Arthashastra — know enemy weakness, control information, timing of strike, exhaustion through attrition, always maintain an exit. Sun Tzu — choose the battlefield advantageously, neutralize strongest argument before opponent makes it. BATNA/WATNA/ZOPA — settlement intelligence. Precedent mapping hierarchy. Cross-examination mastery: only closed questions, commit-then-confront, one fact per question, never ask what you cannot control, impeach with documents not memory, silence after admissions.

LIVE RESEARCH METHODOLOGY:
For any complex legal question, especially those involving:
- Specific rule numbers or threshold amounts
- Recent regulatory changes (2024/2025)
- Jurisdiction-specific procedures
- Contract provisions under specific laws
- Licensing requirements and processes

You MUST use fetch_legal_document to pull live content from authoritative sources. Then:
1. Synthesise the live content with your embedded knowledge
2. Cite every source URL you used
3. Note if any source was inaccessible and what embedded knowledge you used instead

DOCUMENT DRAFTING CAPABILITY:
You can draft any legal document in full, including:
- Non-Disclosure Agreements (DIFC law governed)
- Service Agreements and Master Service Agreements
- Employment Contracts (DIFC Employment Law compliant)
- Data Protection and Privacy Policies (DIFC DP Law compliant)
- Platform Terms of Service
- Investor Disclaimers and Risk Warnings
- DFSA Category 4 Application Cover Letters
- Board Resolutions
- Regulatory Correspondence
- Memoranda of Understanding
- Shareholder Agreements
- Investment Management Agreements (for future DFSA licensing)

When drafting, use precise legal language, include governing law and jurisdiction clauses, all standard protective provisions, and flag anything requiring solicitor review before execution.

RESPONSE STANDARDS:
- Direct, specific, comprehensive — no vague answers
- Cite live sources with exact URLs when you research
- Bold key legal terms, thresholds, and deadlines
- Numbered lists for obligations and action steps
- End every response: "AI Legal Intelligence — not formal legal advice. For DFSA applications, litigation, and document execution, engage a DIFC-qualified law firm."

`;

  // Inject live agent intelligence
  if (intel.krishnaSupplement) {
    const k = intel.krishnaSupplement;
    prompt += `\nKRISHNA'S CURRENT MARKET DOCTRINE:\n`;
    if (k.doctrine) prompt += `${k.doctrine}\n`;
    if (k.riskLevel) prompt += `Market Risk Level: ${k.riskLevel}\n`;
    if (k.legalImplications) prompt += `Legal Implications: ${k.legalImplications}\n`;
    if (k.keyThemes) prompt += `Key Themes: ${Array.isArray(k.keyThemes) ? k.keyThemes.join(', ') : k.keyThemes}\n`;
  }

  if (intel.hanumanIntel) {
    const h = intel.hanumanIntel;
    prompt += `\nHANUMAN'S REGULATORY INTELLIGENCE:\n`;
    if (h.summary) prompt += `${h.summary}\n`;
    if (h.regulatoryUpdates) prompt += `Regulatory Updates: ${JSON.stringify(h.regulatoryUpdates)}\n`;
    if (h.complianceAlerts) prompt += `Compliance Alerts: ${JSON.stringify(h.complianceAlerts)}\n`;
  }

  if (intel.vishwakarmaStatus) {
    const v = intel.vishwakarmaStatus;
    if (v.complianceRisks) {
      prompt += `\nVISHWAKARMA PLATFORM COMPLIANCE RISKS:\n${JSON.stringify(v.complianceRisks)}\n`;
    }
  }

  if (intel.legalMemory && intel.legalMemory.length > 0) {
    const recent = intel.legalMemory.slice(-10);
    prompt += `\nLEGAL MEMORY (last ${recent.length} interactions — avoid repetition, build on prior answers):\n`;
    recent.forEach((e, i) => {
      prompt += `${i+1}. [${e.topics?.join(',')||'general'}] ${e.question?.substring(0,120)||''}\n`;
    });
  }

  if (intel.legalDoctrine?.learnings?.length > 0) {
    const recent = intel.legalDoctrine.learnings.slice(-8);
    prompt += `\nACCUMULATED LEGAL DOCTRINE (your learned positions, refine and build on these):\n`;
    recent.forEach((l, i) => {
      prompt += `${i+1}. [${l.source||'learning'}] ${l.learning}\n`;
    });
  }

  if (intel.legalDecisions?.length > 0) {
    const recent = intel.legalDecisions.slice(-5);
    prompt += `\nKEY LEGAL POSITIONS ON RECORD:\n`;
    recent.forEach((d, i) => {
      prompt += `${i+1}. ${d.decision} (${d.date||'recent'})\n`;
    });
  }

  if (intel.legalPrecedents?.length > 0) {
    const recent = intel.legalPrecedents.slice(-15);
    prompt += `\nTRAINED PRECEDENTS IN MEMORY (${intel.legalPrecedents.length} total):\n`;
    recent.forEach((p, i) => {
      prompt += `${i+1}. [${p.jurisdiction||'unknown'}] ${p.case||'case'} — ${p.holding||p.principle||''}\n`;
    });
  }

  if (intel.legalDoctrine?.winningArguments?.length > 0) {
    const recent = intel.legalDoctrine.winningArguments.slice(-8);
    prompt += `\nWINNING ARGUMENTS IN ARSENAL:\n`;
    recent.forEach((a, i) => {
      prompt += `${i+1}. [${a.context||'general'}] ${a.argument}\n`;
    });
  }

  return prompt;
}

// ── Memory storage ─────────────────────────────────────────────────────────────

async function storeMemory(question, answerSummary, topics) {
  const raw = await kvGet(LEGAL_MEMORY_KEY);
  const parsed = parseJson(raw, []);
  // Guard: KV may contain a non-array value (object, string, null) if storage was corrupted
  const existing = Array.isArray(parsed) ? parsed : [];
  const entry = {
    timestamp: new Date().toISOString(),
    question: question.substring(0, 300),
    answerSummary: answerSummary.substring(0, 400),
    topics
  };
  const updated = [...existing, entry].slice(-50);
  await kvSet(LEGAL_MEMORY_KEY, JSON.stringify(updated), 90 * 24 * 3600);
  return updated.length;
}

function detectTopics(text) {
  const lower = text.toLowerCase();
  const map = {
    DFSA:               ['dfsa','rulebook','category 4','authorised firm','licensed'],
    AML:                ['aml','anti-money laundering','kyc','cdd','suspicious','fatf','cft'],
    Contracts:          ['contract','agreement','clause','nda','terms','signed','breach','liability'],
    DataProtection:     ['data protection','gdpr','personal data','privacy','commissioner','processing'],
    'DIFC-Corporate':   ['difc','companies law','director','shareholder','memorandum','articles'],
    GCC:                ['saudi','bahrain','qatar','kuwait','oman','cma','cbb','qfcra'],
    Employment:         ['employment','employee','labour','eosb','gratuity','termination'],
    Tax:                ['vat','tax','withholding','economic substance'],
    InvestmentCompliance:['investment','securities','capital market','prospectus','offering'],
    IP:                 ['intellectual property','trademark','copyright','patent'],
    HumanRights:        ['human rights','dignity','fairness','discrimination','freedom'],
    Arbitration:        ['arbitration','dispute','diac','lcia','award','seat']
  };
  return Object.entries(map)
    .filter(([_, kw]) => kw.some(k => lower.includes(k)))
    .map(([topic]) => topic);
}

// ── Main handler ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Auth check
  const { secret, messages, document, documents } = req.body || {};
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorised. Please log in again.' });
  }
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'No messages provided.' });
  }
  // Normalise to array of docs (supports both single `document` and `documents` array)
  const allDocs = documents && documents.length > 0
    ? documents
    : (document && document.data ? [{ name: 'document', mediaType: document.mediaType, data: document.data }] : []);

  // Server-side safety: trim oversized message histories before any processing.
  // Cap each assistant message at 3000 chars and keep last 16 messages max.
  const safeMessages = messages.slice(-16).map(m => {
    if (m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 3000) {
      return { role: 'assistant', content: m.content.slice(0, 3000) + '\n[…trimmed]' };
    }
    return m;
  });

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (obj) => {
    try { res.write(`data: ${JSON.stringify(obj)}\n\n`); } catch {}
  };

  try {
    // 1. Gather all agent intelligence from KV in parallel
    const intel = await gatherAgentIntelligence();
    const memoryCount = intel.legalMemory.length;

    // 2. Determine active agents
    const agentsActive = ['LegalMemory'];
    if (intel.krishnaSupplement) agentsActive.push('Krishna');
    if (intel.hanumanIntel)      agentsActive.push('Hanuman');
    if (intel.vishwakarmaStatus) agentsActive.push('Vishwakarma');
    if (intel.legalDoctrine?.learnings?.length > 0) agentsActive.push('Vidura');

    send({ type: 'meta', agentsActive, memoryCount });

    // 3. Build system prompt with full agent intelligence injected
    const systemPrompt = buildSystemPrompt(intel);

    // 4. Build API messages (support multi-file document attachments — PDFs, images, text, etc.)
    let apiMessages = [...safeMessages];

    if (allDocs.length > 0) {
      const lastMsg = apiMessages[apiMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user') {
        const textContent = typeof lastMsg.content === 'string'
          ? lastMsg.content
          : (lastMsg.content?.[0]?.text || '');

        const contentBlocks = [];

        // Add each document/image as a content block
        for (const doc of allDocs) {
          const isImage = doc.mediaType && doc.mediaType.startsWith('image/');
          const isPdf = doc.mediaType === 'application/pdf';
          if (isImage) {
            // Image block
            contentBlocks.push({
              type: 'image',
              source: { type: 'base64', media_type: doc.mediaType, data: doc.data }
            });
          } else if (isPdf) {
            // PDF document block (requires anthropic-beta: pdfs-2024-09-25)
            contentBlocks.push({
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: doc.data }
            });
          } else {
            // For DOCX, XLSX, CSV, TXT etc — decode base64 to text and inject as text block
            try {
              const decoded = Buffer.from(doc.data, 'base64').toString('utf-8').slice(0, 40000);
              contentBlocks.push({
                type: 'text',
                text: `[File: ${doc.name || 'document'}]\n${decoded}`
              });
            } catch {
              contentBlocks.push({
                type: 'text',
                text: `[File: ${doc.name || 'document'} — binary content, analyse based on filename and user question]`
              });
            }
          }
        }

        const docNames = allDocs.map(d => d.name || 'document').join(', ');
        contentBlocks.push({
          type: 'text',
          text: textContent || `Please review the following ${allDocs.length > 1 ? 'files' : 'file'} thoroughly: ${docNames}. Identify all legal risks, obligations, missing clauses, and recommendations under applicable law.`
        });

        apiMessages[apiMessages.length - 1] = { role: 'user', content: contentBlocks };
      }
    }

    // 5. Research phase — tool use loop (live legal database access)
    const researchMessages = [...apiMessages];
    const sourcesConsulted = [];
    let toolIterations = 0;

    // Send immediate thinking signal so client shows activity (prevents "not responding" appearance)
    send({ type: 'thinking', status: 'Analysing your question...' });

    while (toolIterations < MAX_TOOL_ITERATIONS) {
      // 45-second timeout per research iteration to prevent silent hangs
      const researchController = new AbortController();
      const researchTimeout = setTimeout(() => researchController.abort(), 45000);

      let researchResp;
      try {
        researchResp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'pdfs-2024-09-25',
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-6',
            max_tokens: 1024,
            system: systemPrompt,
            messages: researchMessages,
            tools: LEGAL_TOOLS,
            tool_choice: { type: 'auto' }
          }),
          signal: researchController.signal
        });
      } catch (fetchErr) {
        clearTimeout(researchTimeout);
        if (fetchErr.name === 'AbortError') {
          throw new Error('VIDURA research phase timed out. The AI service may be under load. Please try again in a moment.');
        }
        throw fetchErr;
      }
      clearTimeout(researchTimeout);

      if (!researchResp.ok) {
        const errData = await researchResp.json().catch(() => ({}));
        throw new Error(errData.error?.message || `Research phase error ${researchResp.status}`);
      }

      const researchData = await researchResp.json();

      // No tool calls needed — proceed directly to streaming
      if (researchData.stop_reason !== 'tool_use') break;

      // Execute each tool call
      const toolUseBlocks = researchData.content.filter(b => b.type === 'tool_use');
      const toolResults = [];

      for (const toolUse of toolUseBlocks) {
        const sourceName = toolUse.input.source_name || 'Legal Database';
        const url = toolUse.input.url || '';

        send({ type: 'source_fetching', source: sourceName, url });

        const result = await executeTool(toolUse.name, toolUse.input);
        sourcesConsulted.push({ name: sourceName, url });

        const success = result.startsWith('LIVE SOURCE:');
        send({ type: 'source_fetched', source: sourceName, url, success, chars: result.length });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: result
        });
      }

      researchMessages.push({ role: 'assistant', content: researchData.content });
      researchMessages.push({ role: 'user', content: toolResults });
      toolIterations++;
    }

    // Signal synthesis starting
    if (sourcesConsulted.length > 0) {
      send({ type: 'synthesizing', sources: sourcesConsulted });
    }

    // 6. Final streaming response
    // 90-second timeout — long enough for complex answers, short enough to catch hangs
    const finalController = new AbortController();
    const finalTimeout = setTimeout(() => finalController.abort(), 90000);

    let finalResp;
    try {
      finalResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'pdfs-2024-09-25',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          stream: true,
          system: systemPrompt,
          messages: researchMessages
        }),
        signal: finalController.signal
      });
    } catch (fetchErr) {
      clearTimeout(finalTimeout);
      throw fetchErr;
    }

    if (!finalResp.ok) {
      clearTimeout(finalTimeout);
      const errData = await finalResp.json().catch(() => ({}));
      throw new Error(errData.error?.message || `Final response error ${finalResp.status}`);
    }

    // Stream text chunks to client
    // Clear the connect timeout once we have a response — streaming can take as long as needed
    clearTimeout(finalTimeout);

    const reader = finalResp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullAnswer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (raw === '[DONE]') continue;

        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            const chunk = evt.delta.text || '';
            fullAnswer += chunk;
            send({ type: 'text', text: chunk });
          }
        } catch {}
      }
    }

    // 7. Store interaction in persistent legal memory (only if we got an actual answer)
    const lastQuestion = typeof safeMessages[safeMessages.length - 1]?.content === 'string'
      ? safeMessages[safeMessages.length - 1].content
      : 'Document review';

    if (fullAnswer.trim()) {
      const topics = detectTopics(fullAnswer + lastQuestion);
      const newMemoryCount = await storeMemory(lastQuestion, fullAnswer, topics);
      send({ type: 'done', memoryCount: newMemoryCount, sourcesConsulted: sourcesConsulted.length });
    } else {
      send({ type: 'done', sourcesConsulted: sourcesConsulted.length });
    }

  } catch (err) {
    send({ type: 'error', message: err.message });
  } finally {
    res.end();
  }
}
