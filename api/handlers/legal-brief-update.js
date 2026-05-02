// api/legal-brief-update.js — GCI Legal Intelligence Daily Cron
// Runs every morning: gathers all agent intelligence, synthesizes legal implications,
// updates gci:legal:doctrine in KV, emails founders a daily legal intelligence brief.
// Trigger via Vercel Cron: "0 6 * * *" (06:00 UTC = 10:00 Dubai time)

const { kvGet, kvSet } = require('../redis-client');
const RESEND_API_KEY    = process.env.RESEND_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CRON_SECRET       = process.env.CRON_SECRET; // optional guard

const LEGAL_MEMORY_KEY    = 'gci:legal:memory';
const LEGAL_DOCTRINE_KEY  = 'gci:legal:doctrine';
const LEGAL_DECISIONS_KEY = 'gci:legal:decisions';
const LEGAL_BRIEF_KEY     = 'gci:legal:lastbrief';

const FOUNDERS = [
  { name: 'Hemant Agrawal',  email: 'hemanthult@gmail.com' },
  { name: 'Gaurav Agarwal',  email: 'gaurav@boostmylocalbusiness.ai' },
  { name: 'GCI Team',        email: 'difc@gulfcapitalintelligence.com' }
];

// ── Parse JSON safely ─────────────────────────────────────────────────────────

function parseJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Gather all agent intelligence ─────────────────────────────────────────────

async function gatherIntelligence() {
  const [
    krishnaSupplement,
    krishnaHistory,
    hanumanIntel,
    vishwakarmaStatus,
    legalMemory,
    legalDoctrine,
    legalDecisions
  ] = await Promise.all([
    kvGet('gci:krishna:supplement'),
    kvGet('gci:krishna:history'),
    kvGet('gci:hanuman:intel'),
    kvGet('gci:vishwakarma:status'),
    kvGet(LEGAL_MEMORY_KEY),
    kvGet(LEGAL_DOCTRINE_KEY),
    kvGet(LEGAL_DECISIONS_KEY)
  ]);

  return {
    krishnaSupplement: parseJson(krishnaSupplement, null),
    krishnaHistory:    parseJson(krishnaHistory, []),
    hanumanIntel:      parseJson(hanumanIntel, null),
    vishwakarmaStatus: parseJson(vishwakarmaStatus, null),
    legalMemory:       parseJson(legalMemory, []),
    legalDoctrine:     parseJson(legalDoctrine, { learnings: [], lastUpdated: null }),
    legalDecisions:    parseJson(legalDecisions, [])
  };
}

// ── Build synthesis prompt ─────────────────────────────────────────────────────

