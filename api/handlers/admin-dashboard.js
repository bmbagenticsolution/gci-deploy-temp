// api/admin-dashboard.js — GCI God Screen backend
// Admin-only endpoint. Returns live platform data from Vercel KV.
// Auth: email must be in ADMIN_EMAILS AND secret must match ADMIN_SECRET env var.

const { kvGet, kvSet } = require('../redis-client');

const ADMIN_EMAILS = [
  'gaurav@boostmylocalbusiness.ai',
  'difc@gulfcapitalintelligence.com',
  'hemanthult@gmail.com'
];

const ADMIN_SECRET = process.env.ADMIN_SECRET;

async function kvList(key) {
  const val = await kvGet(key);
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [];
}

// GCI Tier structure (source of truth):
// Tier 1: conviction-screen    $499 one-time    1 report total
// Tier 2: due-diligence        $999/month       5 reports/month, auto-debit, cancel anytime
// Tier 3: intelligence-retainer $2,499/month    unlimited, 3 seats, cancel anytime
// Tier 4: enterprise           from $5,000/month annual contract, unlimited, multi-seat

function planMRR(planName, billing) {
  if (!planName) return 0;
  const p = planName.toLowerCase();
  if (p.includes('enterprise'))          return 5000; // minimum
  if (p.includes('retainer')) {
    if (billing === 'annual') return Math.round(24990 / 12);
    return 2499;
  }
  if (p.includes('due')) {
    if (billing === 'annual') return Math.round(9990 / 12);
    return 999;
  }
  return 0; // conviction-screen is one-time
}

function planLabel(planName) {
  if (!planName || planName === 'free') return 'free';
  const p = planName.toLowerCase();
  if (p.includes('enterprise'))  return 'enterprise';
  if (p.includes('retainer'))    return 'intelligence-retainer';
  if (p.includes('due'))         return 'due-diligence';
  if (p.includes('conviction'))  return 'conviction-screen';
  return planName;
}

