// ONE-SHOT: reads ANTHROPIC_API_KEY from Azure env, posts it to the Vercel
// project env endpoint. Vercel token and project id come in the POST body,
// not hardcoded, so the file is safe to commit. DELETE AFTER USE.
module.exports = async function handler(req, res) {
  const guard = (req.query && req.query.token) || '';
  if (guard !== 'gci-seed-042226') return res.status(403).json({ error: 'forbidden' });

  const b = req.body || {};
  const VERCEL_TOKEN = b.vercelToken;
  const PROJECT_ID = b.projectId;
  const TEAM_ID = b.teamId;
  if (!VERCEL_TOKEN || !PROJECT_ID) return res.status(400).json({ error: 'need vercelToken and projectId in body' });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: 'no ANTHROPIC_API_KEY in Azure env' });

  const teamQ = TEAM_ID ? '?teamId=' + encodeURIComponent(TEAM_ID) : '';
  try {
    const listResp = await fetch('https://api.vercel.com/v9/projects/' + PROJECT_ID + '/env' + teamQ, {
      headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN }
    });
    const listData = await listResp.json();
    const existing = (listData.envs || []).find(e => e.key === 'ANTHROPIC_API_KEY');
    if (existing) {
      await fetch('https://api.vercel.com/v9/projects/' + PROJECT_ID + '/env/' + existing.id + teamQ, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN }
      });
    }
  } catch (e) { /* ignore */ }

  const createResp = await fetch('https://api.vercel.com/v10/projects/' + PROJECT_ID + '/env' + teamQ, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + VERCEL_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: 'ANTHROPIC_API_KEY',
      value: key,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    })
  });
  const createData = await createResp.json();
  if (!createResp.ok) return res.status(500).json({ error: 'vercel env create failed', detail: createData });
  return res.status(200).json({ ok: true, env_id: createData.id, key_length: key.length });
};
