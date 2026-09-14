import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "sw.js"), "utf8");

const SITE_CACHE = "dhc6-trainer-site-v7";
const SHELL_CACHE = "dhc6-app-shell-v1";
const abs = (u) => (typeof u === "string" ? (u.startsWith("http") ? u : "https://dhc6trainer.com" + u) : u.url);

/*
  Caches are keyed by NAME here, not merged into one bucket. The app shell now
  lives in its own cache so sign-out can drop it on its own, and a harness that
  cannot tell the two apart cannot test that.
*/
function loadServiceWorker(options) {
  const settings = options || {};
  const listeners = {};
  const stores = new Map();
  const storeFor = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    return stores.get(name);
  };
  const cacheFor = (name) => {
    const store = storeFor(name);
    return {
      async addAll(list) { list.forEach((entry) => store.set(abs(entry), "precached")); },
      async keys() { return Array.from(store.keys()).map((url) => ({ url })); },
      async delete(request) { return store.delete(abs(request)); },
      async put(request, response) { store.set(abs(request), response); },
      async match(request) { return store.get(abs(request)) || undefined; }
    };
  };
  const caches = {
    async open(name) { return cacheFor(name); },
    async keys() { return Array.from(stores.keys()); },
    async delete(name) { return stores.delete(name); },
    async match(request) {
      for (const store of stores.values()) { const hit = store.get(abs(request)); if (hit) return hit; }
      return undefined;
    }
  };
  const self = {
    location: { origin: "https://dhc6trainer.com" },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url: abs(typeof url === "string" ? url : url.url), init: init || {} });
    if (settings.offline) throw new TypeError("Failed to fetch");
    return { ok: true, type: "basic", clone() { return "from-network"; } };
  };
  const sandbox = { self, caches, URL, Promise, console, Response, Request, TypeError, fetch: fetchImpl };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { listeners, stores, storeFor, cacheStore: storeFor(SITE_CACHE), shellStore: storeFor(SHELL_CACHE), fetchCalls };
}

