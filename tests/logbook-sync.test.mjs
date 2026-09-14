/*
  Debrief Logbook sync — the per-account entry store and its API.

  The logbook was the last training screen whose data lived only in the browser
  that recorded it. The rules being enforced here:

    * entries belong to one account and are never visible to another
    * a session is required for every call, and a lapsed entitlement makes the
      entries unreachable without deleting them
    * PUT merges rather than replaces, so a second browser cannot erase the
      first one's attempts and an empty client cannot wipe the record
    * every stored entry is rebuilt from a whitelist — the browser is not
      trusted to send a well-formed one
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestGet as logbookGet, onRequestPut as logbookPut, onRequestDelete as logbookDelete } from "../functions/api/logbook/index.js";
import { sanitizeEntry, sanitizeEntries, mergeEntries, readLogbook, LOGBOOK_PREFIX, LIMITS, accountIdFor } from "../functions/api/logbook/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { mergeLocal } from "../app/js/logbooksync.js";
import worker from "../worker.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const SECRET = "test-signing-secret";
const ORIGIN = "https://dhc6trainer.com";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function entry(o) {
  return Object.assign({
    timestampUtc: Date.UTC(2026, 8, 13, 12, 0, 0),
    procedureName: "Engine Fire in Flight",
    category: "EMERGENCY",
    aircraftVariant: "LEGACY",
    totalSteps: 10,
    wrongRoleCount: 0,
    wrongCalloutCount: 1,
    rushedCount: 0,
    toleranceUsedCount: 0,
    totalTimeMs: 61000,
    scoreBand: "GOOD",
    scorePercent: 88,
    remarks: "Procedure drill completed.",
    instructorFeedback: null,
    examinerOverride: false,
    examinerMode: "OFF",
    attemptId: "procedure-drill-1-abc",
    stepLatencies: [1200, 900],
    kind: "procedure-drill"
  }, o);
}

async function cookieFor(record) {
  const session = await createWebSession(SECRET, record || activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

function req(method, opts) {
  const o = opts || {};
  return new Request(ORIGIN + "/api/logbook", {
    method: method,
    headers: Object.assign({}, o.cookie ? { Cookie: o.cookie } : {}, o.body ? { "Content-Type": "application/json" } : {}),
    body: o.body ? JSON.stringify(o.body) : undefined
  });
}

/* ================================================================ sanitise */

test("an entry is rebuilt from the whitelist, not stored as sent", () => {
  const dirty = entry({ evil: "<script>", scorePercent: "88.4", totalSteps: -3, category: "emergency", examinerOverride: "yes" });
  const clean = sanitizeEntry(dirty);
  assert.equal(clean.evil, undefined, "unknown fields are dropped");
  assert.equal(clean.scorePercent, 88);
  assert.equal(clean.totalSteps, 0, "a negative count is not a count");
  assert.equal(clean.category, "EMERGENCY");
  assert.equal(clean.examinerOverride, false, "only a real boolean sets the override");
});

test("an entry with no identity is refused", () => {
  assert.equal(sanitizeEntry(null), null);
  assert.equal(sanitizeEntry({}), null);
  assert.equal(sanitizeEntry(entry({ attemptId: "" })), null, "no attemptId means it cannot be de-duplicated");
  assert.equal(sanitizeEntry(entry({ timestampUtc: null })), null, "no timestamp means it cannot be ordered");
  assert.equal(sanitizeEntry(entry({ timestampUtc: 123 })), null, "1970 is not a plausible attempt time");
  assert.equal(sanitizeEntry(entry({ timestampUtc: "not a time" })), null);
});

test("free text is clipped rather than refused", () => {
  const long = "x".repeat(LIMITS.remarks + 500);
  const clean = sanitizeEntry(entry({ remarks: long, procedureName: long }));
  assert.equal(clean.remarks.length, LIMITS.remarks);
  assert.equal(clean.procedureName.length, LIMITS.procedureName);
});

test("step latencies are capped and coerced", () => {
  const clean = sanitizeEntry(entry({ stepLatencies: new Array(LIMITS.stepLatencies + 50).fill("120") }));
  assert.equal(clean.stepLatencies.length, LIMITS.stepLatencies);
  assert.equal(clean.stepLatencies[0], 120);
  assert.deepEqual(sanitizeEntry(entry({ stepLatencies: "nope" })).stepLatencies, []);
});

