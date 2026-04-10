// api/linkedin-jobs.js
// LinkedIn Jobs integration for GCI Admin Dashboard
// Manages job postings + applicant data collection
// Auth: admin secret for all read/write actions; webhook is open (verified by LinkedIn header)

const { kvGet, kvSet } = require('../redis-client');

const ADMIN_EMAILS = [
  'gaurav@boostmylocalbusiness.ai',
  'difc@gulfcapitalintelligence.com',
  'hemanthult@gmail.com'
];

const ADMIN_SECRET    = process.env.ADMIN_SECRET;
const LI_CLIENT_ID    = process.env.LINKEDIN_CLIENT_ID;
const LI_CLIENT_SECRET= process.env.LINKEDIN_CLIENT_SECRET;
const LI_ORG_ID       = process.env.LINKEDIN_ORG_ID;   // numeric org ID, e.g. "12345678"
const LI_REDIRECT_URI = process.env.LINKEDIN_REDIRECT_URI
                        || 'https://gulfcapitalintelligence.com/api/linkedin-jobs?action=oauth-callback';

async function kvList(key) {
  const val = await kvGet(key);
  if (!val) return [];
  if (Array.isArray(val)) return val;
  return [];
}

async function kvPush(key, item, maxItems = 500) {
  const list = await kvList(key);
  list.unshift(item);
  const trimmed = list.slice(0, maxItems);
  await kvSet(key, trimmed);
  return trimmed;
}

