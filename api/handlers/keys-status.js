// api/keys-status.js — GCI God Screen: API key health + balance checker
// Reads all API keys from Vercel env vars server-side. Auth: email + ADMIN_SECRET.

const ADMIN_EMAILS = [
  'gaurav@boostmylocalbusiness.ai',
  'difc@gulfcapitalintelligence.com',
  'hemanthult@gmail.com'
];
const ADMIN_SECRET = process.env.ADMIN_SECRET;

async function checkOpenAI(key) {
  if (!key) return { service: 'OpenAI', status: 'missing', note: 'OPENAI_API_KEY not set' };
  try {
    const now   = Math.floor(Date.now() / 1000);
    const start = now - 30 * 86400; // last 30 days
    const authH = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

    // Hit 3 endpoints in parallel: new balance, new costs, old billing sub (fallback)
    const [balRes, costsRes, subRes] = await Promise.all([
      fetch('https://api.openai.com/v1/organization/balance', { headers: authH }),
      fetch(`https://api.openai.com/v1/organization/costs?start_time=${start}&limit=1`, { headers: authH }),
      fetch('https://api.openai.com/dashboard/billing/subscription', { headers: authH })
    ]);

    if (balRes.status === 401 || subRes.status === 401) {
      return { service: 'OpenAI', status: 'invalid', note: 'API key invalid or expired' };
    }

    // New balance endpoint
    let balanceUSD = null, creditType = null;
    if (balRes.ok) {
      const balData = await balRes.json();
      // { object: "balance", available: [{currency:"usd", amount:X}], pending: [...] }
      const avail = balData?.available?.find(b => b.currency === 'usd');
      if (avail?.amount !== undefined) {
        balanceUSD = avail.amount; // already in dollars
        creditType = 'prepaid';
      }
    }

    // New costs endpoint for this month
    let usedThisMonth = null;
    if (costsRes.ok) {
      const costsData = await costsRes.json();
      if (costsData?.data?.length > 0) {
        // sum all line items
        const total = costsData.data.reduce((s, item) => s + (item.amount?.value || 0), 0);
        if (total > 0) usedThisMonth = total;
      }
      // alternatively try top-level total
      if (usedThisMonth === null && costsData?.total !== undefined) {
        usedThisMonth = costsData.total;
      }
    }

    // Old billing sub fallback for plan name and limits
    let plan = 'Pay-as-you-go', hardLimit = null, softLimit = null;
    if (subRes.ok) {
      const sub = await subRes.json();
      plan = sub?.plan?.title || sub?.plan?.id || 'Pay-as-you-go';
      if (sub?.hard_limit_usd) hardLimit = sub.hard_limit_usd;
      if (sub?.soft_limit_usd) softLimit = sub.soft_limit_usd;
      // old billing fallback for used amount
      if (usedThisMonth === null && sub?.hard_limit_usd) {
        const today  = new Date();
        const y = today.getFullYear(), mo = String(today.getMonth()+1).padStart(2,'0'), d = String(today.getDate()).padStart(2,'0');
        const usageRes = await fetch(`https://api.openai.com/dashboard/billing/usage?start_date=${y}-${mo}-01&end_date=${y}-${mo}-${d}`, { headers: authH });
        if (usageRes.ok) {
          const ud = await usageRes.json();
          if (ud?.total_usage) usedThisMonth = ud.total_usage / 100;
        }
      }
    }

    return {
      service:       'OpenAI',
      status:        'active',
      plan,
      balanceUSD:    balanceUSD    !== null ? `$${Number(balanceUSD).toFixed(2)}`    : null,
      usedThisMonth: usedThisMonth !== null ? `$${Number(usedThisMonth).toFixed(2)}` : null,
      hardLimitUSD:  hardLimit     !== null ? `$${Number(hardLimit).toFixed(2)}`     : null,
      softLimitUSD:  softLimit     !== null ? `$${Number(softLimit).toFixed(2)}`     : null,
      creditType,
      console: 'https://platform.openai.com/settings/organization/billing/overview'
    };
  } catch(e) {
    return { service: 'OpenAI', status: 'error', note: e.message };
  }
}

