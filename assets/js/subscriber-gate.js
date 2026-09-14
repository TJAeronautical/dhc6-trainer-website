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

  /*
    Offline access. DHC-6 crews fly to strips with no signal, so the app has to
    open on the ramp with the aircraft in front of them. The server session is
    still 12 hours; this is a separate, longer permission to use content this
    device has ALREADY downloaded while the server cannot be reached.

    The clock resets on every successful verify, so anyone who connects even
    once a month never sees it. It is deliberately not a substitute for the
    session: the moment the server is reachable and says no, that answer wins.
  */
  const OFFLINE_KEY = "dhc6.offlineGrant.v1";
  const OFFLINE_GRACE_DAYS = 30;
  const OFFLINE_GRACE_MS = OFFLINE_GRACE_DAYS * 24 * 60 * 60 * 1000;

  /* The shell the service worker must hold for the app to start with no
     network. Code only - every byte of training data lives in IndexedDB and is
     cleared on sign-out. /app/js/* is already served as public static code, so
     nothing secret is written to disk by caching this list. */
  const APP_SHELL = ["/app/", "/app/app.js", "/app/app.css", "/assets/js/subscriber-gate.js"];

  let current = null;
  let timer = null;
  let offline = null;

  function signInUrl(reason) {
    const next = window.location.pathname + window.location.search + window.location.hash;
    return "/web-app.html?status=" + encodeURIComponent(reason || "signin-required") + "&next=" + encodeURIComponent(next);
  }

  /*
    Every step is guarded on its own, and that is the whole point.

    These used to share one try/catch, so the FIRST thing to throw skipped
    everything after it - and the Cache API is exactly the thing that throws
    (private windows, blocked site data, storage pressure). The last step is
    clearAccountProgress, so a browser that refuses to open a cache used to
    leave one subscriber's logbook and SRS records on a shared machine for the
    next person to sign in. Sign-out has to clear what it can, not stop at the
    first thing it cannot.
  */
  async function step(run) {
    try { await run(); } catch (error) { /* keep going: the next step still matters */ }
  }

  async function clearProtectedCaches() {
    await step(async function () {
      if (!("caches" in window) || !window.caches) return;
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
    });
    await step(async function () {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: "clear-protected" });
      }
    });
    await step(async function () {
      if ("indexedDB" in window && window.indexedDB && window.indexedDB.deleteDatabase) {
        window.indexedDB.deleteDatabase("dhc6-protected-content");
      }
    });
    await step(async function () { window.localStorage.removeItem(HINT_KEY); });
    await step(async function () { window.localStorage.removeItem(OFFLINE_KEY); });
    await step(async function () { clearAccountProgress(); });
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

  function readGrant() {
    try {
      const raw = window.localStorage.getItem(OFFLINE_KEY);
      if (!raw) return null;
      const grant = JSON.parse(raw);
      if (!grant || typeof grant !== "object") return null;
      if (typeof grant.until !== "number" || !isFinite(grant.until)) return null;
      return grant;
    } catch (error) { return null; }
  }

  /*
    Renew the offline window, and notice if a different person has signed in on
    this device. Clearing on an account CHANGE rather than on every lock-out is
    what lets an expired session keep unsynced drills safe: they belong to this
    account and will still sync once it signs back in.
  */
  function grantOffline(email) {
    const previous = readGrant();
    if (previous && previous.email && email && previous.email !== email) clearAccountProgress();
    try {
      window.localStorage.setItem(OFFLINE_KEY, JSON.stringify({ email: email || "", until: Date.now() + OFFLINE_GRACE_MS }));
    } catch (error) { /* ignore */ }
  }

  /*
    Make sure a worker exists and then ask it for the offline shell.

    Two things were wrong before. /app/ does not load site.js, so the app shell
    page never registered a worker of its own - it relied entirely on the user
    having passed through a public page. And this posted to
    navigator.serviceWorker.controller, which is null until a worker actually
    controls the page: on the load right after registration it is always null,
    so the message went nowhere and no shell was ever stored. Both failures
    were silent, and the symptom was the marketing site opening offline while
    the app did not.

    serviceWorker.ready resolves to the active registration whether or not it
    is controlling this page yet, so posting to registration.active works on
    the first load as well as later ones.
  */
  async function cacheAppShell() {
    try {
      if (!navigator.serviceWorker) return;
      if (!navigator.serviceWorker.controller) {
        try { await navigator.serviceWorker.register("/sw.js"); } catch (error) { /* already registered, or blocked */ }
      }
      const registration = await navigator.serviceWorker.ready;
      const worker = registration.active || navigator.serviceWorker.controller;
      if (worker) worker.postMessage({ type: "cache-app-shell", urls: APP_SHELL });
    } catch (error) { /* best effort: offline is a bonus, not the session */ }
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
    offline = null;
    try { window.localStorage.setItem(HINT_KEY, JSON.stringify({ role: data.role, plan: data.plan, expiresAt: data.expiresAt })); } catch (error) { /* ignore */ }
    grantOffline(data.email);
    cacheAppShell();
    document.body.classList.remove("subscriber-locked");
    document.body.classList.remove("subscriber-offline");
    document.body.classList.add("subscriber-authorized");
    document.dispatchEvent(new CustomEvent("dhc6:session", { detail: data }));
    return data;
  }

  /* Days left, rounded up, so "1 day left" never means twenty minutes. */
  function daysLeft(until) { return Math.max(0, Math.ceil((until - Date.now()) / (24 * 60 * 60 * 1000))); }

  /*
    The server could not be reached. That is NOT the same as the server saying
    no, and it must never be treated as one: a refusal is authoritative and
    ends the session, an unreachable server is a strip with no signal.
  */
  function showOffline(grant) {
    offline = grant
      ? { until: grant.until, daysLeft: daysLeft(grant.until), email: grant.email || null }
      : { until: null, daysLeft: null, email: null };
    document.body.classList.remove("subscriber-locked");
    document.body.classList.add("subscriber-authorized");
    document.body.classList.add("subscriber-offline");
    document.dispatchEvent(new CustomEvent("dhc6:session", {
      detail: { ok: false, offline: true, offlineUntil: offline.until, daysLeft: offline.daysLeft }
    }));
  }

  /*
    "granted"  a live offline window - run, and say how long is left.
    "expired"  this device was last verified more than the window ago.
    "none"     no window was ever recorded, which means no verify has ever
               succeeded here. The service worker only caches the shell after
               one does, so this page came from the Worker, which checked the
               cookie before serving it. Staying visible is right; sending
               them to a sign-in page they also cannot reach is not.
  */
  function offlineDecision() {
    const grant = readGrant();
    if (!grant) return { state: "none", grant: null };
    if (grant.until <= Date.now()) return { state: "expired", grant: grant };
    return { state: "granted", grant: grant };
  }

  /*
    Out of offline window. Send them to sign in, but do NOT clear: the drills
    they ran on the ramp have not reached the server yet, and destroying them
    here would lose the very work this feature exists to allow. A sign-in by a
    different account clears them instead, in grantOffline above.
  */
  function offlineExpired() {
    if (timer) window.clearInterval(timer);
    window.location.replace(signInUrl("offline-expired"));
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
    offlineState: function () { return offline; },
    verify: verify,
    signOut: signOut,
    clearProtectedCaches: clearProtectedCaches
  };

  function startTimers() {
    timer = window.setInterval(revalidate, REVALIDATE_MS);
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", function () { if (!document.hidden) revalidate(); });
    window.addEventListener("online", revalidate);
  }

  verify().then(startTimers).catch(function (error) {
    /*
      Only 401 and 403 are the server refusing us, and only those end the
      session and clear this device.

      Everything else means we did not get an answer. A fetch that fails
      because there is no network rejects with a TypeError carrying NO status
      at all, which the previous version of this branch did not allow for: it
      fell through to lockOut(), and lockOut() clears account progress. So
      opening the app with no signal did not merely fail, it deleted the
      logbook entries, SRS records and checklist progress that had not synced
      yet - exactly the work a pilot does offline. Hence `!status` here, not
      `status && status !== 401`.
    */
    const status = error && error.status;
    if (status === 401 || status === 403) {
      lockOut(error);
      return;
    }
    const decision = offlineDecision();
    if (decision.state === "expired") {
      offlineExpired();
      return;
    }
    showOffline(decision.grant);
    startTimers();
  });
})();
