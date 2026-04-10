// api/careers-unsubscribe.js — One-click unsubscribe from weekly career emails

const { getRedisClient } = require('../redis-client');

async function kvSrem(key, member) {
  const redis = getRedisClient();
  await redis.srem(key, member);
  return true;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');

  const { t } = req.query || {};
  if (!t) return res.status(400).send('Invalid unsubscribe link');

  let email;
  try {
    email = Buffer.from(t, 'base64url').toString('utf8');
  } catch {
    return res.status(400).send('Invalid unsubscribe token');
  }

  if (!email || !email.includes('@')) {
    return res.status(400).send('Invalid email in unsubscribe token');
  }

  await kvSrem('gci:career:emails', email.toLowerCase().trim());

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed | Gulf Capital Intelligence</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f5f7; font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
    .card { background: #fff; border-radius: 8px; padding: 48px 40px; max-width: 480px; width: 90%; text-align: center; box-shadow: 0 2px 20px rgba(0,0,0,0.08); }
    .logo { color: #C8A84B; font-size: 20px; font-weight: 700; margin-bottom: 8px; }
    .sub { color: #999; font-size: 12px; margin-bottom: 32px; }
    h2 { color: #0B1D35; margin: 0 0 16px; }
    p { color: #555; font-size: 14px; line-height: 1.7; margin: 0 0 24px; }
    a { color: #C8A84B; text-decoration: none; font-weight: 600; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Gulf Capital Intelligence</div>
    <div class="sub">DIFC | Dubai | Riyadh</div>
    <h2>You have been unsubscribed</h2>
    <p>${email} has been removed from our weekly career intelligence emails. You will not receive further emails from this list.</p>
    <p>If you would like to reapply or get back in touch, you are always welcome at <a href="https://gulfcapitalintelligence.com/careers">gulfcapitalintelligence.com/careers</a>.</p>
  </div>
</body>
</html>`);
}
