/*
  POST /api/web-access/owner-session
  Body: { "email": "<owner email>", "password": "<Firebase password>" }

  Owner sign-in without a Paddle licence:
    1. The submitted email must equal OWNER_ACCESS_EMAIL (server-side secret).
    2. The password is forwarded ONCE to Firebase signInWithPassword and is
       never stored or logged.
    3. The Firebase account returned must carry the same email and must be
       email-verified (accounts:lookup).
  Only then is a signed owner session issued.
*/

import { json, normalizeEmail } from "../_shared.js";
import { createOwnerWebSession, rateLimitAllows, sameOriginRequest } from "./_session.js";
import { sessionResponse } from "./session.js";

const SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword";
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
  const allowedOwner = normalizeEmail(env.OWNER_ACCESS_EMAIL);
  if (!allowedOwner || !env.FIREBASE_WEB_API_KEY || !env.LICENSE_SIGNING_SECRET) {
    return json({ ok: false, error: "owner_access_not_configured" }, 503);
  }
  if (!sameOriginRequest(request)) return json({ ok: false, error: "cross_site_request" }, 403);
  if (!(await rateLimitAllows(context, "owner-session", 10, 15 * 60))) {
    return json({ ok: false, error: "rate_limited" }, 429);
  }

  let body = {};
  try { body = await request.json(); } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (email !== allowedOwner || !password || password.length > 1024) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const signIn = await firebaseJson(SIGN_IN_URL, env.FIREBASE_WEB_API_KEY, {
    email: email,
    password: password,
    returnSecureToken: true
  });
  if (!signIn.ok || normalizeEmail(signIn.data.email) !== allowedOwner || !signIn.data.idToken) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const lookup = await firebaseJson(LOOKUP_URL, env.FIREBASE_WEB_API_KEY, { idToken: signIn.data.idToken });
  const user = lookup.ok && Array.isArray(lookup.data.users) ? lookup.data.users[0] : null;
  if (!user || normalizeEmail(user.email) !== allowedOwner) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (user.emailVerified !== true) {
    return json({ ok: false, error: "owner_email_unverified" }, 403);
  }
  if (user.disabled === true) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, allowedOwner);
  return sessionResponse(session, "owner", "owner");
}
