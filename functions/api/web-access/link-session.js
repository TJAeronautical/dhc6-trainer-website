/*
  POST /api/web-access/link-session
  Body: { "email": "buyer@example.com", "oobCode": "<code from the emailed link>" }

  Completes the passwordless email-link flow started by /request-link:
    1. Firebase accounts:signInWithEmailLink verifies the code belongs to the email.
    2. accounts:lookup confirms the resulting account is email-verified.
    3. The email must still map to an active licence in KV.
  Then a normal subscriber web session is issued (same shape as /session).
*/

import { json, normalizeEmail, getLicense, getLicenseByEmail, isExpired } from "../_shared.js";
import { rateLimitAllows, sameOriginRequest } from "./_session.js";
import { resolveLinkIntent } from "./request-link.js";
import { seatedSessionResponse } from "./session.js";

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

/*
  A sign-in link's code works exactly once, and Firebase spends it the moment
  this endpoint verifies it. That is fine until the seat limit refuses the
  session afterwards: retrying with "sign the others out" would present a code
  that is already spent, and the visitor would be told their link was broken
  when it was nothing of the kind.

  So a refusal at the limit hands back a short-lived, single-use grant that
  stands in for the code on the retry. It is only ever issued AFTER a complete
  Firebase verification, which is what keeps this from becoming an oracle:
  checking seats before verifying the code would let anyone ask whether a
  given address has a licence.
*/
const GRANT_PREFIX = "linkgrant:";
const GRANT_TTL_SECONDS = 10 * 60;

async function issueLinkGrant(env, licenseKey) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < bytes.length; i++) id += bytes[i].toString(16).padStart(2, "0");
  try {
    await env.LICENSES.put(GRANT_PREFIX + id, licenseKey, { expirationTtl: GRANT_TTL_SECONDS });
  } catch (error) {
    return "";
  }
  return id;
}

async function consumeLinkGrant(env, id) {
  const handle = String(id || "").trim();
  if (!/^[0-9a-f]{32}$/.test(handle)) return "";
  let key = "";
  try {
    key = (await env.LICENSES.get(GRANT_PREFIX + handle)) || "";
  } catch (error) {
    return "";
  }
  /* Single use: a grant that has served its retry must not serve another. */
  if (key) { try { await env.LICENSES.delete(GRANT_PREFIX + handle); } catch (error) { /* best effort */ } }
  return key;
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
  /*
    The retry after a seat refusal carries a grant instead of a code, because
    the code it would otherwise resend has already been spent. Everything the
    grant stands for was verified when it was issued, so this path re-reads the
    licence and goes straight to the seat claim.
  */
  if (body.grant) {
    const grantedKey = await consumeLinkGrant(env, body.grant);
    const granted = grantedKey ? await getLicense(env, grantedKey) : null;
    if (!granted || granted.status !== "active" || isExpired(granted)) {
      console.warn("link-session refused: the seat-release grant has expired or its licence is no longer active");
      return json({ ok: false, error: "invalid_credentials" }, 401);
    }
    return seatedSessionResponse(context, granted, {
      deviceId: body.deviceId,
      signOutOthers: body.signOutOthers === true
    });
  }

  const oobCode = String(body.oobCode || "").trim();
  if (!oobCode || oobCode.length > 512) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  /*
    The address comes from the handle the server put in the link, and only
    falls back to what the page submitted - which is all there was before, and
    is still the path for a link issued by an older deploy. When both are
    present they must agree: a handle names one address, and a request that
    pairs it with another is not a mistake worth guessing about.
  */
  const intentEmail = await resolveLinkIntent(env, body.intent);
  const typedEmail = normalizeEmail(body.email);
  const email = intentEmail || typedEmail;
  if (!email) {
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  /*
    Three quite different failures all end as "invalid_credentials" to the
    caller, and that is deliberate: a sign-in endpoint must not tell an
    attacker which half of a guess was wrong. But it left nobody - including
    the owner - able to tell an expired code from an unverified account from a
    lapsed subscription. Every branch below now says which it was in the log,
    where operators can read it and attackers cannot.
  */
  const why = function (reason, detail) {
    console.warn("link-session refused: " + reason + (detail ? " (" + detail + ")" : ""));
  };

  if (intentEmail && typedEmail && intentEmail !== typedEmail) {
    why("the link was issued for a different address than the page submitted");
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (!intentEmail && body.intent) {
    /* Not fatal - the typed address carries it - but worth naming, because a
       handle that no longer resolves means the link is over 30 minutes old. */
    why("the link handle has expired or was never issued", "falling back to the submitted address");
  }

  const signIn = await firebaseJson(SIGN_IN_WITH_LINK_URL, env.FIREBASE_WEB_API_KEY, { email: email, oobCode: oobCode });
  if (!signIn.ok || !signIn.data.idToken) {
    /* Firebase names it: INVALID_OOB_CODE (wrong, or already used - these
       codes are single-use), EXPIRED_OOB_CODE, INVALID_EMAIL. */
    why("firebase rejected the code", String((signIn.data.error && signIn.data.error.message) || "no message"));
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (normalizeEmail(signIn.data.email) !== email) {
    why("the code belongs to a different address than the one submitted");
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const lookup = await firebaseJson(LOOKUP_URL, env.FIREBASE_WEB_API_KEY, { idToken: signIn.data.idToken });
  const user = lookup.ok && Array.isArray(lookup.data.users) ? lookup.data.users[0] : null;
  if (!user) {
    why("Firebase returned no account for the signed-in token");
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (normalizeEmail(user.email) !== email) {
    why("the Firebase account address does not match the submitted one");
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }
  if (user.emailVerified !== true) {
    /* Signing in by email link normally sets this, since clicking the link
       proves control of the address. An account that predates the link flow
       can still be unverified, and this fails closed on purpose. */
    why("the Firebase account is not email-verified");
    return json({ ok: false, error: "invalid_credentials" }, 401);
  }

  const record = await getLicenseByEmail(env, email);
  const active = record && record.status === "active" && !isExpired(record) && normalizeEmail(record.email) === email;
  if (!active) {
    why("no active licence for that address", record ? "status=" + record.status : "no licence record");
    return json({ ok: false, error: "subscription_inactive" }, 403);
  }

  /* The same seat limit as the key path. A magic link proves the address, not
     that the licence has a browser free. */
  const seated = await seatedSessionResponse(context, record, {
    deviceId: body.deviceId,
    signOutOthers: body.signOutOthers === true
  });

  if (seated.status === 403) {
    /* Attach the grant so the retry does not need the spent code. */
    const refusal = await seated.clone().json();
    if (refusal && refusal.error === "seat_limit") {
      refusal.grant = await issueLinkGrant(env, record.key);
      return json(refusal, 403);
    }
  }
  return seated;
}
