// api/careers-applications.js — Admin API: fetch all job applications from KV

const { kvGet, getRedisClient } = require('../redis-client');
const ADMIN_SECRET = process.env.ADMIN_SECRET;

async function kvLrange(key, start, stop) {
  const redis = getRedisClient();
  return await redis.lrange(key, start, stop);
}

async function kvSmembers(key) {
  const redis = getRedisClient();
  return await redis.smembers(key);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Validate admin secret
  const { secret, filter } = req.body || {};
  if (!ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  try {
    // Get all application IDs (most recent last)
    const appIds = await kvLrange('gci:career:applications', 0, -1);

    if (!appIds || appIds.length === 0) {
      return res.status(200).json({ applications: [], total: 0, emailCount: 0 });
    }

    // Fetch each application record in parallel
    const appPromises = appIds.map(id => kvGet(`gci:career:app:${id}`));
    const appRaws = await Promise.all(appPromises);

    let applications = appRaws
      .map((raw, i) => {
        if (!raw) return null;
        try {
          return JSON.parse(raw);
        } catch {
          return { id: appIds[i], parseError: true };
        }
      })
      .filter(Boolean)
      .reverse(); // most recent first

    // Optional filter
    if (filter && filter !== 'all') {
      if (filter === 'new') {
        applications = applications.filter(a => a.status === 'new');
      } else {
        // Filter by firmType or role keyword
        applications = applications.filter(a =>
          (a.firmType || '').toLowerCase().includes(filter.toLowerCase()) ||
          (a.role || '').toLowerCase().includes(filter.toLowerCase())
        );
      }
    }

    // Total email subscribers count
    const emailSet = await kvSmembers('gci:career:emails');
    const emailCount = Array.isArray(emailSet) ? emailSet.length : 0;

    // Lead scoring: simple heuristic
    const scored = applications.map(app => {
      let score = 0;
      const ft = (app.firmType || '').toLowerCase();
      if (ft.includes('family office') || ft.includes('sovereign')) score += 30;
      else if (ft.includes('investment bank') || ft.includes('private equity') || ft.includes('private bank')) score += 25;
      else if (ft.includes('asset management') || ft.includes('hedge fund')) score += 20;
      else if (ft.includes('consulting') || ft.includes('advisory')) score += 15;
      else score += 5;

      const exp = parseInt(app.experience) || 0;
      if (exp >= 10) score += 25;
      else if (exp >= 7) score += 20;
      else if (exp >= 4) score += 15;
      else if (exp >= 2) score += 8;

      if (app.hasCV) score += 10;
      if (app.whatsapp) score += 5;
      if (app.linkedin) score += 5;
      if (app.dealAnswer && app.dealAnswer.length > 100) score += 10;

      const markets = (app.markets || '').toLowerCase();
      if (markets.includes('gcc') || markets.includes('uae') || markets.includes('saudi')) score += 10;

      return { ...app, leadScore: Math.min(score, 100) };
    });

    // Sort by lead score descending
    scored.sort((a, b) => b.leadScore - a.leadScore);

    return res.status(200).json({
      applications: scored,
      total: applications.length,
      emailCount
    });

  } catch (err) {
    console.error('careers-applications error:', err);
    return res.status(500).json({ error: 'Failed to fetch applications' });
  }
}
