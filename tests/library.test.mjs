/*
  Library — the per-account document store and the shared published shelf.

  Android's Library is not authored content: there are no documents under
  core-res/src/main/assets. SourcesScreen lists what the user imported into Room
  and PublishedContentScreen lists what was promoted. The browser edition keeps
  that shape and swaps the on-device extraction pipeline for an upload.

  The rules being enforced:
    * a private document is readable only by the account that uploaded it
    * the published shelf is readable by any active subscriber, writable only by
      owner / instructor / enterprise (the AccessPolicy split the QRH editor uses)
    * a guessed document id is not a way into another account's shelf
    * an unbound bucket degrades to "not configured" rather than breaking the app
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestGet as libGet, onRequestPost as libPost, onRequestDelete as libDelete } from "../functions/api/library/index.js";
import {
  sanitizeRecord, sanitizeRecords, normalizeDocId, makeDocId, contentTypeFor, canPublish,
  objectKeyFor, usedBytes, parseRange, readPrivateIndex, readPublishedIndex,
  PRIVATE_R2_PREFIX, PUBLISHED_R2_PREFIX, LIBRARY_KV_PREFIX, DOC_TYPES, LIMITS, accountIdFor
} from "../functions/api/library/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import worker from "../worker.js";
import { activeLicense, envWithLicense, memoryR2 } from "./helpers.mjs";

const SECRET = "test-signing-secret";
const ORIGIN = "https://dhc6trainer.com";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");

function libraryEnv(license, extra) {
  const env = envWithLicense(license, extra);
  env.WEB_LIBRARY = memoryR2({});
  return env;
}

async function cookieFor(record) {
  const session = await createWebSession(SECRET, record || activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

function get(url, cookie) {
  return new Request(ORIGIN + url, { headers: cookie ? { Cookie: cookie } : {} });
}

function upload(cookie, opts) {
  const o = opts || {};
  const headers = Object.assign({
    Cookie: cookie,
    "X-Doc-Shelf": o.shelf || "private",
    "X-Doc-Filename": o.fileName === undefined ? "manual.pdf" : o.fileName,
    "X-Doc-Title": o.title || "Twin Otter Manual",
    "X-Doc-Type": o.docType || "MANUAL"
  }, o.note ? { "X-Doc-Note": o.note } : {});
  return new Request(ORIGIN + "/api/library/doc", {
    method: "POST",
    headers: headers,
    body: o.body === undefined ? new Uint8Array(64).fill(7) : o.body
  });
}

async function uploadOne(env, cookie, opts) {
  const response = await libPost({ request: upload(cookie, opts), env: env });
  return { status: response.status, body: await response.json() };
}

/* ================================================================ records */

test("a record is rebuilt from the whitelist and needs a servable file type", () => {
  const clean = sanitizeRecord({ docId: "dabc123", fileName: "Manual.PDF", title: "  Trimmed  ", docType: "manual", bytes: "512", evil: 1 });
  assert.equal(clean.evil, undefined);
  assert.equal(clean.title, "Trimmed");
  assert.equal(clean.docType, "MANUAL");
  assert.equal(clean.contentType, "application/pdf");
  assert.equal(clean.bytes, 512);

  assert.equal(sanitizeRecord({ docId: "dabc123", fileName: "payload.exe" }), null, "an executable is not a document");
  assert.equal(sanitizeRecord({ docId: "dabc123", fileName: "noextension" }), null);
  assert.equal(sanitizeRecord({ docId: "../etc/passwd", fileName: "a.pdf" }), null);
  assert.equal(sanitizeRecord(null), null);
});

test("an unknown doc type falls back rather than being stored as typed", () => {
  assert.equal(sanitizeRecord({ docId: "dabc123", fileName: "a.pdf", docType: "WHATEVER" }).docType, "OTHER");
  DOC_TYPES.forEach((t) => assert.equal(sanitizeRecord({ docId: "dabc123", fileName: "a.pdf", docType: t }).docType, t));
});

