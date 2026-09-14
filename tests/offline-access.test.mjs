/*
  Offline access for the subscriber gate.

  DHC-6 crews fly to strips with no signal, so the app has to open on the ramp.
  These are behavioural tests, not source scans, because the bug they exist to
  prevent was invisible in the source: the old first-load branch read
  `error.status && error.status !== 401`, and a fetch that fails for lack of a
  network rejects with a TypeError carrying NO status. So opening the app
  offline fell through to lockOut(), which clears account progress - it deleted
  the logbook entries, SRS records and checklist progress that had not synced
  yet. Exactly the work a pilot does offline.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");

const APP_STATE_KEY = "dhc6.app.v1";
const OFFLINE_KEY = "dhc6.offlineGrant.v1";
const DAY = 24 * 60 * 60 * 1000;

/* A logbook entry and an SRS record that have not reached the server yet. */
const unsyncedWork = () => JSON.stringify({
  logbook: [{ attemptId: "a1", procedureName: "ENGINE FIRE" }],
  srsRecords: { u1: { flashcardId: "u1" } },
  variant: "LEGACY",
  theme: "dark"
});

function runGate(options) {
  const settings = options || {};
  const storage = new Map(Object.entries(settings.storage || {}));
  const classes = new Set();
  const events = [];
  const redirects = [];
  const posted = [];
  const listeners = {};

  const localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k)
  };

  const documentMock = {
    body: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
    addEventListener: (t, fn) => { listeners[t] = fn; },
    dispatchEvent: (e) => { events.push(e); return true; },
    hidden: false
  };

  const windowMock = {
    localStorage: localStorage,
    location: { pathname: "/app/", search: "", hash: "#/qrh", replace: (u) => redirects.push(u) },
    setInterval: () => 1,
    clearInterval: () => {},
    addEventListener: () => {},
    indexedDB: { deleteDatabase: () => {} },
    caches: undefined
  };

  const fetchImpl = async (url) => {
    if (String(url).includes("/api/web-access/logout")) return { ok: true, json: async () => ({ ok: true }) };
    if (settings.failure === "network") throw new TypeError("Failed to fetch");
    if (settings.failure === "server") return { ok: false, status: 503, json: async () => ({ ok: false, error: "unavailable" }) };
    if (settings.failure === "refused") return { ok: false, status: 401, json: async () => ({ ok: false, error: "session_invalid" }) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, role: "subscriber", plan: "premium_annual", email: settings.email || "pilot@example.com", expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() })
    };
  };

  const active = { postMessage: (m) => posted.push(m) };
  const state = { registered: false };
  const serviceWorker = {
    /* `controller` is null on the load right after registration, which is the
       case that used to swallow the request silently. */
    controller: Object.prototype.hasOwnProperty.call(settings, "controller") ? settings.controller : active,
    register: async () => { state.registered = true; return { active: active }; },
    ready: Promise.resolve({ active: active })
  };

  const sandbox = {
    window: windowMock,
    document: documentMock,
    navigator: {
      onLine: settings.failure !== "network",
      serviceWorker: serviceWorker
    },
    fetch: fetchImpl,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = (init || {}).detail; } },
    URL: URL,
    Promise: Promise,
    TypeError: TypeError,
    Math: Math,
    Date: Date,
    JSON: JSON,
    isFinite: isFinite,
    console: console,
    encodeURIComponent: encodeURIComponent
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);

  return {
    storage: storage,
    classes: classes,
    events: events,
    redirects: redirects,
    posted: posted,
    get registered() { return state.registered; },
    session: () => sandbox.window.DHC6Session,
    accountState: () => {
      const raw = storage.get(APP_STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    },
    settle: () => new Promise((r) => setTimeout(r, 5))
  };
}

test("losing the network does not destroy work that has not synced", async () => {
  const gate = runGate({
    failure: "network",
    storage: {
      [APP_STATE_KEY]: unsyncedWork(),
      [OFFLINE_KEY]: JSON.stringify({ email: "pilot@example.com", until: Date.now() + 20 * DAY })
    }
  });
  await gate.settle();

  const state = gate.accountState();
  assert.ok(state.logbook && state.logbook.length === 1, "the offline drill is still here");
  assert.ok(state.srsRecords && state.srsRecords.u1, "so is the SRS record");
  assert.deepEqual(gate.redirects, [], "and the pilot is not thrown out to a sign-in page they cannot reach");
  assert.equal(gate.classes.has("subscriber-authorized"), true);
  assert.equal(gate.classes.has("subscriber-offline"), true);
});

test("the offline window is reported in days so a lock-out is never a surprise", async () => {
  const gate = runGate({
    failure: "network",
    storage: { [OFFLINE_KEY]: JSON.stringify({ email: "pilot@example.com", until: Date.now() + 6.2 * DAY }) }
  });
  await gate.settle();

  const detail = gate.events.map((e) => e.detail).find((d) => d && d.offline);
  assert.ok(detail, "the app is told it is running offline");
  assert.equal(detail.daysLeft, 7, "rounded up, so '1 day left' never means twenty minutes");
  assert.equal(gate.session().offlineState().daysLeft, 7);
});

