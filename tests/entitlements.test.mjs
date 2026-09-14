/*
  One tier model, and a visible difference between the plans.

  The complaint: there was no difference between Premium and Instructor. Almost
  true - the web app had exactly two plan-dependent behaviours, QRH manual edit
  and publishing to the shared shelf, each with its own hand-written
  `plan.indexOf("instructor") === 0`. `enterprise` was indistinguishable from
  `instructor`, `premium` from the legacy `desktop` plan, and nothing anywhere
  told a subscriber what their plan included.

  The full FREE/PRO/INSTRUCTOR/ENTERPRISE model already existed in
  play/validate-purchase.js, written to Firestore for Android and read by no web
  code path at all. It now lives in _entitlements.js and both sides read it.

  The rule these tests exist to hold: introducing the layer must take NOTHING
  away from anybody paying today.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  FREE_ENTITLEMENTS, PRO_ENTITLEMENTS, INSTRUCTOR_ENTITLEMENTS, ENTERPRISE_ENTITLEMENTS,
  entitlementsForTier, entitlementsFor, hasEntitlement, tierForPlan, tierFor,
  lowestTierWith, tierRank, maxTier, tierLabel,
  AI_TRAINER, QRH_MANUAL_EDIT, CONTENT_AUTHORING, ORGANIZATION_MANAGEMENT,
  PRO, INSTRUCTOR, ENTERPRISE, FREE
} from "../functions/api/_entitlements.js";
import { canEditQrh } from "../functions/api/qrh-edits/_store.js";
import { canPublish } from "../functions/api/library/_store.js";
import { onRequestPost as oralExam } from "../functions/api/ai/oral-exam.js";
import { onRequestGet as verify } from "../functions/api/web-access/verify.js";
import { onRequestPost as webSession } from "../functions/api/web-access/session.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense, jsonRequest, mockFetch, jsonResponse, TEST_SERVICE_ACCOUNT_KEY } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://dhc6trainer.com";

const authFor = (plan) => ({ ok: true, role: "subscriber", plan: plan });
const ownerAuth = { ok: true, role: "owner", plan: "owner" };

/* ------------------------------------------- Nothing is taken away from anyone */

test("a premium subscriber keeps every training feature they have today", () => {
  /* The decision that governs this whole change. Premium is PRO, and PRO holds
     the 3D Technical Lab, the AI trainer, logbook sync and the readiness
     analysis. Gating any of those behind Instructor would remove something a
     paying customer can open right now. */
  const premium = entitlementsFor(authFor("premium_annual"));
  ["FULL_STUDY", "SYSTEMS_LAB_3D", "AI_TRAINER", "QRH_DRILLS",
   "ADVANCED_SCENARIOS", "CLOUD_SYNC", "TRAINING_INTELLIGENCE"].forEach(function (e) {
    assert.ok(premium.indexOf(e) >= 0, "premium must keep " + e);
  });
});

test("the legacy desktop plan is not demoted to free", () => {
  /* Records written before the plan model existed carry `desktop`, and those
     are real paying customers. Resolving them to FREE would lock them out of
     the product they bought. */
  assert.equal(tierForPlan("desktop"), PRO);
  assert.equal(tierForPlan("desktop_annual"), PRO);
  assert.equal(tierForPlan(""), PRO);
  assert.equal(tierForPlan(null), PRO);
});

test("an unrecognised plan on an active licence keeps its training content", () => {
  /* By the time a plan string is read the status allowlist has already decided
     the subscription is good. A typo in a plan name must not cost a paying
     pilot their content - it costs them authoring, which fails the right way. */
  assert.equal(tierForPlan("premium_quarterly_promo_2027"), PRO);
  assert.ok(hasEntitlement(authFor("nonsense"), "SYSTEMS_LAB_3D"));
  assert.equal(hasEntitlement(authFor("nonsense"), QRH_MANUAL_EDIT), false);
});

/* ------------------------------------------------------- The tiers themselves */

