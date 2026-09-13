import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "sw.js"), "utf8");

function loadServiceWorker() {
  const listeners = {};
  const cacheStore = new Map();
  const cache = {
    async addAll(list) { list.forEach((entry) => cacheStore.set("https://dhc6trainer.com" + entry, "precached")); },
    async keys() { return Array.from(cacheStore.keys()).map((url) => ({ url })); },
    async delete(request) { return cacheStore.delete(request.url); },
    async put(request, response) { cacheStore.set(request.url, response); },
    async match(request) { return cacheStore.get(typeof request === "string" ? "https://dhc6trainer.com" + request : request.url) || undefined; }
  };
  const caches = { async open() { return cache; }, async keys() { return ["dhc6-trainer-site-v6"]; }, async delete() { return true; }, match: cache.match };
  const self = {
    location: { origin: "https://dhc6trainer.com" },
    addEventListener(type, fn) { listeners[type] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} }
  };
  const sandbox = { self, caches, URL, Promise, console, fetch: async () => new Response("net") };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return { listeners, cacheStore, cache };
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
  assert.equal(dispatchFetch("https://dhc6trainer.com/app/", "navigate"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/app/app.js"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/live.html", "navigate"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/content/pack/limitations"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/web-access/verify"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/api/media/models/systems-lab/PT6A27_ENGINE_REPLICA.glb"), false, "3D models never enter the public cache");
  assert.equal(dispatchFetch("https://dhc6trainer.com/app/vendor/three-lab.js"), false, "app code under /app/ is left to the browser cache");
  assert.equal(dispatchFetch("https://evil.example/app/"), false);
  assert.equal(dispatchFetch("https://dhc6trainer.com/index.html", "navigate"), true);
  assert.equal(dispatchFetch("https://dhc6trainer.com/assets/site-redesign.css"), true);

  sw.cacheStore.set("https://dhc6trainer.com/app/", "stale-protected");
  sw.cacheStore.set("https://dhc6trainer.com/api/content/pack/mel", "stale-protected");
  sw.cacheStore.set("https://dhc6trainer.com/api/media/models/systems-lab/FLAP_SYSTEM.glb", "stale-protected");
  sw.cacheStore.set("https://dhc6trainer.com/index.html", "public");
  let done;
  sw.listeners.message({ data: { type: "clear-protected" }, waitUntil(p) { done = p; } });
  await done;
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/app/"), false);
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/api/content/pack/mel"), false);
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/api/media/models/systems-lab/FLAP_SYSTEM.glb"), false);
  assert.equal(sw.cacheStore.has("https://dhc6trainer.com/index.html"), true);
});
