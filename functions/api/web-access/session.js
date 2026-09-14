/*
  POST /api/web-access/session
  Body: { "email": "buyer@example.com", "licenseKey": "DHC6-XXXX-XXXX-XXXX" }

  Issues a signed 12-hour browser session for an active Paddle subscriber.
  Both the purchase email and the licence key must match the KV record.
*/

import { json, getLicense, isExpired, normalizeEmail, normalizeKey } from "../_shared.js";
import { createWebSession, rateLimitAllows, sameOriginRequest, sessionCookie } from "./_session.js";
import { claimSeat, describeSeats, signOutOtherSeats } from "./_seats.js";

const KEY_PATTERN = /^DHC6-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function sessionResponse(session, plan, role, extra) {
  return new Response(JSON.stringify(Object.assign({
    ok: true,
    token: session.token,
    expiresAt: session.expiresAt,
    plan: plan,
    role: role
  }, extra || {})), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Set-Cookie": sessionCookie(session.token)
    }
  });
}

/*
  One licence, a limited number of browsers.

  Shared by both subscriber sign-in paths. Mints the session first because the
  seat records the session id; a refused claim writes nothing and the token is
  simply never delivered, so there is nothing to clean up.

  A refusal is a 403 carrying the device list, because the subscriber needs to
  see what is holding their seats to decide whether to sign one out - and
  because the alternative, silently evicting whoever was there, would let a
  shared key keep working forever by taking turns.
*/
export async function seatedSessionResponse(context, record, options) {
  const opts = options || {};
  const session = await createWebSession(context.env.LICENSE_SIGNING_SECRET, record);

  if (opts.signOutOthers) {
    await signOutOtherSeats(context.env, record, opts.deviceId || null);
  }

  const claim = await claimSeat(context.env, record, {
    deviceId: opts.deviceId,
    userAgent: context.request.headers.get("User-Agent") || "",
    sid: session.sid,
    exp: session.exp
  });

  if (!claim.ok) {
    return json({
      ok: false,
      error: "seat_limit",
      limit: claim.limit,
      devices: describeSeats(claim.seats, opts.deviceId || null)
    }, 403);
  }

  return sessionResponse(session, record.plan || "desktop", "subscriber", {
    deviceId: claim.deviceId,
    seatLimit: claim.limit,
    seatsUsed: claim.seats.length
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

  /* Signing the other devices out needs the licence key, which this request
     has already proved. That is why it is a flag here rather than a separate
     endpoint: somebody refused at the limit has no session to authenticate a
     second call with. */
  return seatedSessionResponse(context, record, {
    deviceId: body.deviceId,
    signOutOthers: body.signOutOthers === true
  });
}