test("each tier contains the one below it", () => {
  const nested = [FREE_ENTITLEMENTS, PRO_ENTITLEMENTS, INSTRUCTOR_ENTITLEMENTS, ENTERPRISE_ENTITLEMENTS];
  for (let i = 1; i < nested.length; i++) {
    nested[i - 1].forEach(function (e) {
      assert.ok(nested[i].indexOf(e) >= 0, "tier " + i + " must keep " + e);
    });
  }
});

test("the entitlement lists still match what Google Play shipped", () => {
  /*
    These lists are read by the Android client through Firestore. Moving them
    for the web's benefit must not change a single entry, or a purchase made on
    Play stops granting what it granted yesterday. Transcribed from the
    original play/validate-purchase.js.
  */
  assert.deepEqual(FREE_ENTITLEMENTS, ["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"]);
  assert.deepEqual(PRO_ENTITLEMENTS, [
    "BASIC_STUDY", "FULL_STUDY", "SYSTEMS_LAB_3D", "FLASHCARD_SELF_ENTRY",
    "AI_TRAINER", "QRH_DRILLS", "ADVANCED_SCENARIOS", "CLOUD_SYNC", "TRAINING_INTELLIGENCE"
  ]);
  assert.deepEqual(INSTRUCTOR_ENTITLEMENTS.slice().sort(), [
    "BASIC_STUDY", "FULL_STUDY", "SYSTEMS_LAB_3D", "FLASHCARD_SELF_ENTRY",
    "AI_TRAINER", "QRH_DRILLS", "ADVANCED_SCENARIOS", "CLOUD_SYNC", "TRAINING_INTELLIGENCE",
    "INSTRUCTOR_TOOLS", "CONTENT_AUTHORING", "QRH_MANUAL_EDIT", "CORPORATE_REPORTS"
  ].sort());
  assert.deepEqual(ENTERPRISE_ENTITLEMENTS.slice().sort(), [
    "BASIC_STUDY", "FULL_STUDY", "SYSTEMS_LAB_3D", "FLASHCARD_SELF_ENTRY",
    "QRH_DRILLS", "AI_TRAINER", "ADVANCED_SCENARIOS", "CLOUD_SYNC", "TRAINING_INTELLIGENCE",
    "COCKPIT_DEBUG_TOOLS", "QRH_MANUAL_EDIT", "CONTENT_PACK_MANAGEMENT",
    "INSTRUCTOR_TOOLS", "CONTENT_AUTHORING", "ORGANIZATION_MANAGEMENT", "CORPORATE_REPORTS"
  ].sort());
});

test("enterprise is no longer the same thing as instructor", () => {
  /* Both permission functions used to treat the two prefixes as one set, so an
     operator paying the enterprise price got exactly the instructor product. */
  assert.ok(hasEntitlement(authFor("enterprise_annual"), ORGANIZATION_MANAGEMENT));
  assert.equal(hasEntitlement(authFor("instructor_annual"), ORGANIZATION_MANAGEMENT), false);
  assert.ok(hasEntitlement(authFor("enterprise_annual"), "CONTENT_PACK_MANAGEMENT"));
  assert.equal(hasEntitlement(authFor("instructor_annual"), "CONTENT_PACK_MANAGEMENT"), false);
});

test("a plan that merely starts with instructor is not an instructor", () => {
  /* `plan.indexOf("instructor") === 0` granted authoring to anything with that
     prefix. The boundary is now explicit. */
  assert.equal(tierForPlan("instructorship_annual"), PRO);
  assert.equal(tierForPlan("enterprises_monthly"), PRO);
  assert.equal(tierForPlan("premiumish"), PRO);
  assert.equal(tierForPlan("instructor"), INSTRUCTOR, "no billing cycle is still an instructor");
  assert.equal(tierForPlan("instructor_monthly"), INSTRUCTOR);
});

test("the owner owns the product", () => {
  assert.equal(tierFor(ownerAuth), ENTERPRISE);
  assert.ok(hasEntitlement(ownerAuth, ORGANIZATION_MANAGEMENT));
});

