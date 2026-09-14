import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as media } from "../functions/api/media/index.js";
import { normalizeMediaPath, parseRange, MEDIA_R2_PREFIX, MEDIA_KV_PREFIX } from "../functions/api/media/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE, revokeWebSession, verifyWebSession } from "../functions/api/web-access/_session.js";
import worker from "../worker.js";
import { hmacHex } from "../functions/api/_shared.js";
import { activeLicense, envWithLicense, memoryR2 } from "./helpers.mjs";

const SECRET = "test-signing-secret";
const ORIGIN = "https://dhc6trainer.com";

async function subscriberCookie(record) {
  const session = await createWebSession(SECRET, record || activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

function bytes(n, seed) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + (seed || 0)) & 0xff;
  return out;
}

async function forgeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return encoded + "." + await hmacHex(SECRET, encoded);
}

function get(path, headers, method) {
  return new Request(ORIGIN + path, { method: method || "GET", headers: headers || {} });
}

/* --------------------------------------------------------------- helpers */
test("media path validation rejects traversal, unknown types and odd characters", () => {
  assert.equal(normalizeMediaPath("models/systems-lab/PT6A27_ENGINE_REPLICA.glb"), "models/systems-lab/PT6A27_ENGINE_REPLICA.glb");
  assert.equal(normalizeMediaPath("/systems/posters/fuel.png"), "systems/posters/fuel.png");
  assert.equal(normalizeMediaPath("../secrets.json"), null);
  assert.equal(normalizeMediaPath("models/../../x.glb"), null);
  assert.equal(normalizeMediaPath("models//x.glb"), null);
  assert.equal(normalizeMediaPath("models/x.exe"), null);
  assert.equal(normalizeMediaPath("models/x"), null);
  assert.equal(normalizeMediaPath("models/a b.glb"), null);
  assert.equal(normalizeMediaPath("x".repeat(210) + ".glb"), null);
});

test("range parsing covers open, closed, suffix and unsatisfiable ranges", () => {
  assert.equal(parseRange(null, 100), null);
  assert.deepEqual(parseRange("bytes=0-9", 100), { offset: 0, end: 9, length: 10 });
  assert.deepEqual(parseRange("bytes=90-", 100), { offset: 90, end: 99, length: 10 });
  assert.deepEqual(parseRange("bytes=-5", 100), { offset: 95, end: 99, length: 5 });
  assert.deepEqual(parseRange("bytes=0-500", 100), { offset: 0, end: 99, length: 100 });
  assert.deepEqual(parseRange("bytes=100-", 100), { unsatisfiable: true });
  assert.deepEqual(parseRange("bytes=5-2", 100), { unsatisfiable: true });
  assert.equal(parseRange("items=0-1", 100), null);
});

/* ------------------------------------------------------------ authorisation */
test("media refuses anonymous, malformed, expired, revoked and lapsed sessions", async () => {
  const env = envWithLicense();
  env.WEB_MEDIA = memoryR2({ [MEDIA_R2_PREFIX + "models/test.glb"]: bytes(64) });

  const anon = await media({ request: get("/api/media/models/test.glb"), env });
  assert.equal(anon.status, 401);
  assert.equal(anon.headers.get("Cache-Control"), "no-store");

  const malformed = await media({ request: get("/api/media/models/test.glb", { Cookie: SESSION_COOKIE + "=not.a.token" }), env });
  assert.equal(malformed.status, 401);

  const now = Math.floor(Date.now() / 1000);
  const expiredToken = await forgeToken({ v: 2, sid: "expired-sid", role: "subscriber", key: "DHC6-ABCD-EFGH-JKLM", email: "pilot@example.com", plan: "premium_annual", iat: now - 100000, exp: now - 1 });
  const expired = await media({ request: get("/api/media/models/test.glb", { Cookie: SESSION_COOKIE + "=" + expiredToken }), env });
  assert.equal(expired.status, 401);

  const session = await createWebSession(SECRET, activeLicense());
  const payload = await verifyWebSession(SECRET, session.token);
  await revokeWebSession(env, payload);
  const revoked = await media({ request: get("/api/media/models/test.glb", { Cookie: SESSION_COOKIE + "=" + session.token }), env });
  assert.equal(revoked.status, 401);

  const lapsedEnv = envWithLicense(activeLicense({ status: "expired" }));
  lapsedEnv.WEB_MEDIA = env.WEB_MEDIA;
  const lapsed = await media({ request: get("/api/media/models/test.glb", { Cookie: await subscriberCookie() }), env: lapsedEnv });
  assert.equal(lapsed.status, 403);

  const index = await media({ request: get("/api/media/index"), env });
  assert.equal(index.status, 401);
});