test("the title falls back to the file name, never to empty", () => {
  assert.equal(sanitizeRecord({ docId: "dabc123", fileName: "qrh.pdf", title: "   " }).title, "qrh.pdf");
});

test("document ids are ours, opaque, and validated on the way back in", () => {
  const id = makeDocId();
  assert.match(id, /^d[0-9a-f]{24}$/);
  assert.equal(normalizeDocId(id), id);
  assert.equal(normalizeDocId("../../secret"), null);
  assert.equal(normalizeDocId("a/b"), null);
  assert.equal(normalizeDocId(""), null);
  assert.equal(normalizeDocId("x".repeat(LIMITS.docId + 1)), null);
});

test("a duplicate id cannot appear twice in one index", () => {
  const list = sanitizeRecords([
    { docId: "dabc123", fileName: "a.pdf" },
    { docId: "dabc123", fileName: "b.pdf" },
    { docId: "ddef456", fileName: "c.pdf" }
  ]);
  assert.deepEqual(list.map((r) => r.docId), ["dabc123", "ddef456"]);
});

test("object keys keep the two shelves apart and namespace the private one", () => {
  assert.equal(objectKeyFor("private", "acct1", "dabc"), PRIVATE_R2_PREFIX + "acct1/dabc");
  assert.equal(objectKeyFor("published", "acct1", "dabc"), PUBLISHED_R2_PREFIX + "dabc");
});

test("publishing follows the same access split as the QRH editor", () => {
  assert.equal(canPublish({ ok: true, role: "owner" }), true);
  assert.equal(canPublish({ ok: true, role: "subscriber", plan: "instructor_annual" }), true);
  assert.equal(canPublish({ ok: true, role: "subscriber", plan: "enterprise_annual" }), true);
  assert.equal(canPublish({ ok: true, role: "subscriber", plan: "premium_annual" }), false);
  assert.equal(canPublish({ ok: false }), false);
  assert.equal(canPublish(null), false);
});

test("content types cover what a browser can open and nothing else", () => {
  ["a.pdf", "a.png", "a.jpg", "a.webp", "a.svg", "a.txt", "a.md", "a.csv"].forEach((n) => assert.ok(contentTypeFor(n)));
  ["a.exe", "a.zip", "a.glb", "a.js", "a.html", "a"].forEach((n) => assert.equal(contentTypeFor(n), null));
});

test("usedBytes tolerates a malformed record", () => {
  assert.equal(usedBytes([{ bytes: 10 }, { bytes: "x" }, {}, null]), 10);
});