test("an unauthorised request has nothing", () => {
  assert.equal(tierFor({ ok: false }), FREE);
  assert.equal(hasEntitlement({ ok: false }, AI_TRAINER), false);
  assert.equal(hasEntitlement(null, AI_TRAINER), false);
  assert.equal(hasEntitlement(authFor("premium_annual"), ""), false);
});

test("tier helpers rank, cap and name correctly", () => {
  assert.ok(tierRank(ENTERPRISE) > tierRank(INSTRUCTOR));
  assert.ok(tierRank(INSTRUCTOR) > tierRank(PRO));
  assert.equal(maxTier(PRO, INSTRUCTOR), INSTRUCTOR);
  assert.equal(maxTier(ENTERPRISE, PRO), ENTERPRISE);
  assert.equal(tierRank("nonsense"), 0);
  assert.equal(entitlementsForTier("nonsense"), FREE_ENTITLEMENTS);
  assert.equal(lowestTierWith(QRH_MANUAL_EDIT), INSTRUCTOR);
  assert.equal(lowestTierWith(ORGANIZATION_MANAGEMENT), ENTERPRISE);
  assert.equal(lowestTierWith(AI_TRAINER), PRO);
  assert.equal(lowestTierWith("NOT_A_THING"), null);
  assert.equal(tierLabel(PRO), "Premium");
  assert.equal(tierLabel(INSTRUCTOR), "Instructor");
});

/* --------------------------------------- The two existing gates still behave */

test("the authoring gates answer exactly as they did, through the new layer", () => {
  /* Same matrix the old plan-string tests asserted. The mechanism changed; the
     answer must not have. */
  [[ownerAuth, true], [authFor("instructor_annual"), true], [authFor("enterprise_annual"), true],
   [authFor("premium_annual"), false], [authFor("desktop"), false],
   [{ ok: false }, false], [null, false]].forEach(function (pair) {
    assert.equal(canEditQrh(pair[0]), pair[1]);
    assert.equal(canPublish(pair[0]), pair[1]);
  });
});

test("the gates ask the entitlement, not the plan string", () => {
  const qrh = fs.readFileSync(path.join(root, "functions", "api", "qrh-edits", "_store.js"), "utf8");
  const library = fs.readFileSync(path.join(root, "functions", "api", "library", "_store.js"), "utf8");
  assert.match(qrh, /hasEntitlement\(auth, QRH_MANUAL_EDIT\)/);
  assert.match(library, /hasEntitlement\(auth, CONTENT_AUTHORING\)/);
  assert.doesNotMatch(qrh, /indexOf\("instructor"\)/, "the hand-written plan test must be gone");
  assert.doesNotMatch(library, /indexOf\("instructor"\)/);
});