function planReportLimit(planName) {
  const label = planLabel(planName);
  if (label === 'conviction-screen')    return { type: 'one-time', total: 1 };
  if (label === 'due-diligence')        return { type: 'monthly',  perMonth: 5 };
  if (label === 'intelligence-retainer') return { type: 'unlimited' };
  if (label === 'enterprise')           return { type: 'unlimited' };
  return { type: 'none' };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (!['GET','POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  const email  = (req.query.email  || '').toLowerCase().trim();
  const secret = (req.query.secret || '').trim();

  if (!ADMIN_EMAILS.includes(email) || !ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const action = req.query.action || 'overview';

  try {
    /* ── RESET USER PASSWORD ─────────────────────────────── */
    if (action === 'reset-user-password' && req.method === 'POST') {
      const crypto = require('crypto');
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
      const targetEmail = (body?.targetEmail || '').toLowerCase().trim();
      const newPassword = body?.newPassword || '';
      if (!targetEmail || !newPassword || newPassword.length < 8) {
        return res.status(400).json({ error: 'targetEmail and newPassword (min 8 chars) required' });
      }
      const key = `gci:user:${targetEmail}`;
      const existing = await kvGet(key);
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.createHmac('sha256', salt).update(newPassword).digest('hex');
      if (existing && typeof existing === 'object') {
        existing.salt = salt;
        existing.hash = hash;
        await kvSet(key, JSON.stringify(existing));
      } else {
        const newUser = { email: targetEmail, name: '', company: '', mobile: '', created: Date.now(), salt, hash, plan: null, adminGranted: true };
        await kvSet(key, JSON.stringify(newUser));
      }
      return res.status(200).json({ ok: true, message: `Password reset for ${targetEmail}` });
    }

    /* ── GMAIL WRITE (POST) ─────────────────────────────── */
    if (action === 'gmail-write' && req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
      const emails = body?.emails;
      if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
      const digest = { updatedAt: new Date().toISOString(), emails };
      await kvSet('gmail:digest', digest);
      return res.status(200).json({ ok: true, count: emails.length });
    }

    /* ── GMAIL READ ─────────────────────────────────────── */
    if (action === 'gmail') {
      let digest = await kvGet('gmail:digest');
      if (!digest) return res.status(200).json({ emails: [], updatedAt: null });
      if (typeof digest === 'string') { try { digest = JSON.parse(digest); } catch(e) {} }
      if (!digest || typeof digest !== 'object') return res.status(200).json({ emails: [], updatedAt: null });
      return res.status(200).json(digest);
    }

    /* ── USERS ──────────────────────────────────────────── */
    if (action === 'users') {
      const rawEmails = await kvList('users:all');
      const unique    = [...new Set(rawEmails)].filter(Boolean);

      const users = await Promise.all(unique.map(async (e) => {
        const [user, gciUser, plan] = await Promise.all([
          kvGet(`user:${e}`),
          kvGet(`gci:user:${e}`),
          kvGet(`plan:${e}`)
        ]);
        const u = user || gciUser || {};
        const p = plan || {};
        const pLabel = planLabel(p.plan);
        const limits = planReportLimit(p.plan);
        return {
          email:            e,
          name:             u.name  || e.split('@')[0],
          verified:         u.verified    || false,
          createdAt:        u.createdAt   || u.created || null,
          lastLogin:        u.lastLogin   || null,
          loginCount:       u.loginCount  || 0,
          adminGranted:     u.adminGranted || p.adminGranted || false,
          plan:             pLabel,
          planStatus:       p.status      || 'inactive',
          billing:          p.billing     || 'monthly',
          seats:            p.seats       || '1',
          reportsRemaining: p.reportsRemaining !== undefined ? p.reportsRemaining : (limits.type === 'unlimited' ? 'unlimited' : 0),
          reportsUsedMonth: p.reportsUsedMonth || 0,
          reportsUsedTotal: p.reportsUsedTotal || 0,
          monthlyLimit:     limits.type === 'monthly' ? limits.perMonth : (limits.type === 'unlimited' ? 'unlimited' : limits.total || 0),
          stripeCustomerId: p.stripeCustomerId || null,
          subscriptionId:   p.subscriptionId   || null,
          activatedAt:      p.activatedAt || null,
          planUpdatedAt:    p.updatedAt || p.grantedAt || null,
          mrr:              p.status === 'active' ? planMRR(p.plan, p.billing) : 0
        };
      }));

      users.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
      return res.status(200).json({ users, total: users.length });
    }

    /* ── REPORTS ────────────────────────────────────────── */
    if (action === 'reports') {
      const events = await kvList('events:report');
      const recent  = [...events].reverse().slice(0, 200);
      // daily breakdown (last 14 days)
      const byDay = {};
      events.forEach(ev => {
        if (!ev.timestamp) return;
        const d = new Date(ev.timestamp).toISOString().split('T')[0];
        byDay[d] = (byDay[d] || 0) + 1;
      });
      return res.status(200).json({ events: recent, total: events.length, byDay });
    }

    /* ── REVENUE ────────────────────────────────────────── */
    if (action === 'revenue') {
      const [rawEmails, paymentEvents] = await Promise.all([
        kvList('users:all'),
        kvList('events:payment')
      ]);
      const unique = [...new Set(rawEmails)].filter(Boolean);

      const counts = { 'intelligence-retainer': 0, 'due-diligence': 0, 'conviction-screen': 0, enterprise: 0, free: 0, admin: 0 };
      let mrr = 0;

      await Promise.all(unique.map(async (e) => {
        const plan = await kvGet(`plan:${e}`);
        if (!plan) { counts.free++; return; }
        if (plan.adminGranted) { counts.admin++; return; }
        const label = planLabel(plan.plan);
        if (counts[label] !== undefined) counts[label]++;
        else counts.free++;
        if (plan.status === 'active') mrr += planMRR(plan.plan, plan.billing);
      }));

      const recentPayments = [...paymentEvents].reverse().slice(0, 100);
      const totalRevenue   = paymentEvents.reduce((s, p) => s + (p.amount || 0), 0);
      return res.status(200).json({ mrr, totalRevenue, counts, payments: recentPayments, totalPayments: paymentEvents.length });
    }

    /* ── VISHWAKARMA ────────────────────────────────────── */
    if (action === 'vishwakarma') {
      const lastRun = await kvGet('vishwakarma:lastRun');
      const endpoints = ['app-shell','council-health','check-plan','auth','chat'];
      const mediumIssues = (
        await Promise.all(endpoints.map(async ep => {
          const issue = await kvGet(`vishwakarma:medium:${ep}`);
          return issue ? { endpoint: ep, ...issue } : null;
        }))
      ).filter(Boolean);
      return res.status(200).json({ lastRun, mediumIssues });
    }

    /* ── DAILY STATS ────────────────────────────────────── */
    if (action === 'daily') {
      const days  = Math.min(parseInt(req.query.days) || 30, 90);
      const stats = [];
      const now   = Date.now();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now - i * 86400000).toISOString().split('T')[0];
        const s = await kvGet(`stats:daily:${d}`);
        stats.push(s || { date: d, pageviews: 0, uniqueVisitors: 0, signups: 0, reports: 0, payments: 0 });
      }
      return res.status(200).json({ stats });
    }

    /* ── OVERVIEW (default) ─────────────────────────────── */
    const [rawEmails, reportEvents, paymentEvents, vishRun] = await Promise.all([
      kvList('users:all'),
      kvList('events:report'),
      kvList('events:payment'),
      kvGet('vishwakarma:lastRun')
    ]);
    const unique = [...new Set(rawEmails)].filter(Boolean);

    const today     = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const [todayS, yesterdayS] = await Promise.all([
      kvGet(`stats:daily:${today}`),
      kvGet(`stats:daily:${yesterday}`)
    ]);

    let mrr = 0;
    await Promise.all(unique.map(async e => {
      const p = await kvGet(`plan:${e}`);
      if (p && p.status === 'active' && !p.adminGranted) mrr += planMRR(p.plan);
    }));

    return res.status(200).json({
      totalUsers:          unique.length,
      totalReports:        reportEvents.length,
      totalPayments:       paymentEvents.length,
      mrr,
      today:               todayS    || { date: today,     pageviews: 0, signups: 0, reports: 0, payments: 0 },
      yesterday:           yesterdayS || { date: yesterday, pageviews: 0, signups: 0, reports: 0, payments: 0 },
      vishwakarmaStatus:   vishRun?.summary?.status || 'UNKNOWN',
      vishwakarmaLastRun:  vishRun?.runAt || null,
      vishwakarmaPassed:   vishRun?.summary?.passed || 0,
      vishwakarmaIssues:   vishRun?.summary?.issues || 0
    });

  } catch (err) {
    console.error('[admin-dashboard]', err);
    return res.status(500).json({ error: err.message });
  }
}