function buildBriefPrompt(intel) {
  const today = new Date().toISOString().split('T')[0];

  let prompt = `You are GCI's Supreme Legal Intelligence Engine conducting your daily morning synthesis for Gulf Capital Intelligence (GCI), trading as Boost My Business AI Innovation Ltd, DIFC Registration No. 11954.

COMPANY CONTEXT:
- DIFC License expires: 20 November 2026
- Co-Founders: Hemant Agrawal (CEO) and Gaurav Agarwal
- Platform: AI-powered investment intelligence for MENA/GCC markets
- Current regulatory status: Operating under Innovation Testing License (ITL) umbrella pending DFSA Category 4 application

TODAY'S DATE: ${today}

YOUR MISSION: Synthesise all available agent intelligence into a comprehensive daily Legal Intelligence Brief that:
1. Identifies any new legal or regulatory risks from market/platform activity
2. Updates the legal doctrine based on learnings from recent Q&A interactions
3. Highlights upcoming compliance deadlines and actions required
4. Provides a prioritised action list for the legal/compliance team

`;

  // Krishna's market doctrine
  if (intel.krishnaSupplement) {
    const k = intel.krishnaSupplement;
    prompt += `\nKRISHNA'S MARKET DOCTRINE (today):\n`;
    if (k.doctrine) prompt += `Doctrine: ${k.doctrine}\n`;
    if (k.riskLevel) prompt += `Market Risk Level: ${k.riskLevel}\n`;
    if (k.keyThemes) prompt += `Key Themes: ${Array.isArray(k.keyThemes) ? k.keyThemes.join(', ') : k.keyThemes}\n`;
    if (k.legalImplications) prompt += `Legal Implications flagged by Krishna: ${k.legalImplications}\n`;
  }

  // Hanuman's intelligence
  if (intel.hanumanIntel) {
    const h = intel.hanumanIntel;
    prompt += `\nHANUMAN'S INTELLIGENCE REPORT:\n`;
    if (h.summary) prompt += `Summary: ${h.summary}\n`;
    if (h.regulatoryUpdates) prompt += `Regulatory Updates: ${JSON.stringify(h.regulatoryUpdates)}\n`;
    if (h.marketEvents) prompt += `Market Events: ${JSON.stringify(h.marketEvents)}\n`;
    if (h.complianceAlerts) prompt += `Compliance Alerts: ${JSON.stringify(h.complianceAlerts)}\n`;
  }

  // Vishwakarma's system status
  if (intel.vishwakarmaStatus) {
    const v = intel.vishwakarmaStatus;
    prompt += `\nVISHWAKARMA'S SYSTEM STATUS:\n`;
    if (v.systemHealth) prompt += `System Health: ${v.systemHealth}\n`;
    if (v.activeFeatures) prompt += `Active Features: ${JSON.stringify(v.activeFeatures)}\n`;
    if (v.complianceRisks) prompt += `Compliance Risks Detected: ${JSON.stringify(v.complianceRisks)}\n`;
  }

  // Recent legal Q&A memory
  if (intel.legalMemory && intel.legalMemory.length > 0) {
    const recent = intel.legalMemory.slice(-8);
    prompt += `\nRECENT LEGAL Q&A INTERACTIONS (last ${recent.length}):\n`;
    recent.forEach((entry, i) => {
      prompt += `${i + 1}. [${entry.timestamp?.split('T')[0] || 'recent'}] Topics: ${(entry.topics || []).join(', ')}\n`;
      prompt += `   Q: ${entry.question?.substring(0, 120) || 'N/A'}\n`;
      prompt += `   A summary: ${entry.answerSummary?.substring(0, 200) || 'N/A'}\n`;
    });
  }

  // Existing doctrine
  if (intel.legalDoctrine?.learnings?.length > 0) {
    const recent = intel.legalDoctrine.learnings.slice(-10);
    prompt += `\nEXISTING LEGAL DOCTRINE (last ${recent.length} learnings):\n`;
    recent.forEach((l, i) => {
      prompt += `${i + 1}. [${l.date || 'N/A'}] ${l.learning}\n`;
    });
  }

  // Key decisions
  if (intel.legalDecisions && intel.legalDecisions.length > 0) {
    const recent = intel.legalDecisions.slice(-5);
    prompt += `\nKEY LEGAL DECISIONS ON RECORD:\n`;
    recent.forEach((d, i) => {
      prompt += `${i + 1}. ${d.decision} (${d.date || 'N/A'})\n`;
    });
  }

  prompt += `

FIXED COMPLIANCE CALENDAR FOR GCI (always include in brief):
- DFSA Annual Return: 31 March 2026 (9 days away — URGENT)
- DIFC License Renewal: 20 November 2026 (start process by August 2026)
- VAT Return (if registered): Quarterly
- Economic Substance Notification: Within 6 months of financial year end
- AML/CFT Annual Report to DFSA: 31 March 2026 (URGENT)
- CDD/KYC Review of existing clients: Annual
- Data Protection registration with DIFC Commissioner: Ongoing obligation

REQUIRED OUTPUT FORMAT — respond with a valid JSON object only:
{
  "date": "${today}",
  "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL",
  "executiveSummary": "2-3 sentence summary for founders",
  "regulatoryHighlights": ["key point 1", "key point 2", "..."],
  "legalLearnings": [
    {"learning": "specific legal insight synthesised today", "source": "Krishna/Hanuman/Q&A/Doctrine", "confidence": "HIGH|MEDIUM"}
  ],
  "updatedDoctrine": ["doctrine statement 1", "doctrine statement 2"],
  "urgentActions": [
    {"action": "what needs to be done", "deadline": "date or timeframe", "priority": "CRITICAL|HIGH|MEDIUM"}
  ],
  "upcomingDeadlines": [
    {"item": "deadline name", "date": "date", "daysRemaining": N, "status": "OVERDUE|URGENT|ON_TRACK"}
  ],
  "marketLegalRisks": ["risk identified from market intelligence"],
  "systemComplianceRisks": ["risk from platform/system activity"],
  "briefHtml": "Full HTML for the email brief (professional, styled inline CSS, GCI branding, navy #0B1D35)"
}

The briefHtml should be a complete, beautiful HTML email body with inline styles — navy header, white content area, colour-coded priority sections (red=critical, orange=urgent, green=ok), and a clean professional look befitting a DIFC-regulated entity. Include all sections: Executive Summary, Urgent Actions, Upcoming Deadlines, Regulatory Highlights, New Legal Learnings, Market Legal Risks. Sign off as "GCI Legal Intelligence Engine" with today's date.`;

  return prompt;
}

