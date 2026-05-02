// lib/bedrock.js - AWS Bedrock integration for Claude models
// Replaces direct Anthropic API calls (which are geo-blocked from Azure SWA East Asia).
// Uses the Anthropic Messages API format via Bedrock InvokeModel.

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Map GCI model names to Bedrock model IDs
// Uses cross-region inference prefix (us.) for broader availability
// Updated 2026-05-02: active model IDs, use case form approved
const MODEL_MAP = {
  'claude-opus-4-6':               'us.anthropic.claude-opus-4-6-v1',
  'claude-sonnet-4-6':             'us.anthropic.claude-sonnet-4-6',
  'claude-haiku-4-5-20251001':     'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-3-5-sonnet-20241022':    'us.anthropic.claude-sonnet-4-6',
  'claude-3-5-haiku-20241022':     'us.anthropic.claude-haiku-4-5-20251001-v1:0'
};

// Fallback: try alternate model if primary fails
const MODEL_MAP_DIRECT = {
  'claude-opus-4-6':               'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-sonnet-4-6':             'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-haiku-4-5-20251001':     'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-3-5-sonnet-20241022':    'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  'claude-3-5-haiku-20241022':     'us.anthropic.claude-haiku-4-5-20251001-v1:0'
};

let _client = null;
function getClient() {
  if (_client) return _client;
  _client = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });
  return _client;
}

/**
 * Call Claude via AWS Bedrock using the Anthropic Messages API format.
 *
 * @param {Object} params - Same shape as Anthropic Messages API
 * @param {string} params.model - GCI model name (e.g., 'claude-sonnet-4-6')
 * @param {number} params.max_tokens - Max tokens to generate
 * @param {Array}  params.messages - Messages array [{role, content}]
 * @param {string} [params.system] - System prompt
 * @param {number} [params.temperature] - Temperature (0-1)
 * @returns {Object} Anthropic Messages API compatible response
 */
async function callBedrock(params) {
  const client = getClient();

  // Build Bedrock request body (Anthropic Messages API format)
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: params.max_tokens || 4096,
    messages: params.messages || []
  };
  if (params.system) body.system = params.system;
  if (typeof params.temperature === 'number') body.temperature = params.temperature;

  // Try cross-region model ID first, then direct
  const modelIds = [
    MODEL_MAP[params.model] || MODEL_MAP['claude-sonnet-4-6'],
    MODEL_MAP_DIRECT[params.model] || MODEL_MAP_DIRECT['claude-sonnet-4-6']
  ];

  let lastError;
  for (const modelId of modelIds) {
    try {
      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body)
      });
      const response = await client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      return responseBody;
    } catch (e) {
      lastError = e;
      console.error('[bedrock] Model ' + modelId + ' failed:', e.message);
      // If it's an access denied or model not found error, try the next model ID
      if (e.name === 'AccessDeniedException' || e.name === 'ValidationException' || e.name === 'ResourceNotFoundException') {
        continue;
      }
      throw e; // For other errors (network, etc.), throw immediately
    }
  }
  throw lastError;
}

/**
 * Check if Bedrock is configured (AWS credentials present)
 */
function isBedrockConfigured() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
}

/**
 * Call Claude via AWS Lambda proxy in us-east-1.
 * The Lambda function proxies to api.anthropic.com from a US IP,
 * bypassing Anthropic's geo-blocks on Azure SWA East Asia.
 *
 * @param {Object} params - Anthropic Messages API format
 * @returns {Object} Anthropic Messages API compatible response
 */
async function callViaLambdaProxy(params) {
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');

  const lambda = new LambdaClient({
    region: 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    }
  });

  // Pass through all Anthropic API params (model, max_tokens, messages, system,
  // temperature, tools, tool_choice, etc.) with sensible defaults
  const payload = Object.assign({}, params);
  if (!payload.model) payload.model = 'claude-sonnet-4-6';
  if (!payload.max_tokens) payload.max_tokens = 4096;
  if (!payload.messages) payload.messages = [];
  // Never stream through Lambda invoke (response is synchronous)
  delete payload.stream;

  // Build a Lambda event that mimics an HTTP request to the proxy
  const headers = {
    'content-type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': process.env.ANTHROPIC_API_KEY
  };
  // Pass through anthropic-beta if present (needed for pdfs, tool use, etc.)
  if (params._anthropicBeta) headers['anthropic-beta'] = params._anthropicBeta;

  const lambdaEvent = {
    rawPath: '/v1/messages',
    rawQueryString: '',
    requestContext: { http: { method: 'POST' } },
    headers: headers,
    body: JSON.stringify(payload),
    isBase64Encoded: false
  };

  const command = new InvokeCommand({
    FunctionName: 'gci-anthropic-proxy',
    Payload: JSON.stringify(lambdaEvent)
  });

  const response = await lambda.send(command);
  const responsePayload = JSON.parse(new TextDecoder().decode(response.Payload));

  if (response.FunctionError) {
    throw new Error('Lambda proxy error: ' + (responsePayload.errorMessage || 'unknown'));
  }

  // The Lambda returns { statusCode, headers, body }
  const body = typeof responsePayload.body === 'string'
    ? JSON.parse(responsePayload.body)
    : responsePayload.body;

  if (responsePayload.statusCode && responsePayload.statusCode >= 400) {
    throw new Error('Anthropic ' + responsePayload.statusCode + ': ' + ((body.error && body.error.message) || JSON.stringify(body)));
  }

  return body;
}

function isLambdaProxyConfigured() {
  return Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && process.env.ANTHROPIC_API_KEY);
}

module.exports = { callBedrock, isBedrockConfigured, callViaLambdaProxy, isLambdaProxyConfigured, MODEL_MAP };