/* ---------------------------------------------------------------- serving */
test("R2-backed media streams with private no-store headers, ETag, HEAD and byte ranges", async () => {
  const env = envWithLicense();
  const payload = bytes(1000, 3);
  env.WEB_MEDIA = memoryR2({ [MEDIA_R2_PREFIX + "models/systems-lab/FLAP_SYSTEM.glb"]: { bytes: payload, contentType: "model/gltf-binary" } });
  const cookie = await subscriberCookie();

  const full = await media({ request: get("/api/media/models/systems-lab/FLAP_SYSTEM.glb", { Cookie: cookie }), env });
  assert.equal(full.status, 200);
  assert.equal(full.headers.get("Cache-Control"), "private, no-store");
  assert.match(full.headers.get("Vary"), /Cookie/);
  assert.equal(full.headers.get("Content-Type"), "model/gltf-binary");
  assert.equal(full.headers.get("Content-Length"), "1000");
  assert.equal(full.headers.get("Accept-Ranges"), "bytes");
  assert.equal(full.headers.get("X-Media-Store"), "r2");
  const etag = full.headers.get("ETag");
  assert.match(etag, /^".+"$/);
  assert.equal(new Uint8Array(await full.arrayBuffer()).byteLength, 1000);

  const head = await media({ request: get("/api/media/models/systems-lab/FLAP_SYSTEM.glb", { Cookie: cookie }, "HEAD"), env });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Length"), "1000");
  assert.equal(head.headers.get("ETag"), etag);
  assert.equal(head.body, null);

  const notModified = await media({ request: get("/api/media/models/systems-lab/FLAP_SYSTEM.glb", { Cookie: cookie, "If-None-Match": etag }), env });
  assert.equal(notModified.status, 304);

  const partial = await media({ request: get("/api/media/models/systems-lab/FLAP_SYSTEM.glb", { Cookie: cookie, Range: "bytes=10-19" }), env });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("Content-Range"), "bytes 10-19/1000");
  assert.equal(partial.headers.get("Content-Length"), "10");
  const slice = new Uint8Array(await partial.arrayBuffer());
  assert.deepEqual(Array.from(slice), Array.from(payload.slice(10, 20)));

  const bad = await media({ request: get("/api/media/models/systems-lab/FLAP_SYSTEM.glb", { Cookie: cookie, Range: "bytes=5000-" }), env });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("Content-Range"), "bytes */1000");

  const missing = await media({ request: get("/api/media/models/systems-lab/missing.glb", { Cookie: cookie }), env });
  assert.equal(missing.status, 404);
  const traversal = await media({ request: get("/api/media/..%2F..%2Fwrangler.jsonc", { Cookie: cookie }), env });
  assert.equal(traversal.status, 400);
  const badType = await media({ request: get("/api/media/models/worker.js", { Cookie: cookie }), env });
  assert.equal(badType.status, 400);
});

