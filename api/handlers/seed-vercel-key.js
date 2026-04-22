// ONE-SHOT: pushes provider API keys from Azure env to Vercel project env.
// Vercel creds in POST body. DELETE AFTER USE.
module.exports = async function handler(req, res) {
  const guard = (req.query && req.query.token) || '';
  if (guard !== 'gci-seed-042226') return res.status(403).json({ error: 'forbidden' });

  const b = req.body || {};
  const VERCEL_TOKEN = b.vercelToken;
  const PROJECT_ID = b.projectId;
  const TEAM_ID = b.teamId;
  if (!VERCEL_TOKEN || !PROJECT_ID) return res.status(400).json({ error: 'need vercelToken and projectId in body' });
  const teamQ = TEAM_ID ? '?teamId=' + encodeURIComponent(TEAM_ID) : '';

  const keys = ['ANTHROPIC_API_KEY','OPENAI_API_KEY','GEMINI_API_KEY'];
  const results = {};
  for (const k of keys) {
    const val = process.env[k];
    if (!val) { results[k] = 'missing in Azure'; continue; }
    // delete existing
    try {
      const lr = await fetch('https://api.vercel.com/v9/projects/' + PROJECT_ID + '/env' + teamQ, {
        headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN }
      });
      const ld = await lr.json();
      const ex = (ld.envs || []).find(e => e.key === k);
      if (ex) {
        await fetch('https://api.vercel.com/v9/projects/' + PROJECT_ID + '/env/' + ex.id + teamQ, {
          method: 'DELETE', headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN }
        });
      }
    } catch (e) {}
    const cr = await fetch('https://api.vercel.com/v10/projects/' + PROJECT_ID + '/env' + teamQ, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: k, value: val, type: 'encrypted', target: ['production','preview','development'] })
    });
    const cd = await cr.json();
    results[k] = cr.ok ? ('set, length=' + val.length) : ('FAIL: ' + JSON.stringify(cd).slice(0,200));
  }
  return res.status(200).json({ ok: true, results });
};
