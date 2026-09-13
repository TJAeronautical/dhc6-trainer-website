/*
  Manual QRH editing: the Android logic port and the entitlement-gated per-account
  edit API.

  The rules being enforced:
    * an edit belongs to one account and is never visible to another
    * reading needs an active session; writing needs owner / instructor / enterprise
      (Android AccessPolicy.canEditQrh -> QRH_MANUAL_EDIT)
    * a lapsed entitlement makes edits unreachable but never deletes them
    * nothing written here changes the published Android content
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestGet as editsGet, onRequestPut as editsPut, onRequestDelete as editsDelete } from "../functions/api/qrh-edits/index.js";
import { accountIdFor, canEditQrh, normalizeProcedureId, sanitizeDraft, QRH_EDIT_PREFIX, LIMITS } from "../functions/api/qrh-edits/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import worker from "../worker.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

import { compactRoleTag, defaultFlowRole, removePrefixNumber, cleanManualStepText, stepFromLine, cleanStep, normalizeStep, normalizedMemorySteps, normalizedFlowSteps, controlById, findByNameOrAlias, positionMatches, parseStepText, buildWrittenStep, buildExpectedControlIds, inferExpectedControlIds, draftFromDetail, cleanDraft, applyDraftToDetail, validateDraft, applyStructure, autoStructure, expectedControlIdList } from "../app/js/logic/qrhedit.js";

const SECRET = "test-signing-secret";
const ORIGIN = "https://dhc6trainer.com";
const PROC = "EMERGENCY/Engine Fire in Flight";

/* A small stand-in for the qrh-editor content pack (the real one is extracted
   from QrhEditorCockpitCatalog.kt by tools/build-content.mjs). */
const CATALOG = {
  controls: [
    { controlId: "FLAP_SELECTOR", displayName: "FLAPS", positions: ["UP", "10°", "20°", "FULL"], aliases: ["FLAPS", "FLAP"] },
    { controlId: "POWER_LEVER_L", displayName: "POWER LEVER L", positions: ["IDLE", "CLIMB", "CRUISE", "TAKEOFF", "REVERSE", "AS REQUIRED"], aliases: [] },
    { controlId: "POWER_LEVER_R", displayName: "POWER LEVER R", positions: ["IDLE", "CLIMB", "CRUISE", "TAKEOFF", "REVERSE", "AS REQUIRED"], aliases: [] },
    { controlId: "PROP_LEVER_L", displayName: "PROP LEVER L", positions: ["MAX", "MIN", "FEATHER", "AS REQUIRED"], aliases: ["PROPELLER_LEVER_L"] }
  ],
  memoryCallouts: [{ label: "PF identify", roleTag: "PF", writtenStep: "IDENTIFY ABNORMAL CONDITION", itemKind: "SPOKEN_LINE" }],
  flowCallouts: [{ label: "Flaps — UP", roleTag: "PM CALL", writtenStep: "FLAPS — UP", itemKind: "ITEM_POSITION" }]
};

function draftFixture(overrides) {
  return Object.assign({
    title: "Engine Fire in Flight",
    trigger: "Fire warning in flight",
    memoryItems: ["POWER LEVER L — IDLE"],
    flowItems: ["FLAPS — UP"],
    notes: ["Land as soon as practicable."],
    memoryStepDrafts: [{ writtenStep: "POWER LEVER L — IDLE", spokenWording: "", mccCrmNote: "", expectedControlIds: "POWER_LEVER_L", requiresConfirmation: true, roleTag: "PF", itemKind: "ITEM_POSITION", targetControlId: "POWER_LEVER_L", targetPosition: "IDLE" }],
    flowStepDrafts: [{ writtenStep: "FLAPS — UP", spokenWording: "", mccCrmNote: "", expectedControlIds: "FLAP_SELECTOR", requiresConfirmation: true, roleTag: "PM CALL", itemKind: "ITEM_POSITION", targetControlId: "FLAP_SELECTOR", targetPosition: "UP" }]
  }, overrides || {});
}