test("KV blobs are served when no R2 bucket is bound, and R2 wins when both exist", async () => {
  const env = envWithLicense();
  const poster = bytes(300, 9);
  await env.LICENSES.put(MEDIA_KV_PREFIX + "blob:systems/posters/fuel.png", poster);
  await env.LICENSES.put(MEDIA_KV_PREFIX + "index", JSON.stringify({ version: "m1", publishedAt: "2026-09-13T00:00:00Z", items: [{ path: "systems/posters/fuel.png", bytes: 300, sha256: "abc123", contentType: "image/png", store: "kv" }] }));
  const cookie = await subscriberCookie();

  const kv = await media({ request: get("/api/media/systems/posters/fuel.png", { Cookie: cookie }), env });
  assert.equal(kv.status, 200);
  assert.equal(kv.headers.get("X-Media-Store"), "kv");
  assert.equal(kv.headers.get("Content-Type"), "image/png");
  assert.equal(kv.headers.get("ETag"), '"abc123"');
  assert.equal(kv.headers.get("Cache-Control"), "private, no-store");
  assert.equal(new Uint8Array(await kv.arrayBuffer()).byteLength, 300);

  const ranged = await media({ request: get("/api/media/systems/posters/fuel.png", { Cookie: cookie, Range: "bytes=-20" }), env });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("Content-Range"), "bytes 280-299/300");
  assert.deepEqual(Array.from(new Uint8Array(await ranged.arrayBuffer())), Array.from(poster.slice(280)));

  const index = await media({ request: get("/api/media/index", { Cookie: cookie }), env });
  const indexBody = await index.json();
  assert.equal(indexBody.published, true);
  assert.equal(indexBody.items.length, 1);
  assert.equal(index.headers.get("Cache-Control"), "private, no-store");

  env.WEB_MEDIA = memoryR2({ [MEDIA_R2_PREFIX + "systems/posters/fuel.png"]: bytes(50, 1) });
  const r2 = await media({ request: get("/api/media/systems/posters/fuel.png", { Cookie: cookie }), env });
  assert.equal(r2.headers.get("X-Media-Store"), "r2");
  assert.equal(r2.headers.get("Content-Length"), "50");
});

test("owners can read media and the index reports unpublished when nothing is stored", async () => {
  const env = envWithLicense();
  env.WEB_MEDIA = memoryR2({ [MEDIA_R2_PREFIX + "models/x.glb"]: bytes(10) });
  const owner = await createOwnerWebSession(SECRET, "owner@example.com");
  const response = await media({ request: get("/api/media/models/x.glb", { Authorization: "Bearer " + owner.token }), env });
  assert.equal(response.status, 200);
  const index = await media({ request: get("/api/media/index", { Authorization: "Bearer " + owner.token }), env });
  /* Asserted field by field rather than as a whole object: this test is about
     an empty store reporting itself honestly, and it should not fail every
     time the index learns to say something new (offlineDownload, and whatever
     comes after it). Those have their own tests. */
  const empty = await index.json();
  assert.equal(empty.ok, true);
  assert.equal(empty.published, false);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.version, null);
});

