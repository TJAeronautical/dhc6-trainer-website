/*
  Storage for the Debrief Logbook — the account's own training attempts.

  KV layout (namespace LICENSES, the same binding the licence, content and QRH
  edit data already use, so this needs no new Cloudflare resource):

    logbook:<accountId>   { updatedAt, entries: [LogbookEntry, …] }

  `accountId` is the SHA-256 seed from the QRH edit store, so an account has one
  id across both features and neither the licence key nor the owner address ever
  appears in a KV key name. Entries are kept when an entitlement lapses —
  authorizeWebRequest simply stops answering — and come back on renewal, which is
  the behaviour the QRH edits already have and the one a pilot expects of a
  training record.

  Every entry is rebuilt field by field from a whitelist before it is stored. The
  browser is not trusted to send a well-formed entry, and nothing that is not in
  the Android LogbookEntry shape is kept.
*/

import { accountIdFor } from "../qrh-edits/_store.js";

export { accountIdFor };
export const LOGBOOK_PREFIX = "logbook:";

export const LIMITS = {
  /* Store.addLogbookEntry keeps 300 in the browser; the server keeps the same
     number so a sync can never silently grow past what the client will hold. */
  entries: 300,
  procedureName: 200,
  category: 40,
  variant: 20,
  scoreBand: 40,
  examinerMode: 20,
  remarks: 2000,
  feedback: 2000,
  attemptId: 120,
  stepLatencies: 200,
  kind: 40,
  bodyBytes: 512 * 1024
};

function str(v) { return v == null ? "" : String(v); }
function clip(v, max) { return str(v).trim().slice(0, max); }

/* Finite, non-negative, integral. A malformed count must not poison a sort. */
function count(v, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(Math.floor(n), max == null ? Number.MAX_SAFE_INTEGER : max);
}

function percentOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function timestamp(v) {
  const n = Number(v);
  /* Anything outside a plausible range is not a timestamp. Year 2000 to 2200. */
  if (!Number.isFinite(n) || n < 946684800000 || n > 7258118400000) return null;
  return Math.floor(n);
}

/*
  Rebuild one entry from the whitelist. Returns null when the entry carries no
  usable identity — without a timestamp it cannot be ordered and without an
  attemptId it cannot be de-duplicated against the other device.
*/
export function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const ts = timestamp(raw.timestampUtc);
  const attemptId = clip(raw.attemptId, LIMITS.attemptId);
  if (ts == null || !attemptId) return null;
  const latencies = Array.isArray(raw.stepLatencies)
    ? raw.stepLatencies.slice(0, LIMITS.stepLatencies).map(function (n) { return count(n, 86400000); })
    : [];
  return {
    timestampUtc: ts,
    procedureName: clip(raw.procedureName, LIMITS.procedureName),
    category: clip(raw.category, LIMITS.category).toUpperCase(),
    aircraftVariant: clip(raw.aircraftVariant, LIMITS.variant).toUpperCase(),
    totalSteps: count(raw.totalSteps, 10000),
    wrongRoleCount: count(raw.wrongRoleCount, 10000),
    wrongCalloutCount: count(raw.wrongCalloutCount, 10000),
    rushedCount: count(raw.rushedCount, 10000),
    toleranceUsedCount: count(raw.toleranceUsedCount, 10000),
    totalTimeMs: count(raw.totalTimeMs, 86400000),
    scoreBand: clip(raw.scoreBand, LIMITS.scoreBand).toUpperCase(),
    scorePercent: percentOrNull(raw.scorePercent),
    remarks: clip(raw.remarks, LIMITS.remarks),
    instructorFeedback: raw.instructorFeedback == null ? null : clip(raw.instructorFeedback, LIMITS.feedback),
    examinerOverride: raw.examinerOverride === true,
    examinerMode: clip(raw.examinerMode, LIMITS.examinerMode).toUpperCase() || "OFF",
    attemptId: attemptId,
    stepLatencies: latencies,
    kind: clip(raw.kind, LIMITS.kind)
  };
}

export function sanitizeEntries(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const entry = sanitizeEntry(list[i]);
    if (entry) out.push(entry);
  }
  return out;
}

/*
  Merge two devices' views of the same logbook.

  attemptId is the identity: the Android mapper builds it from the completion
  timestamp and a hash of the procedure id, so the same attempt carries the same
  id wherever it is read. When both sides hold an id, the later timestampUtc wins
  — a re-sync of an entry that has since gained instructor feedback keeps the
  newer text rather than reviving the older row.

  Newest first, which is the order the browser keeps and the order the list
  screen's default sort expects.
*/
export function mergeEntries(existing, incoming) {
  const byId = new Map();
  const take = function (entry) {
    if (!entry) return;
    const seen = byId.get(entry.attemptId);
    if (!seen || entry.timestampUtc > seen.timestampUtc) byId.set(entry.attemptId, entry);
  };
  (existing || []).forEach(take);
  (incoming || []).forEach(take);
  const merged = Array.from(byId.values());
  merged.sort(function (a, b) {
    if (b.timestampUtc !== a.timestampUtc) return b.timestampUtc - a.timestampUtc;
    return a.attemptId < b.attemptId ? -1 : a.attemptId > b.attemptId ? 1 : 0;
  });
  return merged.slice(0, LIMITS.entries);
}

function kv(env) { return env && env.LICENSES ? env.LICENSES : null; }

export async function readLogbook(env, accountId) {
  const store = kv(env);
  if (!store || !accountId) return { updatedAt: null, entries: [] };
  let raw;
  try { raw = await store.get(LOGBOOK_PREFIX + accountId); } catch (error) { return { updatedAt: null, entries: [] }; }
  if (!raw) return { updatedAt: null, entries: [] };
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { return { updatedAt: null, entries: [] }; }
  const entries = sanitizeEntries(parsed && parsed.entries) || [];
  return { updatedAt: parsed && typeof parsed.updatedAt === "string" ? parsed.updatedAt : null, entries: entries };
}

export async function writeLogbook(env, accountId, entries) {
  const store = kv(env);
  if (!store || !accountId) return null;
  const updatedAt = new Date().toISOString();
  await store.put(LOGBOOK_PREFIX + accountId, JSON.stringify({ updatedAt: updatedAt, entries: entries }));
  return updatedAt;
}

export async function deleteLogbook(env, accountId) {
  const store = kv(env);
  if (!store || !accountId) return false;
  await store.delete(LOGBOOK_PREFIX + accountId);
  return true;
}