test("range parsing matches the media store's", () => {
  assert.deepEqual(parseRange("bytes=0-9", 100), { offset: 0, length: 10, end: 9 });
  assert.deepEqual(parseRange("bytes=90-", 100), { offset: 90, length: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=-10", 100), { offset: 90, length: 10, end: 99 });
  assert.deepEqual(parseRange("bytes=200-300", 100), { unsatisfiable: true });
  assert.equal(parseRange(null, 100), null);
});

/* ==================================================================== API */

test("every Library call refuses an anonymous or lapsed session", async () => {
  const env = libraryEnv();
  assert.equal((await libGet({ request: get("/api/library"), env: env })).status, 401);
  assert.equal((await libPost({ request: new Request(ORIGIN + "/api/library/doc", { method: "POST", body: "x" }), env: env })).status, 401);

  const lapsed = libraryEnv(activeLicense({ status: "expired" }));
  assert.equal((await libGet({ request: get("/api/library", await cookieFor()), env: lapsed })).status, 403);
});

test("an empty Library reports both shelves and the account's quota", async () => {
  const env = libraryEnv();
  const response = await libGet({ request: get("/api/library", await cookieFor()), env: env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.canPublish, false, "a premium subscriber does not publish to the shared shelf");
  assert.deepEqual(body.privateShelf.items, []);
  assert.deepEqual(body.publishedShelf.items, []);
  assert.equal(body.limits.bytes, LIMITS.bytes);
});

test("an unbound bucket degrades to not-configured instead of failing", async () => {
  const env = envWithLicense();   // no WEB_LIBRARY
  const listed = await libGet({ request: get("/api/library", await cookieFor()), env: env });
  assert.equal(listed.status, 200, "the screen must still render");
  assert.equal((await listed.json()).configured, false);

  const posted = await libPost({ request: upload(await cookieFor()), env: env });
  assert.equal(posted.status, 503);
  assert.equal((await posted.json()).error, "library_not_configured");
});

test("a document round-trips: upload, list, fetch, remove", async () => {
  const env = libraryEnv();
  const cookie = await cookieFor();

  const added = await uploadOne(env, cookie, { fileName: "otter.pdf", title: "Twin Otter AFM" });
  assert.equal(added.status, 201);
  const docId = added.body.document.docId;
  assert.equal(added.body.document.title, "Twin Otter AFM");
  assert.equal(added.body.document.bytes, 64);

  const listed = await libGet({ request: get("/api/library", cookie), env: env });
  const body = await listed.json();
  assert.equal(body.privateShelf.items.length, 1);
  assert.equal(body.privateShelf.usedBytes, 64);

  const fetched = await libGet({ request: get("/api/library/doc/private/" + docId, cookie), env: env });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get("Content-Type"), "application/pdf");
  assert.equal(fetched.headers.get("Cache-Control"), "private, no-store");
  assert.match(fetched.headers.get("X-Robots-Tag") || "", /noindex/);
  assert.match(fetched.headers.get("Content-Disposition") || "", /otter\.pdf/);

  const removed = await libDelete({ request: new Request(ORIGIN + "/api/library/doc/private/" + docId, { method: "DELETE", headers: { Cookie: cookie } }), env: env });
  assert.equal(removed.status, 200);
  const after = await libGet({ request: get("/api/library", cookie), env: env });
  assert.deepEqual((await after.json()).privateShelf.items, []);
  const gone = await libGet({ request: get("/api/library/doc/private/" + docId, cookie), env: env });
  assert.equal(gone.status, 404);
});

test("one account can never list or fetch another account's documents", async () => {
  const mine = activeLicense({ key: "DHC6-AAAA-AAAA-AAAA", email: "a@example.com" });
  const theirs = activeLicense({ key: "DHC6-BBBB-BBBB-BBBB", email: "b@example.com" });
  const env = libraryEnv(mine);
  env.LICENSES.map.set("license:" + theirs.key, JSON.stringify(theirs));
  env.LICENSES.map.set("email:" + theirs.email, theirs.key);

  const added = await uploadOne(env, await cookieFor(mine), { fileName: "private.pdf" });
  const docId = added.body.document.docId;

  const theirCookie = await cookieFor(theirs);
  const listed = await libGet({ request: get("/api/library", theirCookie), env: env });
  assert.deepEqual((await listed.json()).privateShelf.items, [], "not listed");

  const guessed = await libGet({ request: get("/api/library/doc/private/" + docId, theirCookie), env: env });
  assert.equal(guessed.status, 404, "and a guessed id is not a way in either");
});

test("a premium subscriber cannot publish to the shared shelf", async () => {
  const env = libraryEnv();
  const response = await libPost({ request: upload(await cookieFor(), { shelf: "published" }), env: env });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "publish_forbidden");
});

test("an instructor publishes, and every subscriber can then read it", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "cfi@example.com", plan: "instructor_annual" });
  const subscriber = activeLicense();
  const env = libraryEnv(instructor);
  env.LICENSES.map.set("license:" + subscriber.key, JSON.stringify(subscriber));
  env.LICENSES.map.set("email:" + subscriber.email, subscriber.key);

  const published = await uploadOne(env, await cookieFor(instructor), { shelf: "published", fileName: "sop.pdf", title: "Company SOP" });
  assert.equal(published.status, 201);
  assert.equal(published.body.document.publishedBy, "Instructor");

  const cookie = await cookieFor(subscriber);
  const listed = await libGet({ request: get("/api/library", cookie), env: env });
  const body = await listed.json();
  assert.equal(body.publishedShelf.items.length, 1, "the shared shelf is shared");
  assert.equal(body.canPublish, false);

  const fetched = await libGet({ request: get("/api/library/doc/published/" + published.body.document.docId, cookie), env: env });
  assert.equal(fetched.status, 200);

  const removal = await libDelete({ request: new Request(ORIGIN + "/api/library/doc/published/" + published.body.document.docId, { method: "DELETE", headers: { Cookie: cookie } }), env: env });
  assert.equal(removal.status, 403, "reading the shelf is not the right to unpublish from it");
});

