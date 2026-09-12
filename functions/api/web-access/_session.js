import { hmacHex, timingSafeEqual } from "../_shared.js";

const SESSION_SECONDS = 12 * 60 * 60;

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

export async function createWebSession(secret, record) {
  const now = Math.floor(Date.now() / 1000);
  const payload = encodeBase64Url(JSON.stringify({
    v: 1,
    key: record.key,
    email: record.email,
    plan: record.plan || "desktop",
    iat: now,
    exp: now + SESSION_SECONDS
  }));
  const signature = await hmacHex(secret, payload);
  return { token: payload + "." + signature, expiresAt: new Date((now + SESSION_SECONDS) * 1000).toISOString() };
}

export async function verifyWebSession(secret, token) {
  if (!secret || !token || token.length > 4096) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = await hmacHex(secret, parts[0]);
  if (!timingSafeEqual(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[0]));
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || !payload.key || !payload.email || !payload.exp || payload.exp <= now) return null;
    return payload;
  } catch (error) {
    return null;
  }
}
