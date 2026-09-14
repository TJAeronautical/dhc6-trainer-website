/*
  Debrief Logbook sync client (/api/logbook).

  The logbook was the last screen whose data lived only in the browser it was
  recorded in — finish a drill on your phone and the desktop knew nothing about
  it, and clearing site data threw the record away. Entries now belong to the
  signed-in account, in the same KV namespace the QRH edits already use, so they
  follow the account between devices and survive a cleared browser.

  Rules this follows:
    * The local copy stays authoritative for rendering. A failed sync never
      empties a screen, and the app works offline exactly as it did before.
    * Merging is by attemptId with the later timestampUtc winning, on both sides,
      so the same attempt cannot appear twice and a stale device cannot resurrect
      a superseded row.
    * Pushing merges on the server. A browser with an empty logbook cannot erase
      the account's history by syncing — only an explicit clear does that.
    * Nothing is cached: every request is `private, no-store`, and the service
      worker skips /api entirely.
*/

import { Store } from "./core.js";

const ENDPOINT = "/api/logbook";
const PUSH_DELAY_MS = 1500;
const CAP = 300;

/* idle → syncing → synced | offline | signed-out | unavailable */
const state = { status: "idle", updatedAt: null, count: 0, error: null };
const listeners = new Set();
let pushTimer = null;
let inFlight = null;
let stopped = false;

export function syncState() { return Object.assign({}, state); }

export function onSyncChange(fn) {
  listeners.add(fn);
  return function () { listeners.delete(fn); };
}

function setState(next) {
  Object.assign(state, next);
  listeners.forEach(function (fn) { try { fn(syncState()); } catch (error) { /* a listener must not break sync */ } });
}

async function call(method, body) {
  const init = { method: method, credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(ENDPOINT, init);
  let data = null;
  try { data = await response.json(); } catch (error) { data = null; }
  if (!response.ok || !data || data.ok !== true) {
    const error = new Error((data && data.error) || "logbook_sync_failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

/* Same identity rule as the server, so both sides converge on the same list. */
export function mergeLocal(existing, incoming) {
  const byId = new Map();
  const take = function (entry) {
    if (!entry || !entry.attemptId) return;
    const seen = byId.get(entry.attemptId);
    const ts = Number(entry.timestampUtc) || 0;
    if (!seen || ts > (Number(seen.timestampUtc) || 0)) byId.set(entry.attemptId, entry);
  };
  (existing || []).forEach(take);
  (incoming || []).forEach(take);
  const merged = Array.from(byId.values());
  merged.sort(function (a, b) {
    const d = (Number(b.timestampUtc) || 0) - (Number(a.timestampUtc) || 0);
    if (d) return d;
    return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
  });
  return merged.slice(0, CAP);
}

/* Entries with no attemptId predate sync; keep them locally, never send them. */
function syncable(list) {
  return (list || []).filter(function (e) { return e && e.attemptId && Number.isFinite(Number(e.timestampUtc)); });
}

function adopt(entries) {
  const local = Store.logbook();
  const merged = mergeLocal(local, entries);
  const changed = merged.length !== local.length ||
    merged.some(function (e, i) { return !local[i] || local[i].attemptId !== e.attemptId; });
  if (changed) Store.set("logbook", merged);
  return changed;
}

function fail(error) {
  if (error && (error.status === 401 || error.status === 403)) {
    stopped = true;
    setState({ status: "signed-out", error: null });
    return;
  }
  if (error && error.status === 404) {
    /* The API is not deployed on this origin. Stop asking; stay local-only. */
    stopped = true;
    setState({ status: "unavailable", error: null });
    return;
  }
  setState({ status: "offline", error: (error && error.message) || "sync_failed" });
}

export async function pull() {
  if (stopped) return syncState();
  if (inFlight) return inFlight;
  setState({ status: "syncing" });
  inFlight = call("GET")
    .then(function (data) {
      adopt(data.entries || []);
      setState({ status: "synced", updatedAt: data.updatedAt || null, count: Store.logbook().length, error: null });
      /* Anything recorded here while signed out on another device is pushed up
         so both sides hold the union rather than only what the server had. */
      const local = syncable(Store.logbook());
      const serverIds = new Set((data.entries || []).map(function (e) { return e.attemptId; }));
      if (local.some(function (e) { return !serverIds.has(e.attemptId); })) schedulePush();
      return syncState();
    })
    .catch(function (error) { fail(error); return syncState(); })
    .then(function (result) { inFlight = null; return result; });
  return inFlight;
}

export async function push() {
  if (stopped) return syncState();
  const entries = syncable(Store.logbook());
  setState({ status: "syncing" });
  try {
    const data = await call("PUT", { entries: entries });
    adopt(data.entries || []);
    setState({ status: "synced", updatedAt: data.updatedAt || null, count: Store.logbook().length, error: null });
  } catch (error) {
    fail(error);
  }
  return syncState();
}

export function schedulePush() {
  if (stopped) return;
  if (pushTimer) window.clearTimeout(pushTimer);
  pushTimer = window.setTimeout(function () { pushTimer = null; push(); }, PUSH_DELAY_MS);
}

/* Settings → Clear local progress: the account's server copy goes too, or the
   next pull would put everything straight back. */
export async function clearRemote() {
  if (stopped) return syncState();
  try {
    await call("DELETE");
    setState({ status: "synced", updatedAt: null, count: 0, error: null });
  } catch (error) {
    fail(error);
  }
  return syncState();
}

let started = false;
export function start() {
  if (started) return;
  started = true;
  document.addEventListener("dhc6:logbook-changed", function () { schedulePush(); });
  document.addEventListener("dhc6:logbook-cleared", function () { clearRemote(); });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && !stopped && state.status === "offline") pull();
  });
  window.addEventListener("online", function () { if (!stopped && state.status === "offline") pull(); });
  pull();
}
