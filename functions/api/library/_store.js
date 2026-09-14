/*
  Library document store.

  The Android Library is not a bundled content pack — there are no documents in
  core-res/src/main/assets. SourcesScreen lists what the user imported on the
  device (SourceDocumentEntity in Room, populated by PdfImportScreen), and
  PublishedContentScreen lists what has been promoted to runtime-ready content.
  So the web Library is a document store, not a port of authored data: it holds
  what an account uploads, plus a shelf the owner publishes to everyone.

  R2 (binding WEB_LIBRARY, bucket dhc6-web-content):

    library/private/<accountId>/<docId>     the file, for that account alone
    library/published/<docId>               the file, readable by any subscriber

  KV (namespace LICENSES, alongside the licence, content and logbook data):

    library:private:<accountId>   { updatedAt, items: [DocumentRecord, …] }
    library:published             { updatedAt, items: [DocumentRecord, …] }

  The catalogue lives in KV rather than being derived from an R2 list because a
  record carries metadata R2 keys cannot (title, doc type, uploader, page count)
  and because listing a bucket per request is slower and harder to cap.

  `accountId` is the SHA-256 seed the QRH edit store already uses, so an account
  has one id across QRH edits, the logbook and the Library, and neither the
  licence key nor the owner address ever appears in a key or an object path.

  Binding names: the bucket is called dhc6-web-content but the binding is
  WEB_LIBRARY. WEB_CONTENT is already claimed as an optional KV namespace by the
  content and media stores — see wrangler.jsonc.
*/

import { accountIdFor } from "../qrh-edits/_store.js";

export { accountIdFor };

export const LIBRARY_KV_PREFIX = "library:";
export const PRIVATE_R2_PREFIX = "library/private/";
export const PUBLISHED_R2_PREFIX = "library/published/";

/* SourceDocType.kt — the Android document kinds, plus OTHER for anything else. */
export const DOC_TYPES = ["MANUAL", "QRH", "CHECKLIST", "MEL", "BULLETIN", "NOTES", "OTHER"];

/* What a browser can actually open. An .exe in a training library is not a
   document, and the store refuses rather than trusting the extension later. */
export const CONTENT_TYPES = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8"
};

export const LIMITS = {
  title: 200,
  note: 1000,
  fileName: 180,
  docId: 64,
  items: 300,
  /* One document. R2 handles far more, but a training library is documents, and
     an accidental multi-gigabyte upload is a mistake, not a manual. */
  bytes: 64 * 1024 * 1024,
  totalBytesPerAccount: 512 * 1024 * 1024
};

export const DOC_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

function str(v) { return v == null ? "" : String(v); }
function clip(v, max) { return str(v).trim().slice(0, max); }

export function bucket(env) { return (env && env.WEB_LIBRARY) || null; }
export function kv(env) { return (env && env.LICENSES) || null; }

export function extensionOf(name) {
  const s = str(name);
  const dot = s.lastIndexOf(".");
  return dot === -1 ? "" : s.slice(dot + 1).toLowerCase();
}

export function contentTypeFor(name) {
  return CONTENT_TYPES[extensionOf(name)] || null;
}

/* A document id is ours, never the client's file name: a name can contain
   anything, and it is shown as a label rather than used as a key. */
export function makeDocId(randomBytes) {
  const bytes = randomBytes || crypto.getRandomValues(new Uint8Array(12));
  let hex = "";
  for (let i = 0; i < bytes.length; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return "d" + hex;
}

export function normalizeDocId(raw) {
  const id = str(raw).trim().toLowerCase();
  if (!id || id.length > LIMITS.docId) return null;
  if (!DOC_ID_PATTERN.test(id)) return null;
  return id;
}

/* Rebuilt from a whitelist, like every other record this app stores. */
export function sanitizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = normalizeDocId(raw.docId);
  const fileName = clip(raw.fileName, LIMITS.fileName);
  const contentType = contentTypeFor(fileName);
  if (!id || !fileName || !contentType) return null;
  const bytes = Number(raw.bytes);
  const docType = DOC_TYPES.indexOf(clip(raw.docType, 40).toUpperCase()) > -1
    ? clip(raw.docType, 40).toUpperCase()
    : "OTHER";
  return {
    docId: id,
    title: clip(raw.title, LIMITS.title) || fileName,
    fileName: fileName,
    contentType: contentType,
    docType: docType,
    note: clip(raw.note, LIMITS.note),
    bytes: Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : 0,
    uploadedAt: typeof raw.uploadedAt === "string" ? raw.uploadedAt : new Date().toISOString(),
    /* Who put it on the shared shelf. Never an email — a display label only. */
    publishedBy: clip(raw.publishedBy, 80) || null
  };
}

export function sanitizeRecords(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length && out.length < LIMITS.items; i += 1) {
    const record = sanitizeRecord(list[i]);
    if (record && !seen.has(record.docId)) { seen.add(record.docId); out.push(record); }
  }
  return out;
}

function privateKey(accountId) { return LIBRARY_KV_PREFIX + "private:" + accountId; }
const PUBLISHED_KEY = LIBRARY_KV_PREFIX + "published";

async function readIndexAt(env, key) {
  const store = kv(env);
  if (!store) return { updatedAt: null, items: [] };
  let raw;
  try { raw = await store.get(key); } catch (error) { return { updatedAt: null, items: [] }; }
  if (!raw) return { updatedAt: null, items: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { return { updatedAt: null, items: [] }; }
  return {
    updatedAt: parsed && typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    items: sanitizeRecords(parsed && parsed.items)
  };
}

async function writeIndexAt(env, key, items) {
  const store = kv(env);
  if (!store) return null;
  const updatedAt = new Date().toISOString();
  await store.put(key, JSON.stringify({ updatedAt: updatedAt, items: items }));
  return updatedAt;
}

export function readPrivateIndex(env, accountId) { return readIndexAt(env, privateKey(accountId)); }
export function readPublishedIndex(env) { return readIndexAt(env, PUBLISHED_KEY); }
export function writePrivateIndex(env, accountId, items) { return writeIndexAt(env, privateKey(accountId), items); }
export function writePublishedIndex(env, items) { return writeIndexAt(env, PUBLISHED_KEY, items); }

export function objectKeyFor(shelf, accountId, docId) {
  return shelf === "published"
    ? PUBLISHED_R2_PREFIX + docId
    : PRIVATE_R2_PREFIX + accountId + "/" + docId;
}

export function usedBytes(items) {
  return (items || []).reduce(function (total, item) { return total + (item ? Number(item.bytes) || 0 : 0); }, 0);
}

/*
  Android AccessPolicy: publishing to the shared shelf is an authoring action.
  Reading it is not — any active subscriber sees what the owner published, the
  same way they see the published training packs.
*/
export function canPublish(auth) {
  if (!auth || !auth.ok) return false;
  if (auth.role === "owner") return true;
  const plan = str(auth.plan).toLowerCase();
  return plan.indexOf("instructor") === 0 || plan.indexOf("enterprise") === 0;
}

/* Single-range `Range: bytes=a-b`, as the media store parses it. */
export function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (!suffix) return { unsatisfiable: true };
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { unsatisfiable: true };
  return { offset: start, length: Math.min(end, size - 1) - start + 1, end: Math.min(end, size - 1) };
}
