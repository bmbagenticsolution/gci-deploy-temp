const { kvLpushWithTrim } = require('../redis-client');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    userEmail   = 'anonymous',
    userName    = '',
    userCompany = '',
    agentType   = 'unknown',
    agentLabel  = 'Report',
    verdict     = '',
    reportText  = '',
  } = req.body || {};

  const now = new Date();
  const entry = {
    id:          `gl_${now.getTime()}_${Math.random().toString(36).substr(2, 5)}`,
    userEmail,
    userName,
    userCompany,
    agentType,
    agentLabel,
    verdict,
    reportText,
    timestamp:   now.toISOString(),
    dateLabel:   now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    timeLabel:   now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
    charCount:   reportText.length,
  };

  try {
    // LPUSH to list + LTRIM to keep latest 2000 entries
    await kvLpushWithTrim('gci:god_library', JSON.stringify(entry), 2000);
    return res.status(200).json({ success: true, id: entry.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