test("the owner publishes too, and is labelled as the owner", async () => {
  const env = libraryEnv();
  const owner = await createOwnerWebSession(SECRET, "owner@example.com");
  const cookie = SESSION_COOKIE + "=" + owner.token;
  const published = await uploadOne(env, cookie, { shelf: "published", fileName: "bulletin.pdf" });
  assert.equal(published.status, 201);
  assert.equal(published.body.document.publishedBy, "Owner");
});

test("uploads are refused when they are empty, oversized, or the wrong type", async () => {
  const env = libraryEnv();
  const cookie = await cookieFor();
  const cases = [
    [{ body: new Uint8Array(0) }, 400, "empty_file"],
    [{ fileName: "payload.exe" }, 415, "unsupported_file_type"],
    [{ fileName: "" }, 400, "filename_required"],
    [{ body: new Uint8Array(LIMITS.bytes + 1) }, 413, "file_too_large"]
  ];
  for (const [opts, status, error] of cases) {
    const response = await libPost({ request: upload(cookie, opts), env: env });
    assert.equal(response.status, status, error);
    assert.equal((await response.json()).error, error);
  }
});

test("a byte range is served, and an impossible one is refused", async () => {
  const env = libraryEnv();
  const cookie = await cookieFor();
  const added = await uploadOne(env, cookie, { body: new Uint8Array(1000).fill(3) });
  const url = "/api/library/doc/private/" + added.body.document.docId;

  const ranged = await libGet({ request: new Request(ORIGIN + url, { headers: { Cookie: cookie, Range: "bytes=0-99" } }), env: env });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get("Content-Range"), "bytes 0-99/1000");
  assert.equal(ranged.headers.get("Content-Length"), "100");

  const bad = await libGet({ request: new Request(ORIGIN + url, { headers: { Cookie: cookie, Range: "bytes=5000-6000" } }), env: env });
  assert.equal(bad.status, 416);
});

test("the KV keys and object paths carry no licence key or address", async () => {
  const record = activeLicense();
  const env = libraryEnv(record);
  await uploadOne(env, await cookieFor(record), {});
  const keys = Array.from(env.LICENSES.map.keys()).filter((k) => k.startsWith(LIBRARY_KV_PREFIX));
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(record.key) && !keys[0].includes(record.email));
  const accountId = await accountIdFor({ ok: true, role: "subscriber", payload: { key: record.key } });
  assert.equal(keys[0], LIBRARY_KV_PREFIX + "private:" + accountId);
});

test("documents survive a lapsed entitlement and return on renewal", async () => {
  const record = activeLicense();
  const env = libraryEnv(record);
  const cookie = await cookieFor(record);
  await uploadOne(env, cookie, { fileName: "kept.pdf" });

  env.LICENSES.map.set("license:" + record.key, JSON.stringify(Object.assign({}, record, { status: "expired" })));
  assert.equal((await libGet({ request: get("/api/library", cookie), env: env })).status, 403);

  env.LICENSES.map.set("license:" + record.key, JSON.stringify(record));
  const back = await libGet({ request: get("/api/library", cookie), env: env });
  assert.equal((await back.json()).privateShelf.items[0].fileName, "kept.pdf");
});