async function cookieFor(record) {
  const session = await createWebSession(SECRET, record || activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

function req(method, procedureId, opts) {
  const o = opts || {};
  const url = ORIGIN + "/api/qrh-edits" + (procedureId ? "/" + encodeURIComponent(procedureId) : "");
  return new Request(url, {
    method: method,
    headers: Object.assign({}, o.cookie ? { Cookie: o.cookie } : {}, o.token ? { Authorization: "Bearer " + o.token } : {}, o.body ? { "Content-Type": "application/json" } : {}),
    body: o.body ? (typeof o.body === "string" ? o.body : JSON.stringify(o.body)) : undefined
  });
}

/* ===================================================== logic: role + text */
test("role tags and flow defaults follow QrhManualEditStore", () => {
  assert.equal(compactRoleTag(""), "PF");
  assert.equal(compactRoleTag("pm call"), "PM CALL");
  assert.equal(compactRoleTag("PM ACKNOWLEDGE"), "PM ACK");
  assert.equal(compactRoleTag("PM"), "PM");
  assert.equal(compactRoleTag("pf command"), "PF CMD");
  assert.equal(compactRoleTag("PF"), "PF");
  assert.equal(compactRoleTag("CAPTAIN"), "CAPTAIN", "an unknown tag is kept verbatim");
  assert.deepEqual([0, 1, 2, 3].map(defaultFlowRole), ["PM ACK", "PF CMD", "PM CALL", "PM ACK"]);
  assert.equal(removePrefixNumber("  12) FLAPS — UP"), "FLAPS — UP");
  assert.equal(removePrefixNumber("3. CHECKED"), "CHECKED");
  assert.equal(removePrefixNumber("FLAPS 10"), "FLAPS 10", "a number inside the text is untouched");
});

test("cleanManualStepText strips role prefixes and source citations", () => {
  assert.equal(cleanManualStepText("PF — FLAPS UP"), "FLAPS UP");
  assert.equal(cleanManualStepText("PM FLAPS UP"), "FLAPS UP");
  assert.equal(cleanManualStepText("FLAPS — UP • POH/AFM Section 3"), "FLAPS — UP");
  assert.equal(cleanManualStepText("FLAPS — UP POH / AFM 3.4"), "FLAPS — UP");
  assert.equal(cleanManualStepText("FLAPS — UP -"), "FLAPS — UP");
  assert.equal(cleanManualStepText("PROP LEVER L — FEATHER"), "PROP LEVER L — FEATHER", "a legitimate dash inside the step survives");
});

/* ================================================== logic: catalog lookup */
test("the cockpit catalogue resolves ids, display names and aliases", () => {
  assert.equal(controlById(CATALOG, "flap_selector").displayName, "FLAPS");
  assert.equal(controlById(CATALOG, "PROPELLER_LEVER_L").controlId, "PROP_LEVER_L", "aliases resolve");
  assert.equal(controlById(CATALOG, "NOT_A_CONTROL"), null);
  assert.equal(findByNameOrAlias(CATALOG, "Flaps").controlId, "FLAP_SELECTOR");
  assert.equal(findByNameOrAlias(CATALOG, "flap selector").controlId, "FLAP_SELECTOR");
  assert.equal(findByNameOrAlias(CATALOG, "POWER LEVER L").controlId, "POWER_LEVER_L");
  assert.equal(findByNameOrAlias(CATALOG, ""), null);
  assert.equal(positionMatches("UP", "up"), true);
  assert.equal(positionMatches("10°", "10 deg"), true, "\"10 deg\" matches the canonical \"10°\" after stripping non-alphanumerics");
  assert.equal(positionMatches("MAX", "MAXIMUM"), true);
  assert.equal(positionMatches("FULL", "FULL FWD"), true);
  assert.equal(positionMatches("FEATHER", "FEATHERED"), true);
  assert.equal(positionMatches("UP", ""), false);
});

test("free text is parsed into structured QRH items exactly like QrhEditorTextParser", () => {
  assert.deepEqual(parseStepText(CATALOG, "AFTER START CHECKLIST"), { kind: "CHECKLIST_CUE", controlId: "", position: "" });
  assert.deepEqual(parseStepText(CATALOG, "CHECKLIST"), { kind: "CHECKLIST_CUE", controlId: "", position: "" });
  assert.equal(parseStepText(CATALOG, "CHECKS COMPLETE"), null, "anything containing COMPLETE is never a checklist cue, and is not a bare ack either");
  assert.deepEqual(parseStepText(CATALOG, "COMPLETE"), { kind: "PM_ACK", controlId: "", position: "" });
  assert.deepEqual(parseStepText(CATALOG, "CHECKED"), { kind: "PM_ACK", controlId: "", position: "" });
  assert.deepEqual(parseStepText(CATALOG, "FLAPS — UP"), { kind: "ITEM_POSITION", controlId: "FLAP_SELECTOR", position: "UP" });
  assert.deepEqual(parseStepText(CATALOG, "flaps: full"), { kind: "ITEM_POSITION", controlId: "FLAP_SELECTOR", position: "FULL" });
  assert.equal(parseStepText(CATALOG, "POWER LEVER L — SOMETHING ODD").position, "SOMETHING ODD", "an unrecognised position is kept as typed");
  assert.equal(parseStepText(CATALOG, "IDENTIFY ABNORMAL CONDITION"), null, "a plain spoken line gives no structured signal");
  assert.equal(parseStepText(CATALOG, "   "), null);
  assert.equal(parseStepText(CATALOG, "NOT A CONTROL — UP"), null, "an unknown control is not turned into an item/position step");
});

test("written steps and expected control ids are built for the drill runner", () => {
  assert.equal(buildWrittenStep(CATALOG, "ITEM_POSITION", "FLAP_SELECTOR", "UP", "ignored"), "FLAPS — UP");
  assert.equal(buildWrittenStep(CATALOG, "ITEM_POSITION", "FLAP_SELECTOR", "", "ignored"), "FLAPS");
  assert.equal(buildWrittenStep(CATALOG, "ITEM_POSITION", "", "", "free text"), "free text");
  assert.equal(buildWrittenStep(CATALOG, "SPOKEN_LINE", "FLAP_SELECTOR", "UP", "QRH FOR ENGINE FIRE"), "QRH FOR ENGINE FIRE");
  assert.deepEqual(buildExpectedControlIds("ITEM_POSITION", "flap_selector"), ["FLAP_SELECTOR"]);
  assert.deepEqual(buildExpectedControlIds("SPOKEN_LINE", "FLAP_SELECTOR"), []);
  assert.deepEqual(inferExpectedControlIds(CATALOG, "FLAPS — UP"), ["FLAP_SELECTOR"]);
  assert.deepEqual(inferExpectedControlIds(CATALOG, "AFTER START CHECKLIST"), ["CHECKLIST"]);
  assert.deepEqual(inferExpectedControlIds(CATALOG, "MASTER CAUTION RESET"), ["MASTER_CAUTION_LEFT", "MASTER_CAUTION_RIGHT"]);
  assert.deepEqual(inferExpectedControlIds(CATALOG, "BOOST PUMPS ON"), ["AFT_BOOST_PUMP_1", "AFT_BOOST_PUMP_2"]);
  assert.deepEqual(inferExpectedControlIds(CATALOG, "BRIEF THE CREW"), []);
});

/* ===================================================== logic: the draft */
test("a draft seeds from the published detail and survives the save-time cleaning", () => {
  const detail = { title: "Engine Fire in Flight", trigger: "Fire warning", memoryItems: ["1. POWER LEVER L — IDLE", "  "], steps: ["1. FLAPS — UP", "2. LAND"], notes: ["Note one", ""] };
  const draft = draftFromDetail(detail);
  assert.deepEqual(draft.memoryItems, ["POWER LEVER L — IDLE"], "numeric prefixes and blanks are dropped");
  assert.deepEqual(draft.flowItems, ["FLAPS — UP", "LAND"]);
  assert.deepEqual(draft.notes, ["Note one"]);
  assert.equal(draft.memoryStepDrafts[0].roleTag, "PF");
  assert.deepEqual(draft.flowStepDrafts.map((s) => s.roleTag), ["PM ACK", "PF CMD"], "flow roles cycle PM ACK / PF CMD / PM CALL");
  assert.equal(draft.flowStepDrafts[0].spokenWording, "fLAPS — UP", "fromLine lower-cases the first character for the spoken line");

  const cleaned = cleanDraft(Object.assign(draftFixture(), { title: "  Trimmed  ", notes: [" keep ", "  "] }));
  assert.equal(cleaned.title, "Trimmed");
  assert.deepEqual(cleaned.notes, ["keep"]);
  assert.deepEqual(cleaned.memoryItems, ["POWER LEVER L — IDLE"], "line lists are rebuilt from the step drafts");

  const empty = cleanDraft({ title: "T", memoryStepDrafts: [], flowStepDrafts: [], memoryItems: ["fallback line"], flowItems: [], notes: [] });
  assert.deepEqual(empty.memoryItems, ["fallback line"], "with no step drafts the legacy line list is kept");

  assert.deepEqual(expectedControlIdList({ expectedControlIds: " A , ,B, A " }), ["A", "B"]);
  assert.equal(cleanStep({ writtenStep: " x ", roleTag: "pm call", targetControlId: " flap_selector ", expectedControlIds: "A,,B", itemKind: "NONSENSE" }).itemKind, "GENERIC");
  assert.equal(cleanStep({ writtenStep: "x", roleTag: "pm call" }).roleTag, "PM CALL");
  assert.equal(normalizeStep({ writtenStep: "2. FLAPS" }).writtenStep, "FLAPS");
});

test("a saved edit replaces the displayed procedure and renumbers the checklist", () => {
  const source = { title: "Published title", trigger: "Published trigger", memoryItems: ["OLD"], steps: ["1. OLD"], notes: ["old note"] };
  assert.equal(applyDraftToDetail(source, null), source, "no draft leaves the published detail untouched");
  const detail = applyDraftToDetail(source, draftFixture());
  assert.equal(detail.title, "Engine Fire in Flight");
  assert.equal(detail.trigger, "Fire warning in flight");
  assert.deepEqual(detail.memoryItems, ["POWER LEVER L — IDLE"]);
  assert.deepEqual(detail.steps, ["1. FLAPS — UP"], "flow steps are renumbered from 1");
  assert.deepEqual(detail.notes, ["Land as soon as practicable."]);
  assert.equal(detail.edited, true);

  const blankTitle = applyDraftToDetail(source, Object.assign(draftFixture(), { title: "  " }));
  assert.equal(blankTitle.title, "Published title", "a blank edit falls back to the published value");
  assert.equal(normalizedMemorySteps({ memoryItems: ["A"], memoryStepDrafts: [] }).length, 1, "legacy line lists still produce steps");
  assert.equal(normalizedFlowSteps({ flowItems: ["A", "B"], flowStepDrafts: [] })[1].roleTag, "PF CMD");
});

test("structured edits rebuild the step text; typed text never overrides a manual pick", () => {
  const step = { writtenStep: "", itemKind: "ITEM_POSITION", targetControlId: "FLAP_SELECTOR", targetPosition: "UP", expectedControlIds: "" };
  const applied = applyStructure(CATALOG, step, { targetPosition: "FULL" });
  assert.equal(applied.writtenStep, "FLAPS — FULL");
  assert.equal(applied.expectedControlIds, "FLAP_SELECTOR");

  const typed = autoStructure(CATALOG, { itemKind: "GENERIC", targetControlId: "", targetPosition: "", expectedControlIds: "" }, "PF — FLAPS — UP");
  assert.equal(typed.writtenStep, "FLAPS — UP", "the role prefix is stripped as you type");
  assert.equal(typed.itemKind, "ITEM_POSITION");
  assert.equal(typed.targetControlId, "FLAP_SELECTOR");
  assert.equal(typed.targetPosition, "UP");

  const manual = autoStructure(CATALOG, { itemKind: "SPOKEN_LINE", targetControlId: "POWER_LEVER_L", targetPosition: "IDLE", expectedControlIds: "POWER_LEVER_L" }, "FLAPS — UP");
  assert.equal(manual.itemKind, "SPOKEN_LINE", "an author's kind is never overridden");
  assert.equal(manual.targetControlId, "POWER_LEVER_L", "an author's control is never overridden");
});

test("authoring warnings never invent aviation data and never block on style", () => {
  assert.ok(validateDraft(CATALOG, { title: "", memoryStepDrafts: [], flowStepDrafts: [] }).some((w) => w.level === "error" && /title/.test(w.text)));
  assert.ok(validateDraft(CATALOG, { title: "T", memoryStepDrafts: [], flowStepDrafts: [] }).some((w) => w.level === "error" && /at least one/.test(w.text)));
  const missingControl = validateDraft(CATALOG, { title: "T", memoryStepDrafts: [{ writtenStep: "x", itemKind: "ITEM_POSITION", targetControlId: "", targetPosition: "" }], flowStepDrafts: [] });
  assert.ok(missingControl.some((w) => w.level === "warn" && /no cockpit control/.test(w.text)));
  assert.ok(missingControl.every((w) => w.level !== "error"), "a half-finished step is a warning, not a blocker");
  const unknown = validateDraft(CATALOG, { title: "T", memoryStepDrafts: [{ writtenStep: "x", itemKind: "GENERIC", expectedControlIds: "NOT_A_CONTROL" }], flowStepDrafts: [] });
  assert.ok(unknown.some((w) => /not in the cockpit catalogue/.test(w.text)));
  assert.deepEqual(validateDraft(CATALOG, draftFixture()), [], "a complete draft is clean");
});

/* ==================================================== store: ids and caps */
test("procedure ids are validated and account ids are unguessable and isolated", async () => {
  assert.equal(normalizeProcedureId("EMERGENCY/Engine Fire in Flight [Airborne]"), "EMERGENCY/Engine Fire in Flight [Airborne]");
  assert.equal(normalizeProcedureId("  "), null);
  assert.equal(normalizeProcedureId("../secrets"), null);
  assert.equal(normalizeProcedureId("a\nb"), null);
  assert.equal(normalizeProcedureId("x".repeat(200)), null);

  const owner = await accountIdFor({ role: "owner", payload: { email: "Owner@Example.com" } });
  const ownerAgain = await accountIdFor({ role: "owner", payload: { email: "owner@example.com" } });
  const subscriber = await accountIdFor({ role: "subscriber", payload: { key: "DHC6-ABCD-EFGH-JKLM" } });
  assert.equal(owner, ownerAgain, "the owner id is case-insensitive and stable");
  assert.notEqual(owner, subscriber);
  assert.match(owner, /^[0-9a-f]{32}$/);
  assert.doesNotMatch(owner, /example/i, "no address or licence key ever appears in a KV key");
});

test("write permission follows AccessPolicy.canEditQrh", () => {
  assert.equal(canEditQrh({ ok: true, role: "owner" }), true);
  assert.equal(canEditQrh({ ok: true, role: "subscriber", plan: "instructor_annual" }), true);
  assert.equal(canEditQrh({ ok: true, role: "subscriber", plan: "enterprise" }), true);
  assert.equal(canEditQrh({ ok: true, role: "subscriber", plan: "premium_annual" }), false);
  assert.equal(canEditQrh({ ok: true, role: "subscriber", plan: "desktop" }), false);
  assert.equal(canEditQrh({ ok: false }), false);
  assert.equal(canEditQrh(null), false);
});

test("the server sanitises every draft it stores", () => {
  assert.equal(sanitizeDraft(null), null);
  assert.equal(sanitizeDraft({ title: "" }), null, "a draft with no title is refused");
  assert.equal(sanitizeDraft({ title: "T" }), null, "a draft with no steps at all is refused");

  const clean = sanitizeDraft({
    title: " Long ".repeat(80),
    trigger: "t",
    memoryItems: ["a"],
    flowItems: [],
    notes: ["n", ""],
    memoryStepDrafts: [{ writtenStep: "x".repeat(2000), roleTag: "pm call", itemKind: "NOT_A_KIND", targetControlId: " flaps ", requiresConfirmation: false }, { writtenStep: "   " }],
    flowStepDrafts: []
  });
  assert.ok(clean.title.length <= LIMITS.title);
  assert.equal(clean.memoryStepDrafts.length, 1, "empty steps are dropped");
  assert.equal(clean.memoryStepDrafts[0].writtenStep.length, LIMITS.stepText);
  assert.equal(clean.memoryStepDrafts[0].itemKind, "GENERIC", "an unknown item kind is normalised");
  assert.equal(clean.memoryStepDrafts[0].targetControlId, "FLAPS");
  assert.equal(clean.memoryStepDrafts[0].requiresConfirmation, false);
  assert.deepEqual(clean.notes, ["n"]);

  const tooMany = sanitizeDraft({ title: "T", memoryStepDrafts: Array.from({ length: 400 }, (_, i) => ({ writtenStep: "s" + i })) });
  assert.equal(tooMany.memoryStepDrafts.length, LIMITS.steps, "the step count is capped");

  const huge = sanitizeDraft({ title: "T", notes: ["n"], memoryStepDrafts: Array.from({ length: 120 }, () => ({ writtenStep: "x".repeat(600), spokenWording: "y".repeat(600), mccCrmNote: "z".repeat(600) })) });
  assert.equal(huge, null, "an oversized draft is refused outright");
});

/* ============================================================ the API */
test("QRH edits refuse anonymous and lapsed sessions", async () => {
  const env = envWithLicense();
  const anon = await editsGet({ request: req("GET", null, {}), env });
  assert.equal(anon.status, 401);
  const anonWrite = await editsPut({ request: req("PUT", PROC, { body: { draft: draftFixture() } }), env });
  assert.equal(anonWrite.status, 401);

  const lapsed = envWithLicense(activeLicense({ status: "expired" }));
  const response = await editsGet({ request: req("GET", PROC, { cookie: await cookieFor() }), env: lapsed });
  assert.equal(response.status, 403);
});

test("a Pro subscriber may read their own edits but never write one", async () => {
  const env = envWithLicense();
  const cookie = await cookieFor();

  const list = await editsGet({ request: req("GET", null, { cookie: cookie }), env });
  assert.equal(list.status, 200);
  const listBody = await list.json();
  assert.equal(listBody.canEdit, false, "premium_annual has no QRH_MANUAL_EDIT entitlement");
  assert.deepEqual(listBody.items, []);
  assert.equal(list.headers.get("Cache-Control"), "private, no-store");
  assert.match(list.headers.get("Vary"), /Cookie/);

  const refused = await editsPut({ request: req("PUT", PROC, { cookie: cookie, body: { draft: draftFixture() } }), env });
  assert.equal(refused.status, 403);
  assert.equal((await refused.json()).error, "qrh_edit_not_permitted");
  const refusedDelete = await editsDelete({ request: req("DELETE", PROC, { cookie: cookie }), env });
  assert.equal(refusedDelete.status, 403);

  const missing = await editsGet({ request: req("GET", PROC, { cookie: cookie }), env });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).edited, false);
});

