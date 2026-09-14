/*
  Signed web-access sessions for the browser app.

  Token format: <base64url(JSON payload)>.<hex HMAC-SHA256(payload)>
  Payload: { v:2, sid, role:"subscriber"|"owner", key?, email, plan, iat, exp }

  The token is delivered two ways:
    1. Set-Cookie dhc6_web_session (HttpOnly, Secure, SameSite=Strict) so the
       Worker can gate protected HTML navigations (/app/*, /live.html).
    2. Response body `token` so scripts can send `Authorization: Bearer`.

  Revocation: logout writes `websession-revoked:<sid>` to KV until the token's
  natural expiry. Every verification checks that marker, then re-checks the
  licence record (subscriber) or OWNER_ACCESS_EMAIL (owner) live.
*/

import { hmacHex, timingSafeEqual, getLicense, isExpired, normalizeEmail } from "../_shared.js";

export const SESSION_SECONDS = 12 * 60 * 60;
export const SESSION_COOKIE = "dhc6_web_session";
const REVOKED_PREFIX = "websession-revoked:";
const RATE_PREFIX = "ratelimit:";

function encodeBase64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, function (char) { return char.charCodeAt(0); });
  return new TextDecoder().decode(bytes);
}

function randomId(byteLength) {
  const bytes = new Uint8Array(byteLength || 16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function signPayload(secret, payload) {
  const encoded = encodeBase64Url(JSON.stringify(payload));
  const signature = await hmacHex(secret, encoded);
  return {
    token: encoded + "." + signature,
    sid: payload.sid,
    /* Unix seconds, kept alongside the ISO string because the seat store needs
       it to set a revocation marker that expires with the token. */
    exp: payload.exp,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

export async function createWebSession(secret, record) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(secret, {
    v: 2,
    sid: randomId(16),
    role: "subscriber",
    key: record.key,
    email: normalizeEmail(record.email),
    plan: record.plan || "desktop",
    iat: now,
    exp: now + SESSION_SECONDS
  });
}

export async function createOwnerWebSession(secret, email) {
  const now = Math.floor(Date.now() / 1000);
  return signPayload(secret, {
    v: 2,
    sid: randomId(16),
    role: "owner",
    email: normalizeEmail(email),
    plan: "owner",
    iat: now,
    exp: now + SESSION_SECONDS
  });
}

/* Signature + structural validation only (no KV). Returns payload or null. */
export async function verifyWebSession(secret, token) {
  if (!secret || !token || typeof token !== "string" || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  const expected = await hmacHex(secret, parts[0]);
  if (!timingSafeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[0]));
    const now = Math.floor(Date.now() / 1000);
    if (!payload || typeof payload !== "object") return null;
    if (payload.v !== 2 || !payload.sid || !payload.email || !payload.exp || payload.exp <= now) return null;
    if (payload.role !== "owner" && payload.role !== "subscriber") return null;
    if (payload.role === "subscriber" && !payload.key) return null;
    return payload;
  } catch (error) {
    return null;
  }
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach(function (part) {
    const idx = part.indexOf("=");
    if (idx > -1) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  });
  return out;
}

/* Bearer header wins, then cookie. */
export function tokenFromRequest(request) {
  const authorization = request.headers.get("Authorization") || "";
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, "").trim();
  const cookies = parseCookies(request);
  return cookies[SESSION_COOKIE] || "";
}

export function sessionCookie(token, maxAgeSeconds) {
  const maxAge = typeof maxAgeSeconds === "number" ? maxAgeSeconds : SESSION_SECONDS;
  return SESSION_COOKIE + "=" + (token || "") + "; Path=/; Max-Age=" + maxAge + "; HttpOnly; Secure; SameSite=Strict";
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export async function revokeWebSession(env, payload) {
  if (!env || !env.LICENSES || !payload || !payload.sid) return;
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Number(payload.exp || now) - now + 60);
  await env.LICENSES.put(REVOKED_PREFIX + payload.sid, "1", { expirationTtl: ttl });
}

export async function isRevoked(env, payload) {
  if (!env || !env.LICENSES || !payload || !payload.sid) return false;
  const marker = await env.LICENSES.get(REVOKED_PREFIX + payload.sid);
  return Boolean(marker);
}

/*
  Full authorisation for a request: signature, expiry, revocation marker, then a
  live entitlement check. Returns { ok:true, payload, plan, role } or
  { ok:false, status, error }.
*/
export async function authorizeWebRequest(context) {
  const { request, env } = context;
  if (!env || !env.LICENSE_SIGNING_SECRET) return { ok: false, status: 503, error: "web_access_not_configured" };
  const token = tokenFromRequest(request);
  const payload = await verifyWebSession(env.LICENSE_SIGNING_SECRET, token);
  if (!payload) return { ok: false, status: 401, error: "session_invalid" };
  if (await isRevoked(env, payload)) return { ok: false, status: 401, error: "session_revoked" };

  if (payload.role === "owner") {
    const allowedOwner = normalizeEmail(env.OWNER_ACCESS_EMAIL);
    if (!allowedOwner || normalizeEmail(payload.email) !== allowedOwner) {
      return { ok: false, status: 403, error: "owner_access_revoked" };
    }
    /* An owner has no paid period to run out. */
    return { ok: true, payload: payload, role: "owner", plan: "owner", entitledUntil: null, expiresAt: new Date(payload.exp * 1000).toISOString() };
  }

  const record = await getLicense(env, payload.key);
  const active = record && record.status === "active" && !isExpired(record);
  if (!active || normalizeEmail(record.email) !== normalizeEmail(payload.email)) {
    return { ok: false, status: 403, error: "subscription_inactive" };
  }
  return {
    ok: true,
    payload: payload,
    role: "subscriber",
    plan: record.plan || "desktop",
    record: record,
    /*
      The end of the period this subscriber has actually paid for, which is a
      different thing from the 12-hour session expiry below. Offline access is
      bounded by it: without that, every check-in pushed the offline window a
      further 30 days out, so cancelling bought a free month on a device that
      simply stayed off the network.
    */
    entitledUntil: record.expiresAt || null,
    expiresAt: new Date(payload.exp * 1000).toISOString()
  };
}

/* Best-effort per-IP throttle in KV. Returns true when the request is allowed. */
export async function rateLimitAllows(context, scope, limit, windowSeconds) {
  const { request, env } = context;
  if (!env || !env.LICENSES) return true;
  const ip = request.headers.get("CF-Connecting-IP") || request.headers.get("X-Forwarded-For") || "unknown";
  const key = RATE_PREFIX + scope + ":" + ip;
  let count = 0;
  try {
    count = Number((await env.LICENSES.get(key)) || 0);
  } catch (error) {
    count = 0;
  }
  if (count >= limit) return false;
  try {
    await env.LICENSES.put(key, String(count + 1), { expirationTtl: windowSeconds });
  } catch (error) {
    /* KV write failures must not block sign-in. */
  }
  return true;
}

/* Origin check for state-changing browser requests (defence in depth on top of SameSite=Strict). */
const TRUSTED_SITE_ORIGINS = new Set(["https://dhc6trainer.com", "https://www.dhc6trainer.com"]);

export function sameOriginRequest(request) {
  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== url.origin && !TRUSTED_SITE_ORIGINS.has(origin)) return false;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") return false;
  return true;
}
