/*
  POST /api/web-access/link-session
  Body: { "email": "buyer@example.com", "oobCode": "<code from the emailed link>" }

  Completes the passwordless email-link flow started by /request-link:
    1. Firebase accounts:signInWithEmailLink verifies the code belongs to the email.
    2. accounts:lookup confirms the resulting account is email-verified.
    3. The email must still map to an active licence in KV.
  Then a normal subscriber web session is issued (same shape as /session).
*/

import { json, normalizeEmail, getLicenseByEmail, isExpired } from "../_shared.js";
import { createWebSession, rateLimitAllows, sameOriginRequest } from "./_session.js";
import { sessionResponse } from "./session.js";

const SIGN_IN_WITH_LINK_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithEmailLink";
const LOOKUP_URL = "https://identitytoolkit.googleapis.com/v1/accounts:lookup";

async function firebaseJson(url, apiKey, body) {
  const response = await fetch(url + "?key=" + encodeURIComponent(apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = {};
  try { data = await response.json(); } catch (error) { data = {}; }
  return { ok: response.ok, data: data };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.LICENSES || !env.FIREBASE_WEB_API_KEY || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "email_link_not_configured" }, 503);
  }
  if (!sameOriginRequest(request)) return json({ ok: false, error: "cross_site_request" }, 403);
  if (!(await rateLimitAllows(context, "link-session", 20, 15 * 60))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const email = normalizeEmail(body.email);
  const oobCode = String(body.oobCode || "").trim();
  if (!email || !oobCode || oobCode.length > 512) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const signIn = await firebaseJson(SIGN_IN_WITH_LINK_URL, env.FIREBASE_WEB_API_KEY, { email: email, oobCode: oobCode });
  if (!signIn.ok || !signIn.data.idToken || normalizeEmail(signIn.data.email) !== email) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const lookup = await firebaseJson(LOOKUP_URL, env.FIREBASE_WEB_API_KEY, { idToken: signIn.data.idToken });
  const user = lookup.ok && Array.isArray(lookup.data.users) ? lookup.data.users[0] : null;
  if (!user || normalizeEmail(user.email) !== email || user.emailVerified !== true) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const record = await getLicenseByEmail(env, email);
  const active = record && record.status === "active" && !isExpired(record) && normalizeEmail(record.email) === email;
  if (!active) return json({ ok: false, error: "subscription_inactive" }, 403);

  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, record);
  return sessionResponse(session, record.plan || "desktop", "subscriber");
}
