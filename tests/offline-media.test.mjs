/*
  Pre-downloading protected imagery for a trip with no coverage.

  The interesting invariants are not "does it fetch" but: it must not pull down
  172 MB of 3D models by accident, it must state the real size before spending
  someone's data, one bad object must not abandon the other forty, and the
  bytes must land in the cache that sign-out ALREADY clears rather than a new
  one nobody remembers to wipe.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MEDIA_CACHE_NAME, isImagery, partitionIndex, totalBytes, formatBytes,
  mediaUrl, readIndex, storedCount, downloadAll, removeAll
} from "../app/js/offlinemedia.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

/* A slice of a real /api/media/index payload: the shape comes from the build. */
const INDEX = [
  { path: "cockpit/legacy/plate.png", bytes: 2_400_000, contentType: "image/png", sha256: "a" },
  { path: "cockpit/legacy/sprites.png", bytes: 900_000, contentType: "image/png", sha256: "b" },
  { path: "systems/posters/electrical_system.webp", bytes: 640_000, contentType: "image/webp", sha256: "c" },
  { path: "models/systems-lab/PT6A27_ENGINE_REPLICA.glb", bytes: 75_108_224, contentType: "model/gltf-binary", sha256: "d" },
  { path: "models/systems-lab/FLAP_SYSTEM.glb", bytes: 41_000_000, contentType: "model/gltf-binary", sha256: "e" }
];

function fakeCaches(seed) {
  const stores = new Map();
  const store = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  (seed || []).forEach((url) => store(MEDIA_CACHE_NAME).set(url, { ok: true, cached: true }));
  globalThis.caches = {
    async open(name) {
      const s = store(name);
      return {
        async match(url) { return s.get(url); },
        async put(url, response) { s.set(url, response); },
        async delete(url) { return s.delete(url); }
      };
    },
    async delete(name) { return stores.delete(name); }
  };
  return stores;
}

function fakeFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    return handler(String(url), init || {});
  };
  return calls;
}

const okResponse = () => ({ ok: true, status: 200, clone() { return { body: "bytes" }; } });

test("3D models are never swept into a download about diagrams", () => {
  const split = partitionIndex(INDEX);
  assert.equal(split.imagery.length, 3);
  assert.equal(split.models.length, 2);
  assert.ok(split.imagery.every((i) => i.contentType.startsWith("image/")));
  assert.ok(!split.imagery.some((i) => i.path.startsWith("models/")), "no model reaches the imagery set");

  /* The size difference is the whole reason for the split. */
  assert.ok(totalBytes(split.models) > 100 * 1024 * 1024);
  assert.ok(totalBytes(split.imagery) < 10 * 1024 * 1024);

  assert.equal(isImagery({ contentType: "image/png" }), true);
  assert.equal(isImagery({ contentType: "model/gltf-binary" }), false);
  assert.equal(isImagery(null), false);
  assert.equal(isImagery({}), false, "an entry with no type is not assumed to be an image");
});

test("the size shown is the real one, and junk in the index cannot distort it", () => {
  assert.equal(totalBytes([{ bytes: 1000 }, { bytes: "500" }]), 1500);
  assert.equal(totalBytes([{ bytes: -5 }, { bytes: NaN }, { bytes: undefined }, null]), 0, "nothing negative or missing is counted");
  assert.equal(totalBytes([]), 0);

  assert.equal(formatBytes(3_940_000), "3.8 MB");
  assert.equal(formatBytes(180_000_000), "172 MB");
  assert.equal(formatBytes(40_000), "39 KB");
  assert.equal(formatBytes(0), "0 MB");
  assert.equal(formatBytes(-1), "0 MB", "never a negative size");
});

test("paths are escaped the same way the media API is addressed elsewhere", () => {
  assert.equal(mediaUrl("cockpit/legacy/plate.png"), "/api/media/cockpit/legacy/plate.png");
  assert.equal(mediaUrl("systems/a b.png"), "/api/media/systems/a%20b.png");
  assert.equal(mediaUrl(""), "/api/media/");
  const src = read("app/js/cockpit.js");
  assert.match(src, /"\/api\/media\/" \+ mediaPath\.split\("\/"\)\.map\(encodeURIComponent\)\.join\("\/"\)/,
    "the same construction as the loader, so a cached entry is the one the cockpit looks up");
});

test("what is already on the device is not downloaded again", async () => {
  fakeCaches(["/api/media/cockpit/legacy/plate.png"]);
  const calls = fakeFetch(async () => okResponse());
  const imagery = partitionIndex(INDEX).imagery;

  const held = await storedCount(imagery);
  assert.equal(held.count, 1);
  assert.equal(held.bytes, 2_400_000, "so the screen can say how much is left to fetch");

  const result = await downloadAll(imagery);
  assert.equal(result.done, 3);
  assert.equal(result.failed, 0);
  assert.equal(calls.length, 2, "the file already held is not fetched a second time");
});

