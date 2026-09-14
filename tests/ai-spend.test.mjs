/*
  The budget on the endpoint that spends money, and the namespace bug found
  while looking for something to count against.

  Phase 36 settled who may call /api/ai/oral-exam. It never settled how much,
  and until phase 46 nothing called it at all. The screen caps a session at
  twelve questions; a client-side cap is not a control.
*/

import test from "node:test";
import assert from "node:assert/strict";
import {
  onRequestPost as oralExam,
  MAX_INSTRUCTIONS_CHARS, MAX_TURN_CHARS, MAX_INPUT_ITEMS, MAX_INPUT_CHARS
} from "../functions/api/ai/oral-exam.js";
import { toRequest, UNITS_PER_SESSION } from "../app/js/logic/oralexam.js";
import { chargeExamQuestion, burstLimit, dailyLimit, BURST_LIMIT, DAILY_LIMIT } from "../functions/api/ai/_spend.js";
import { accountIdFor, accountSeed } from "../functions/api/_account.js";
import { onRequestGet as logbookGet } from "../functions/api/logbook/index.js";
import { createWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { PRO_ENTITLEMENTS } from "../functions/api/_entitlements.js";
import { activeLicense, envWithLicense, memoryKv, mockFetch, jsonResponse, jsonRequest, TEST_SERVICE_ACCOUNT_KEY } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";
const EXAM_BODY = { instructions: "Examine the candidate.", input: [{ role: "user", content: "ready" }] };

function examEnv(extra) {
  return Object.assign(envWithLicense(activeLicense()), {
    OPENAI_API_KEY: "sk-test",
    FIREBASE_PROJECT_ID: "dhc6-test",
    GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL: "svc@dhc6-test.iam.gserviceaccount.com",
    GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY: TEST_SERVICE_ACCOUNT_KEY
  }, extra || {});
}

const OPENAI_OK = () => jsonResponse({ output: [{ content: [{ text: "Question one." }] }] });

function upstream(handler) {
  return async function (url, init, n) {
    if (/api\.openai\.com/.test(url)) return OPENAI_OK();
    if (handler) return handler(url, init, n);
    return jsonResponse({}, 404);
  };
}

function playHandler(uid, entitlements) {
  return async function (url) {
    if (/oauth2\.googleapis\.com/.test(url)) return jsonResponse({ access_token: "t", expires_in: 3600 });
    if (/identitytoolkit/.test(url)) return jsonResponse({ users: [{ localId: uid }] });
    if (/firestore/.test(url)) {
      return jsonResponse({ fields: {
        tier: { stringValue: "PRO" },
        entitlements: { arrayValue: { values: (entitlements || PRO_ENTITLEMENTS).map((e) => ({ stringValue: e })) } }
      } });
    }
    if (/api\.openai\.com/.test(url)) return OPENAI_OK();
    return jsonResponse({}, 404);
  };
}

async function subscriberHeaders(record) {
  const session = await createWebSession("test-signing-secret", record || activeLicense());
  return { Cookie: SESSION_COOKIE + "=" + session.token };
}

async function callExam(env, headers, handler, body) {
  const mock = mockFetch(handler || upstream());
  try {
    const response = await oralExam({
      request: jsonRequest(ORIGIN + "/api/ai/oral-exam", body || EXAM_BODY, headers),
      env: env
    });
    let parsed = null;
    try { parsed = await response.clone().json(); } catch (error) { parsed = null; }
    return { status: response.status, body: parsed, headers: response.headers };
  } finally {
    mock.restore();
  }
}

/* ------------------------------------------------------- the budget exists */

test("a subscriber cannot call the paid endpoint without limit", async () => {
  const env = examEnv({ AI_BURST_LIMIT: 3 });
  const headers = await subscriberHeaders();
  for (let i = 0; i < 3; i++) {
    const ok = await callExam(env, headers);
    assert.equal(ok.status, 200, "call " + (i + 1) + " should be allowed");
  }
  const refused = await callExam(env, headers);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error, "ai_rate_limited");
  assert.equal(refused.body.window, "burst");
  assert.equal(refused.headers.get("Retry-After"), String(5 * 60), "a refusal says when to come back");
});

