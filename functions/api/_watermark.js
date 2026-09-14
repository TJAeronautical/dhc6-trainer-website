/*
  Per-account content watermarking.

  What this is for, stated plainly: it does NOT stop a subscriber copying the
  training content. Nothing can. The packs are JSON the app has to read, so
  anything the browser can render, the person reading it can save - with the
  offline download or without it, from IndexedDB or from the Network tab.

  What it does is make a copy TRACEABLE. Every pack handed to a subscriber
  carries an identifier for the account that asked for it, so a dump that
  turns up somewhere else points back at a source. That is the lever that
  actually deters sharing, and it is the one that survives the fact that
  client-side DRM cannot work on content you intend people to read.

  Someone who looks can find the field and delete it. That is understood and
  is not a reason to skip it: the realistic leak is a subscriber handing a
  folder to a colleague, not a stripped and curated release.

  The identifier is HMAC(LICENSE_SIGNING_SECRET, seed), deliberately NOT the
  accountIdFor() used for storage keys. That one is a plain SHA-256 of the
  licence key, so anyone holding a key could compute it, and it names the KV
  namespace holding that account's logbook and drafts. A watermark is meant to
  be seen by whoever receives a leak; it must not double as a storage handle,
  and it must not be forgeable by someone wanting to stamp their copy with
  another subscriber's identity.
*/

import { hmacHex, normalizeEmail } from "./_shared.js";

export const WATERMARK_VERSION = 1;
export const WATERMARK_FIELD = "_wm";

/* The same seed shape as accountIdFor, so one account is one watermark across
   licence renewals of the same key, and the owner is distinguishable. */
export function watermarkSeed(auth) {
  const payload = (auth && auth.payload) || {};
  if (auth && auth.role === "owner") return "owner:" + normalizeEmail(payload.email || "");
  return "license:" + String(payload.key || "").trim().toUpperCase();
}

export function seedForLicenseKey(key) {
  return "license:" + String(key || "").trim().toUpperCase();
}

export function seedForOwnerEmail(email) {
  return "owner:" + normalizeEmail(email || "");
}

/*
  16 hex characters: short enough to read out of a leaked file, long enough
  that guessing another account's stamp is not a thing you can do.
*/
export async function watermarkFromSeed(env, seed) {
  const secret = env && env.LICENSE_SIGNING_SECRET;
  if (!secret || !seed) return null;
  const digest = await hmacHex(secret, "watermark:v" + WATERMARK_VERSION + ":" + seed);
  return digest.slice(0, 16);
}

export async function watermarkFor(env, auth) {
  if (!auth || !auth.ok) return null;
  return watermarkFromSeed(env, watermarkSeed(auth));
}

/* Day precision, not a timestamp. It says roughly when a copy was taken
   without turning every request into a distinct fingerprint. */
export function issuedToday(now) {
  return new Date(typeof now === "number" ? now : Date.now()).toISOString().slice(0, 10);
}

/*
  Inject the stamp at the front of an already-serialised pack.

  A string splice rather than parse-and-restringify, for one reason that
  matters more than speed: this code must not be able to alter a procedure, a
  limitation or a memory item. It never parses the aviation content, so it
  cannot corrupt it. If the body is not a JSON object it is returned
  untouched rather than guessed at.
*/
export function stampPack(raw, watermark, issued) {
  const text = typeof raw === "string" ? raw : null;
  if (!text || !watermark) return raw;
  const start = text.indexOf("{");
  if (start === -1) return raw;
  if (text.slice(0, start).trim() !== "") return raw;

  const stamp = JSON.stringify({ id: watermark, d: issued || issuedToday(), v: WATERMARK_VERSION });
  const rest = text.slice(start + 1);
  /* An empty object has no following field, so no comma. */
  const separator = rest.trim().startsWith("}") ? "" : ",";
  return "{" + JSON.stringify(WATERMARK_FIELD) + ":" + stamp + separator + rest;
}

/* Read a stamp back out of a file someone has handed you. */
export function readStamp(text) {
  try {
    const parsed = JSON.parse(typeof text === "string" ? text : JSON.stringify(text));
    const stamp = parsed && parsed[WATERMARK_FIELD];
    if (!stamp || typeof stamp.id !== "string") return null;
    return { id: stamp.id, issued: stamp.d || null, version: Number(stamp.v) || null };
  } catch (error) { return null; }
}
