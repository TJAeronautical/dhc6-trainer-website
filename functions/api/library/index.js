/*
  Library API — a signed-in session is required for every call.

    GET    /api/library                     both shelves this account can see
    GET    /api/library/doc/<shelf>/<docId> stream one document (Range supported)
    POST   /api/library/doc                 upload  (body: the file; metadata in headers)
    DELETE /api/library/doc/<shelf>/<docId> remove one document

  Two shelves:
    private   — this account's own uploads. Nobody else can list or fetch them.
    published — the owner's shared shelf. Any active subscriber may read it;
                only owner / instructor / enterprise may write to it, following
                the same AccessPolicy split the QRH editor uses.

  Nothing here is world-readable: every response is `private, no-store` and the
  service worker skips /api entirely, so a document never lands in a cache a
  signed-out visitor could reach.

  When the bucket is not bound the API still answers — the shelves report
  `configured: false` and the screen says the Library is not set up yet, the
  same way /api/media reports an unpublished media store. That keeps the app
  working on a deployment where the binding has not been added.
*/

import { json, STORED_FILE_CSP } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import {
  accountIdFor, bucket, kv, canPublish, contentTypeFor, makeDocId, normalizeDocId,
  sanitizeRecord, readPrivateIndex, readPublishedIndex, writePrivateIndex, writePublishedIndex,
  objectKeyFor, usedBytes, parseRange, DOC_TYPES, LIMITS
} from "./_store.js";

function protectedHeaders(extra) {
  return Object.assign({
    "Cache-Control": "private, no-store",
    "Vary": "Cookie, Authorization",
    "X-Robots-Tag": "noindex, nofollow"
  }, extra || {});
}

function protectedJson(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: protectedHeaders({ "Content-Type": "application/json" })
  });
}

async function authorize(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return { response: json({ ok: false, error: auth.error }, auth.status) };
  return { auth: auth, accountId: await accountIdFor(auth) };
}

/* /api/library/doc/<shelf>/<docId> */
function targetFrom(url) {
  const path = url.pathname.replace(/\/+$/, "");
  const match = path.match(/^\/api\/library\/doc\/(private|published)\/([^/]+)$/);
  if (!match) return null;
  const docId = normalizeDocId(decodeURIComponent(match[2]));
  if (!docId) return null;
  return { shelf: match[1], docId: docId };
}

