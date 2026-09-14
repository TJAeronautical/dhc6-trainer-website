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
  /*
    Android has no licence key: its identity is the Firebase uid that Google
    Play validation wrote entitlements against. Without this branch every
    Android account would seed "license:" - the same empty string for all of
    them - and so share one stamp, which would make a mobile leak attributable
    to nobody while still looking like it worked.
  */
  if (auth && auth.client === "android" && auth.uid) return seedForFirebaseUid(auth.uid);
  return "license:" + String(payload.key || "").trim().toUpperCase();
}

export function seedForLicenseKey(key) {
  return "license:" + String(key || "").trim().toUpperCase();
}

export function seedForFirebaseUid(uid) {
  return "firebase:" + String(uid || "").trim();
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

/* ------------------------------------------------------------------ models */
/*
  The 3D models are the most valuable thing in the library: 20 files, 168 MB,
  against 7 MB of everything else. They cannot be withheld - the Technical Lab
  has to fetch a .glb to display it - so the goal is not prevention but
  attribution: a leaked model should name the account that took it.

  A GLB is a 12-byte header followed by length-prefixed chunks. The glTF spec
  requires readers to ignore chunks whose type they do not recognise, and the
  bundled three.js GLTFLoader does exactly that - its chunk loop handles JSON
  and BIN and steps over everything else with no else branch. So the stamp
  rides in a chunk of its own.

  That is the same property stampPack was built around: this code never reads
  or rewrites the glTF JSON or the binary buffer, so it is structurally
  incapable of altering a model. It appends bytes and corrects one integer.

  Honest about the limit, as with packs: truncating the file to the length in
  its header removes the stamp, and re-exporting through any glTF tool loses
  it. This identifies a careless leak, not a determined one.
*/
export const GLB_MAGIC = 0x46546c67;          /* "glTF", little-endian */
export const GLB_HEADER_BYTES = 12;
export const GLB_CHUNK_JSON = 0x4e4f534a;     /* "JSON" - must not collide */
export const GLB_CHUNK_BIN = 0x004e4942;      /* "BIN\0" - nor this */
export const GLB_CHUNK_STAMP = 0x574a5754;    /* "TWJW" - ours */

function asBytes(input) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  return null;
}

export function isGlb(input) {
  const bytes = asBytes(input);
  if (!bytes || bytes.byteLength < GLB_HEADER_BYTES) return false;
  return new DataView(bytes.buffer, bytes.byteOffset, GLB_HEADER_BYTES).getUint32(0, true) === GLB_MAGIC;
}

/* The chunk, ready to append: [length][type][JSON padded to 4 with spaces]. */
export function modelStampChunk(watermark, issued) {
  if (!watermark) return null;
  const payload = JSON.stringify({ id: watermark, d: issued || issuedToday(), v: WATERMARK_VERSION });
  const text = new TextEncoder().encode(payload);
  const padded = (4 - (text.length % 4)) % 4;
  const chunk = new Uint8Array(8 + text.length + padded);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, text.length + padded, true);
  view.setUint32(4, GLB_CHUNK_STAMP, true);
  chunk.set(text, 8);
  chunk.fill(0x20, 8 + text.length);          /* spaces, as glTF pads JSON */
  return chunk;
}

export function stampModel(input, watermark, issued) {
  const bytes = asBytes(input);
  const chunk = modelStampChunk(watermark, issued);
  if (!bytes || !chunk || !isGlb(bytes)) return input;

  const out = new Uint8Array(bytes.byteLength + chunk.byteLength);
  out.set(bytes, 0);
  out.set(chunk, bytes.byteLength);
  /* The loader reads chunks until the length declared in the header, so the
     stamp is invisible unless that number includes it. */
  const view = new DataView(out.buffer, out.byteOffset, GLB_HEADER_BYTES);
  view.setUint32(8, view.getUint32(8, true) + chunk.byteLength, true);
  return out;
}

/*
  The same edit against a stream, so a 40 MB model never sits in Worker memory.
  Only the first 12 bytes are held back; everything after passes straight
  through and the chunk goes on at the end.
*/
export function stampModelStream(source, watermark, issued) {
  const chunk = modelStampChunk(watermark, issued);
  if (!chunk || !source || typeof source.pipeThrough !== "function") return source;

  let held = new Uint8Array(0);
  let decided = false;
  let stamping = false;

  return source.pipeThrough(new TransformStream({
    transform(piece, controller) {
      if (decided) { controller.enqueue(piece); return; }
      const incoming = asBytes(piece) || new Uint8Array(0);
      const merged = new Uint8Array(held.byteLength + incoming.byteLength);
      merged.set(held, 0);
      merged.set(incoming, held.byteLength);
      if (merged.byteLength < GLB_HEADER_BYTES) { held = merged; return; }

      decided = true;
      held = new Uint8Array(0);
      const view = new DataView(merged.buffer, merged.byteOffset, GLB_HEADER_BYTES);
      if (view.getUint32(0, true) === GLB_MAGIC) {
        stamping = true;
        view.setUint32(8, view.getUint32(8, true) + chunk.byteLength, true);
      }
      controller.enqueue(merged);
    },
    flush(controller) {
      /* Shorter than a header: not a GLB. Pass it on untouched rather than
         damaging whatever it is. */
      if (!decided && held.byteLength) controller.enqueue(held);
      if (stamping) controller.enqueue(chunk);
    }
  }));
}

/* Forensics: given a leaked file, which account was it served to? */
export function readModelStamp(input) {
  const bytes = asBytes(input);
  if (!isGlb(bytes)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = GLB_HEADER_BYTES;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + length > bytes.byteLength) return null;
    if (type === GLB_CHUNK_STAMP) {
      try {
        const text = new TextDecoder().decode(bytes.subarray(start, start + length)).trim();
        const parsed = JSON.parse(text);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch (error) { return null; }
    }
    offset = start + length;
  }
  return null;
}
