// Vercel Edge Middleware: auth gate for all /api/* routes.
// Accepts either:
//   1. x-gci-proxy-key header matching GCI_PROXY_SECRET env var
//   2. Authorization: Bearer <token> header (GCI session token from front-end)
// Vercel cron invocations are always allowed.

export const config = { matcher: '/api/:path*' };

export default function middleware(req) {
  // Allow Vercel cron invocations
  if (req.headers.get('x-vercel-cron')) return;

  // Check proxy secret (if configured)
  const expected = process.env.GCI_PROXY_SECRET;
  if (expected) {
    const provided = req.headers.get('x-gci-proxy-key');
    if (provided === expected) return;
  }

  // Accept Authorization bearer token (front-end sends GCI session token)
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ') && auth.length > 15) return;

  // Reject unauthenticated requests
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
}