export async function onRequestGet(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/library") {
    const store = bucket(context.env);
    const [own, published] = await Promise.all([
      readPrivateIndex(context.env, gate.accountId),
      readPublishedIndex(context.env)
    ]);
    return protectedJson({
      ok: true,
      configured: Boolean(store && kv(context.env)),
      canPublish: canPublish(gate.auth),
      docTypes: DOC_TYPES,
      limits: { bytes: LIMITS.bytes, items: LIMITS.items, totalBytes: LIMITS.totalBytesPerAccount },
      privateShelf: { updatedAt: own.updatedAt, items: own.items, usedBytes: usedBytes(own.items) },
      publishedShelf: { updatedAt: published.updatedAt, items: published.items }
    });
  }

  const target = targetFrom(url);
  if (!target) return json({ ok: false, error: "not_found" }, 404);

  const store = bucket(context.env);
  if (!store) return json({ ok: false, error: "library_not_configured" }, 503);

  /* The index is the authority on what this account may fetch. Without this
     check a guessed docId on the private prefix would be a cross-account read. */
  const index = target.shelf === "published"
    ? await readPublishedIndex(context.env)
    : await readPrivateIndex(context.env, gate.accountId);
  const record = index.items.find(function (item) { return item.docId === target.docId; });
  if (!record) return json({ ok: false, error: "not_found" }, 404);

  const key = objectKeyFor(target.shelf, gate.accountId, target.docId);
  const head = await store.head(key);
  if (!head) return json({ ok: false, error: "not_found" }, 404);

  const range = parseRange(context.request.headers.get("Range"), head.size);
  if (range && range.unsatisfiable) {
    return new Response(null, { status: 416, headers: protectedHeaders({ "Content-Range": "bytes */" + head.size }) });
  }

  const disposition = 'inline; filename="' + record.fileName.replace(/["\\]/g, "") + '"';
  const headers = protectedHeaders({
    "Content-Type": record.contentType,
    "Content-Disposition": disposition,
    /* Uploaded by a subscriber, opened in a tab on our own origin. See
       STORED_FILE_CSP: without this an uploaded SVG is executable script. */
    "Content-Security-Policy": STORED_FILE_CSP,
    "X-Content-Type-Options": "nosniff",
    "ETag": head.httpEtag || '"' + head.etag + '"',
    "Accept-Ranges": "bytes"
  });

  if (context.request.method === "HEAD") {
    headers["Content-Length"] = String(head.size);
    return new Response(null, { status: 200, headers: headers });
  }

  const object = await store.get(key, range ? { range: { offset: range.offset, length: range.length } } : undefined);
  if (!object) return json({ ok: false, error: "not_found" }, 404);

  if (range) {
    headers["Content-Range"] = "bytes " + range.offset + "-" + range.end + "/" + head.size;
    headers["Content-Length"] = String(range.length);
    return new Response(object.body, { status: 206, headers: headers });
  }
  headers["Content-Length"] = String(head.size);
  return new Response(object.body, { status: 200, headers: headers });
}

export function onRequestHead(context) { return onRequestGet(context); }

/*
  Upload. The file is the request body and the metadata rides in headers, so a
  large document streams straight into R2 instead of being base64'd through a
  JSON envelope.

    X-Doc-Shelf      private | published
    X-Doc-Filename   the original name, shown as a label
    X-Doc-Title      optional display title
    X-Doc-Type       MANUAL | QRH | CHECKLIST | MEL | BULLETIN | NOTES | OTHER
    X-Doc-Note       optional free text
*/
export async function onRequestPost(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;

  const url = new URL(context.request.url);
  if (url.pathname.replace(/\/+$/, "") !== "/api/library/doc") return json({ ok: false, error: "not_found" }, 404);

  const store = bucket(context.env);
  if (!store || !kv(context.env)) return json({ ok: false, error: "library_not_configured" }, 503);

  const headers = context.request.headers;
  const shelf = String(headers.get("X-Doc-Shelf") || "private").toLowerCase() === "published" ? "published" : "private";
  if (shelf === "published" && !canPublish(gate.auth)) return json({ ok: false, error: "publish_forbidden" }, 403);

  const fileName = String(headers.get("X-Doc-Filename") || "").trim();
  if (!fileName) return json({ ok: false, error: "filename_required" }, 400);
  if (!contentTypeFor(fileName)) return json({ ok: false, error: "unsupported_file_type" }, 415);

  const declared = Number(headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > LIMITS.bytes) return json({ ok: false, error: "file_too_large" }, 413);

  const body = await context.request.arrayBuffer();
  if (!body.byteLength) return json({ ok: false, error: "empty_file" }, 400);
  if (body.byteLength > LIMITS.bytes) return json({ ok: false, error: "file_too_large" }, 413);

  const index = shelf === "published"
    ? await readPublishedIndex(context.env)
    : await readPrivateIndex(context.env, gate.accountId);
  if (index.items.length >= LIMITS.items) return json({ ok: false, error: "library_full" }, 409);
  if (shelf === "private" && usedBytes(index.items) + body.byteLength > LIMITS.totalBytesPerAccount) {
    return json({ ok: false, error: "quota_exceeded" }, 413);
  }

  const record = sanitizeRecord({
    docId: makeDocId(),
    fileName: fileName,
    title: headers.get("X-Doc-Title") || fileName,
    docType: headers.get("X-Doc-Type") || "OTHER",
    note: headers.get("X-Doc-Note") || "",
    bytes: body.byteLength,
    uploadedAt: new Date().toISOString(),
    publishedBy: shelf === "published" ? (gate.auth.role === "owner" ? "Owner" : "Instructor") : null
  });
  if (!record) return json({ ok: false, error: "invalid_document" }, 400);

  const key = objectKeyFor(shelf, gate.accountId, record.docId);
  await store.put(key, body, { httpMetadata: { contentType: record.contentType } });

  const items = [record].concat(index.items);
  const updatedAt = shelf === "published"
    ? await writePublishedIndex(context.env, items)
    : await writePrivateIndex(context.env, gate.accountId, items);

  return protectedJson({ ok: true, shelf: shelf, updatedAt: updatedAt, document: record }, 201);
}

export async function onRequestDelete(context) {
  const gate = await authorize(context);
  if (gate.response) return gate.response;

  const target = targetFrom(new URL(context.request.url));
  if (!target) return json({ ok: false, error: "not_found" }, 404);
  if (target.shelf === "published" && !canPublish(gate.auth)) return json({ ok: false, error: "publish_forbidden" }, 403);

  const store = bucket(context.env);
  if (!store || !kv(context.env)) return json({ ok: false, error: "library_not_configured" }, 503);

  const index = target.shelf === "published"
    ? await readPublishedIndex(context.env)
    : await readPrivateIndex(context.env, gate.accountId);
  const remaining = index.items.filter(function (item) { return item.docId !== target.docId; });
  if (remaining.length === index.items.length) return json({ ok: false, error: "not_found" }, 404);

  /* Index first: if the object delete fails, the document is already
     unreachable rather than listed-but-broken. */
  const updatedAt = target.shelf === "published"
    ? await writePublishedIndex(context.env, remaining)
    : await writePrivateIndex(context.env, gate.accountId, remaining);
  try { await store.delete(objectKeyFor(target.shelf, gate.accountId, target.docId)); } catch (error) { /* orphan, not a leak */ }

  return protectedJson({ ok: true, shelf: target.shelf, updatedAt: updatedAt, removed: target.docId });
}
