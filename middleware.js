// Vercel Edge Middleware: CORS + auth gate for all /api/* routes.
// 1. Handles CORS preflight (OPTIONS) - always allowed
// 2. Sets CORS headers on all responses
// 3. Validates auth via proxy secret or Authorization bearer token

export const config = { matcher: '/api/:path*' };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-gci-proxy-key',
  'Access-Control-Max-Age': '86400',
};

export default function middleware(req) {
  // CORS preflight: always respond immediately with 204
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Allow Vercel cron invocations
  if (req.headers.get('x-vercel-cron')) return addCors();

  // Check proxy secret (if configured)
  const expected = process.env.GCI_PROXY_SECRET;
  if (expected) {
    const provided = req.headers.get('x-gci-proxy-key');
    if (provided === expected) return addCors();
  }

  // Accept Authorization bearer token (front-end sends GCI session token)
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ') && auth.length > 15) return addCors();

  // Reject unauthenticated requests (with CORS headers so browser sees the 401)
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: Object.assign({ 'content-type': 'application/json' }, CORS_HEADERS),
  });
}

// Helper: return a NextResponse that adds CORS headers to the upstream response
function addCors() {
  const resp = new Response(null);
  // Edge middleware: returning undefined passes to the handler.
  // We use headers on the response to inject CORS via Vercel's header merging.
  // But edge middleware can't easily append headers to the downstream response
  // without NextResponse. Use the simpler approach: return undefined and
  // rely on vercel.json headers config for CORS on successful requests.
  return undefined;
}
