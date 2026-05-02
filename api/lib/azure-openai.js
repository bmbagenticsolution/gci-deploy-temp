// lib/azure-openai.js - Azure OpenAI Service integration
// Routes OpenAI calls through Azure, billing to Azure credits instead of OpenAI API key.
//
// Environment variables:
//   AZURE_OPENAI_ENDPOINT - e.g. https://gci-openai.openai.azure.com
//   AZURE_OPENAI_KEY      - Azure OpenAI resource key (also accepts AZURE_OPENAI_API_KEY)
//   AZURE_OPENAI_API_VERSION - e.g. 2024-10-21 (defaults to 2024-10-21)
//
// Deployment names should match the model: e.g. 'gpt-4o' deployment for gpt-4o model.
// Azure OpenAI uses deployment names in the URL path instead of model in the body.

// Map model names to Azure deployment names
// These must match the deployment names created in Azure OpenAI Studio
const DEPLOYMENT_MAP = {
  'gpt-4.1':       'gpt-4.1',
  'gpt-4o':        'gpt-4o',
  'gpt-4o-mini':   'gpt-4o-mini',
  'gpt-4':         'gpt-4',
  'gpt-4-turbo':   'gpt-4-turbo',
  'gpt-35-turbo':  'gpt-35-turbo',
  'gpt-3.5-turbo': 'gpt-35-turbo',
};

function isAzureOpenAIConfigured() {
  return Boolean(process.env.AZURE_OPENAI_ENDPOINT && (process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY));
}

/**
 * Call Azure OpenAI Chat Completions.
 *
 * @param {Object} params
 * @param {string} params.model - Model/deployment name (e.g. 'gpt-4.1')
 * @param {Array}  params.messages - Chat messages
 * @param {number} [params.max_tokens] - Max tokens
 * @param {number} [params.temperature] - Temperature
 * @returns {Object} OpenAI-compatible response
 */
async function callAzureOpenAI(params) {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '');
  const apiKey = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-10-21';

  const model = params.model || 'gpt-4.1';
  // Use AZURE_OPENAI_CHAT_DEPLOYMENT env var as override, then DEPLOYMENT_MAP, then model name
  const deployment = process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || DEPLOYMENT_MAP[model] || model;

  const url = endpoint + '/openai/deployments/' + encodeURIComponent(deployment)
    + '/chat/completions?api-version=' + apiVersion;

  const body = {
    messages: params.messages || [],
    max_tokens: params.max_tokens || 4096,
  };
  if (typeof params.temperature === 'number') body.temperature = params.temperature;
  if (typeof params.top_p === 'number') body.top_p = params.top_p;
  if (Array.isArray(params.stop)) body.stop = params.stop;

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  const data = await r.json();
  if (!r.ok) {
    const errMsg = (data && data.error && data.error.message) || JSON.stringify(data);
    throw new Error('Azure OpenAI ' + r.status + ': ' + errMsg);
  }

  return data;
}

module.exports = { callAzureOpenAI, isAzureOpenAIConfigured, DEPLOYMENT_MAP };