test("one unavailable file does not abandon the rest", async () => {
  fakeCaches([]);
  fakeFetch(async (url) => (url.includes("sprites") ? { ok: false, status: 404 } : okResponse()));

  const progress = [];
  const result = await downloadAll(partitionIndex(INDEX).imagery, { onProgress: (p) => progress.push(p) });
  assert.equal(result.done, 2);
  assert.equal(result.failed, 1);
  assert.equal(progress.length, 3, "progress is reported for every file, including the one that failed");
  assert.equal(progress[progress.length - 1].total, 3);
});

test("a network that dies mid-download keeps what it got", async () => {
  fakeCaches([]);
  let n = 0;
  fakeFetch(async () => {
    n += 1;
    if (n > 1) throw new TypeError("Failed to fetch");
    return okResponse();
  });
  const result = await downloadAll(partitionIndex(INDEX).imagery);
  assert.equal(result.done, 1, "the first file is kept");
  assert.equal(result.failed, 2);
  assert.equal(result.cancelled, false);
});

test("stopping stops, and does not throw away what was already fetched", async () => {
  fakeCaches([]);
  fakeFetch(async () => okResponse());
  let stop = false;
  const result = await downloadAll(partitionIndex(INDEX).imagery, {
    onProgress: () => { stop = true; },
    shouldStop: () => stop
  });
  assert.equal(result.cancelled, true);
  assert.equal(result.done, 1, "the file in flight when Stop was pressed is still on the device");
});

test("losing the session stops the run rather than hammering a closed door", async () => {
  fakeCaches([]);
  const calls = fakeFetch(async () => ({ ok: false, status: 401 }));
  await assert.rejects(
    () => downloadAll(partitionIndex(INDEX).imagery),
    (error) => error.status === 401,
    "the caller is told, so it can hand over to the gate"
  );
  assert.equal(calls.length, 1, "it stops at the first refusal");
});

test("a browser that will not store files says so instead of pretending", async () => {
  globalThis.caches = { async open() { throw new Error("denied"); } };
  fakeFetch(async () => okResponse());
  const result = await downloadAll(partitionIndex(INDEX).imagery);
  assert.equal(result.unavailable, true);
  assert.equal(result.done, 0);

  const held = await storedCount(partitionIndex(INDEX).imagery);
  assert.deepEqual(held, { count: 0, bytes: 0 }, "and counting degrades to zero rather than throwing");
});

test("removing takes the imagery and leaves anything else alone", async () => {
  const stores = fakeCaches([
    "/api/media/cockpit/legacy/plate.png",
    "/api/media/systems/posters/electrical_system.webp",
    "/api/media/models/systems-lab/FLAP_SYSTEM.glb"
  ]);
  const removed = await removeAll(partitionIndex(INDEX).imagery);
  assert.equal(removed, 2);
  const left = stores.get(MEDIA_CACHE_NAME);
  assert.equal(left.has("/api/media/models/systems-lab/FLAP_SYSTEM.glb"), true, "a model someone opened is not collateral damage");
});

test("an unpublished library is reported as nothing to download, not as an error", async () => {
  fakeFetch(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, published: false, items: [] }) }));
  const index = await readIndex();
  assert.equal(index.published, false);
  assert.deepEqual(index.items, []);

  fakeFetch(async () => ({ ok: false, status: 403 }));
  await assert.rejects(() => readIndex(), (e) => e.status === 403);
});

test("the download lands in the cache sign-out already clears", () => {
  /* This is the reason for reusing dhc6-media-v1 rather than inventing a
     cache. subscriber-gate.js deletes every /api/ entry from EVERY cache on
     sign-out, so protected imagery on a shared machine goes without any new
     clearing code - and without a second code path that could drift. */
  assert.equal(MEDIA_CACHE_NAME, "dhc6-media-v1");
  assert.match(read("app/js/cockpit.js"), /MEDIA_CACHE_NAME = "dhc6-media-v1"/,
    "the same cache the cockpit loader reads, so a downloaded plate is actually used");

  const gate = read("assets/js/subscriber-gate.js");
  assert.match(gate, /url\.pathname\.startsWith\("\/api\/"\)/, "sign-out sweeps /api entries from every cache");
  assert.match(gate, /await window\.caches\.keys\(\)/, "including this one, because it enumerates them all");

  /* And it stays out of the service worker: /api is never cached there. */
  const sw = read("sw.js");
  assert.match(sw, /if \(isApiRequest\(url\)\) return;/, "the service worker still never handles /api");
});
