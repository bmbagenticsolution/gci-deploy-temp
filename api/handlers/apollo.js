// api/apollo.js — Apollo.io REST proxy for GCI God Screen
// Auth: requires admin email + ADMIN_SECRET. Apollo API key passed per-request.
// Actions: overview, contacts, sequences

const ADMIN_EMAILS = [
  'gaurav@boostmylocalbusiness.ai',
  'difc@gulfcapitalintelligence.com',
  'hemanthult@gmail.com'
];

const ADMIN_SECRET     = process.env.ADMIN_SECRET;
const APOLLO_ENV_KEY   = process.env.APOLLO_API_KEY;
const APOLLO_BASE      = 'https://api.apollo.io/v1';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const email   = (req.query.email  || '').toLowerCase().trim();
  const secret  = (req.query.secret || '').trim();
  const apiKey  = req.query.key || (req.body && req.body.key) || APOLLO_ENV_KEY || '';
  const action  = req.query.action || 'overview';

  if (!ADMIN_EMAILS.includes(email) || !ADMIN_SECRET || secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: 'Access denied' });
  }
  if (!apiKey) {
    return res.status(400).json({ error: 'Apollo API key required — add APOLLO_API_KEY to Vercel env' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'X-Api-Key': apiKey
  };

  try {
    /* ── OVERVIEW ────────────────────────────────────────── */
    if (action === 'overview') {
      const [contactsRes, seqRes] = await Promise.all([
        fetch(`${APOLLO_BASE}/contacts/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page: 1, per_page: 1 })
        }),
        fetch(`${APOLLO_BASE}/emailer_campaigns/search`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ page: 1, per_page: 25 })
        })
      ]);

      if (contactsRes.status === 401 || seqRes.status === 401) {
        return res.status(401).json({ error: 'Invalid Apollo API key' });
      }

      const contactsData = contactsRes.ok ? await contactsRes.json() : {};
      const seqData      = seqRes.ok      ? await seqRes.json()      : {};

      const sequences = (seqData.emailer_campaigns || []).map(s => ({
        id:           s.id,
        name:         s.name,
        status:       s.status,
        contacts:     s.num_steps || 0,
        openRate:     s.open_rate    ? Math.round(s.open_rate * 100)    : null,
        replyRate:    s.reply_rate   ? Math.round(s.reply_rate * 100)   : null,
        bounceRate:   s.bounce_rate  ? Math.round(s.bounce_rate * 100)  : null,
        createdAt:    s.created_at
      }));

      return res.status(200).json({
        totalContacts: contactsData.pagination?.total_entries || 0,
        sequences,
        totalSequences: sequences.length
      });
    }

    /* ── CONTACTS ────────────────────────────────────────── */
    if (action === 'contacts') {
      const page    = parseInt(req.query.page)    || 1;
      const perPage = Math.min(parseInt(req.query.per_page) || 25, 100);

      const r = await fetch(`${APOLLO_BASE}/contacts/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ page, per_page: perPage })
      });

      if (r.status === 401) return res.status(401).json({ error: 'Invalid Apollo API key' });
      if (!r.ok) return res.status(502).json({ error: 'Apollo API error' });

      const d = await r.json();
      const contacts = (d.contacts || []).map(c => ({
        id:           c.id,
        name:         [c.first_name, c.last_name].filter(Boolean).join(' '),
        email:        c.email,
        title:        c.title,
        company:      c.organization_name,
        stage:        c.contact_stage?.name || null,
        city:         c.city,
        country:      c.country,
        createdAt:    c.created_at,
        lastActivity: c.last_activity_date
      }));

      return res.status(200).json({
        contacts,
        total:   d.pagination?.total_entries || contacts.length,
        page,
        perPage
      });
    }

    /* ── SEQUENCES ───────────────────────────────────────── */
    if (action === 'sequences') {
      const r = await fetch(`${APOLLO_BASE}/emailer_campaigns/search`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ page: 1, per_page: 50 })
      });

      if (r.status === 401) return res.status(401).json({ error: 'Invalid Apollo API key' });
      if (!r.ok) return res.status(502).json({ error: 'Apollo API error' });

      const d = await r.json();
      const sequences = (d.emailer_campaigns || []).map(s => ({
        id:         s.id,
        name:       s.name,
        status:     s.status,
        openRate:   s.open_rate    ? Math.round(s.open_rate * 100)    : null,
        replyRate:  s.reply_rate   ? Math.round(s.reply_rate * 100)   : null,
        bounceRate: s.bounce_rate  ? Math.round(s.bounce_rate * 100)  : null,
        contacts:   s.num_steps || 0,
        createdAt:  s.created_at
      }));

      return res.status(200).json({ sequences });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch(err) {
    console.error('[apollo]', err);
    return res.status(500).json({ error: err.message });
  }
}
