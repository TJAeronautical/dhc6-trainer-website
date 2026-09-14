/*
  Pre-downloading protected imagery for a trip with no coverage.

  The app already caches protected media opportunistically: loadProtectedImage()
  in cockpit.js reads and writes the "dhc6-media-v1" Cache, so anything you have
  looked at is already on the device. That is no use before a rotation, when the
  point is to have it BEFORE you lose signal. This walks /api/media/index and
  fetches the lot into that same cache.

  Deliberately the same cache, not a new one:
    - clearProtectedCaches() in subscriber-gate.js already deletes every entry
      under /api/ from every cache, so sign-out clears this with no new code;
    - clearCockpitImageCache() already drops it on a 401 or 403;
    - and a downloaded plate is then served to the cockpit by the code that
      already exists, rather than by a second path that could drift from it.

  It also stays out of the service worker. /api is never cached there and that
  rule has not moved: this is page code using the Cache API directly, which is
  also what makes progress reporting and cancellation possible.
*/

export const MEDIA_CACHE_NAME = "dhc6-media-v1";

/* 3D models are excluded by content type rather than by path. The Technical Lab
   set is ~172 MB against a handful of MB of imagery, and nobody should pull
   that down by pressing a button labelled "diagrams". */
export function isImagery(item) {
  return Boolean(item && typeof item.contentType === "string" && item.contentType.indexOf("image/") === 0);
}

export function partitionIndex(items) {
  const imagery = [];
  const models = [];
  (items || []).forEach(function (item) {
    if (!item || typeof item.path !== "string" || !item.path) return;
    (isImagery(item) ? imagery : models).push(item);
  });
  return { imagery: imagery, models: models };
}

export function totalBytes(items) {
  return (items || []).reduce(function (sum, item) {
    const bytes = item ? Number(item.bytes) : 0;
    return sum + (isFinite(bytes) && bytes > 0 ? bytes : 0);
  }, 0);
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!isFinite(value) || value <= 0) return "0 MB";
  if (value < 1024 * 1024) return Math.max(1, Math.round(value / 1024)) + " KB";
  const mb = value / (1024 * 1024);
  return (mb >= 100 ? Math.round(mb) : Math.round(mb * 10) / 10) + " MB";
}

export function mediaUrl(path) {
  return "/api/media/" + String(path || "").split("/").map(encodeURIComponent).join("/");
}

export async function readIndex() {
  const response = await fetch("/api/media/index", { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const error = new Error("media_index_" + response.status);
    error.status = response.status;
    throw error;
  }
  const data = await response.json();
  if (!data || data.ok !== true || data.published === false) return { published: false, items: [] };
  return { published: true, items: Array.isArray(data.items) ? data.items : [] };
}

/* How much of a set is already on the device. Counted by asking the cache, so
   it stays right after a partial download or a browser eviction. */
export async function storedCount(items) {
  let cache;
  try { cache = await caches.open(MEDIA_CACHE_NAME); } catch (error) { return { count: 0, bytes: 0 }; }
  let count = 0;
  let bytes = 0;
  for (const item of items || []) {
    try {
      const hit = await cache.match(mediaUrl(item.path));
      if (hit) { count += 1; bytes += Number(item.bytes) || 0; }
    } catch (error) { /* treat as missing */ }
  }
  return { count: count, bytes: bytes };
}

/*
  Fetch everything not already held. Sequential on purpose: a phone on a hotel
  connection does worse with twenty parallel requests than with one at a time,
  and a pilot watching a progress count wants it to move steadily.

  Returns { done, failed, cancelled }. A single failure never aborts the run -
  one missing plate should not cost the other forty.
*/
export async function downloadAll(items, options) {
  const settings = options || {};
  const onProgress = settings.onProgress || function () {};
  const shouldStop = settings.shouldStop || function () { return false; };
  const list = items || [];

  let cache = null;
  try { cache = await caches.open(MEDIA_CACHE_NAME); } catch (error) { cache = null; }
  if (!cache) return { done: 0, failed: list.length, cancelled: false, unavailable: true };

  let done = 0;
  let failed = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (shouldStop()) return { done: done, failed: failed, cancelled: true };
    const item = list[i];
    const url = mediaUrl(item.path);
    try {
      const already = await cache.match(url);
      if (already) { done += 1; onProgress({ done: done, failed: failed, total: list.length }); continue; }
      const response = await fetch(url, { credentials: "same-origin" });
      if (response.status === 401 || response.status === 403) {
        /* The session went away mid-download. Stop rather than hammering a
           closed door, and let the gate handle the sign-out. */
        const error = new Error("session_invalid");
        error.status = response.status;
        throw error;
      }
      if (!response.ok) { failed += 1; onProgress({ done: done, failed: failed, total: list.length }); continue; }
      await cache.put(url, response.clone());
      done += 1;
    } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) throw error;
      failed += 1;   /* offline, quota, one bad object: keep going */
    }
    onProgress({ done: done, failed: failed, total: list.length });
  }
  return { done: done, failed: failed, cancelled: false };
}

/* Remove only the imagery, leaving anything else in the cache alone. */
export async function removeAll(items) {
  let cache;
  try { cache = await caches.open(MEDIA_CACHE_NAME); } catch (error) { return 0; }
  let removed = 0;
  for (const item of items || []) {
    try { if (await cache.delete(mediaUrl(item.path))) removed += 1; } catch (error) { /* ignore */ }
  }
  return removed;
}