async function checkAnthropic(key) {
  if (!key) return { service: 'Anthropic', status: 'missing', note: 'ANTHROPIC_API_KEY not set' };
  try {
    const now = new Date();
    const startOfMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01T00:00:00Z`;
    const h = { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-beta': 'usage-2025-01-09' };

    const [modelsRes, usageRes] = await Promise.all([
      fetch('https://api.anthropic.com/v1/models', { headers: h }),
      fetch(`https://api.anthropic.com/v1/organizations/usage?start_time=${startOfMonth}&limit=1`, { headers: h })
    ]);

    if (modelsRes.status === 401) return { service: 'Anthropic', status: 'invalid', note: 'API key invalid' };

    const modelsData = modelsRes.ok ? await modelsRes.json() : null;
    const models = modelsData?.data?.map(m => m.id).slice(0,3) || [];

    let usedThisMonth = null, inputTokens = null, outputTokens = null;
    if (usageRes.ok) {
      const ud = await usageRes.json();
      // Anthropic usage: { data: [{model, input_tokens, output_tokens, cache_...}] }
      if (ud?.data?.length) {
        inputTokens  = ud.data.reduce((s, r) => s + (r.input_tokens || 0), 0);
        outputTokens = ud.data.reduce((s, r) => s + (r.output_tokens || 0), 0);
      }
    }

    return {
      service:      'Anthropic',
      status:       'active',
      models:       models.join(', ') || 'claude-sonnet-4-6, claude-opus-4-6',
      inputTokens:  inputTokens  !== null ? inputTokens.toLocaleString()  : null,
      outputTokens: outputTokens !== null ? outputTokens.toLocaleString() : null,
      note:         'No credit balance API — see console for billing',
      console:      'https://console.anthropic.com/settings/usage'
    };
  } catch(e) {
    return { service: 'Anthropic', status: 'error', note: e.message };
  }
}

async function checkGemini(key) {
  if (!key) return { service: 'Gemini', status: 'missing', note: 'GEMINI_API_KEY not set' };
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}&pageSize=5`);
    if (r.status === 400 || r.status === 403) {
      const d = await r.json();
      return { service: 'Gemini', status: 'invalid', note: d?.error?.message || 'Key invalid' };
    }
    const d = r.ok ? await r.json() : null;
    const models = (d?.models || []).map(m => m.name?.replace('models/','') || '').filter(Boolean).slice(0,3);
    return {
      service: 'Gemini',
      status: 'active',
      note: 'Key valid. Free quota-based — check aistudio.google.com',
      models: models.join(', ') || 'gemini-1.5-pro',
      console: 'https://aistudio.google.com/apikey'
    };
  } catch(e) {
    return { service: 'Gemini', status: 'error', note: e.message };
  }
}

async function checkVercel(token) {
  if (!token) return { service: 'Vercel', status: 'missing', note: 'VERCEL_TOKEN not set' };
  try {
    const r = await fetch('https://api.vercel.com/v2/teams?slug=gaurav-8894s-projects', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (r.status === 401) return { service: 'Vercel', status: 'invalid', note: 'Token invalid' };
    const d = r.ok ? await r.json() : null;
    const team = d?.teams?.[0] || d;
    const plan = team?.plan || team?.billing?.plan || 'unknown';
    const name = team?.name || team?.slug || 'gaurav-8894s-projects';

    // Get project info
    const pr = await fetch('https://api.vercel.com/v9/projects/gulf-capital-intelligence-live-agentic', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const proj = pr.ok ? await pr.json() : null;
    const latestDeploy = proj?.latestDeployments?.[0];

    return {
      service: 'Vercel',
      status: 'active',
      team: name,
      plan: plan.toUpperCase(),
      projectName: proj?.name || 'gulf-capital-intelligence-live-agentic',
      latestDeploy: latestDeploy?.createdAt ? new Date(latestDeploy.createdAt).toISOString() : null,
      deployState: latestDeploy?.readyState || 'READY',
      framework: proj?.framework || 'nextjs',
      console: 'https://vercel.com/gaurav-8894s-projects/gulf-capital-intelligence-live-agentic'
    };
  } catch(e) {
    return { service: 'Vercel', status: 'error', note: e.message };
  }
}

async function checkApollo(key) {
  if (!key) return { service: 'Apollo', status: 'missing', note: 'No Apollo key stored in env (paste in Leads tab)' };
  try {
    const r = await fetch('https://api.apollo.io/v1/contacts/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Api-Key': key },
      body: JSON.stringify({ page: 1, per_page: 1 })
    });
    if (r.status === 401) return { service: 'Apollo', status: 'invalid', note: 'API key invalid' };
    const d = r.ok ? await r.json() : null;
    return {
      service: 'Apollo',
      status: 'active',
      totalContacts: d?.pagination?.total_entries || 0,
      note: 'GCI God Screen master key active',
      console: 'https://developer.apollo.io/#/keys'
    };
  } catch(e) {
    return { service: 'Apollo', status: 'error', note: e.message };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const email  = (req.query.email  || '').toLowerCase().trim();
  const secret = (req.query.secret || '').trim();

  if (!ADMIN_EMAILS.includes(email) || !ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const [openai, anthropic, gemini, vercel, apollo] = await Promise.all([
      checkOpenAI(process.env.OPENAI_API_KEY),
      checkAnthropic(process.env.ANTHROPIC_API_KEY),
      checkGemini(process.env.GEMINI_API_KEY),
      checkVercel(process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || ''),
      checkApollo(process.env.APOLLO_API_KEY)
    ]);

    const checkedAt = new Date().toISOString();
    return res.status(200).json({ checkedAt, services: { openai, anthropic, gemini, vercel, apollo } });

  } catch(err) {
    console.error('[keys-status]', err);
    return res.status(500).json({ error: err.message });
  }
}
