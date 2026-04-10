module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // Accept secret via POST body or GET query param
  const secret =
    (req.method === 'POST' ? req.body?.secret : null) ||
    req.query?.secret || '';

  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { getRedisClient } = require('../redis-client');

  try {
    // Fetch up to 500 most recent reports
    const redis = getRedisClient();
    const raw = await redis.lrange('gci:god_library', 0, 499);
    const reports = raw
      .map(s => { try { return JSON.parse(s); } catch { return null; } })
      .filter(Boolean);

    // Compute stats server-side
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const todayCount    = reports.filter(r => r.dateLabel === today).length;
    // Count unique emails + count anonymous as unique by their report IDs
    const knownEmails = new Set(reports.map(r => r.userEmail).filter(e => e && e !== 'anonymous'));
    const anonCount   = reports.filter(r => !r.userEmail || r.userEmail === 'anonymous').length;
    const uniqueUsers = knownEmails.size + (anonCount > 0 ? 1 : 0);
    const agentCounts   = {};
    reports.forEach(r => { agentCounts[r.agentLabel] = (agentCounts[r.agentLabel] || 0) + 1; });
    const topAgent      = Object.entries(agentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';
    const verdictCounts = { PROCEED: 0, CAUTION: 0, AVOID: 0, STRATEGY: 0, OTHER: 0 };
    reports.forEach(r => {
      if (!r.verdict) { verdictCounts.OTHER++; return; }
      if (r.verdict === 'STRATEGY') { verdictCounts.STRATEGY++; return; }
      if (r.verdict.includes('PROCEED')) { verdictCounts.PROCEED++; return; }
      if (r.verdict.includes('AVOID'))   { verdictCounts.AVOID++;   return; }
      verdictCounts.CAUTION++;
    });

    return res.status(200).json({
      success: true,
      stats: {
        total:       reports.length,
        todayCount,
        uniqueUsers,
        topAgent,
        verdictCounts,
        agentCounts,
      },
      reports,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
