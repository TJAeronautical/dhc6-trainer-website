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
import { watermarkFor, stampModel, stampModelStream } from "../_watermark.js";

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

  /* Whether this account may take the whole imagery library to a device. */
  const paidUp = auth.role === "owner" || !(auth.record && auth.record.trial === true);

  if (rawPath === "index" || rawPath === "") {
    const index = await readMediaIndex(context.env);
    if (!index) return protectedJson({ ok: true, published: false, items: [], version: null, offlineDownload: paidUp });
    return protectedJson(Object.assign({ ok: true, published: true, offlineDownload: paidUp }, index));
  }

  /*
    GET /api/media/offline-manifest -> the list the bulk downloader works from.

    Deliberately a second endpoint rather than a flag on the index. The index
    is what the online app uses to know which posters and models exist, so
    withholding it would break a trial user's diagrams and Technical Lab -
    exactly the things a trial is meant to show off. This endpoint does
    nothing for the running app and everything for taking the library away,
    so it is the one that asks whether the subscription has been paid.

    Honest about what this is: it stops the button, not somebody who writes a
    script against the index they can legitimately read. Making that slow too
    means rate-limiting media reads for trial accounts, which needs a real
    number for how large the published library is - not a guess.
  */
  if (rawPath === "offline-manifest") {
    if (!paidUp) {
      return json({ ok: false, error: "trial_offline_unavailable" }, 403);
    }
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

  /*
    The 3D models are the library's most valuable asset by a wide margin - 20
    files and 168 MB against 7 MB of everything else - and they cannot be
    withheld, because the Technical Lab has to fetch one to show it. So each
    is stamped with the account it was served to, and the fetch is logged.
    Neither prevents a copy; together they make a leak attributable.
  */
  const isModel = /\.glb$/i.test(path);
  const watermark = isModel ? await watermarkFor(context.env, auth) : null;

  /*
    A stamped body is longer than the stored object, so a byte range into it
    would be measured against the wrong length - and honouring the range
    unstamped would hand anyone an unmarked copy for the price of one header.
    Models are served whole. Nothing asks them for ranges: the viewer reads
    the buffer in one go.
  */
  const range = watermark ? null : parseRange(request.headers.get("Range"), head.size);
  if (range && range.unsatisfiable) {
    return new Response(null, { status: 416, headers: mediaHeaders(head, { "Content-Range": "bytes */" + head.size }) });
  }

  const media = await getMedia(context.env, path, range);
  if (!media) return json({ ok: false, error: "media_not_found" }, 404);

  if (watermark) {
    /* The watermark identifies the account without naming it; the owner
       resolves it through /api/owner/watermark. Nothing here logs an address
       or a licence key. */
    console.log("model served: " + path + " to " + watermark);
    const streaming = media.body && typeof media.body.pipeThrough === "function";
    const stamped = streaming ? stampModelStream(media.body, watermark) : stampModel(media.body, watermark);

    /* Say so rather than advertising ranges and then refusing them. A stamped
       body is longer than the stored object, so the offsets a client would
       compute from the index are wrong for it. */
    const extra = { "Accept-Ranges": "none" };
    /* Streaming genuinely does not know the final length until the last
       chunk, and guessing it would be worse than omitting it. */
    if (!streaming) extra["Content-Length"] = String(stamped.byteLength);

    const headers = mediaHeaders(
      Object.assign({}, media, {
        /* The body differs per account, so the ETag must too, or a cache
           could answer one subscriber with another's copy. */
        etag: media.etag ? media.etag.replace(/"$/, "-" + watermark + '"') : media.etag
      }),
      extra
    );
    return new Response(stamped, { status: 200, headers: headers });
  }

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
