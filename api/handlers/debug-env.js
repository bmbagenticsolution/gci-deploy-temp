// Debug endpoint: returns which proxy URLs would be used at runtime.
// SAFE: does not leak secrets, only shows whether env vars are set + full non-secret URL values.
module.exports = async function handler(req, res) {
  // Check if AWS SDK is loadable
  let awsSdkStatus = 'not checked';
  try {
    require('@aws-sdk/client-bedrock-runtime');
    awsSdkStatus = 'loaded';
  } catch (e) {
    awsSdkStatus = 'MISSING: ' + e.message.slice(0, 100);
  }

  // Quick Bedrock test if requested via ?test=1
  let bedrockTest = 'skipped';
  if (req.query && req.query.test === '1') {
    try {
      const { callBedrock, isBedrockConfigured } = require('../lib/bedrock');
      if (!isBedrockConfigured()) {
        bedrockTest = 'not configured';
      } else {
        const result = await callBedrock({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'Say OK' }]
        });
        bedrockTest = 'OK: ' + ((result.content && result.content[0] && result.content[0].text) || 'no text');
      }
    } catch (e) {
      bedrockTest = 'FAIL: ' + e.name + ' - ' + e.message.slice(0, 150);
    }
  }

  // Lambda proxy test if requested via ?test=lambda
  let lambdaTest = 'skipped';
  if (req.query && (req.query.test === 'lambda' || req.query.test === 'all')) {
    try {
      const { callViaLambdaProxy, isLambdaProxyConfigured } = require('../lib/bedrock');
      if (!isLambdaProxyConfigured()) {
        lambdaTest = 'not configured';
      } else {
        const result = await callViaLambdaProxy({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 20,
          messages: [{ role: 'user', content: 'Say OK in one word' }]
        });
        lambdaTest = 'OK: ' + ((result.content && result.content[0] && result.content[0].text) || 'no text');
      }
    } catch (e) {
      lambdaTest = 'FAIL: ' + (e.name || 'Error') + ' - ' + (e.message || String(e)).slice(0, 300);
    }
  }

  // Azure OpenAI test if requested via ?test=azure
  let azureTest = 'skipped';
  if (req.query && (req.query.test === 'azure' || req.query.test === 'all')) {
    try {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const key = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
      const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || 'gpt-4.1';
      if (!endpoint || !key) {
        azureTest = 'not configured (missing endpoint or key)';
      } else {
        const url = endpoint.replace(/\/$/, '') + '/openai/deployments/' + deployment + '/chat/completions?api-version=2024-12-01-preview';
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'api-key': key },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'Say OK' }], max_tokens: 10 })
        });
        const data = await r.json();
        if (!r.ok) {
          azureTest = 'FAIL: ' + r.status + ' - ' + ((data.error && data.error.message) || JSON.stringify(data)).slice(0, 200);
        } else {
          azureTest = 'OK: ' + ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || 'no text');
        }
      }
    } catch (e) {
      azureTest = 'FAIL: ' + (e.name || 'Error') + ' - ' + (e.message || String(e)).slice(0, 200);
    }
  }

  const info = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(unset, default proxy)',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(unset, default proxy)',
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || '(unset, default proxy)',
    has_ANTHROPIC_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    has_OPENAI_KEY: Boolean(process.env.OPENAI_API_KEY),
    has_GEMINI_KEY: Boolean(process.env.GEMINI_API_KEY),
    has_AWS_KEY: Boolean(process.env.AWS_ACCESS_KEY_ID),
    AWS_REGION: process.env.AWS_REGION || '(unset)',
    aws_sdk: awsSdkStatus,
    bedrock_test: bedrockTest,
    lambda_proxy_test: lambdaTest,
    azure_openai_test: azureTest,
    has_LAMBDA_SDK: (() => { try { require('@aws-sdk/client-lambda'); return true; } catch(e) { return false; } })(),
    lambda_proxy_configured: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    has_AZURE_OPENAI_ENDPOINT: Boolean(process.env.AZURE_OPENAI_ENDPOINT),
    has_AZURE_OPENAI_KEY: Boolean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY),
    AZURE_OPENAI_CHAT_DEPLOYMENT: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '(unset)',
    node_version: process.version,
    build_marker: 'v14-lambda-azure-diag'
  };
  res.status(200).json(info);
};
