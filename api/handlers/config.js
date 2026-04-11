// api/config.js - Public configuration endpoint
// Returns non-secret client-side config values (OAuth client IDs, feature flags)
// Never exposes secrets (client secrets, API keys, tokens)

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=300'); // cache 5 min
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    oauth: {
      google: { clientId: process.env.GOOGLE_OAUTH_CLIENT_ID || '' },
      microsoft: { clientId: process.env.MICROSOFT_OAUTH_CLIENT_ID || '' },
      linkedin: { clientId: process.env.LINKEDIN_OAUTH_CLIENT_ID || '' }
    },
    keys: {
      azureOpenai: !!process.env.AZURE_OPENAI_KEY,
      azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT ? process.env.AZURE_OPENAI_ENDPOINT.replace(/\/+$/, '') : '',
      azureChatDeployment: process.env.AZURE_OPENAI_CHAT_DEPLOYMENT || '',
      azureTtsDeployment: process.env.AZURE_OPENAI_TTS_DEPLOYMENT || '',
      openai: !!process.env.OPENAI_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      hubspot: !!process.env.HUBSPOT_PRIVATE_APP_TOKEN,
      azureSpeech: !!process.env.AZURE_SPEECH_KEY,
      azureSpeechRegion: process.env.AZURE_SPEECH_REGION || ''
    }
  });
}
