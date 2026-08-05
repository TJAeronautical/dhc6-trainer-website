const CACHE_NAME = "dhc6-trainer-site-v2";
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/mobile.html",
  "/desktop.html",
  "/live.html",
  "/access.html",
  "/privacy.html",
  "/account-deletion.html",
  "/changelog.html",
  "/404.html",
  "/assets/site-redesign.css",
  "/assets/js/site.js",
  "/assets/js/desktop-launch.js",
  "/assets/app-icon-192.png",
  "/assets/app-icon-512.png",
  "/assets/latest-design-overview.webp",
  "/assets/latest-design-mcc.webp",
  "/assets/cockpit/legacy-cockpit-base-clean.webp"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(CORE_ASSETS);
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (key) { return key !== CACHE_NAME; }).map(function (key) { return caches.delete(key); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (event) {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(function (response) {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
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
