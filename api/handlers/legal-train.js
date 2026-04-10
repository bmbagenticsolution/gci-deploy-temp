// api/legal-train.js — GCI Legal Agent Training Engine
//
// Feed any legal material to the agent and he permanently learns from it.
// Accepts: case judgments, statutes, legal treatises, academic papers,
//          regulatory guidance, arbitration awards, bar association opinions,
//          law review articles, legal textbooks (text extracts).
//
// What he extracts and stores permanently:
//   - Legal principles and holdings
//   - Precedents with jurisdiction tags
//   - Doctrinal positions
//   - Statutory interpretations
//   - Key tests and thresholds
//   - Procedural rules
//   - Winning arguments (from successful party's pleadings)
//
// KV Keys updated:
//   gci:legal:doctrine    — accumulated legal principles
//   gci:legal:precedents  — case precedents by jurisdiction
//   gci:legal:training-log — log of all training sessions

const { kvGet, kvSet } = require('../redis-client');
const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const ADMIN_SECRET       = process.env.ADMIN_SECRET;

const LEGAL_DOCTRINE_KEY    = 'gci:legal:doctrine';
const LEGAL_PRECEDENTS_KEY  = 'gci:legal:precedents';
const LEGAL_TRAINING_LOG    = 'gci:legal:training-log';
const LEGAL_MEMORY_KEY      = 'gci:legal:memory';

function parseJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

// ── Extraction prompt ─────────────────────────────────────────────────────────

function buildExtractionPrompt(docType, jurisdiction, source) {
  return `You are the GCI Legal Knowledge Extraction Engine. You operate on the principle of HUMANITY FIRST.

Your task is to read the provided legal material and extract structured knowledge that will permanently strengthen the GCI Legal Agent.

Document type: ${docType || 'Unknown — identify it'}
Jurisdiction: ${jurisdiction || 'Unknown — identify it from the content'}
Source: ${source || 'Provided by GCI founders'}

EXTRACT THE FOLLOWING and respond ONLY with valid JSON matching this exact schema:

{
  "docType": "case_judgment | statute | regulation | treatise | arbitration_award | academic_paper | pleading | legal_opinion | other",
  "jurisdiction": "identified jurisdiction(s)",
  "court": "court or tribunal if applicable",
  "year": "year if identifiable",
  "keyPrinciples": [
    {
      "principle": "Clear statement of the legal principle extracted",
      "rule": "The specific rule, test, or standard established",
      "context": "When this principle applies",
      "strength": "BINDING | HIGHLY_PERSUASIVE | PERSUASIVE | ACADEMIC"
    }
  ],
  "precedents": [
    {
      "case": "Case name and citation if available",
      "jurisdiction": "Jurisdiction of the case",
      "holding": "What the court held — the actual legal rule",
      "principle": "The broader legal principle this establishes",
      "relevantTo": ["AML", "Contracts", "Corporate", "etc — tag the legal areas"]
    }
  ],
  "doctrinalPositions": [
    {
      "position": "A clear, firm doctrinal statement the agent should hold",
      "basis": "What authority it is based on",
      "jurisdiction": "Which jurisdiction(s) this applies in"
    }
  ],
  "keyDefinitions": [
    {
      "term": "Legal term",
      "definition": "Precise legal definition from this source",
      "source": "Which law/case defines this"
    }
  ],
  "thresholdsAndTests": [
    {
      "test": "Name of the legal test",
      "elements": ["element 1", "element 2"],
      "source": "Authority",
      "jurisdiction": "Jurisdiction"
    }
  ],
  "proceduralRules": [
    {
      "rule": "Specific procedural rule or time limit",
      "court": "Which court/forum",
      "consequence": "Consequence of non-compliance"
    }
  ],
  "winningArguments": [
    {
      "argument": "A successful argument extracted from the material",
      "context": "What type of case or situation this works in",
      "authority": "The authority for this argument"
    }
  ],
  "summary": "2-3 sentence summary of what was learned from this document",
  "gciBenefit": "How this knowledge specifically benefits GCI — legal risks avoided, strategies enabled, or compliance strengthened"
}

Be exhaustive. Extract every usable piece of legal intelligence. This knowledge will be used to defend clients in real legal proceedings.`;
}