test("a list with junk in it keeps the good entries", () => {
  const list = sanitizeEntries([entry({ attemptId: "a" }), null, "nope", entry({ attemptId: "b" }), {}]);
  assert.deepEqual(list.map((e) => e.attemptId), ["a", "b"]);
  assert.equal(sanitizeEntries("not a list"), null);
});

/* =================================================================== merge */

test("attemptId is the identity and the later timestamp wins", () => {
  const older = entry({ attemptId: "same", timestampUtc: 1000000000000, remarks: "old" });
  const newer = entry({ attemptId: "same", timestampUtc: 1000000001000, remarks: "new" });
  assert.equal(mergeEntries([older], [newer])[0].remarks, "new");
  assert.equal(mergeEntries([newer], [older])[0].remarks, "new", "order of arguments does not decide it");
  assert.equal(mergeEntries([older], [newer]).length, 1, "the same attempt never appears twice");
});

test("a merge is the union, newest first", () => {
  const a = entry({ attemptId: "a", timestampUtc: 1000000000000 });
  const b = entry({ attemptId: "b", timestampUtc: 1000000002000 });
  const c = entry({ attemptId: "c", timestampUtc: 1000000001000 });
  assert.deepEqual(mergeEntries([a, c], [b]).map((e) => e.attemptId), ["b", "c", "a"]);
});

test("the merge is capped at what the browser will hold", () => {
  const many = [];
  for (let i = 0; i < LIMITS.entries + 120; i += 1) many.push(entry({ attemptId: "a" + i, timestampUtc: 1000000000000 + i }));
  assert.equal(mergeEntries([], many).length, LIMITS.entries);
  assert.equal(mergeEntries([], many)[0].attemptId, "a" + (LIMITS.entries + 119), "the newest survive the cap");
});

test("the browser and the server merge by the same rule", () => {
  const older = entry({ attemptId: "same", timestampUtc: 1000000000000, remarks: "old" });
  const newer = entry({ attemptId: "same", timestampUtc: 1000000001000, remarks: "new" });
  const server = mergeEntries([older], [newer]);
  const client = mergeLocal([older], [newer]);
  assert.deepEqual(client.map((e) => e.attemptId + ":" + e.remarks), server.map((e) => e.attemptId + ":" + e.remarks),
    "if the two sides disagreed, a sync loop could flip an entry back and forth forever");
});

/* ===================================================================== API */

test("the logbook refuses anonymous, malformed and lapsed sessions", async () => {
  const env = envWithLicense();
  const anonymous = await logbookGet({ request: req("GET"), env: env });
  assert.equal(anonymous.status, 401);

  const garbage = await logbookGet({ request: req("GET", { cookie: SESSION_COOKIE + "=not-a-token" }), env: env });
  assert.equal(garbage.status, 401);

  const lapsedEnv = envWithLicense(activeLicense({ status: "expired" }));
  const cookie = await cookieFor();
  const lapsed = await logbookGet({ request: req("GET", { cookie: cookie }), env: lapsedEnv });
  assert.equal(lapsed.status, 403);
});

test("an empty account reads as empty, and a round trip returns what was stored", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();

  const empty = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.deepEqual(emptyBody.entries, []);
  assert.equal(emptyBody.updatedAt, null);

  const put = await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "one" })] } }), env: env });
  assert.equal(put.status, 200);
  const putBody = await put.json();
  assert.equal(putBody.stored, 1);
  assert.equal(putBody.changed, true);
  assert.ok(putBody.updatedAt);

  const back = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  const backBody = await back.json();
  assert.equal(backBody.entries.length, 1);
  assert.equal(backBody.entries[0].attemptId, "one");
});

test("responses are private and never indexed or cached", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  const response = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.match(response.headers.get("Vary") || "", /Cookie/);
  assert.match(response.headers.get("X-Robots-Tag") || "", /noindex/);
});