test("an instructor can save, read back and reset a QRH edit", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "instructor@example.com", plan: "instructor_annual" });
  const env = envWithLicense(instructor);
  const cookie = await cookieFor(instructor);

  const saved = await editsPut({ request: req("PUT", PROC, { cookie: cookie, body: { draft: draftFixture() } }), env });
  assert.equal(saved.status, 200);
  const savedBody = await saved.json();
  assert.equal(savedBody.edited, true);
  assert.equal(savedBody.draft.title, "Engine Fire in Flight");
  assert.equal(saved.headers.get("Cache-Control"), "private, no-store");

  const read = await editsGet({ request: req("GET", PROC, { cookie: cookie }), env });
  assert.equal(read.status, 200);
  const readBody = await read.json();
  assert.equal(readBody.canEdit, true);
  assert.deepEqual(readBody.draft.memoryStepDrafts[0].targetControlId, "POWER_LEVER_L");

  const list = await editsGet({ request: req("GET", null, { cookie: cookie }), env });
  const listBody = await list.json();
  assert.equal(listBody.items.length, 1);
  assert.equal(listBody.items[0].procedureId, PROC);
  assert.equal(listBody.items[0].title, "Engine Fire in Flight");

  // the published content is untouched — only the account's own namespace was written
  const keys = [...env.LICENSES.map.keys()];
  assert.ok(keys.some((k) => k.startsWith(QRH_EDIT_PREFIX)));
  assert.ok(!keys.some((k) => k.startsWith("webcontent:")), "no published pack was modified");
  assert.ok(!keys.some((k) => k.indexOf(PROC) > -1), "the procedure title never appears in a KV key");

  const reset = await editsDelete({ request: req("DELETE", PROC, { cookie: cookie }), env });
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).edited, false);
  const afterReset = await editsGet({ request: req("GET", PROC, { cookie: cookie }), env });
  assert.equal(afterReset.status, 404);
});

