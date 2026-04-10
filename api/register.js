const { app } = require('@azure/functions');
const { wrapVercel } = require('./adapter');

/* Health check - no handler, pure Azure Functions */
app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: async (request, context) => {
    return { status: 200, jsonBody: { ok: true, ts: Date.now(), functions: functions.length } };
  },
});

const ALL_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];

const functions = [
  'admin-dashboard', 'admin-hubspot-backfill', 'admin-hubspot-bootstrap',
  'admin-hubspot-lists', 'admin-integrations-backfill', 'admin-otp',
  'admin-reports', 'ai-checker', 'apollo', 'aria-voice', 'auth-me',
  'auth-signin', 'auth-signup', 'capture-lead', 'careers-applications',
  'careers-apply', 'careers-interest', 'careers-send-otp', 'careers-unsubscribe',
  'careers-verify-otp', 'careers-weekly', 'chat', 'create-checkout-session',
  'dashboard-data', 'gemini-agent', 'hubspot-webhook', 'job', 'keys-status',
  'legal-agent', 'legal-brief-update', 'legal-train', 'legal-war-room',
  'linkedin-jobs', 'magic-link', 'mandate-intake', 'news', 'openai-agent',
  'reports', 'save-report', 'send-reset-email', 'sitemap', 'social-publish',
  'strategic-intel-adjuncts', 'strategic-intel', 'stripe-webhook', 'synthesis',
  'track', 'verify-magic-link', 'verify-reset-token', 'verify-session',
];

const cache = {};

for (const name of functions) {
  app.http(name, {
    methods: ALL_METHODS,
    authLevel: 'anonymous',
    route: name,
    handler: async (request, context) => {
      try {
        if (!cache[name]) {
          cache[name] = require(`./handlers/${name}.js`);
        }
        const handler = cache[name].default || cache[name];
        if (typeof handler !== 'function') {
          return { status: 500, jsonBody: { error: 'Handler is not a function', type: typeof handler, keys: Object.keys(cache[name] || {}) } };
        }
        return await wrapVercel(handler)(request, context);
      } catch (err) {
        return { status: 500, jsonBody: { error: err.message, stack: (err.stack || '').split('\n').slice(0, 5) } };
      }
    },
  });
}

/* Dynamic route: /api/job/{slug} */
app.http('job-slug', {
  methods: ALL_METHODS,
  authLevel: 'anonymous',
  route: 'job/{slug}',
  handler: async (request, context) => {
    if (!cache['job-slug']) {
      const m = require('./handlers/job/[slug].js');
      cache['job-slug'] = m.default || m;
    }
    return wrapVercel(cache['job-slug'])(request, context);
  },
});