/* ================================================================= worker */

test("the Worker routes /api/library with the session gate and rejects other methods", async () => {
  const env = libraryEnv();
  const cookie = await cookieFor();
  assert.equal((await worker.fetch(new Request(ORIGIN + "/api/library"), env, {})).status, 401);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/api/library", { headers: { Cookie: cookie } }), env, {})).status, 200);
  assert.equal((await worker.fetch(new Request(ORIGIN + "/api/library", { method: "PUT", headers: { Cookie: cookie } }), env, {})).status, 405);
  const index = await worker.fetch(new Request(ORIGIN + "/api"), env, {});
  assert.ok((await index.json()).routes.includes("/api/library"));
});

/* ============================================================== wiring */

test("the R2 binding is not the name the KV stores already claim", () => {
  // env.WEB_CONTENT is an OPTIONAL KV namespace in functions/api/content/_store.js
  // and functions/api/media/_store.js (`env.WEB_CONTENT || env.LICENSES`).
  // Binding an R2 bucket to that name would make both call .get() on a bucket.
  const wrangler = read("wrangler.jsonc");
  assert.match(wrangler, /"binding": "WEB_LIBRARY"/);
  assert.match(wrangler, /"bucket_name": "dhc6-web-content"/);
  const r2Section = wrangler.slice(wrangler.indexOf('"r2_buckets"'));
  assert.doesNotMatch(r2Section.replace(/\/\/.*$/gm, ""), /"binding": "WEB_CONTENT"/,
    "WEB_CONTENT is a KV namespace name; an R2 bucket must not take it");
  assert.match(read("functions/api/content/_store.js"), /env\.WEB_CONTENT \|\| env\.LICENSES/);
  assert.match(read("functions/api/library/_store.js"), /env\.WEB_LIBRARY/);
});

test("the Library routes open the real screens, not a placeholder", () => {
  const app = read("app/app.js");
  assert.match(app, /route\("\/library\/home", libraryHub\)/);
  assert.match(app, /route\("\/library\/sources", librarySources\)/);
  assert.match(app, /route\("\/library\/published", libraryPublished\)/);
  assert.match(app, /route\("\/library\/qrh-drafts", libraryQrhDrafts\)/);
  assert.match(app, /route\("\/library\/import", laterScreen\("import"/, "Import stays a documented later screen");
  const core = read("app/js/core.js");
  assert.match(core, /id: "library"[^}]*status: "available"/);
  assert.match(core, /id: "import"[^}]*status: "later"/);
});

/* ------------------------------------------------- fidelity to the Kotlin */

test("the hub keeps LibraryHubScreen's card order and its two intro strings", () => {
  const src = read("app/js/screens/library.js");
  const hub = src.slice(src.indexOf("export async function libraryHub"), src.indexOf("export async function librarySources"));
  const order = ["Import", "Sources", "QRH Drafts", "Published"].map((t) => hub.indexOf('card("' + t + '"'));
  assert.ok(order.every((i) => i > -1), "a hub card is missing: " + JSON.stringify(order));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, "the Kotlin order is Import, Sources, QRH Drafts, Published");

  // Verbatim from LibraryHubScreen.kt.
  assert.ok(hub.includes("One place for protected knowledge imports, source documents, extracted QRH procedures, and published training content."));
  assert.ok(hub.includes("Read-only source index and published training content. Knowledge import is visible here, but opens only for authorised accounts."));
  assert.ok(hub.includes("Imported PDFs, source documents, and promoted content in the shared source index."));
  assert.ok(hub.includes("Trusted runtime-ready content only."));
  assert.ok(hub.includes("Review extracted QRH procedures in the shared QRH edit screen."));
  assert.ok(hub.includes("Open Import") && hub.includes("Unlock Import"), "the Import button title follows allowAuthoringTools");
});