test("the Play validator reads the shared table rather than its own copy", () => {
  const play = fs.readFileSync(path.join(root, "functions", "api", "play", "validate-purchase.js"), "utf8");
  assert.match(play, /from "\.\.\/_entitlements\.js"/);
  assert.doesNotMatch(play, /const PRO_ENTITLEMENTS = \[/, "one table, not two");
});

/* ------------------------------------------------ What the browser is told */

async function verifyAs(env, license) {
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const response = await verify({
    request: new Request(ORIGIN + "/api/web-access/verify", { headers: { cookie: SESSION_COOKIE + "=" + session.token } }),
    env: env
  });
  return response.json();
}

test("verify tells the browser its tier and what it includes", () => {
  const license = activeLicense({ plan: "instructor_annual" });
  return verifyAs(envWithLicense(license), license).then(function (body) {
    assert.equal(body.ok, true);
    assert.equal(body.tier, INSTRUCTOR);
    assert.ok(body.entitlements.indexOf(QRH_MANUAL_EDIT) >= 0);
    assert.equal(body.entitlements.indexOf(ORGANIZATION_MANAGEMENT), -1);
  });
});

test("a premium subscriber is told they are Premium, not Instructor", async () => {
  const license = activeLicense({ plan: "premium_annual" });
  const body = await verifyAs(envWithLicense(license), license);
  assert.equal(body.tier, PRO);
  assert.equal(body.entitlements.indexOf(QRH_MANUAL_EDIT), -1);
  assert.ok(body.entitlements.indexOf("SYSTEMS_LAB_3D") >= 0, "and still has the Technical Lab");
});

test("the tier comes from the licence record, never from the token", async () => {
  /*
    A downgrade has to bite before the 12-hour session expires. The token still
    carries a plan field for compatibility; nothing may trust it.
  */
  const license = activeLicense({ plan: "instructor_annual" });
  const env = envWithLicense(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);

  await env.LICENSES.put("license:" + license.key, JSON.stringify(Object.assign({}, license, { plan: "premium_annual" })));

  const body = await (await verify({
    request: new Request(ORIGIN + "/api/web-access/verify", { headers: { cookie: SESSION_COOKIE + "=" + session.token } }),
    env: env
  })).json();

  assert.equal(body.tier, PRO, "the downgrade applies on the next request, not in twelve hours");
  assert.equal(body.entitlements.indexOf(QRH_MANUAL_EDIT), -1);
});

test("an owner verifies as enterprise", async () => {
  const env = envWithLicense();
  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, "owner@example.com");
  const body = await (await verify({
    request: new Request(ORIGIN + "/api/web-access/verify", { headers: { cookie: SESSION_COOKIE + "=" + session.token } }),
    env: env
  })).json();
  assert.equal(body.tier, ENTERPRISE);
  assert.ok(body.entitlements.indexOf(ORGANIZATION_MANAGEMENT) >= 0);
});

test("signing in carries the tier too, so the first paint is right", async () => {
  const license = activeLicense({ plan: "instructor_annual" });
  const env = envWithLicense(license);
  const response = await webSession({
    request: jsonRequest(ORIGIN + "/api/web-access/session", { email: license.email, licenseKey: license.key }),
    env: env
  });
  const body = await response.json();
  assert.equal(body.tier, INSTRUCTOR);
  assert.ok(body.entitlements.indexOf(CONTENT_AUTHORING) >= 0);
});

/* ------------------------------------------------------- The AI oral exam */


const OPENAI_OK = () => jsonResponse({ output: [{ content: [{ text: "ask about the fuel system" }] }] });
const examBody = { instructions: "Examine the candidate.", input: [{ role: "user", content: "ready" }] };

function examEnv(extra) {
  return Object.assign(envWithLicense(activeLicense()), {
    OPENAI_API_KEY: "sk-test",
    FIREBASE_PROJECT_ID: "dhc6-test",
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "svc@dhc6-test.iam.gserviceaccount.com",
    GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: TEST_SERVICE_ACCOUNT_KEY
  }, extra || {});
}

/* Firestore + Google OAuth doubles. `playEntitlements` is what Play validation
   previously wrote for this Firebase user. */
function firebaseAndFirestore(playEntitlements, tier) {
  return async function (url) {
    if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "token", expires_in: 3600 });
    if (/identitytoolkit.*accounts:lookup/.test(url)) return jsonResponse({ users: [{ localId: "uid-1", email: "android@example.com" }] });
    if (/firestore\.googleapis\.com/.test(url)) {
      return jsonResponse({ fields: {
        tier: { stringValue: tier || "PRO" },
        entitlements: { arrayValue: { values: (playEntitlements || []).map(function (e) { return { stringValue: e }; }) } }
      } });
    }
    if (/api\.openai\.com/.test(url)) return OPENAI_OK();
    return jsonResponse({}, 404);
  };
}

async function callExam(env, headers, handler) {
  const fetchMock = mockFetch(handler);
  try {
    const response = await oralExam({
      request: jsonRequest(ORIGIN + "/api/ai/oral-exam", examBody, headers),
      env: env
    });
    return { status: response.status, body: await response.json() };
  } finally {
    fetchMock.restore();
  }
}