test("the daily cap bounds the bill even when the bursts are paced", async () => {
  /*
    A script pacing itself just under a five-minute limit would still spend all
    month. A limit that only catches the impatient is not a budget.
  */
  const env = examEnv({ AI_BURST_LIMIT: 100, AI_DAILY_LIMIT: 2 });
  const headers = await subscriberHeaders();
  assert.equal((await callExam(env, headers)).status, 200);
  assert.equal((await callExam(env, headers)).status, 200);
  const refused = await callExam(env, headers);
  assert.equal(refused.status, 429);
  assert.equal(refused.body.window, "daily");
  assert.equal(refused.headers.get("Retry-After"), String(24 * 60 * 60));
});

test("one subscriber's spending never touches another's budget", async () => {
  const other = activeLicense({ key: "DHC6-ZZZZ-YYYY-XXXX", email: "second@example.com" });
  const env = examEnv({ AI_BURST_LIMIT: 1 });
  env.LICENSES = memoryKv({
    ["license:" + activeLicense().key]: JSON.stringify(activeLicense()),
    ["email:" + activeLicense().email]: activeLicense().key,
    ["license:" + other.key]: JSON.stringify(other),
    ["email:" + other.email]: other.key
  });

  assert.equal((await callExam(env, await subscriberHeaders())).status, 200);
  assert.equal((await callExam(env, await subscriberHeaders())).status, 429, "the first account is spent");
  assert.equal((await callExam(env, await subscriberHeaders(other))).status, 200, "the second is not");
});

test("an Android caller is counted against their own uid, not one shared bucket", async () => {
  /*
    The bug this would have had before _account.js: a mobile session carries no
    licence key, so every Android account hashed the same empty seed - one
    budget for the whole Android install base, exhausted by whoever went first.
  */
  const env = examEnv({ AI_BURST_LIMIT: 1 });
  const first = await callExam(env, { Authorization: "Bearer token-a" }, playHandler("uid-a"));
  assert.equal(first.status, 200);
  const firstAgain = await callExam(env, { Authorization: "Bearer token-a" }, playHandler("uid-a"));
  assert.equal(firstAgain.status, 429, "the same uid is metered");
  const second = await callExam(env, { Authorization: "Bearer token-b" }, playHandler("uid-b"));
  assert.equal(second.status, 200, "a different uid has its own budget");
});

/* ------------------------------------------------- what is and is not charged */

test("a refused call costs nothing", async () => {
  /*
    A caller without the entitlement, or with a malformed payload, must not
    have their budget charged - and the operator must not be billed for a call
    that never happened.
  */
  const env = examEnv({ AI_BURST_LIMIT: 2 });
  const headers = await subscriberHeaders();

  const bad = await callExam(env, headers, upstream(), { instructions: "", input: [] });
  assert.equal(bad.status, 400);

  const anonymous = await callExam(env, {}, upstream());
  assert.notEqual(anonymous.status, 200);

  /* Both calls above were refused, so the whole budget must still be there. */
  assert.equal((await callExam(env, headers)).status, 200);
  assert.equal((await callExam(env, headers)).status, 200);
  assert.equal((await callExam(env, headers)).status, 429);
});

/* ------------------------------------------- the size of what gets forwarded */

/*
  The budget counts CALLS. Input tokens are billed by the character, and
  `instructions` is supplied by the client by design - so until phase 52 the
  size of a call was entirely the caller's choice. Eighty calls a day is a
  sensible ceiling on questions and no ceiling at all on spend.
*/

test("an oversized answer is refused, and refused before it is charged", async () => {
  const env = examEnv({ AI_BURST_LIMIT: 2 });
  const headers = await subscriberHeaders();

  const huge = await callExam(env, headers, upstream(), {
    instructions: "Examine the candidate.",
    input: [{ role: "user", content: "x".repeat(MAX_TURN_CHARS + 1) }]
  });
  assert.equal(huge.status, 413);
  assert.equal(huge.body.error, "oral_exam_payload_too_large");
  assert.equal(huge.body.reason, "turn");
  assert.equal(huge.body.limit, MAX_TURN_CHARS);

  /* The whole budget must still be there: a refused call costs nothing. */
  assert.equal((await callExam(env, headers)).status, 200);
  assert.equal((await callExam(env, headers)).status, 200);
  assert.equal((await callExam(env, headers)).status, 429);
});

