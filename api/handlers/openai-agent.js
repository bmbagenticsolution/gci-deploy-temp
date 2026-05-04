// /api/openai-agent
// Proxies a Claude-shaped chat request to OpenAI Chat Completions and
// returns a response in Anthropic shape: { content: [{ text: "..." }] }
// so the front-end can use the same extraction code path.
//
// Fallback chain:
//   1. Azure OpenAI Service (uses $100K Azure credits)
//   2. Lambda proxy in us-east-1 (bypasses geo-blocks)
//   3. Cloudflare Worker proxy (last resort)

const { callAzureOpenAI, isAzureOpenAIConfigured } = require('../lib/azure-openai');

function convertToOpenAIMessages(system, messages) {
  const oaMessages = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    let content = '';
    if (typeof m.content === 'string') content = m.content;
    else if (Array.isArray(m.content)) {
      content = m.content
        .filter(function(b){ return b && b.type === 'text' && typeof b.text === 'string'; })
        .map(function(b){ return b.text; })
        .join('\n\n');
    }
    if (content) oaMessages.push({ role: m.role || 'user', content: content });
  }
  return oaMessages;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const body = req.body || {};
    const system = typeof body.system === 'string' ? body.system : '';
    const max_tokens = typeof body.max_tokens === 'number' && body.max_tokens > 0 ? body.max_tokens : 16000;
    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) return res.status(400).json({ error: 'No messages provided' });

    const oaMessages = convertToOpenAIMessages(system, messages);
    const model = body.model || 'gpt-4.1';
    const temperature = typeof body.temperature === 'number' ? body.temperature : 0.4;

    let data = null;

    // 1. Try Azure OpenAI Service (billed to Azure credits)
    if (isAzureOpenAIConfigured()) {
      try {
        data = await callAzureOpenAI({
          model: model,
          messages: oaMessages,
          max_tokens: max_tokens,
          temperature: temperature
        });
        console.log('[openai-agent] Azure OpenAI success');
      } catch (e) {
        console.error('[openai-agent] Azure OpenAI failed:', e.message);
      }
    }

    // 2. Try Lambda proxy in us-east-1 (bypasses geo-blocks)
    if (!data && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      try {
        const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
        const lambda = new LambdaClient({
          region: 'us-east-1',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
          }
        });

        const lambdaEvent = {
          rawPath: '/openai/v1/chat/completions',
          rawQueryString: '',
          requestContext: { http: { method: 'POST' } },
          headers: {
            'content-type': 'application/json',
            'authorization': 'Bearer ' + (process.env.OPENAI_API_KEY || '')
          },
          body: JSON.stringify({
            model: model,
            messages: oaMessages,
            max_tokens: max_tokens,
            temperature: temperature
          }),
          isBase64Encoded: false
        };

        const command = new InvokeCommand({
          FunctionName: 'gci-anthropic-proxy',
          Payload: JSON.stringify(lambdaEvent)
        });
        const lambdaResp = await lambda.send(command);
        const lambdaPayload = JSON.parse(new TextDecoder().decode(lambdaResp.Payload));
        if (!lambdaResp.FunctionError && lambdaPayload.statusCode && lambdaPayload.statusCode < 400) {
          data = typeof lambdaPayload.body === 'string' ? JSON.parse(lambdaPayload.body) : lambdaPayload.body;
          console.log('[openai-agent] Lambda proxy success');
        } else {
          const errBody = typeof lambdaPayload.body === 'string' ? lambdaPayload.body : JSON.stringify(lambdaPayload);
          console.error('[openai-agent] Lambda proxy failed:', errBody.slice(0, 200));
        }
      } catch (e) {
        console.error('[openai-agent] Lambda proxy error:', e.message);
      }
    }

    // 3. Last resort: Cloudflare Worker proxy
    if (!data) {
      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({ error: 'No OpenAI backend configured (need AZURE_OPENAI_ENDPOINT or OPENAI_API_KEY)' });
      }
      const _oaBase = 'https://gci-anthropic-proxy.gaurav-892.workers.dev/openai'.replace(/\/+$/, '');
      const _oaHeaders = {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.OPENAI_API_KEY
      };
      if (process.env.PROXY_SHARED_SECRET) _oaHeaders['x-proxy-secret'] = process.env.PROXY_SHARED_SECRET;
      const r = await fetch(_oaBase + '/v1/chat/completions', {
        method: 'POST',
        headers: _oaHeaders,
        body: JSON.stringify({
          model: model,
          messages: oaMessages,
          max_tokens: max_tokens,
          temperature: temperature
        })
      });
      data = await r.json();
      if (!r.ok) {
        return res.status(r.status).json({ error: (data && data.error && data.error.message) || 'OpenAI API error' });
      }
    }

    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    return res.status(200).json({
      content: [{ type: 'text', text: text }],
      model: data.model || model,
      usage: data.usage || null
    });
  } catch (err) {
    return res.status(500).json({ error: 'openai-agent error: ' + (err && err.message ? err.message : String(err)) });
  }
}
// cold-start trigger 1776807133
