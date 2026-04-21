// Test what Cloudflare edge actually serves when called from the SWA Function
// (same source IP as production traffic). Shows if proxy is bypassing geo-block.
module.exports = async function handler(req, res) {
  const out = {};

  // Test 1: Hit proxy root (returns ok:true)
  try {
    const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/', { method: 'GET' });
    out.proxy_root = { status: r.status, body: (await r.text()).slice(0, 200) };
  } catch (e) {
    out.proxy_root = { error: String(e) };
  }

  // Test 2: Hit OpenAI via proxy with a dummy API key (should return openai auth error, NOT geo-block)
  try {
    const r = await fetch('https://gci-anthropic-proxy.gaurav-892.workers.dev/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer sk-fake' },
      body: JSON.stringify({ model:'gpt-4o-mini', messages:[{role:'user', content:'hi'}], max_tokens:1 })
    });
    out.proxy_openai = { status: r.status, body: (await r.text()).slice(0, 500) };
  } catch (e) {
    out.proxy_openai = { error: String(e) };
  }

  // Test 3: Direct api.openai.com (expected geo-block)
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer sk-fake' },
      body: JSON.stringify({ model:'gpt-4o-mini', messages:[{role:'user', content:'hi'}], max_tokens:1 })
    });
    out.direct_openai = { status: r.status, body: (await r.text()).slice(0, 500) };
  } catch (e) {
    out.direct_openai = { error: String(e) };
  }

  res.status(200).json(out);
};
