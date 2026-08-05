/* CORS and preflight handling for /api/* routes only. */
const ALLOWED_ORIGINS = new Set([
  "https://dhc6trainer.com",
  "https://www.dhc6trainer.com"
]);

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Firebase-AppCheck",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function withHeaders(response, extraHeaders) {
  const headers = new Headers(response.headers);
  Object.keys(extraHeaders).forEach(function (key) { headers.set(key, extraHeaders[key]); });
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}

export async function onRequest(context) {
  const origin = context.request.headers.get("Origin") || "";
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  const response = await context.next();
  return withHeaders(response, corsHeaders(origin));
}
