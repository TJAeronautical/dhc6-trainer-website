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
const CACHE_NAME = "dhc6-trainer-site-v7";

/*
  The app shell, kept apart from the public site cache so it can be dropped on
  its own at sign-out.

  DHC-6 crews fly to strips with no signal, so the app has to open on the ramp.
  Only code goes in here - the shell HTML, app.js, app.css, the gate - and
  /app/js/* is already served as public static code by the Worker, so nothing
  secret reaches disk. Training data stays in IndexedDB and licence state stays
  in the HttpOnly cookie, both untouched by this.

  Nothing populates it on its own: the gate posts "cache-app-shell" only after
  a verify has succeeded, so an unauthenticated visitor never builds one.
*/
const APP_SHELL_CACHE = "dhc6-app-shell-v1";
const SHELL_DOCUMENT = "/app/";
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
  "/assets/app-icon-512.png"
];
/* Screenshots are deliberately NOT precached: they are large, the hero is
   already <link rel=preload>ed for first paint, and the runtime
   stale-while-revalidate below caches them on first visit anyway. */

function isProtectedRequest(url) {
  const path = url.pathname;
  if (path.startsWith("/api/") || path === "/api") return true;
  if (path === "/app" || path.startsWith("/app/")) return true;
  if (path === "/live" || path === "/live.html") return true;
  return false;
}

/* The API is never cached, by anyone, for any reason. The app shell is, but
   only into APP_SHELL_CACHE and only on request. */
function isApiRequest(url) {
  return url.pathname.startsWith("/api/") || url.pathname === "/api";
}

function isShellRequest(url) {
  return url.pathname === "/app" || url.pathname.startsWith("/app/");
}

async function clearProtectedEntries() {
  const cache = await caches.open(CACHE_NAME);
  const keys = await cache.keys();
  await Promise.all(keys.map(function (request) {
    const url = new URL(request.url);
    return isProtectedRequest(url) ? cache.delete(request) : Promise.resolve(false);
  }));
  /* Sign-out removes the offline shell as well: the next person on this device
     gets the sign-in page from the network, not a cached app. */
  await caches.delete(APP_SHELL_CACHE);
}

async function cacheAppShell(urls) {
  const cache = await caches.open(APP_SHELL_CACHE);
  await Promise.all((urls || []).map(async function (url) {
    try {
      /* `credentials: "same-origin"` matters: /app/ is session-gated, and
         without the cookie the Worker answers with a redirect to sign-in,
         which is what we would then serve offline. */
      const response = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
      if (response && response.ok && response.type !== "opaqueredirect") await cache.put(url, response.clone());
    } catch (error) { /* one missing file must not fail the rest */ }
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
  if (data.type === "cache-app-shell") {
    event.waitUntil(cacheAppShell(data.urls));
  } else if (data.type === "clear-protected") {
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
  if (url.origin !== self.location.origin) return;

  /* Sessions, licence checks, training packs, media, library documents: always
     straight to the network, never stored here. */
  if (isApiRequest(url)) return;

  /*
    The app shell: network first, so a deploy lands immediately and the session
    cookie is still checked on every online load. The cache is only consulted
    when the network is genuinely unreachable - which is the whole point.

    Any /app/ deep link falls back to the one shell document, because the
    router resolves the path from the hash once it boots, exactly as the Worker
    does online.
  */
  if (isShellRequest(url)) {
    event.respondWith(fetch(request).catch(function () {
      return caches.open(APP_SHELL_CACHE).then(function (cache) {
        return cache.match(request).then(function (hit) {
          if (hit) return hit;
          if (request.mode === "navigate") return cache.match(SHELL_DOCUMENT);
          return undefined;
        }).then(function (response) {
          return response || Response.error();
        });
      });
    }));
    return;
  }

  if (isProtectedRequest(url)) return;

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
