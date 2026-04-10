/**
 * Vercel-to-Azure Functions adapter (CommonJS).
 */

function wrapVercel(handlerFn) {
  return async function azureHandler(request, context) {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams.entries());

    let body = null;
    const ct = (request.headers.get('content-type') || '').toLowerCase();
    try {
      if (ct.includes('application/json')) {
        body = await request.json();
      } else {
        const txt = await request.text();
        if (txt) {
          try { body = JSON.parse(txt); } catch { body = txt; }
        }
      }
    } catch { /* empty body */ }

    const headers = {};
    request.headers.forEach((v, k) => { headers[k] = v; });

    if (request.params) {
      for (const [k, v] of Object.entries(request.params)) {
        if (!query[k]) query[k] = v;
      }
    }

    const req = { method: request.method, url: request.url, headers, query, body };

    let statusCode = 200;
    const resHeaders = {};
    let responseBody = undefined;

    const res = {
      status(code) { statusCode = code; return res; },
      setHeader(k, v) { resHeaders[k] = v; return res; },
      json(data) { responseBody = data; return res; },
      send(data) { responseBody = data; return res; },
      end(data) { if (data !== undefined) responseBody = data; return res; },
      writeHead(code, hdrs) {
        statusCode = code;
        if (hdrs) Object.entries(hdrs).forEach(([k, v]) => { resHeaders[k] = v; });
        return res;
      },
      getHeader(k) { return resHeaders[k]; },
    };

    try {
      await handlerFn(req, res);
    } catch (err) {
      context.log('Handler error:', err);
      return { status: 500, jsonBody: { error: 'Internal server error' } };
    }

    const azRes = { status: statusCode, headers: resHeaders };
    if (responseBody === undefined || responseBody === null) {
      azRes.body = '';
    } else if (typeof responseBody === 'object' && !(responseBody instanceof Buffer) && !(responseBody instanceof ArrayBuffer) && !(responseBody instanceof Uint8Array)) {
      azRes.jsonBody = responseBody;
    } else {
      azRes.body = responseBody;
    }
    return azRes;
  };
}

module.exports = { wrapVercel };
