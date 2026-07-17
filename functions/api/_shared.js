/*
  Shared helpers for the licence API. Underscore prefix => not routed,
  importable by the route handlers.
*/

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function importHmacKey(secret) {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

export async function hmacHex(secret, message) {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toHex(sig);
}

// Constant-time-ish hex comparison.
export function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Licence key in the format the desktop app + website gate expect:
// DHC6-XXXX-XXXX-XXXX using an unambiguous A-Z0-9 alphabet.
export function generateLicenseKey() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let out = "DHC6-";
  for (let i = 0; i < 12; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7) out += "-";
  }
  return out;
}

export function normalizeKey(key) {
  return String(key || "").trim().toUpperCase();
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isExpired(record) {
  if (!record || !record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() < Date.now();
}

export function publicLicense(record) {
  const status = record.status === "active" && isExpired(record) ? "expired" : record.status;
  return {
    key: record.key,
    email: record.email || null,
    status: status,
    plan: record.plan || "desktop",
    priceId: record.priceId || null,
    subscriptionId: record.subscriptionId || null,
    customerId: record.customerId || null,
    createdAt: record.createdAt || null,
    updatedAt: record.updatedAt || null,
    expiresAt: record.expiresAt || null,
    cancelAt: record.cancelAt || null,
    canceledAt: record.canceledAt || null,
    activationCount: Array.isArray(record.activations) ? record.activations.length : 0,
    activationLimit: record.activationLimit || 3,
    activations: Array.isArray(record.activations)
      ? record.activations.map(function (item) {
          return {
            deviceId: item.deviceId,
            deviceName: item.deviceName || "Unnamed device",
            activatedAt: item.activatedAt || null,
            lastSeenAt: item.lastSeenAt || null
          };
        })
      : []
  };
}

export async function getLicense(env, key) {
  if (!env.LICENSES || !key) return null;
  const raw = await env.LICENSES.get("license:" + normalizeKey(key));
  return raw ? JSON.parse(raw) : null;
}

export async function getLicenseByEmail(env, email) {
  if (!env.LICENSES) return null;
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const key = await env.LICENSES.get("email:" + normalized);
  return key ? getLicense(env, key) : null;
}

export async function writeLicense(env, record) {
  record.updatedAt = new Date().toISOString();
  await env.LICENSES.put("license:" + record.key, JSON.stringify(record));
  if (record.subscriptionId) {
    await env.LICENSES.put("sub:" + record.subscriptionId, record.key);
  }
  if (record.customerId) {
    await env.LICENSES.put("customer:" + record.customerId, record.key);
  }
  if (record.email) {
    await env.LICENSES.put("email:" + normalizeEmail(record.email), record.key);
  }
}

export function paddleApiBase(env) {
  return env.PADDLE_ENVIRONMENT === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";
}

export async function paddleApi(context, path, init) {
  const { env } = context;
  if (!env.PADDLE_API_KEY) {
    return { ok: false, status: 500, data: { error: "paddle_api_key_missing" } };
  }
  const response = await fetch(paddleApiBase(env) + path, {
    method: (init && init.method) || "GET",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + env.PADDLE_API_KEY
    },
    body: init && init.body ? JSON.stringify(init.body) : undefined
  });
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  return { ok: response.ok, status: response.status, data: data };
}

// Verify a Paddle Billing webhook signature.
// Header format: "ts=1700000000;h1=<hex hmac of `${ts}:${rawBody}`>"
export async function verifyPaddleSignature(signatureHeader, rawBody, secret, toleranceSeconds) {
  if (!signatureHeader || !secret) return false;
  const parts = {};
  signatureHeader.split(";").forEach(function (pair) {
    const idx = pair.indexOf("=");
    if (idx > -1) parts[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  if (!parts.ts || !parts.h1) return false;

  const parsedTolerance = Number(toleranceSeconds || 5);
  const toleranceMs = (Number.isFinite(parsedTolerance) ? Math.max(0, parsedTolerance) : 5) * 1000;
  const sentAtMs = Number(parts.ts) * 1000;
  if (!Number.isFinite(sentAtMs) || Math.abs(Date.now() - sentAtMs) > toleranceMs) {
    return false;
  }

  const expected = await hmacHex(secret, parts.ts + ":" + rawBody);
  return timingSafeEqual(expected, parts.h1);
}