// ── Main handler ───────────────────────────────────────────────────────────────

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { secret, text, url, docType, jurisdiction, source } = req.body || {};

  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorised.' });
  }

  let contentToProcess = text;

  // If URL provided, fetch it
  if (!contentToProcess && url) {
    try {
      const resp = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GCI-LegalTrainer/1.0)', Accept: 'text/html,text/plain' },
        signal: AbortSignal.timeout(15000)
      });
      if (resp.ok) {
        const html = await resp.text();
        contentToProcess = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s{3,}/g, '\n\n').trim().substring(0, 12000);
      }
    } catch (e) {
      return res.status(400).json({ error: `Could not fetch URL: ${e.message}` });
    }
  }

  if (!contentToProcess || contentToProcess.length < 100) {
    return res.status(400).json({ error: 'Please provide legal text (minimum 100 characters) or a URL.' });
  }

  try {
    // Extract knowledge using Claude
    const extractResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system: buildExtractionPrompt(docType, jurisdiction, source || url),
        messages: [{
          role: 'user',
          content: `LEGAL MATERIAL TO PROCESS:\n\n${contentToProcess.substring(0, 10000)}`
        }]
      })
    });

    if (!extractResp.ok) {
      const err = await extractResp.json().catch(() => ({}));
      throw new Error(err.error?.message || `Extraction API error ${extractResp.status}`);
    }

    const extractData = await extractResp.json();
    const rawText = extractData.content?.[0]?.text || '';

    // Parse extracted knowledge
    let knowledge;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      knowledge = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    } catch {
      return res.status(500).json({ error: 'Could not parse extracted knowledge. The document may not contain processable legal content.' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Load existing doctrine and precedents
    const [existingDoctrine, existingPrecedents, existingLog] = await Promise.all([
      kvGet(LEGAL_DOCTRINE_KEY).then(v => parseJson(v, { learnings: [], statements: [] })),
      kvGet(LEGAL_PRECEDENTS_KEY).then(v => parseJson(v, [])),
      kvGet(LEGAL_TRAINING_LOG).then(v => parseJson(v, []))
    ]);

    // Update doctrine with new learnings
    const newLearnings = [
      ...(knowledge.keyPrinciples || []).map(p => ({
        date: today,
        learning: p.principle + ' — ' + p.rule,
        source: source || url || 'Training session',
        jurisdiction: knowledge.jurisdiction,
        strength: p.strength,
        confidence: p.strength === 'BINDING' ? 'HIGH' : 'MEDIUM'
      })),
      ...(knowledge.doctrinalPositions || []).map(d => ({
        date: today,
        learning: d.position,
        source: d.basis,
        jurisdiction: d.jurisdiction,
        strength: 'DOCTRINE',
        confidence: 'HIGH'
      }))
    ];

    const updatedDoctrine = {
      ...existingDoctrine,
      lastUpdated: today,
      learnings: [...(existingDoctrine.learnings || []), ...newLearnings].slice(-200),
      keyDefinitions: [
        ...(existingDoctrine.keyDefinitions || []),
        ...(knowledge.keyDefinitions || []).map(d => ({ ...d, addedDate: today }))
      ].slice(-100),
      thresholdsAndTests: [
        ...(existingDoctrine.thresholdsAndTests || []),
        ...(knowledge.thresholdsAndTests || []).map(t => ({ ...t, addedDate: today }))
      ].slice(-100),
      winningArguments: [
        ...(existingDoctrine.winningArguments || []),
        ...(knowledge.winningArguments || []).map(a => ({ ...a, addedDate: today }))
      ].slice(-100)
    };

    // Update precedents
    const newPrecedents = (knowledge.precedents || []).map(p => ({
      ...p,
      addedDate: today,
      source: source || url || 'Training session'
    }));

    const updatedPrecedents = [...existingPrecedents, ...newPrecedents].slice(-500);

    // Update training log
    const logEntry = {
      date: today,
      timestamp: new Date().toISOString(),
      docType: knowledge.docType,
      jurisdiction: knowledge.jurisdiction,
      source: source || url || 'Manual input',
      learningsAdded: newLearnings.length,
      precedentsAdded: newPrecedents.length,
      summary: knowledge.summary,
      gciBenefit: knowledge.gciBenefit
    };

    const updatedLog = [...existingLog, logEntry].slice(-100);

    // Store all updates in parallel
    await Promise.all([
      kvSet(LEGAL_DOCTRINE_KEY, JSON.stringify(updatedDoctrine), 365 * 24 * 3600),
      kvSet(LEGAL_PRECEDENTS_KEY, JSON.stringify(updatedPrecedents), 365 * 24 * 3600),
      kvSet(LEGAL_TRAINING_LOG, JSON.stringify(updatedLog), 365 * 24 * 3600)
    ]);

    return res.status(200).json({
      ok: true,
      docType: knowledge.docType,
      jurisdiction: knowledge.jurisdiction,
      learningsAdded: newLearnings.length,
      precedentsAdded: newPrecedents.length,
      totalDoctrine: updatedDoctrine.learnings.length,
      totalPrecedents: updatedPrecedents.length,
      summary: knowledge.summary,
      gciBenefit: knowledge.gciBenefit,
      keyPrinciples: (knowledge.keyPrinciples || []).map(p => p.principle),
      proceduralRules: knowledge.proceduralRules || []
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