// ── Update KV doctrine with new learnings ─────────────────────────────────────

async function updateDoctrine(briefData, existingDoctrine) {
  const today = new Date().toISOString().split('T')[0];

  const updatedLearnings = [
    ...(existingDoctrine.learnings || []),
    ...(briefData.legalLearnings || []).map(l => ({
      date: today,
      learning: l.learning,
      source: l.source,
      confidence: l.confidence
    }))
  ].slice(-100); // keep last 100 learnings

  const updatedDoctrine = {
    lastUpdated: today,
    statements: briefData.updatedDoctrine || existingDoctrine.statements || [],
    learnings: updatedLearnings,
    riskLevel: briefData.riskLevel
  };

  await kvSet(LEGAL_DOCTRINE_KEY, JSON.stringify(updatedDoctrine), 90 * 24 * 3600);
  return updatedDoctrine;
}

// ── Send email brief to founders ───────────────────────────────────────────────

async function sendBriefEmail(briefData, htmlBody) {
  const today = new Date().toISOString().split('T')[0];
  const riskColors = { LOW: '#059669', MEDIUM: '#D97706', HIGH: '#DC2626', CRITICAL: '#7C3AED' };
  const riskColor = riskColors[briefData.riskLevel] || '#0B1D35';

  const emailPromises = FOUNDERS.map(founder => {
    const personalHtml = htmlBody.replace(
      /<div[^>]*id="greeting"[^>]*>.*?<\/div>/s,
      `<div>Good morning, ${founder.name},</div>`
    ) || htmlBody;

    return fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'GCI Legal Intelligence <difc@gulfcapitalintelligence.com>',
        to: [founder.email],
        subject: `[${briefData.riskLevel}] GCI Legal Intelligence Brief — ${today}`,
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:680px;margin:0 auto">
            <div style="background:#0B1D35;padding:20px 32px;border-radius:8px 8px 0 0">
              <div style="color:rgba(255,255,255,0.6);font-size:11px;letter-spacing:2px;text-transform:uppercase">Gulf Capital Intelligence</div>
              <div style="color:#fff;font-size:20px;font-weight:700;margin-top:4px">Daily Legal Intelligence Brief</div>
              <div style="color:rgba(255,255,255,0.5);font-size:12px;margin-top:4px">${today} &middot; DIFC Reg. 11954</div>
              <div style="display:inline-block;background:${riskColor};color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;padding:3px 10px;border-radius:20px;margin-top:8px">${briefData.riskLevel} RISK</div>
            </div>
            <div style="background:#fff;padding:24px 32px;border:1px solid #E2E8F0;border-top:none">
              <div style="color:#64748B;font-size:13px;margin-bottom:16px">Good morning, ${founder.name},</div>
              ${personalHtml}
              <div style="margin-top:24px;padding-top:16px;border-top:1px solid #E2E8F0;font-size:11px;color:#94A3B8">
                This brief is generated automatically by the GCI Legal Intelligence Engine, powered by Claude AI and a network of specialised agents (Krishna, Hanuman, Vishwakarma, Vidura). It does not constitute legal advice. For regulated advice, consult a DIFC-qualified legal practitioner.
                <br><br>Gulf Capital Intelligence &middot; DIFC, Dubai &middot; Reg. 11954
              </div>
            </div>
          </div>
        `
      })
    });
  });

  const results = await Promise.allSettled(emailPromises);
  const sent = results.filter(r => r.status === 'fulfilled').length;
  return { sent, total: FOUNDERS.length };
}

// ── Main handler ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Allow GET (Vercel cron) or POST (manual trigger)
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional cron guard — Vercel sends Authorization: Bearer <CRON_SECRET>
  if (CRON_SECRET) {
    const auth = req.headers.authorization || '';
    const manual = req.query.secret;
    if (!auth.includes(CRON_SECRET) && manual !== CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const startTime = Date.now();

    // 1. Gather all agent intelligence
    console.log('[LegalBrief] Gathering agent intelligence...');
    const intel = await gatherIntelligence();

    // 2. Build synthesis prompt
    const prompt = buildBriefPrompt(intel);

    // 3. Call Claude to synthesise
    console.log('[LegalBrief] Calling Claude for synthesis...');
    const claudeResp = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!claudeResp.ok) {
      const err = await claudeResp.json().catch(() => ({}));
      throw new Error(`Claude API error: ${err.error?.message || claudeResp.status}`);
    }

    const claudeData = await claudeResp.json();
    const rawText = claudeData.content?.[0]?.text || '';

    // 4. Parse Claude's JSON response (defensive: handle markdown fences and prose wrapping)
    let briefData;
    try {
      let jsonStr = rawText.trim();
      // Strip markdown code fences if present
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1].trim();
      // Extract first balanced JSON object
      const firstBrace = jsonStr.indexOf('{');
      const lastBrace = jsonStr.lastIndexOf('}');
      if (firstBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = jsonStr.slice(firstBrace, lastBrace + 1);
      }
      briefData = JSON.parse(jsonStr);
    } catch (e) {
      console.error('[LegalBrief] Failed to parse Claude response. Raw text:', rawText.slice(0, 500));
      console.error('[LegalBrief] Parse error:', e.message);
      throw new Error('Failed to parse legal brief JSON from Claude: ' + e.message);
    }

    // 5. Update legal doctrine in KV
    console.log('[LegalBrief] Updating legal doctrine in KV...');
    const updatedDoctrine = await updateDoctrine(briefData, intel.legalDoctrine);

    // 6. Store the brief itself in KV (7-day TTL)
    const briefRecord = {
      ...briefData,
      generatedAt: new Date().toISOString(),
      agentsConsulted: ['Krishna', 'Hanuman', 'Vishwakarma', 'LegalMemory'],
      processingMs: Date.now() - startTime
    };
    delete briefRecord.briefHtml; // don't store HTML in KV, too large

    await kvSet(LEGAL_BRIEF_KEY, JSON.stringify(briefRecord), 7 * 24 * 3600);

    // 7. Send email brief to founders
    console.log('[LegalBrief] Sending email briefs...');
    const emailResult = await sendBriefEmail(briefData, briefData.briefHtml || '');

    const totalMs = Date.now() - startTime;
    console.log(`[LegalBrief] Complete in ${totalMs}ms. Emails sent: ${emailResult.sent}/${emailResult.total}`);

    return res.status(200).json({
      ok: true,
      date: briefData.date,
      riskLevel: briefData.riskLevel,
      learningsAdded: (briefData.legalLearnings || []).length,
      totalDoctrine: updatedDoctrine.learnings.length,
      urgentActions: (briefData.urgentActions || []).length,
      emailsSent: emailResult.sent,
      processingMs: totalMs
    });

  } catch (err) {
    console.error('[LegalBrief] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