test("QRH Drafts is shown only to accounts with authoring tools", () => {
  // LibraryHubScreen gates the compile-queue card on allowCompileTools.
  const src = read("app/js/screens/library.js");
  const hub = src.slice(src.indexOf("export async function libraryHub"), src.indexOf("export async function librarySources"));
  const gate = hub.slice(hub.indexOf("if (authoring)"));
  assert.ok(gate.indexOf('card("QRH Drafts"') > -1 && gate.indexOf('card("QRH Drafts"') < gate.indexOf('card("Published"'),
    "the QRH Drafts card must sit inside the authoring gate");
});

test("Sources is titled and structured like SourcesScreen", () => {
  const src = read("app/js/screens/library.js");
  const sources = src.slice(src.indexOf("export async function librarySources"), src.indexOf("export function uploadErrorText"));
  assert.ok(sources.includes('title: "Library Sources"'), "the Kotlin titles it Library Sources, not Sources");
  assert.match(sources, /bubble\("light", "Sources", \{ count:/, "the header carries the source count, as the Kotlin does");
  assert.ok(sources.includes("No sources yet."), "EmptySourcesCard's title");
  assert.ok(sources.includes("No source documents are installed. Runtime study content can still be available from Systems, QRH, and Flashcards."),
    "the read-only empty body, verbatim");
  assert.ok(sources.includes("Delete source?") && sources.includes("Published QRH drills are not removed here."),
    "the delete confirmation follows the Kotlin");
});

test("Published lists compiled procedures, not documents", () => {
  // PublishedContentScreen filters CompiledDrillProcedure by reviewStatus ==
  // PUBLISHED and renders title / CATEGORY - VARIANT / Status. It is not a
  // document shelf, which is what an earlier pass had assumed.
  const src = read("app/js/screens/library.js");
  const published = src.slice(src.indexOf("export async function libraryPublished"), src.indexOf("export async function libraryQrhDrafts"));
  assert.match(published, /allProcedures\(\)/, "it reads the procedure packs");
  assert.ok(published.includes("Status: PUBLISHED"));
  assert.ok(published.includes("No published content yet."), "the Kotlin's empty string");
  assert.ok(!/\/api\/library\/doc\//.test(published), "Published must not serve uploaded documents");
});

test("documents an instructor shares appear in the source index, not on a separate shelf", () => {
  const src = read("app/js/screens/library.js");
  const sources = src.slice(src.indexOf("export async function librarySources"), src.indexOf("export function uploadErrorText"));
  assert.match(sources, /publishedShelf\.items[\s\S]{0,200}privateShelf\.items/,
    "Sources lists the shared documents and the account's own together");
});

test("a later screen shows one explanation, not two", () => {
  // laterScreen used to render feature(id).desc AND its `extra` card, so the
  // Import screen said the same thing twice — once under the pill and again in
  // the card below it.
  const misc = read("app/js/screens/misc.js");
  const fn = misc.slice(misc.indexOf("export function laterScreen"), misc.indexOf("/* ---------------------------------------------------------------- Settings */"));
  assert.match(fn, /text: extra \|\| f\.desc/, "the screen picks one of the two");
  const pillRow = fn.slice(fn.indexOf('statusPill(f.status)'), fn.indexOf("blueCard("));
  assert.ok(!pillRow.includes("f.desc"), "the description must not also sit beside the pill");

  // The training-side twin has the same shape and the same rule.
  const training = read("app/js/screens/training.js");
  const later = training.slice(training.indexOf("export function laterTraining"));
  const row = later.slice(later.indexOf("statusPill(f.status)"), later.indexOf("blueCard("));
  assert.ok(!row.includes("f.desc"), "laterTraining repeats the description beside the pill");
  assert.match(later, /LATER_TRAINING_DETAIL\[id\] \|\| f\.desc/);
});

test("no later screen describes a feature that has since shipped", () => {
  // laterTraining carried a CRM branch saying the standalone drill screen was
  // "scheduled for the CRM phase" long after it shipped and went Available.
  const training = read("app/js/screens/training.js");
  const later = training.slice(training.indexOf("export function laterTraining"));
  assert.ok(!/scheduled for the CRM phase/.test(later), "the stale CRM branch is back");
  const core = read("app/js/core.js");
  assert.match(core, /id: "crm"[^}]*status: "available"/, "and CRM is Available, which is why");
});

test("the Library client never caches a document and never guesses a path", () => {
  const src = read("app/js/screens/library.js");
  assert.match(src, /cache: "no-store"/);
  assert.match(src, /credentials: "same-origin"/);
  assert.match(src, /\/api\/library\/doc\//);
  assert.doesNotMatch(src, /localStorage/, "documents are session data, not browser state");
});

/* ------------------------------------------------- search over the Library */

test("documentMatches searches the fields a reader would type", async () => {
  const { documentMatches } = await import("../app/js/screens/study.js");
  const entry = { shelf: "private", doc: { title: "Twin Otter AFM", fileName: "otter-afm-rev4.pdf", note: "Section 3 performance", docType: "MANUAL" } };
  ["twin otter", "afm", "rev4", "performance", "manual"].forEach((q) => {
    assert.ok(documentMatches(entry, q), "should match on " + q);
  });
  assert.ok(!documentMatches(entry, "hydraulic"), "and not on something absent");
  assert.ok(!documentMatches(null, "afm"));
  assert.ok(!documentMatches({}, "afm"));
});

test("search reads the Library and degrades to nothing when it cannot", () => {
  const src = read("app/js/screens/study.js");
  const fn = src.slice(src.indexOf("async function libraryDocuments"), src.indexOf("export function documentMatches"));
  assert.match(fn, /\/api\/library/);
  assert.match(fn, /cache: "no-store"/);
  // A search screen must never fail because the Library is unconfigured or down.
  assert.match(fn, /catch \(error\) \{ return \[\]; \}/);
  assert.match(fn, /data\.configured/, "an unconfigured Library contributes no results");
});

test("a document result opens in its own tab, not in the router", () => {
  const src = read("app/js/screens/study.js");
  assert.match(src, /external: true/);
  assert.match(src, /r\.external \? \{ href: r\.href, target: "_blank" \}/);
  const ui = read("app/js/ui.js");
  assert.match(ui, /attrs\.target = o\.target; attrs\.rel = "noopener"/, "and without handing the new tab an opener");
});

test("Search no longer claims the Library is missing from it", () => {
  const src = read("app/js/screens/study.js");
  const fn = src.slice(src.indexOf("export async function knowledgeSearch"));
  assert.ok(!/Published-library and imported-source search arrive with the Library phase/.test(fn),
    "that banner outlived the Library phase");
  assert.ok(!/statusPill\("partial"\)/.test(fn), "and the screen is no longer Partial");
  const core = read("app/js/core.js");
  assert.match(core, /id: "search"[^}]*status: "available"/);
});

test("Knowledge names the one reason it is still Partial", () => {
  const core = read("app/js/core.js");
  const entry = core.slice(core.indexOf('id: "study"'), core.indexOf('id: "search"'));
  assert.match(entry, /status: "partial"/);
  assert.match(entry, /Flashcards/, "the remaining reason is named");
  assert.ok(!/Search \(does not yet cover/.test(entry), "and the closed one is not still listed");
  // study-cards is what keeps it Partial, so that had better still be Partial.
  assert.match(core, /id: "study-cards"[^}]*status: "partial"/);
});

test("the Library screen keeps the training-support-only statement", () => {
  const src = read("app/js/screens/library.js");
  assert.match(src, /not an approved AFM, QRH, MEL, company manual or checklist/);
});

test("the service worker still refuses to cache anything under /api", () => {
  const sw = read("sw.js");
  assert.match(sw, /\/api/, "the /api bypass is what keeps a document out of an unauthenticated cache");
});