test("a second browser merges in rather than replacing", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "phone", timestampUtc: 1000000000000 })] } }), env: env });
  const second = await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "desktop", timestampUtc: 1000000001000 })] } }), env: env });
  const body = await second.json();
  assert.deepEqual(body.entries.map((e) => e.attemptId), ["desktop", "phone"],
    "the desktop must not erase what the phone recorded");
});

test("a client with an empty logbook cannot wipe the account's history", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "kept" })] } }), env: env });
  const wiped = await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [] } }), env: env });
  const body = await wiped.json();
  assert.equal(body.entries.length, 1, "an empty push is not a delete");
  assert.equal(body.changed, false, "and it does not even cost a write");
});

test("DELETE is the explicit way to clear, and it only clears that account", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "gone" })] } }), env: env });
  const cleared = await logbookDelete({ request: req("DELETE", { cookie: cookie }), env: env });
  assert.equal(cleared.status, 200);
  const after = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  assert.deepEqual((await after.json()).entries, []);
});

test("one account can never see another account's entries", async () => {
  const mine = activeLicense({ key: "DHC6-AAAA-AAAA-AAAA", email: "a@example.com" });
  const theirs = activeLicense({ key: "DHC6-BBBB-BBBB-BBBB", email: "b@example.com" });
  const env = envWithLicense(mine);
  env.LICENSES.map.set("license:" + theirs.key, JSON.stringify(theirs));
  env.LICENSES.map.set("email:" + theirs.email, theirs.key);

  await logbookPut({ request: req("PUT", { cookie: await cookieFor(mine), body: { entries: [entry({ attemptId: "mine" })] } }), env: env });
  const other = await logbookGet({ request: req("GET", { cookie: await cookieFor(theirs) }), env: env });
  assert.deepEqual((await other.json()).entries, [], "a different licence is a different account");
});

test("the owner has their own namespace, separate from every subscriber", async () => {
  const env = envWithLicense();
  const owner = await createOwnerWebSession(SECRET, "owner@example.com");
  const ownerCookie = SESSION_COOKIE + "=" + owner.token;
  await logbookPut({ request: req("PUT", { cookie: ownerCookie, body: { entries: [entry({ attemptId: "owner-run" })] } }), env: env });
  const subscriber = await logbookGet({ request: req("GET", { cookie: await cookieFor() }), env: env });
  assert.deepEqual((await subscriber.json()).entries, []);
  const back = await logbookGet({ request: req("GET", { cookie: ownerCookie }), env: env });
  assert.equal((await back.json()).entries[0].attemptId, "owner-run");
});

test("entries survive a lapsed entitlement and return on renewal", async () => {
  const record = activeLicense();
  const env = envWithLicense(record);
  const cookie = await cookieFor(record);
  await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: [entry({ attemptId: "kept" })] } }), env: env });

  env.LICENSES.map.set("license:" + record.key, JSON.stringify(Object.assign({}, record, { status: "expired" })));
  const blocked = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  assert.equal(blocked.status, 403);

  env.LICENSES.map.set("license:" + record.key, JSON.stringify(record));
  const back = await logbookGet({ request: req("GET", { cookie: cookie }), env: env });
  assert.equal((await back.json()).entries[0].attemptId, "kept", "nothing was deleted while the plan lapsed");
});

test("the KV key carries no licence key or address", async () => {
  const record = activeLicense();
  const env = envWithLicense(record);
  await logbookPut({ request: req("PUT", { cookie: await cookieFor(record), body: { entries: [entry()] } }), env: env });
  const keys = Array.from(env.LICENSES.map.keys()).filter((k) => k.startsWith(LOGBOOK_PREFIX));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(record.key));
  assert.ok(!keys[0].includes(record.email));
  assert.equal(keys[0], LOGBOOK_PREFIX + (await accountIdFor({ ok: true, role: "subscriber", payload: { key: record.key } })));
});

