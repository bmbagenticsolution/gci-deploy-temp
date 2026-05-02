// lib/bedrock.js - AWS Bedrock integration for Claude models
// Replaces direct Anthropic API calls (which are geo-blocked from Azure SWA East Asia).
// Uses the Anthropic Messages API format via Bedrock InvokeModel.

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');

// Map GCI model names to Bedrock model IDs
// Uses cross-region inference prefix (us.) for broader availability
const MODEL_MAP = {
  'claude-opus-4-6':               'us.anthropic.claude-opus-4-20250514-v1:0',
  'claude-sonnet-4-6':             'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-haiku-4-5-20251001':     'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-3-5-sonnet-20241022':    'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'claude-3-5-haiku-20241022':     'us.anthropic.claude-3-5-haiku-20241022-v1:0'
};

// Fallback without cross-region prefix (if us. prefix fails)
const MODEL_MAP_DIRECT = {
  'claude-opus-4-6':               'anthropic.claude-opus-4-20250514-v1:0',
  'claude-sonnet-4-6':             'anthropic.claude-sonnet-4-20250514-v1:0',
  'claude-haiku-4-5-20251001':     'anthropic.claude-haiku-4-5-20251001-v1:0',
  'claude-3-5-sonnet-20241022':    'anthropic.claude-3-5-sonnet-20241022-v2:0',
  'claude-3-5-haiku-20241022':     'anthropic.claude-3-5-haiku-20241022-v1:0'
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

module.exports = { callBedrock, isBedrockConfigured, MODEL_MAP };
