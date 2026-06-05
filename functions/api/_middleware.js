/*
  CORS + preflight handling for all /api/* routes.
  Lives at functions/api/_middleware.js so it only wraps the API,
  never the static site.
*/

const ALLOWED_ORIGINS = [
  "https://dhc6trainer.com",
  "https://www.dhc6trainer.com"
];

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

export async function onRequest(context) {
  const { request, next } = context;
  const origin = request.headers.get("Origin") || "";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const response = await next();
  const headers = corsHeaders(origin);
  Object.keys(headers).forEach(function (key) {
    response.headers.set(key, headers[key]);
  });
  return response;
}