test("an answer right at the limit is accepted", async () => {
  const env = examEnv();
  const headers = await subscriberHeaders();
  const ok = await callExam(env, headers, upstream(), {
    instructions: "Examine the candidate.",
    input: [{ role: "user", content: "x".repeat(MAX_TURN_CHARS) }]
  });
  assert.equal(ok.status, 200, "the boundary must be inclusive, or the textarea's maxlength is one short");
});

test("instructions cannot be used to post megabytes on the operator's key", async () => {
  const env = examEnv();
  const headers = await subscriberHeaders();
  const flood = await callExam(env, headers, upstream(), {
    instructions: "x".repeat(MAX_INSTRUCTIONS_CHARS + 1),
    input: [{ role: "user", content: "ready" }]
  });
  assert.equal(flood.status, 413);
  assert.equal(flood.body.reason, "instructions");
});

test("a transcript cannot be padded past the ceiling, by item count or by total", async () => {
  const env = examEnv();
  const headers = await subscriberHeaders();

  const many = await callExam(env, headers, upstream(), {
    instructions: "Examine the candidate.",
    input: new Array(MAX_INPUT_ITEMS + 1).fill({ role: "user", content: "hi" })
  });
  assert.equal(many.status, 413);
  assert.equal(many.body.reason, "input_items");

  /* Every turn legal on its own, and the sum still has to be bounded. */
  const perItem = Math.floor(MAX_INPUT_CHARS / MAX_INPUT_ITEMS) + 1;
  assert.ok(perItem <= MAX_TURN_CHARS, "this test only proves anything while each turn is individually legal");
  const fat = await callExam(env, headers, upstream(), {
    instructions: "Examine the candidate.",
    input: new Array(MAX_INPUT_ITEMS).fill({ role: "user", content: "x".repeat(perItem) })
  });
  assert.equal(fat.status, 413);
  assert.equal(fat.body.reason, "input_total");
});

test("a real exam payload is nowhere near any of the limits", async () => {
  /*
    A cap that a genuine twelve-unit session could reach is a cap that refuses
    customers, so this measures the real thing rather than trusting the number.
  */
  const units = new Array(UNITS_PER_SESSION).fill(null).map((_, i) => ({
    title: "Question " + i + " about the fuel system on this aircraft?",
    content: "The approved answer, written out at the length the decks actually use, with a little room to spare.",
    sourceTitle: "Fuel System deck",
    sectionRef: "AFM 2.4." + i
  }));
  const request = toRequest(units, [{ role: "candidate", text: "A full spoken answer from a candidate." }]);
  assert.ok(request.instructions.length < MAX_INSTRUCTIONS_CHARS / 2,
    "a real grounding block is " + request.instructions.length + " characters against a limit of " + MAX_INSTRUCTIONS_CHARS);

  const env = examEnv();
  const headers = await subscriberHeaders();
  assert.equal((await callExam(env, headers, upstream(), request)).status, 200);
});

test("an unreadable budget does not lock a paying subscriber out", async () => {
  /*
    Same choice _seats.js makes, for the same reason: the exposure is bounded
    by the outage, an attacker cannot cause one, and refusing a real customer
    mid-exam because a KV read timed out is the more common failure.
  */
  const env = examEnv();
  env.LICENSES = Object.assign(Object.create(Object.getPrototypeOf(env.LICENSES)), env.LICENSES, {
    get: async function (key) {
      if (String(key).indexOf("aispend:") === 0) throw new Error("kv down");
      return env.LICENSES.map.has(key) ? env.LICENSES.map.get(key) : null;
    }
  });
  const warnings = [];
  const realWarn = console.warn;
  console.warn = function (message) { warnings.push(String(message)); };
  try {
    const result = await callExam(env, await subscriberHeaders());
    assert.equal(result.status, 200, "a storage blip must not read as an exhausted budget");
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.some((w) => /budget could not be read/.test(w)), "a budget that stopped counting is logged");
});

test("with no store bound at all the endpoint still works, uncounted", async () => {
  const env = examEnv();
  delete env.LICENSES;
  const result = await chargeExamQuestion(env, { ok: true, role: "subscriber", payload: { key: "DHC6-A" } });
  assert.equal(result.ok, true);
  assert.equal(result.unavailable, true);
});

test("an unidentifiable caller does not get an unmetered budget", async () => {
  const env = examEnv();
  const result = await chargeExamQuestion(env, { ok: true, role: "subscriber", payload: {} });
  assert.equal(result.ok, false);
  assert.equal(result.error, "account_unidentified");
});

