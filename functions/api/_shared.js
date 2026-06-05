/*
  Shared helpers for the licence API. Underscore prefix => not routed,
  importable by the route handlers.
*/

export function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "Content-Type": "application/json" }
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

// Verify a Paddle Billing webhook signature.
// Header format: "ts=1700000000;h1=<hex hmac of `${ts}:${rawBody}`>"
export async function verifyPaddleSignature(signatureHeader, rawBody, secret) {
  if (!signatureHeader || !secret) return false;
  const parts = {};
  signatureHeader.split(";").forEach(function (pair) {
    const idx = pair.indexOf("=");
    if (idx > -1) parts[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  });
  if (!parts.ts || !parts.h1) return false;

  const expected = await hmacHex(secret, parts.ts + ":" + rawBody);
  return timingSafeEqual(expected, parts.h1);
}
