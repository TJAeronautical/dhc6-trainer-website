/*
  Protected media store (3D models, system posters, cockpit plates/sprites).

  Binary training media is never committed to this public repository. It is
  published to Cloudflare storage and served only through /api/media/<path>
  after the subscriber/owner session has been verified:

    R2  (binding WEB_MEDIA, bucket dhc6-web-media)   -> object key "webmedia/<path>"
        Required for anything above the KV value limit (25 MiB): the PT6A-27
        engine replica alone is 75 MB.
    KV  (binding WEB_CONTENT or LICENSES)            -> "webmedia:blob:<path>" (raw bytes,
        published with `wrangler kv bulk put --binding LICENSES` and base64:true)
        Fallback for small assets (posters, cockpit sprites) so that no new
        binding is needed to publish them.
    KV  "webmedia:index"                             -> { version, publishedAt, items:[{ path, bytes, sha256, contentType, store }] }

  When both stores hold the same path R2 wins.
*/

export const MEDIA_R2_PREFIX = "webmedia/";
export const MEDIA_KV_PREFIX = "webmedia:";
export const MEDIA_PATH_PATTERN = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/i;
export const MEDIA_MAX_PATH = 200;

export const CONTENT_TYPES = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  bin: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
  json: "application/json",
  pdf: "application/pdf"
};

export function normalizeMediaPath(raw) {
  const path = String(raw || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!path || path.length > MEDIA_MAX_PATH) return null;
  if (!MEDIA_PATH_PATTERN.test(path)) return null;
  if (path.split("/").some(function (segment) { return segment === "." || segment === ".."; })) return null;
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(CONTENT_TYPES, ext)) return null;
  return path;
}

export function contentTypeFor(path) {
  const ext = String(path).slice(String(path).lastIndexOf(".") + 1).toLowerCase();
  return CONTENT_TYPES[ext] || "application/octet-stream";
}

export function mediaBucket(env) {
  return (env && env.WEB_MEDIA) || null;
}

export function mediaKv(env) {
  if (!env) return null;
  return env.WEB_CONTENT || env.LICENSES || null;
}

export async function readMediaIndex(env) {
  const kv = mediaKv(env);
  if (!kv) return null;
  const raw = await kv.get(MEDIA_KV_PREFIX + "index");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/*
  Parse a single-range `Range: bytes=a-b` header against a known size.
  Returns { offset, length, end } or null when absent; { unsatisfiable:true }
  when the range cannot be served.
*/
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
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return { unsatisfiable: true };
  return { offset: start, end: end, length: end - start + 1 };
}

function quoteEtag(value) {
  const v = String(value || "");
  if (!v) return "";
  return v.startsWith('"') ? v : '"' + v + '"';
}

/*
  Look a media object up without reading its body.
  -> { store:"r2"|"kv", size, etag, contentType } | null
*/
export async function headMedia(env, path) {
  const bucket = mediaBucket(env);
  if (bucket) {
    const object = await bucket.head(MEDIA_R2_PREFIX + path);
    if (object) {
      return {
        store: "r2",
        size: object.size,
        etag: quoteEtag(object.httpEtag || object.etag),
        contentType: (object.httpMetadata && object.httpMetadata.contentType) || contentTypeFor(path)
      };
    }
  }
  const kv = mediaKv(env);
  if (kv) {
    const blob = await kv.get(MEDIA_KV_PREFIX + "blob:" + path, "arrayBuffer");
    if (blob) {
      const index = await readMediaIndex(env);
      const item = index && Array.isArray(index.items) ? index.items.find(function (i) { return i.path === path; }) : null;
      return {
        store: "kv",
        size: blob.byteLength,
        etag: quoteEtag(item && item.sha256 ? item.sha256 : "kv-" + blob.byteLength),
        contentType: contentTypeFor(path),
        buffer: blob
      };
    }
  }
  return null;
}

/*
  Read a media object, optionally a byte range.
  -> { store, status: 200|206, size, etag, contentType, body, range } | null
*/
export async function getMedia(env, path, range) {
  const bucket = mediaBucket(env);
  if (bucket) {
    const options = range ? { range: { offset: range.offset, length: range.length } } : undefined;
    const object = await bucket.get(MEDIA_R2_PREFIX + path, options);
    if (object) {
      return {
        store: "r2",
        status: range ? 206 : 200,
        size: object.size,
        etag: quoteEtag(object.httpEtag || object.etag),
        contentType: (object.httpMetadata && object.httpMetadata.contentType) || contentTypeFor(path),
        body: object.body,
        range: range || null
      };
    }
  }
  const head = await headMedia(env, path);
  if (!head || head.store !== "kv") return null;
  const buffer = head.buffer;
  const slice = range ? buffer.slice(range.offset, range.offset + range.length) : buffer;
  return {
    store: "kv",
    status: range ? 206 : 200,
    size: buffer.byteLength,
    etag: head.etag,
    contentType: head.contentType,
    body: slice,
    range: range || null
  };
}
