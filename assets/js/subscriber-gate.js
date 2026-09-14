(function () {
  "use strict";

  /*
    Client-side companion to the server-side gate in worker.js.
    The Worker already refuses to serve this page without a valid session
    cookie; this script re-validates when the page opens, when it regains
    focus, and every 5 minutes, and signs the user out cleanly when the
    entitlement lapses. Exposed as window.DHC6Session for the app shell.
  */
  const HINT_KEY = "dhc6WebSessionHint";
  const REVALIDATE_MS = 5 * 60 * 1000;
  let current = null;
  let timer = null;

  function signInUrl(reason) {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return "/web-app.html?status=" + encodeURIComponent(reason || "signin-required") + "&next=" + encodeURIComponent(next);
  }

  async function clearProtectedCaches() {
    try {
      if ("caches" in window) {
        const keys = await window.caches.keys();
        await Promise.all(keys.map(async function (key) {
          const cache = await window.caches.open(key);
          const requests = await cache.keys();
          await Promise.all(requests.map(function (request) {
            const url = new URL(request.url);
            const protectedPath = url.pathname.startsWith("/api/") || url.pathname === "/app" || url.pathname.startsWith("/app/") || url.pathname === "/live.html" || url.pathname === "/live";
            return protectedPath ? cache.delete(request) : Promise.resolve(false);
          }));
        }));
      }
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "clear-protected" });
      }
      if ("indexedDB" in window && window.indexedDB.deleteDatabase) {
        window.indexedDB.deleteDatabase("dhc6-protected-content");
      }
      try { window.localStorage.removeItem(HINT_KEY); } catch (error) { /* ignore */ }
      clearAccountProgress();
    } catch (error) { /* best effort */ }
  }

  /*
    The app's own state lives in localStorage, and the training data in it now
    belongs to a signed-in account: logbook entries sync to /api/logbook and the
    readiness dashboard is computed from them. Leaving that behind on sign-out
    would show one subscriber the previous subscriber's attempts on a shared
    machine, and the next sync would merge them into that account for good.

    Only the per-account data is removed. Display preferences — variant, theme,
    sound — are this browser's, not the account's, and are left alone.
  */
  var APP_STATE_KEY = "dhc6.app.v1";
  var ACCOUNT_KEYS = ["logbook", "attempts", "recent", "srsRecords", "checklistProgress", "flashcardStats", "cockpitResume", "pinnedProcedures", "favorites"];
  function clearAccountProgress() {
    try {
      var raw = window.localStorage.getItem(APP_STATE_KEY);
      if (!raw) return;
      var state = JSON.parse(raw);
      if (!state || typeof state !== "object") return;
      ACCOUNT_KEYS.forEach(function (key) { delete state[key]; });
      window.localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    } catch (error) { /* ignore */ }
  }

  async function verify() {
    const response = await fetch("/api/web-access/verify", { cache: "no-store", credentials: "same-origin" });
    let data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    if (!response.ok || !data.ok) {
      const error = new Error(data.error || "session_invalid");
      error.status = response.status;
      throw error;
    }
    current = data;
    try { window.localStorage.setItem(HINT_KEY, JSON.stringify({ role: data.role, plan: data.plan, expiresAt: data.expiresAt })); } catch (error) { /* ignore */ }
    document.body.classList.remove("subscriber-locked");
    document.body.classList.add("subscriber-authorized");
    document.dispatchEvent(new CustomEvent("dhc6:session", { detail: data }));
    return data;
  }

  async function signOut(reason) {
    if (timer) window.clearInterval(timer);
    try {
      await fetch("/api/web-access/logout", { method: "POST", credentials: "same-origin", cache: "no-store" });
    } catch (error) { /* offline: still clear local state */ }
    await clearProtectedCaches();
    window.location.replace(reason ? signInUrl(reason) : "/web-app.html?status=signed-out");
  }

  async function lockOut(error) {
    if (timer) window.clearInterval(timer);
    await clearProtectedCaches();
    const reason = error && (error.message === "subscription_inactive" || error.message === "owner_access_revoked") ? "subscription-inactive" : "signin-required";
    window.location.replace(signInUrl(reason));
  }

  function revalidate() {
    if (!navigator.onLine) return;
    verify().catch(function (error) {
      // Network failures keep the current session; only an explicit
      // 401/403 from the API ends it.
      if (error && (error.status === 401 || error.status === 403)) lockOut(error);
    });
  }

  window.DHC6Session = {
    get: function () { return current; },
    verify: verify,
    signOut: signOut,
    clearProtectedCaches: clearProtectedCaches
  };

  verify().then(function () {
    timer = window.setInterval(revalidate, REVALIDATE_MS);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) revalidate(); });
  }).catch(function (error) {
    if (error && error.status && error.status !== 401 && error.status !== 403) {
      // Service unavailable or offline on first load: the Worker already
      // validated the cookie to serve this page, so keep it visible.
      document.body.classList.remove("subscriber-locked");
      document.body.classList.add("subscriber-authorized");
      document.dispatchEvent(new CustomEvent("dhc6:session", { detail: { ok: false, offline: true } }));
      return;
    }
    lockOut(error);
  });
})();