/* ------------------------------------------------------- cockpit imagery */
test("cockpit plates, atlases and sprite sheets are session-gated like every other protected asset", async () => {
  const env = envWithLicense();
  const plate = bytes(4096, 11);
  const atlas = bytes(2048, 5);
  env.WEB_MEDIA = memoryR2({
    [MEDIA_R2_PREFIX + "cockpit/legacy/plate.webp"]: { bytes: plate, contentType: "image/webp" },
    [MEDIA_R2_PREFIX + "cockpit/legacy/atlas.webp"]: { bytes: atlas, contentType: "image/webp" }
  });

  assert.equal(normalizeMediaPath("cockpit/legacy/plate.webp"), "cockpit/legacy/plate.webp");
  assert.equal(normalizeMediaPath("cockpit/g950/atlas.webp"), "cockpit/g950/atlas.webp");
  assert.equal(normalizeMediaPath("cockpit/../worker.js"), null);

  const anon = await media({ request: get("/api/media/cockpit/legacy/plate.webp"), env });
  assert.equal(anon.status, 401, "the cockpit plate is never public");
  assert.equal(anon.headers.get("Cache-Control"), "no-store");

  const anonAtlas = await worker.fetch(new Request(ORIGIN + "/api/media/cockpit/legacy/atlas.webp"), Object.assign({ ASSETS: { fetch: async () => new Response("asset") } }, env), {});
  assert.equal(anonAtlas.status, 401);

  const cookie = await subscriberCookie();
  const ok = await media({ request: get("/api/media/cockpit/legacy/plate.webp", { Cookie: cookie }), env });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/webp");
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store", "cockpit imagery must never reach a shared cache");
  assert.match(ok.headers.get("Vary"), /Cookie/);
  assert.equal(new Uint8Array(await ok.arrayBuffer()).byteLength, 4096);

  const lapsedEnv = envWithLicense(activeLicense({ status: "canceled" }));
  lapsedEnv.WEB_MEDIA = env.WEB_MEDIA;
  const lapsed = await media({ request: get("/api/media/cockpit/legacy/plate.webp", { Cookie: await subscriberCookie() }), env: lapsedEnv });
  assert.equal(lapsed.status, 403, "a lapsed entitlement loses the cockpit imagery too");
});

test("system reference posters are session-gated and never publicly cacheable", async () => {
  const env = envWithLicense();
  const poster = bytes(6144, 7);
  env.WEB_MEDIA = memoryR2({
    [MEDIA_R2_PREFIX + "systems/posters/electrical_system.webp"]: { bytes: poster, contentType: "image/webp" }
  });

  assert.equal(normalizeMediaPath("systems/posters/electrical_system.webp"), "systems/posters/electrical_system.webp");
  assert.equal(normalizeMediaPath("systems/posters/../../worker.js"), null);
  assert.equal(normalizeMediaPath("systems/posters/electrical_system.kt"), null, "only known media types are served");

  const anon = await media({ request: get("/api/media/systems/posters/electrical_system.webp"), env });
  assert.equal(anon.status, 401, "a reference poster is never public");
  assert.equal(anon.headers.get("Cache-Control"), "no-store");

  const ok = await media({ request: get("/api/media/systems/posters/electrical_system.webp", { Cookie: await subscriberCookie() }), env });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Content-Type"), "image/webp");
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  assert.match(ok.headers.get("Vary"), /Cookie/);
  assert.equal(new Uint8Array(await ok.arrayBuffer()).byteLength, 6144);

  const lapsedEnv = envWithLicense(activeLicense({ status: "canceled" }));
  lapsedEnv.WEB_MEDIA = env.WEB_MEDIA;
  const lapsed = await media({ request: get("/api/media/systems/posters/electrical_system.webp", { Cookie: await subscriberCookie() }), env: lapsedEnv });
  assert.equal(lapsed.status, 403, "a lapsed entitlement loses the reference diagrams too");
});

/* ---------------------------------------------------------------- worker */
test("the Worker routes /api/media through the API middleware with the session gate", async () => {
  const env = envWithLicense();
  env.WEB_MEDIA = memoryR2({ [MEDIA_R2_PREFIX + "models/x.glb"]: bytes(10) });
  env.ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
  const anon = await worker.fetch(new Request(ORIGIN + "/api/media/models/x.glb"), env, {});
  assert.equal(anon.status, 401);
  const ok = await worker.fetch(new Request(ORIGIN + "/api/media/models/x.glb", { headers: { Cookie: await subscriberCookie() } }), env, {});
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Cache-Control"), "private, no-store");
  const head = await worker.fetch(new Request(ORIGIN + "/api/media/models/x.glb", { method: "HEAD", headers: { Cookie: await subscriberCookie() } }), env, {});
  assert.equal(head.status, 200);
  const routes = await (await worker.fetch(new Request(ORIGIN + "/api"), env, {})).json();
  assert.ok(routes.routes.includes("/api/media/:path"));
});
