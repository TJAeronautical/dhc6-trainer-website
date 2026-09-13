/*
  DHC-6 Trainer site service worker.

  Caches ONLY public marketing/account pages and their static assets.
  Protected material is never stored here:
    - /app/ (subscriber app shell) and /live.html are served with
      Cache-Control: private, no-store by the Worker and are bypassed below.
    - /api/ responses (sessions, licence data, training content) are bypassed.
  Pages can post {type:"clear-protected"} to drop any cached copies (logout,
  entitlement expiry) and {type:"clear-all"} to wipe every site cache.
*/
const CACHE_NAME = "dhc6-trainer-site-v6";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/mobile.html",
  "/desktop.html",
  "/web-app.html",
  "/access.html",
  "/terms.html",
  "/refund.html",
  "/privacy.html",
  "/account-deletion.html",
  "/changelog.html",
  "/404.html",
  "/assets/site-redesign.css",
  "/assets/js/site.js",
  "/assets/js/desktop-launch.js",
  "/assets/js/web-app-login.js",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
  "/assets/actual-android-app.jpeg"
];

function isProtectedRequest(url) {
  const path = url.pathname;
  if (path.startsWith("/api/") || path === "/api") return true;
  if (path === "/app" || path.startsWith("/app/")) return true;
  if (path === "/live" || path === "/live.html") return true;
  return false;
}

async function clearProtectedEntries() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(keys.map(function (request) {
    const url = new URL(request.url);
    return isProtectedRequest(url) ? cache.delete(request) : Promise.resolve(false);
  }));
}

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(CORE_ASSETS);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); }));
  }).then(clearProtectedEntries).then(function () { return self.clients.claim(); }));
});

self.addEventListener("message", function (event) {
  const data = event.data || {};
  if (data.type === "clear-protected") {
    event.waitUntil(clearProtectedEntries());
  } else if (data.type === "clear-all") {
    event.waitUntil(caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
    }));
  }
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || isProtectedRequest(url)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(function (response) {
      if (response && response.ok && !isProtectedRequest(new URL(response.url || request.url))) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request).then(function (cached) { return cached || caches.match("/index.html"); });
    }));
    return;
  }

  event.respondWith(caches.match(request).then(function (cached) {
    const network = fetch(request).then(function (response) {
      if (response && response.ok) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () { return cached; });
    return cached || network;
  }));
});