test("sign-out still clears the account when the Cache API refuses to open", async () => {
  /* This harness leaves window.caches present but unusable, which is what a
     private window or blocked site data looks like. The cleanup steps used to
     share one try/catch, so the cache throwing skipped the step that removes
     the account's training data - leaving one subscriber's logbook on a shared
     machine for the next person. */
  const gate = runGate({ failure: "refused", storage: { [APP_STATE_KEY]: unsyncedWork() } });
  await gate.settle();
  const state = gate.accountState();
  assert.equal(state.logbook, undefined, "the logbook goes even though the cache step threw");
  assert.equal(state.srsRecords, undefined);
  assert.equal(state.variant, "LEGACY", "display settings are this browser's, not the account's");
});

test("a server that refuses is authoritative; a server that cannot be reached is not", async () => {
  const refused = runGate({ failure: "refused", storage: { [APP_STATE_KEY]: unsyncedWork() } });
  await refused.settle();
  const state = refused.accountState();
  assert.equal(state.logbook, undefined, "a 401 is the server saying no, so this device is cleared");
  assert.equal(refused.redirects.length, 1);

  const unreachable = runGate({ failure: "network", storage: { [APP_STATE_KEY]: unsyncedWork(), [OFFLINE_KEY]: JSON.stringify({ email: "pilot@example.com", until: Date.now() + DAY }) } });
  await unreachable.settle();
  assert.ok(unreachable.accountState().logbook, "no answer is not the same answer");
});

test("past the window the app locks, but still does not delete anything", async () => {
  const gate = runGate({
    failure: "network",
    storage: {
      [APP_STATE_KEY]: unsyncedWork(),
      [OFFLINE_KEY]: JSON.stringify({ email: "pilot@example.com", until: Date.now() - DAY })
    }
  });
  await gate.settle();

  assert.equal(gate.redirects.length, 1, "the app locks");
  assert.match(gate.redirects[0], /offline-expired/, "and says why");
  const state = gate.accountState();
  assert.ok(state.logbook && state.logbook.length === 1, "the ramp drills survive to sync after the next sign-in");
});

test("a device that has never verified stays visible rather than bouncing", async () => {
  /* No grant means no verify has ever succeeded here, which means the service
     worker never cached a shell, which means this page came from the Worker -
     and the Worker checked the cookie before serving it. */
  const gate = runGate({ failure: "server", storage: {} });
  await gate.settle();
  assert.deepEqual(gate.redirects, [], "a 5xx must not sign out a valid subscriber");
  assert.equal(gate.classes.has("subscriber-authorized"), true);
});

test("a successful verify renews the window and asks for the shell to be cached", async () => {
  const gate = runGate({});
  await gate.settle();

  const grant = JSON.parse(gate.storage.get(OFFLINE_KEY));
  const days = Math.round((grant.until - Date.now()) / DAY);
  assert.equal(days, 30, "the window is 30 days and resets on every successful check");
  assert.equal(grant.email, "pilot@example.com");

  const shell = gate.posted.find((m) => m && m.type === "cache-app-shell");
  assert.ok(shell, "the shell is cached only after the session is known good");
  assert.ok(shell.urls.includes("/app/"), "including the document the app boots from");
  assert.ok(!shell.urls.some((u) => u.startsWith("/api/")), "and nothing from the API, ever");
});

test("the shell request survives a page that is not controlled yet", async () => {
  /*
    The other half of what Trevor saw. /app/ does not load site.js, so the app
    shell page never registered a worker of its own, and this posted to
    navigator.serviceWorker.controller - which is null on the load right after
    registration. The message went nowhere, nothing was ever cached, and both
    failures were silent.

    serviceWorker.ready resolves to the active registration whether or not it
    controls this page, so the ask lands on the first load too.
  */
  const gate = runGate({ controller: null });
  await gate.settle();
  const shell = gate.posted.find((m) => m && m.type === "cache-app-shell");
  assert.ok(shell, "the shell is still requested with no controller on this page");
  assert.equal(gate.registered, true, "and a worker is registered if the page never had one");
});

test("a different subscriber signing in on this device clears the previous one's work", async () => {
  const shared = runGate({
    email: "second@example.com",
    storage: {
      [APP_STATE_KEY]: unsyncedWork(),
      [OFFLINE_KEY]: JSON.stringify({ email: "first@example.com", until: Date.now() + 10 * DAY })
    }
  });
  await shared.settle();
  const state = shared.accountState();
  assert.equal(state.logbook, undefined, "one pilot never inherits another's attempts");
  assert.equal(state.variant, "LEGACY", "but this browser's own display settings are left alone");

  const same = runGate({
    email: "pilot@example.com",
    storage: {
      [APP_STATE_KEY]: unsyncedWork(),
      [OFFLINE_KEY]: JSON.stringify({ email: "pilot@example.com", until: Date.now() + 10 * DAY })
    }
  });
  await same.settle();
  assert.ok(same.accountState().logbook, "and signing back in as yourself keeps your own");
});
