// /api/track
// Lightweight pageview / event tracker. Writes to Redis if configured,
// otherwise no-ops. Always returns 200 so the front-end fire-and-forget call
// never logs an error in the console.

const { kvIncr, kvSet } = require('../redis-client');

module.exports = async function handler(req, res) {
  // Allow GET and POST, fail closed only on truly broken methods
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ ok: false });

  try {
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
    }
    const event = (body.event || 'pageview').toString().substring(0, 64);
    const page = (body.page || '/').toString().substring(0, 256);
    const ts = Date.now();

    const key = 'gci:track:' + new Date().toISOString().substring(0, 10) + ':' + event;
    // Best-effort INCR; ignore failures.
    kvIncr(key).catch(function(){});
    const lastKey = 'gci:track:last:' + event;
    kvSet(lastKey, { page: page, ts: ts }).catch(function(){});
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(200).json({ ok: false });
  }
}