test("one account can never see another account's edits", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "instructor@example.com", plan: "instructor_annual" });
  const env = envWithLicense(instructor);
  await editsPut({ request: req("PUT", PROC, { cookie: await cookieFor(instructor), body: { draft: draftFixture() } }), env });

  // a second active account sharing the same KV namespace
  const other = activeLicense({ key: "DHC6-OTHR-OTHR-OTHR", email: "other@example.com", plan: "instructor_annual" });
  env.LICENSES.map.set("license:" + other.key, JSON.stringify(other));
  env.LICENSES.map.set("email:" + other.email, other.key);
  const otherCookie = await cookieFor(other);

  const read = await editsGet({ request: req("GET", PROC, { cookie: otherCookie }), env });
  assert.equal(read.status, 404, "the other account sees the published procedure, not the edit");
  const list = await editsGet({ request: req("GET", null, { cookie: otherCookie }), env });
  assert.deepEqual((await list.json()).items, []);

  // and the owner is a third, separate namespace
  const ownerSession = await createOwnerWebSession(SECRET, "owner@example.com");
  const ownerRead = await editsGet({ request: req("GET", PROC, { token: ownerSession.token }), env });
  assert.equal(ownerRead.status, 404);
});

test("an edit is retained while the entitlement lapses and returns on renewal", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "instructor@example.com", plan: "instructor_annual" });
  const env = envWithLicense(instructor);
  const cookie = await cookieFor(instructor);
  await editsPut({ request: req("PUT", PROC, { cookie: cookie, body: { draft: draftFixture() } }), env });
  const storedKeys = [...env.LICENSES.map.keys()].filter((k) => k.startsWith(QRH_EDIT_PREFIX));
  assert.equal(storedKeys.length, 2, "one draft record and one index");

  // lapse: same KV, inactive licence
  const lapsedRecord = Object.assign({}, instructor, { status: "canceled" });
  env.LICENSES.map.set("license:" + instructor.key, JSON.stringify(lapsedRecord));
  const blocked = await editsGet({ request: req("GET", PROC, { cookie: cookie }), env });
  assert.equal(blocked.status, 403, "a lapsed entitlement cannot reach the edit");
  assert.deepEqual([...env.LICENSES.map.keys()].filter((k) => k.startsWith(QRH_EDIT_PREFIX)), storedKeys, "nothing was deleted");

  // renew
  env.LICENSES.map.set("license:" + instructor.key, JSON.stringify(instructor));
  const restored = await editsGet({ request: req("GET", PROC, { cookie: cookie }), env });
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).draft.title, "Engine Fire in Flight");
});

