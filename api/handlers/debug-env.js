// Debug endpoint: returns which proxy URLs would be used at runtime.
// SAFE: does not leak secrets, only shows whether env vars are set + full non-secret URL values.
module.exports = async function handler(req, res) {
  const info = {
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL || '(unset → default proxy)',
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || '(unset → default proxy)',
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL || '(unset → default proxy)',
    has_ANTHROPIC_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
    has_OPENAI_KEY: Boolean(process.env.OPENAI_API_KEY),
    has_GEMINI_KEY: Boolean(process.env.GEMINI_API_KEY),
    has_AWS_KEY: Boolean(process.env.AWS_ACCESS_KEY_ID),
    AWS_REGION: process.env.AWS_REGION || '(unset)',
    node_version: process.version,
    build_marker: 'v5-bedrock-integration'
  };
  res.status(200).json(info);
};