// ── LinkedIn API helper ───────────────────────────────────────────────────────
async function liGet(path, token) {
  const r = await fetch(`https://api.linkedin.com/v2${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Restli-Protocol-Version': '2.0.0',
      'LinkedIn-Version': '202401'
    }
  });
  if (!r.ok) {
    const err = await r.text();
    throw new Error(`LinkedIn API ${r.status}: ${err}`);
  }
  return r.json();
}

// ── Generate a unique applicant ID ────────────────────────────────────────────
function genId() {
  return 'app_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
}

// ── Main handler ─────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-LinkedIn-Signature');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const action = req.query.action || 'overview';

  // ── WEBHOOK (called by LinkedIn Easy Apply / ATS, no admin auth) ────────────
  if (action === 'webhook' && req.method === 'POST') {
    try {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

      const applicant = {
        id:           genId(),
        receivedAt:   new Date().toISOString(),
        source:       'linkedin-webhook',
        status:       'new',
        name:         body.applicantName || body.name || 'Unknown',
        email:        body.applicantEmail || body.email || '',
        phone:        body.phone || '',
        linkedinUrl:  body.linkedinProfile || body.profileUrl || '',
        headline:     body.headline || '',
        location:     body.location || '',
        jobId:        body.jobPostingId || body.jobId || '',
        jobTitle:     body.jobTitle || '',
        message:      body.coverLetter || body.message || '',
        resumeUrl:    body.resumeUrl || '',
        raw:          body
      };

      await kvPush('gci:linkedin:applications', applicant, 1000);

      // also push to per-job list
      if (applicant.jobId) {
        await kvPush(`gci:linkedin:apps:${applicant.jobId}`, applicant, 200);
        // increment job counter
        const jobs = await kvList('gci:linkedin:jobs');
        const idx = jobs.findIndex(j => j.id === applicant.jobId);
        if (idx >= 0) {
          jobs[idx].applicationCount = (jobs[idx].applicationCount || 0) + 1;
          jobs[idx].newCount = (jobs[idx].newCount || 0) + 1;
          await kvSet('gci:linkedin:jobs', jobs);
        }
      }

      console.log('[linkedin-jobs] webhook received:', applicant.name, applicant.jobTitle);
      return res.status(200).json({ ok: true });
    } catch(err) {
      console.error('[linkedin-jobs] webhook error:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  // ── OAUTH CALLBACK (no admin auth - handles redirect) ──────────────────────
  if (action === 'oauth-callback') {
    const code  = req.query.code;
    const error = req.query.error;
    if (error) {
      return res.redirect(302, '/admin#linkedin-error=' + encodeURIComponent(req.query.error_description || error));
    }
    if (!code) return res.status(400).send('No code received from LinkedIn');

    try {
      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          client_id:     LI_CLIENT_ID,
          client_secret: LI_CLIENT_SECRET,
          redirect_uri:  LI_REDIRECT_URI
        }).toString()
      });
      const tokenData = await tokenRes.json();
      if (tokenData.error) throw new Error(tokenData.error_description || tokenData.error);

      await kvSet('gci:linkedin:token', {
        ...tokenData,
        savedAt:   new Date().toISOString(),
        expiresAt: new Date(Date.now() + (tokenData.expires_in || 5183944) * 1000).toISOString()
      });

      return res.redirect(302, '/admin?li=connected');
    } catch(err) {
      console.error('[linkedin-jobs] oauth-callback error:', err);
      return res.redirect(302, '/admin?li=error&msg=' + encodeURIComponent(err.message));
    }
  }

  // ── All other actions require admin auth ───────────────────────────────────
  const email  = (req.query.email  || '').toLowerCase().trim();
  const secret = (req.query.secret || '').trim();
  if (!ADMIN_EMAILS.includes(email) || !ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    // ── OAUTH START ─────────────────────────────────────────────────────────
    if (action === 'oauth-start') {
      if (!LI_CLIENT_ID) return res.status(400).json({ error: 'LINKEDIN_CLIENT_ID env var not set' });
      const scopes = [
        'r_basicprofile',
        'r_organization_admin',
        'rw_organization_admin',
        'r_organization_social'
      ].join('%20');
      const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${LI_CLIENT_ID}&redirect_uri=${encodeURIComponent(LI_REDIRECT_URI)}&scope=${scopes}&state=gci_admin`;
      return res.status(200).json({ url });
    }

    // ── OVERVIEW ─────────────────────────────────────────────────────────────
    if (action === 'overview') {
      const [token, jobs, apps] = await Promise.all([
        kvGet('gci:linkedin:token'),
        kvList('gci:linkedin:jobs'),
        kvList('gci:linkedin:applications')
      ]);

      const newCount = apps.filter(a => a.status === 'new').length;
      const lastSync = await kvGet('gci:linkedin:last-sync');

      return res.status(200).json({
        connected:  !!token,
        tokenExpiry: token?.expiresAt || null,
        jobCount:   jobs.length,
        totalApps:  apps.length,
        newApps:    newCount,
        lastSync:   lastSync || null,
        jobs:       jobs.slice(0,10)
      });
    }

    // ── LIST JOBS ─────────────────────────────────────────────────────────────
    if (action === 'jobs') {
      const jobs = await kvList('gci:linkedin:jobs');
      return res.status(200).json({ jobs });
    }

    // ── SYNC JOBS FROM LINKEDIN ───────────────────────────────────────────────
    if (action === 'sync') {
      const token = await kvGet('gci:linkedin:token');
      if (!token) return res.status(200).json({ ok: false, error: 'Not connected to LinkedIn' });

      let jobs = [];
      try {
        const orgId = LI_ORG_ID;
        if (!orgId) throw new Error('LINKEDIN_ORG_ID env var not set');

        // Fetch job postings for organisation
        const data = await liGet(
          `/jobPostings?q=organizations&organizations=List(urn%3Ali%3Aorganization%3A${orgId})&count=50`,
          token.access_token
        );

        jobs = (data.elements || []).map(j => ({
          id:               j.id || j['~'].id || genId(),
          title:            j.title?.text || j.title || 'Untitled',
          location:         j.formattedLocation || j.location || '',
          state:            j.state || 'LISTED',
          listedAt:         j.listedAt ? new Date(j.listedAt).toISOString() : new Date().toISOString(),
          closedAt:         j.closedAt ? new Date(j.closedAt).toISOString() : null,
          applicationCount: j.applicationCount || 0,
          newCount:         0,
          url:              j.applyMethod?.companyApplyUrl?.url || `https://www.linkedin.com/jobs/view/${j.id}`,
          description:      j.description?.text || ''
        }));

        const existingJobs = await kvList('gci:linkedin:jobs');
        // Merge: keep existing application counts where available
        const merged = jobs.map(nj => {
          const existing = existingJobs.find(ej => ej.id === nj.id);
          return existing ? { ...nj, applicationCount: existing.applicationCount, newCount: existing.newCount } : nj;
        });

        await kvSet('gci:linkedin:jobs', merged);
        await kvSet('gci:linkedin:last-sync', new Date().toISOString());

        return res.status(200).json({ ok: true, count: merged.length, jobs: merged });

      } catch(err) {
        console.error('[linkedin-jobs] sync error:', err.message);
        // Return existing cached jobs with error note
        const existingJobs = await kvList('gci:linkedin:jobs');
        return res.status(200).json({ ok: false, error: err.message, jobs: existingJobs });
      }
    }

    // ── LIST APPLICATIONS ─────────────────────────────────────────────────────
    if (action === 'applications') {
      const jobId = req.query.jobId;
      let apps;
      if (jobId) {
        apps = await kvList(`gci:linkedin:apps:${jobId}`);
      } else {
        apps = await kvList('gci:linkedin:applications');
      }
      return res.status(200).json({ applications: apps, total: apps.length });
    }

    // ── UPDATE APPLICANT STATUS ───────────────────────────────────────────────
    if ((action === 'update-status') && req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }
      const { appId, status, note } = body;
      const validStatuses = ['new','reviewed','shortlisted','interviewing','offered','rejected'];
      if (!appId || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'appId and valid status required' });
      }

      // Update in global list
      const apps = await kvList('gci:linkedin:applications');
      const idx = apps.findIndex(a => a.id === appId);
      if (idx >= 0) {
        apps[idx].status = status;
        if (note) apps[idx].note = note;
        apps[idx].statusUpdatedAt = new Date().toISOString();
        await kvSet('gci:linkedin:applications', apps);
      }

      return res.status(200).json({ ok: true, status });
    }

    // ── MANUAL ADD APPLICANT ──────────────────────────────────────────────────
    if ((action === 'manual-add') && req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

      const applicant = {
        id:          genId(),
        receivedAt:  new Date().toISOString(),
        source:      'manual',
        status:      'new',
        name:        body.name || 'Unknown',
        email:       body.email || '',
        phone:       body.phone || '',
        linkedinUrl: body.linkedinUrl || '',
        headline:    body.headline || '',
        location:    body.location || '',
        jobId:       body.jobId || '',
        jobTitle:    body.jobTitle || '',
        message:     body.message || '',
        resumeUrl:   body.resumeUrl || ''
      };

      await kvPush('gci:linkedin:applications', applicant, 1000);
      if (applicant.jobId) {
        await kvPush(`gci:linkedin:apps:${applicant.jobId}`, applicant, 200);
        const jobs = await kvList('gci:linkedin:jobs');
        const idx = jobs.findIndex(j => j.id === applicant.jobId);
        if (idx >= 0) {
          jobs[idx].applicationCount = (jobs[idx].applicationCount || 0) + 1;
          jobs[idx].newCount = (jobs[idx].newCount || 0) + 1;
          await kvSet('gci:linkedin:jobs', jobs);
        }
      }

      return res.status(200).json({ ok: true, applicant });
    }

    // ── MANUAL ADD JOB ────────────────────────────────────────────────────────
    if ((action === 'add-job') && req.method === 'POST') {
      let body = req.body;
      if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

      const job = {
        id:               body.id || ('job_' + Date.now()),
        title:            body.title || 'Untitled',
        location:         body.location || '',
        state:            'LISTED',
        listedAt:         new Date().toISOString(),
        closedAt:         null,
        applicationCount: 0,
        newCount:         0,
        url:              body.url || '',
        description:      body.description || '',
        source:           'manual'
      };

      const jobs = await kvList('gci:linkedin:jobs');
      jobs.unshift(job);
      await kvSet('gci:linkedin:jobs', jobs);
      return res.status(200).json({ ok: true, job });
    }

    // ── EXPORT CSV ────────────────────────────────────────────────────────────
    if (action === 'export') {
      const apps = await kvList('gci:linkedin:applications');
      const headers = ['Name','Email','Phone','LinkedIn','Headline','Location','Job Title','Applied','Status','Message','Resume URL'];
      const rows = apps.map(a => [
        a.name, a.email, a.phone, a.linkedinUrl, a.headline,
        a.location, a.jobTitle, a.receivedAt, a.status, a.message, a.resumeUrl
      ].map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(','));
      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="gci-linkedin-applicants.csv"');
      return res.status(200).send(csv);
    }

    // ── MARK ALL READ ─────────────────────────────────────────────────────────
    if ((action === 'mark-read') && req.method === 'POST') {
      const apps = await kvList('gci:linkedin:applications');
      let changed = 0;
      apps.forEach(a => { if (a.status === 'new') { a.status = 'reviewed'; changed++; } });
      if (changed > 0) {
        await kvSet('gci:linkedin:applications', apps);
        // Update job newCounts
        const jobs = await kvList('gci:linkedin:jobs');
        jobs.forEach(j => { j.newCount = 0; });
        await kvSet('gci:linkedin:jobs', jobs);
      }
      return res.status(200).json({ ok: true, changed });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch(err) {
    console.error('[linkedin-jobs]', err);
    return res.status(500).json({ error: err.message });
  }
}