test("bad input is rejected before anything is stored", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  const bad = [
    [new Request(ORIGIN + "/api/logbook", { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{" }), 400],
    [req("PUT", { cookie: cookie, body: { nope: 1 } }), 400],
    [req("PUT", { cookie: cookie, body: { entries: "not a list" } }), 400]
  ];
  for (const [request, status] of bad) {
    const response = await logbookPut({ request: request, env: env });
    assert.equal(response.status, status);
  }
  const stored = await readLogbook(env, await accountIdFor({ ok: true, role: "subscriber", payload: { key: activeLicense().key } }));
  assert.deepEqual(stored.entries, []);
});

test("an oversized push is refused rather than truncated silently", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  const many = [];
  for (let i = 0; i < LIMITS.entries * 2 + 10; i += 1) many.push(entry({ attemptId: "a" + i }));
  const response = await logbookPut({ request: req("PUT", { cookie: cookie, body: { entries: many } }), env: env });
  assert.equal(response.status, 413);
});

/* ================================================================== worker */

test("the Worker routes /api/logbook with the session gate and rejects other methods", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();
  const anonymous = await worker.fetch(new Request(ORIGIN + "/api/logbook"), env, {});
  assert.equal(anonymous.status, 401);

  const ok = await worker.fetch(new Request(ORIGIN + "/api/logbook", { headers: { Cookie: cookie } }), env, {});
  assert.equal(ok.status, 200);

  const posted = await worker.fetch(new Request(ORIGIN + "/api/logbook", { method: "POST", headers: { Cookie: cookie } }), env, {});
  assert.equal(posted.status, 405);

  const index = await worker.fetch(new Request(ORIGIN + "/api"), env, {});
  assert.ok((await index.json()).routes.includes("/api/logbook"), "the route is advertised");
});

/* ============================================================ client rules */

test("the sync client never caches and never sends what it cannot identify", () => {
  const src = read("app/js/logbooksync.js");
  assert.match(src, /cache: "no-store"/);
  assert.match(src, /credentials: "same-origin"/);
  assert.doesNotMatch(src, /localStorage\.setItem\(\s*["']dhc6\.sync/, "sync state is not persisted anywhere");
  assert.match(src, /function syncable/, "entries without an attemptId stay local");
});

test("a 401 or 403 stops the client instead of retrying forever", () => {
  const src = read("app/js/logbooksync.js");
  assert.match(src, /error\.status === 401 \|\| error\.status === 403/);
  assert.match(src, /stopped = true/);
});

test("signing out removes the account's training data from this browser", () => {
  // Without this, the next person to sign in on a shared machine sees the
  // previous subscriber's attempts — and the first sync merges them into their
  // account permanently.
  const src = read("assets/js/subscriber-gate.js");
  assert.match(src, /function clearAccountProgress/);
  assert.match(src, /clearAccountProgress\(\);/);
  ["logbook", "attempts", "recent", "srsRecords"].forEach((key) => {
    assert.ok(src.includes('"' + key + '"'), "sign-out must clear " + key);
  });
  assert.ok(!/ACCOUNT_KEYS = \[[^\]]*"variant"/.test(src), "display preferences belong to the browser, not the account");
});

test("clearing local progress clears the account copy too", () => {
  const core = read("app/js/core.js");
  assert.match(core, /dhc6:logbook-cleared/);
  const sync = read("app/js/logbooksync.js");
  assert.match(sync, /dhc6:logbook-cleared[\s\S]{0,80}clearRemote/);
});

test("recording an attempt schedules a push", () => {
  const core = read("app/js/core.js");
  assert.match(core, /addLogbookEntry[\s\S]{0,900}dhc6:logbook-changed/);
  const sync = read("app/js/logbooksync.js");
  assert.match(sync, /dhc6:logbook-changed[\s\S]{0,80}schedulePush/);
});

test("the tile no longer claims the logbook is browser-only", () => {
  const core = read("app/js/core.js");
  const tile = core.slice(core.indexOf('id: "logbook"'), core.indexOf('id: "readiness"'));
  assert.match(tile, /status: "available"/);
  assert.doesNotMatch(tile, /entries live in this browser only/);
  assert.match(tile, /\/api\/logbook/);
});

test("no screen restates a feature status the registry already owns", () => {
  // The Study home hardcoded status: "later" for the Technical Lab while the
  // registry and the dashboard both said available — telling a subscriber a
  // finished screen was not built yet.
  const study = read("app/js/screens/study.js").replace(/\/\*[\s\S]*?\*\//g, "");
  const hardcoded = study.match(/status: "(later|partial)"/g) || [];
  assert.deepEqual(hardcoded, [], "read feature(id).status instead: " + hardcoded.join(", "));
});
