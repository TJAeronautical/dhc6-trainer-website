/*
  Protected media API (subscriber or owner session required).

    GET|HEAD /api/media/index          -> published media index (or published:false)
    GET|HEAD /api/media/<path>         -> one object (Range and If-None-Match supported)

  Responses are `Cache-Control: private, no-store`: the browser HTTP cache and
  the site service worker never retain protected media. The app shell keeps
  its own Cache API copy keyed by ETag and clears it on sign-out / lapse.
*/

import { json, STORED_FILE_CSP } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { getMedia, headMedia, normalizeMediaPath, parseRange, readMediaIndex } from "./_store.js";

const PROTECTED_HEADERS = {
  "Cache-Control": "private, no-store",
  "Vary": "Cookie, Authorization, Range",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  /* The media store holds build-produced assets rather than uploads, so there is
     no injection path into it today. It serves image/svg+xml all the same, and a
     store that can return an executable document should not rely on who happens
     to fill it. Same header as the Library: see STORED_FILE_CSP. */
  "Content-Security-Policy": STORED_FILE_CSP,
  "Accept-Ranges": "bytes"
};

function protectedJson(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, PROTECTED_HEADERS)
  });
}

function mediaHeaders(meta, extra) {
  const headers = new Headers(PROTECTED_HEADERS);
  headers.set("Content-Type", meta.contentType);
  if (meta.etag) headers.set("ETag", meta.etag);
  headers.set("X-Media-Store", meta.store);
  if (extra) Object.keys(extra).forEach(function (key) { headers.set(key, extra[key]); });
  return headers;
}

export async function onRequestGet(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const request = context.request;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const rawPath = url.pathname.replace(/^\/api\/media\/?/, "").replace(/\/+$/, "");

  if (rawPath === "index" || rawPath === "") {
    const index = await readMediaIndex(context.env);
    if (!index) return protectedJson({ ok: true, published: false, items: [], version: null });
    return protectedJson(Object.assign({ ok: true, published: true }, index));
  }

  let path;
  try {
    path = normalizeMediaPath(decodeURIComponent(rawPath));
  } catch (error) {
    path = null;
  }
  if (!path) return json({ ok: false, error: "bad_media_path" }, 400);

  const head = await headMedia(context.env, path);
  if (!head) return json({ ok: false, error: "media_not_found" }, 404);

  const ifNoneMatch = request.headers.get("If-None-Match");
  if (ifNoneMatch && head.etag && ifNoneMatch.split(",").map(function (v) { return v.trim(); }).indexOf(head.etag) >= 0) {
    return new Response(null, { status: 304, headers: mediaHeaders(head) });
  }

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: mediaHeaders(head, { "Content-Length": String(head.size) }) });
  }

  const range = parseRange(request.headers.get("Range"), head.size);
  if (range && range.unsatisfiable) {
    return new Response(null, { status: 416, headers: mediaHeaders(head, { "Content-Range": "bytes */" + head.size }) });
  }

  const media = await getMedia(context.env, path, range);
  if (!media) return json({ ok: false, error: "media_not_found" }, 404);

  const extra = {};
  if (media.range) {
    extra["Content-Range"] = "bytes " + media.range.offset + "-" + media.range.end + "/" + media.size;
    extra["Content-Length"] = String(media.range.length);
  } else {
    extra["Content-Length"] = String(media.size);
  }
  return new Response(media.body, { status: media.status, headers: mediaHeaders(media, extra) });
}

export const onRequestHead = onRequestGet;