test("a misconfigured entitlement check fails closed, not open", async () => {
  /* If the service account is missing, readCurrentEntitlements throws. That
     must be a refusal, never a 500 and never a way through. */
  const env = examEnv();
  delete env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY;
  const result = await callExam(env, { Authorization: "Bearer firebase-id-token" },
    firebaseAndFirestore(["AI_TRAINER"]));
  assert.equal(result.status, 503);
  assert.equal(result.body.error, "entitlement_check_unavailable");
});

test("an anonymous request cannot spend the OpenAI key", async () => {
  const result = await callExam(examEnv(), {}, firebaseAndFirestore([]));
  assert.equal(result.status, 401);
  assert.equal(result.body.error, "firebase_token_missing");
});

test("a signed-in subscriber gets the examiner", async () => {
  const license = activeLicense({ plan: "premium_annual" });
  const env = Object.assign(examEnv(), { LICENSES: envWithLicense(license).LICENSES });
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const result = await callExam(env, { cookie: SESSION_COOKIE + "=" + session.token }, firebaseAndFirestore([]));
  assert.equal(result.status, 200, "premium includes AI_TRAINER");
});

test("an Android user who bought the entitlement still gets through", async () => {
  /*
    The reason this endpoint could not simply be moved behind the web session:
    the Android app authenticates with a Firebase token, and locking it out
    would have broken the client the feature was built for.
  */
  const result = await callExam(examEnv(), { Authorization: "Bearer firebase-id-token" },
    firebaseAndFirestore(["BASIC_STUDY", "AI_TRAINER"]));
  assert.equal(result.status, 200);
});

test("an Android user who did not buy it is refused, and told what it needs", async () => {
  /* The hole: this was any valid Firebase account in the project, spending the
     operator's OpenAI credit. */
  const result = await callExam(examEnv(), { Authorization: "Bearer firebase-id-token" },
    firebaseAndFirestore(["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"]));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "entitlement_required");
  assert.equal(result.body.requiredTier, PRO);
  assert.match(result.body.message, /Premium/);
});

test("a Firebase account with no purchase at all is refused", async () => {
  const result = await callExam(examEnv(), { Authorization: "Bearer firebase-id-token" },
    async function (url) {
      if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "t", expires_in: 3600 });
      if (/identitytoolkit/.test(url)) return jsonResponse({ users: [{ localId: "uid-2" }] });
      if (/firestore/.test(url)) return jsonResponse({}, 404);
      if (/openai/.test(url)) return OPENAI_OK();
      return jsonResponse({}, 404);
    });
  assert.equal(result.status, 403);
});

test("a lapsed web session is reported as lapsed, not retried as an Android caller", async () => {
  /* Falling through on every failure would let a subscriber whose entitlement
     had run out present a Firebase token instead and carry on. */
  const license = activeLicense({ plan: "premium_annual" });
  const env = Object.assign(examEnv(), { LICENSES: envWithLicense(license).LICENSES });
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  await env.LICENSES.put("license:" + license.key, JSON.stringify(Object.assign({}, license, { status: "canceled" })));

  const result = await callExam(env, { cookie: SESSION_COOKIE + "=" + session.token },
    firebaseAndFirestore(["AI_TRAINER"]));
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "subscription_inactive");
});

test("the endpoint no longer trusts a Firebase token on its own", () => {
  const source = fs.readFileSync(path.join(root, "functions", "api", "ai", "oral-exam.js"), "utf8");
  assert.match(source, /hasEntitlement\(web, AI_TRAINER\)/);
  assert.match(source, /indexOf\(AI_TRAINER\) < 0/, "the Play path must check the entitlement too");
  assert.doesNotMatch(source, /const auth = await verifyFirebaseUser\(context\);\s*\n\s*if \(!auth\.ok\) return auth\.response;\s*\n\s*\n\s*if \(!env\.OPENAI_API_KEY\)/,
    "the old token-only gate must be gone");
});

/* ------------------------------------------------------------ The front end */