test("bad input is rejected before anything is stored", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "instructor@example.com", plan: "instructor_annual" });
  const env = envWithLicense(instructor);
  const cookie = await cookieFor(instructor);

  const badId = await editsPut({ request: new Request(ORIGIN + "/api/qrh-edits/" + encodeURIComponent("../escape"), { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ draft: draftFixture() }) }), env });
  assert.equal(badId.status, 400);
  const badJson = await editsPut({ request: req("PUT", PROC, { cookie: cookie, body: "{not json" }), env });
  assert.equal(badJson.status, 400);
  const badDraft = await editsPut({ request: req("PUT", PROC, { cookie: cookie, body: { draft: { title: "" } } }), env });
  assert.equal(badDraft.status, 422);
  assert.equal([...env.LICENSES.map.keys()].filter((k) => k.startsWith(QRH_EDIT_PREFIX)).length, 0, "nothing was written");
});

/* ============================================================== worker */
test("the Worker routes /api/qrh-edits with the session gate and rejects other methods", async () => {
  const instructor = activeLicense({ key: "DHC6-INST-INST-INST", email: "instructor@example.com", plan: "instructor_annual" });
  const env = envWithLicense(instructor);
  env.ASSETS = { fetch: async () => new Response("asset", { status: 200 }) };
  const cookie = await cookieFor(instructor);

  const anon = await worker.fetch(new Request(ORIGIN + "/api/qrh-edits"), env, {});
  assert.equal(anon.status, 401);

  const put = await worker.fetch(new Request(ORIGIN + "/api/qrh-edits/" + encodeURIComponent(PROC), { method: "PUT", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ draft: draftFixture() }) }), env, {});
  assert.equal(put.status, 200);
  const get = await worker.fetch(new Request(ORIGIN + "/api/qrh-edits", { headers: { Cookie: cookie } }), env, {});
  assert.equal(get.status, 200);
  assert.equal((await get.json()).items.length, 1);

  const post = await worker.fetch(new Request(ORIGIN + "/api/qrh-edits", { method: "POST", headers: { Cookie: cookie } }), env, {});
  assert.equal(post.status, 405);

  const routes = await (await worker.fetch(new Request(ORIGIN + "/api"), env, {})).json();
  assert.ok(routes.routes.includes("/api/qrh-edits"));
  assert.ok(routes.routes.includes("/api/qrh-edits/:procedureId"));
});

/* =========================================================== the client */
test("the browser client and editor never cache protected drafts or bypass the API", () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const client = fs.readFileSync(path.join(root, "app", "js", "qrhedits.js"), "utf8");
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /cache: "no-store"/);
  assert.match(client, /\/api\/qrh-edits/);
  assert.match(client, /resetQrhEditCache/);

  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.doesNotMatch(sw, /qrh-edits/, "the service worker never caches the edit API");

  const editor = fs.readFileSync(path.join(root, "app", "js", "screens", "qrhmanualedit.js"), "utf8");
  assert.match(editor, /does not replace the approved AFM/, "the editor carries the training-support-only disclaimer");
  assert.match(editor, /Instructor, Admin, or Owner access/, "the Android lock copy is shown to an unpermitted account");

  const detail = fs.readFileSync(path.join(root, "app", "js", "screens", "procedures.js"), "utf8");
  assert.match(detail, /applyDraftToDetail/, "a saved edit replaces the displayed procedure");
  assert.match(detail, /#\/qrh\/edit\//, "the Edit QRH button opens the editor when permitted");
});
