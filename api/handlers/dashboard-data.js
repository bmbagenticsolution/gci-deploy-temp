// api/dashboard-data.js
// GCI Subscriber Dashboard Data API
// GET ?token=SESSION_TOKEN -> returns subscriber dashboard payload
//
// Returns:
//   user:       { email, name, company }
//   plan:       { name, status, billing, seats }
//   reports:    { remaining, usedMonth, usedTotal, monthReset, isUnlimited }
//   mandates:   [ { refNumber, mandateType, assetClass, dealSize, status, submittedAt } ]
//   recentReports: [ { id, agentLabel, verdict, timestamp } ]

const { kvGet, getRedisClient } = require('../redis-client');

async function kvLrange(key, start, end) {
  try {
    const redis = getRedisClient();
    const items = await redis.lrange(key, start, end);
    if (!Array.isArray(items)) return [];
    return items.map(item => { try { return JSON.parse(item); } catch { return item; } });
  } catch { return []; }
}

const PLAN_LABELS = {
  'conviction-screen':    'Conviction Screen',
  'due-diligence':        'Due Diligence Access',
  'intelligence-retainer':'Intelligence Retainer',
  'enterprise':           'Enterprise',
};

const PLAN_PRICES = {
  'conviction-screen':    '$499 one-time',
  'due-diligence':        '$999/month',
  'intelligence-retainer':'$2,499/month',
  'enterprise':           'Custom pricing',
};

const REPORT_LIMITS = {
  'conviction-screen':    { monthly: null, total: 1, unlimited: false },
  'due-diligence':        { monthly: 5,    total: null, unlimited: false },
  'intelligence-retainer':{ monthly: null, total: null, unlimited: true },
  'enterprise':           { monthly: null, total: null, unlimited: true },
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });


  const { token } = req.query;
  if (!token) return res.status(401).json({ error: 'Authentication required. Provide token param.' });

  // Verify session
  const sessionData = await kvGet(`gci:session:${token}`);
  if (!sessionData) {
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }

  const email = typeof sessionData === 'object' ? sessionData.email : null;
  if (!email) return res.status(401).json({ error: 'Invalid session. Please log in again.' });

  // Load data in parallel
  const [userRaw, planData, userMandates, godLibraryEntries] = await Promise.all([
    kvGet(`gci:user:${email}`),
    kvGet(`plan:${email}`),
    kvGet(`mandates:${email}`),
    kvLrange('gci:god_library', 0, 199),
  ]);

  const user = (userRaw && typeof userRaw === 'object') ? userRaw : { email };

  // If no plan data found, still return limited dashboard
  if (!planData) {
    return res.status(200).json({
      user:    { email: user.email, name: user.name || '', company: user.company || '' },
      plan:    null,
      reports: null,
      mandates: [],
      recentReports: [],
      message: 'No active subscription found.',
    });
  }

  const planName   = planData.plan || 'unknown';
  const planLabel  = PLAN_LABELS[planName] || planName;
  const planPrice  = planData.billing === 'annual'
    ? (planName === 'due-diligence' ? '$9,990/year' : planName === 'intelligence-retainer' ? '$24,990/year' : PLAN_PRICES[planName])
    : (PLAN_PRICES[planName] || 'Custom');

  const limits = REPORT_LIMITS[planName] || { monthly: null, total: null, unlimited: false };

  // Check if monthly report count should be reset
  let reportsRemaining = planData.reportsRemaining;
  let reportsUsedMonth = planData.reportsUsedMonth || 0;
  if (!limits.unlimited && planData.monthReset && new Date() > new Date(planData.monthReset)) {
    // Monthly reset is due (in case webhook missed it)
    reportsRemaining = limits.monthly || reportsRemaining;
    reportsUsedMonth = 0;
  }

  // Load mandate details
  const mandateRefs = Array.isArray(userMandates) ? userMandates.slice(0, 20) : [];
  const mandates = await Promise.all(
    mandateRefs.map(async ref => {
      const m = await kvGet(`mandate:${ref}`);
      if (!m) return null;
      return {
        refNumber:    m.refNumber,
        mandateType:  m.mandateType,
        assetClass:   m.assetClass,
        dealSize:     m.dealSize,
        geography:    m.geography,
        status:       m.status || 'received',
        submittedAt:  m.submittedAt,
      };
    })
  );

  // Filter reports saved by this user from god_library
  const userReports = godLibraryEntries
    .filter(e => e && e.userEmail && e.userEmail.toLowerCase() === email.toLowerCase())
    .slice(0, 20)
    .map(e => ({
      id:         e.id,
      agentType:  e.agentType,
      agentLabel: e.agentLabel,
      verdict:    e.verdict,
      dateLabel:  e.dateLabel,
      timeLabel:  e.timeLabel,
      timestamp:  e.timestamp,
    }));

  const payload = {
    user: {
      email:   user.email,
      name:    user.name    || '',
      company: user.company || '',
    },
    plan: {
      name:        planName,
      label:       planLabel,
      price:       planPrice,
      status:      planData.status || 'unknown',
      billing:     planData.billing || 'monthly',
      seats:       planData.seats || '1',
      activatedAt: planData.activatedAt || null,
      cancelledAt: planData.cancelledAt || null,
    },
    reports: {
      isUnlimited:      limits.unlimited,
      remaining:        limits.unlimited ? null : reportsRemaining,
      usedMonth:        reportsUsedMonth,
      usedTotal:        planData.reportsUsedTotal || 0,
      monthlyAllowance: limits.monthly,
      totalAllowance:   limits.total,
      monthReset:       planData.monthReset || null,
    },
    mandates: mandates.filter(Boolean),
    recentReports: userReports,
  };

  return res.status(200).json(payload);
}