test("the app knows what the plan includes, and says so", () => {
  const core = fs.readFileSync(path.join(root, "app", "js", "core.js"), "utf8");
  assert.match(core, /export const Entitlements/);
  assert.match(core, /export function featureStatus/);
  assert.match(core, /locked: "Upgrade"/);
  assert.match(core, /requires: "AI_TRAINER"/);

  const app = fs.readFileSync(path.join(root, "app", "app.js"), "utf8");
  assert.match(app, /Entitlements\.set\(data\.entitlements, data\.tier\)/,
    "the session answer has to actually reach the registry");
  assert.match(app, /tierLabel\(data\.tier\)/, "the chip names the tier, not the raw plan string");

  const misc = fs.readFileSync(path.join(root, "app", "js", "screens", "misc.js"), "utf8");
  assert.match(misc, /planCard\(session, plan\)/);
  assert.match(misc, /Included with/, "a feature the plan lacks must say which plan has it");

  const dash = fs.readFileSync(path.join(root, "app", "js", "screens", "dashboard.js"), "utf8");
  assert.doesNotMatch(dash, /feature\("[a-z-]+"\)\.status/,
    "tiles must show the effective status, not the raw registry one");
});

test("an unbuilt feature says Coming later, never Upgrade", async () => {
  /*
    The commercially convenient lie this prevents: telling somebody to buy a
    tier for a screen nobody can use yet.

    The oral exam used to be the live example - entitled but unbuilt. It
    shipped, and with it the registry ran out of unbuilt features that require
    an entitlement, which left this rule with no fixture. Rather than let the
    coverage lapse quietly, or pin it to whichever row happens to be unfinished
    next, the rule is exercised against a feature added for the length of the
    test. FEATURES is a plain exported array, so this is the real function
    making the real decision.
  */
  const core = await import("../app/js/core.js");
  core.Entitlements.set(PRO_ENTITLEMENTS, PRO);
  assert.ok(PRO_ENTITLEMENTS.indexOf(AI_TRAINER) >= 0, "this tier does hold it");

  core.FEATURES.push({ id: "test-unbuilt", title: "Unbuilt", route: "#/nowhere", requires: AI_TRAINER, status: "later", desc: "" });
  try {
    assert.equal(core.featureStatus("test-unbuilt"), "later", "unbuilt beats entitled");
    /* The half that actually costs money if it breaks: a tier that does NOT
       hold the entitlement must still be told the screen does not exist,
       rather than be sold an upgrade for it. */
    core.Entitlements.set(["BASIC_STUDY"], "FREE");
    assert.equal(core.featureStatus("test-unbuilt"), "later", "unbuilt is never an upsell");
  } finally {
    core.FEATURES.pop();
    core.Entitlements.set(PRO_ENTITLEMENTS, PRO);
  }

  /* And the oral exam, now that it is built, reads as available to a tier that
     holds AI_TRAINER rather than staying stuck on its old status. */
  assert.equal(core.feature("oral-exam").requires, AI_TRAINER);
  assert.equal(core.featureStatus("oral-exam"), "available");
  assert.equal(core.featureStatus("technical-lab"), "available");
  assert.equal(core.featureStatus("not-a-feature"), "later");

  /* A BUILT feature the tier lacks is the case where "Upgrade" is honest. */
  core.Entitlements.set(["BASIC_STUDY"], "FREE");
  assert.equal(core.featureStatus("oral-exam"), "locked", "built and unowned is a real upsell");
  assert.equal(core.featureLockedTier("oral-exam"), PRO, "and it names the cheapest plan that has it");
});

test("before the session answers, nothing is drawn as locked", async () => {
  /* A paying subscriber must never see a lock flash on something they own
     while the first verify is still in flight. */
  const core = await import("../app/js/core.js");
  core.Entitlements.set(null, null);
  assert.equal(core.Entitlements.known(), false);
  assert.equal(core.Entitlements.has("ORGANIZATION_MANAGEMENT"), true, "unknown means show, not hide");
  core.Entitlements.set(PRO_ENTITLEMENTS, PRO);
  assert.equal(core.Entitlements.has("ORGANIZATION_MANAGEMENT"), false);
});