test("service worker precache contains only public assets", () => {
  const entries = Array.from(source.matchAll(/^\s*"(\/[^"]+)"[,]?$/gm), (m) => m[1]);
  for (const entry of entries) {
    assert.doesNotMatch(entry, /^\/app|^\/live|^\/api/, "protected path precached: " + entry);
    assert.doesNotMatch(entry, /latest-design|screenshots\//, "concept image precached: " + entry);
  }
});

test("service worker bypasses protected requests and clears protected entries on demand", async () => {
  const sw = loadServiceWorker();
  const intercepted = [];
  function dispatchFetch(url, mode) {
    let handled = false;
    sw.listeners.fetch({ request: { method: "GET", url, mode: mode || "cors" }, respondWith() { handled = true; } });
    intercepted.push({ url, handled });
    return handled;
  }
  /* The API is the line that must never move: sessions, licence checks,
     training packs, media and library documents are never handled here. */
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/content/pack/limitations"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/web-access/verify"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/media/models/systems-lab/PT6A27_ENGINE_REPLICA.glb"), false, "3D models never enter any cache");
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/media/systems/posters/electrical_system.webp"), false, "system reference posters never enter any cache");
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/library/doc/private/abc"), false, "library documents never enter any cache");

  /* The shell IS handled now - that is what lets the app open on a strip with
     no signal - and /live.html and other origins still are not. */
  assert.equal(dispatchFetch("https://dhc6trainer.com/app/", "navigate"), true);
  assert.equal(dispatchFetch("https://dhc6trainer.com/app/app.js"), true);
  assert.equal(dispatchFetch("https://dhc6trainer.com/live.html", "navigate"), false);
  assert.equal(dispatchFetch("https://evil.example/app/"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/index.html", "navigate"), true);
  assert.equal(dispatchFetch("https://dhc6trainer.com/assets/site-redesign.css"), true);

  sw.cacheStore.set("https://dhc6trainer.com/api/content/pack/mel", "stale-protected");
  sw.cacheStore.set("https://dhc6trainer.com/api/media/models/systems-lab/FLAP_SYSTEM.glb", "stale-protected");
  sw.cacheStore.set("https://dhc6trainer.com/index.html", "public");
  sw.shellStore.set("https://dhc6trainer.com/app/", "shell");
  let done;
  sw.listeners.message({ data: { type: "clear-protected" }, waitUntil(p) { done = p; } });
  await done;
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/api/content/pack/mel"), false);
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/api/media/models/systems-lab/FLAP_SYSTEM.glb"), false);
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/index.html"), true);
  assert.equal(sw.stores.has("dhc6-app-shell-v1"), false, "sign-out drops the offline shell, so the next person gets the sign-in page");
});

test("the offline shell is only ever built on request, never by browsing", async () => {
  const sw = loadServiceWorker();

  /* Passive traffic must not populate it. An unauthenticated visitor who lands
     on /app/ and is redirected to sign-in must not leave a shell behind. */
  sw.listeners.fetch({ request: { method: "GET", url: "https://dhc6trainer.com/app/", mode: "navigate" }, respondWith(p) { return p; } });
  sw.listeners.fetch({ request: { method: "GET", url: "https://dhc6trainer.com/app/app.js", mode: "cors" }, respondWith(p) { return p; } });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sw.storeFor("dhc6-app-shell-v1").size, 0, "browsing alone caches nothing");

  /* The gate posts this only after a verify has succeeded. */
  let done;
  sw.listeners.message({ data: { type: "cache-app-shell", urls: ["/app/", "/app/app.js"] }, waitUntil(p) { done = p; } });
  await done;
  assert.equal(sw.storeFor("dhc6-app-shell-v1").size, 2, "the shell is stored when the app asks for it");

  /* And it asks WITH credentials, or the Worker answers the sign-in redirect
     and that is what would be served offline. */
  const shellFetches = sw.fetchCalls.filter((c) => c.url.includes("/app/") && c.init && c.init.credentials);
  assert.ok(shellFetches.length >= 2, "the shell is fetched with credentials");
  shellFetches.forEach((c) => assert.equal(c.init.credentials, "same-origin"));
});

test("the app opens from cache only when the network is genuinely gone", async () => {
  /* Online: the network answers, so a deploy lands at once and the Worker
     still checks the session cookie on every load. */
  const online = loadServiceWorker();
  online.storeFor("dhc6-app-shell-v1").set("https://dhc6trainer.com/app/", "STALE");
  let served;
  online.listeners.fetch({
    request: { method: "GET", url: "https://dhc6trainer.com/app/", mode: "navigate" },
    respondWith(p) { served = p; }
  });
  const live = await served;
  assert.notEqual(live, "STALE", "a reachable network always wins over the cache");
  assert.equal(live && live.ok, true, "and it is the network response that is served");

  /* Offline: the cached shell is served, and a deep link falls back to the one
     shell document because the router resolves the rest from the hash. */
  const offline = loadServiceWorker({ offline: true });
  offline.storeFor("dhc6-app-shell-v1").set("https://dhc6trainer.com/app/", "SHELL");
  const ask = (url) => new Promise((resolve) => {
    offline.listeners.fetch({
      request: { method: "GET", url: url, mode: "navigate" },
      respondWith(p) { resolve(p); }
    });
  });
  assert.equal(await (await ask("https://dhc6trainer.com/app/")), "SHELL");
  assert.equal(await (await ask("https://dhc6trainer.com/app/qrh/engine-fire")), "SHELL", "a deep link still opens the app offline");

  /* With nothing cached there is nothing to serve, and it must not hang. */
  const empty = loadServiceWorker({ offline: true });
  let bare;
  empty.listeners.fetch({
    request: { method: "GET", url: "https://dhc6trainer.com/app/", mode: "navigate" },
    respondWith(p) { bare = p; }
  });
  const response = await bare;
  assert.ok(response && response.type === "error", "an uncached shell fails cleanly rather than hanging");
});