test("the limits are operating numbers, changeable without a deploy", async () => {
  assert.equal(burstLimit({}), BURST_LIMIT);
  assert.equal(dailyLimit({}), DAILY_LIMIT);
  assert.equal(burstLimit({ AI_BURST_LIMIT: "40" }), 40);
  assert.equal(dailyLimit({ AI_DAILY_LIMIT: 500 }), 500);
  /* Junk falls back rather than reading as "no limit". */
  [null, "", "abc", 0, -5, NaN].forEach((junk) => {
    assert.equal(burstLimit({ AI_BURST_LIMIT: junk }), BURST_LIMIT, "junk limit: " + String(junk));
  });
  assert.ok(DAILY_LIMIT >= 6 * 12, "the default must not cut short ordinary use: six full sessions");
});

/* ------------------------------------------------ the namespace it counts by */

test("an Android account never lands in the empty-licence namespace", async () => {
  /*
    The latent defect. accountIdFor read payload.key, which a mobile session has
    not got, so every Android account hashed the literal "license:" - one
    namespace for all of them. The Library, the Logbook and the QRH editor all
    key their storage on this. Nothing reaches them with a mobile session today;
    the next endpoint to accept one would have inherited a silent cross-account
    leak that looks like a data bug rather than an auth one.

    This is the same defect watermarkSeed() had, fixed the same way.
  */
  const android = { ok: true, role: "subscriber", client: "android", uid: "uid-a" };
  const andrewSecond = { ok: true, role: "subscriber", client: "android", uid: "uid-b" };
  const empty = { ok: true, role: "subscriber", payload: {} };

  assert.equal(accountSeed(android), "firebase:uid-a");
  assert.notEqual(await accountIdFor(android), await accountIdFor(andrewSecond), "two Android accounts, two namespaces");
  assert.equal(await accountIdFor(empty), null, "an unidentifiable caller gets null, never a shared bucket");
  assert.equal(accountSeed({ ok: true, role: "subscriber", client: "android", uid: "  " }), null);
});

test("owner, subscriber and Android namespaces still never collide", async () => {
  const owner = await accountIdFor({ role: "owner", payload: { email: "Owner@Example.com" } });
  const ownerAgain = await accountIdFor({ role: "owner", payload: { email: "owner@example.com" } });
  const subscriber = await accountIdFor({ role: "subscriber", payload: { key: "DHC6-ABCD-EFGH-JKLM" } });
  const android = await accountIdFor({ role: "subscriber", client: "android", uid: "DHC6-ABCD-EFGH-JKLM" });
  assert.equal(owner, ownerAgain, "case and spacing do not make a second owner");
  assert.equal(new Set([owner, subscriber, android]).size, 3);
  [owner, subscriber, android].forEach((id) => assert.match(id, /^[0-9a-f]{32}$/));
});

test("an owner with no email, and a subscriber with no key, are refused not merged", async () => {
  assert.equal(await accountIdFor({ role: "owner", payload: {} }), null);
  assert.equal(await accountIdFor({ role: "subscriber", payload: { key: "   " } }), null);
  assert.equal(await accountIdFor(null), null);
  assert.equal(await accountIdFor({}), null);
});

test("an account-scoped endpoint refuses rather than serving a null namespace", async () => {
  /*
    The guard that makes the null return safe. Without it a null accountId
    would be concatenated into a KV key as the string "null" - which is itself
    a shared namespace, just a differently spelled one.
  */
  const env = envWithLicense(activeLicense());
  const session = await createWebSession("test-signing-secret", activeLicense());
  /* A session whose payload carries no licence key: signed, unexpired, and
     unidentifiable. */
  const request = new Request(ORIGIN + "/api/logbook", {
    headers: { Authorization: "Bearer " + session.token }
  });
  const good = await logbookGet({ request: request, env: env });
  assert.equal(good.status, 200, "the ordinary case still works");

  const sources = [
    "functions/api/library/index.js",
    "functions/api/logbook/index.js",
    "functions/api/qrh-edits/index.js"
  ];
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
  sources.forEach((file) => {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(src, /if \(!accountId\) return \{ response: json\(\{ ok: false, error: "account_unidentified" \}, 403\) \}/,
      file + " serves whatever accountIdFor returned, including null");
  });
});
