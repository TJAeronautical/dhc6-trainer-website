/*
  POST /api/web-access/logout
  Revokes the presented session (KV marker until natural expiry) and clears
  the HttpOnly cookie. Always succeeds so the browser can finish clearing
  local state even when the token was already invalid.
*/

import { clearSessionCookie, revokeWebSession, tokenFromRequest, verifyWebSession } from "./_session.js";

export async function onRequestPost(context) {
  const { request, env } = context;
  const token = tokenFromRequest(request);
  const payload = env.LICENSE_SIGNING_SECRET ? await verifyWebSession(env.LICENSE_SIGNING_SECRET, token) : null;
  if (payload) {
    try { await revokeWebSession(env, payload); } catch (error) { /* best effort */ }
  }
  return new Response(JSON.stringify({ ok: true, revoked: Boolean(payload) }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Clear-Site-Data": "\"cache\"",
      "Set-Cookie": clearSessionCookie()
    }
  });
}
