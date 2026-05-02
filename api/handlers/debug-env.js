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
    has_LAMBDA_SDK: (() => { try { require('@aws-sdk/client-lambda'); return true; } catch(e) { return false; } })(),
    lambda_proxy_configured: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.ANTHROPIC_API_KEY),
    node_version: process.version,
    build_marker: 'v12-lambda-all-handlers'
  };
  res.status(200).json(info);
};
