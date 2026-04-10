// /api/reports
// Server-side report storage for the GCI platform. Uses Vercel KV when
// available; falls back to a no-op success so the client never breaks.
//
// Actions (selected via ?action= or req.body.action):
//   list   GET  ?userId=<id>                              -> { reports: [...] }
//   save   POST { userId, type, title, verdict, raw }     -> { id, ok:true }
//   delete POST { userId, id }                            -> { ok:true }
//
// userId resolution: header x-gci-user, then body.userId, then 'anon'.
//
// Storage: KV key per-user is gci:reports:<userId>, holding a JSON array,
// newest first, capped at 200 entries.

const { hsBumpCounter, hsLogTimelineNote, HS_SOURCE } = require('../lib/hubspot.js');
const { kvGet, kvSet } = require('../redis-client');

const MAX_PER_USER = 200;

function resolveUser(req) {
  return (req.headers['x-gci-user'] || (req.body && req.body.userId) || (req.query && req.query.userId) || 'anon').toString().slice(0, 200);
}

function key(userId) { return 'gci:reports:' + userId; }

function newId() { return 'srv_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8); }

function stripDashes(s) { return (s || '').toString().replace(/\u2014/g, ', ').replace(/\u2013/g, '-'); }

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const action = (req.query && req.query.action) || (req.body && req.body.action) || (req.method === 'GET' ? 'list' : 'save');
  const userId = resolveUser(req);

  try {
    if (action === 'list') {
      const list = (await kvGet(key(userId))) || [];
      return res.status(200).json({ reports: list, source: list.length ? 'kv' : 'empty' });
    }

    if (action === 'save') {
      const body = req.body || {};
      const entry = {
        id: body.id || newId(),
        type: (body.type || 'conviction').toString().slice(0, 40),
        title: stripDashes((body.title || 'Untitled Report').toString().slice(0, 300)),
        subtitle: stripDashes((body.subtitle || '').toString().slice(0, 400)),
        verdict: (body.verdict || '').toString().toUpperCase().slice(0, 50),
        date: body.date || new Date().toISOString(),
        raw: stripDashes((body.raw || '').toString()).slice(0, 200000)
      };
      let list = (await kvGet(key(userId))) || [];
      list.unshift(entry);
      if (list.length > MAX_PER_USER) list = list.slice(0, MAX_PER_USER);
      const ok = await kvSet(key(userId), list);

      // Best-effort HubSpot bump + timeline note. userId is the user's email when the
      // client passes it via x-gci-user. Skip for 'anon'.
      if (userId && userId !== 'anon' && userId.includes('@')) {
        hsBumpCounter({ email: userId, propertyName: 'gci_reports_count', delta: 1 })
          .then(() => hsLogTimelineNote({
            email: userId,
            body: `Report saved: ${entry.title} (${entry.verdict || entry.type})`
          })).catch(() => {});
      }

      return res.status(200).json({ id: entry.id, ok: true, persisted: ok });
    }

    if (action === 'delete') {
      const body = req.body || {};
      const id = (body.id || '').toString();
      let list = (await kvGet(key(userId))) || [];
      list = list.filter(function (r) { return r.id !== id; });
      const ok = await kvSet(key(userId), list);
      return res.status(200).json({ ok: true, persisted: ok });
    }

    return res.status(400).json({ error: 'unknown action: ' + action });
  } catch (err) {
    // Never break the client - return ok:false but 200 so localStorage still saves
    return res.status(200).json({ ok: false, error: (err && err.message) || String(err) });
  }
}
