/*
  POST /api/web-access/session
  Body: { "email": "buyer@example.com", "licenseKey": "DHC6-XXXX-XXXX-XXXX" }

  Issues a signed 12-hour browser session for an active Paddle subscriber.
  Both the purchase email and the licence key must match the KV record.
*/

import { json, getLicense, isExpired, normalizeEmail, normalizeKey } from "../_shared.js";
import { createWebSession, rateLimitAllows, sameOriginRequest, sessionCookie } from "./_session.js";

const KEY_PATTERN = /^DHC6-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function sessionResponse(session, plan, role) {
  return new Response(JSON.stringify({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    plan: plan,
    role: role
  }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": sessionCookie(session.token)
    }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.LICENSES || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "web_access_not_configured" }, 503);
  }
  if (!sameOriginRequest(request)) return json({ ok: false, error: "cross_site_request" }, 403);
  if (!(await rateLimitAllows(context, "web-session", 20, 15 * 60))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const email = normalizeEmail(body.email);
  const licenseKey = normalizeKey(body.licenseKey);
  if (!email || !KEY_PATTERN.test(licenseKey)) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const record = await getLicense(env, licenseKey);
  const active = record && record.status === "active" && !isExpired(record);
  if (!active || normalizeEmail(record.email) !== email) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, record);
  return sessionResponse(session, record.plan || "desktop", "subscriber");
}
