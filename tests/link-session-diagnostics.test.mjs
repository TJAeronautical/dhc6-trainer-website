/*
  Why a sign-in link was refused.

  /api/web-access/link-session returns the same "invalid_credentials" for a
  used code, an expired code, an address mismatch, an unverified Firebase
  account and a lapsed subscription. That is right for the caller - a sign-in
  endpoint must not tell an attacker which half of a guess was wrong - but it
  left nobody, including the owner, able to tell those five apart. Chasing one
  such refusal in production cost an afternoon.

  The response must stay uniform. The LOG must not.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as linkSession } from "../functions/api/web-access/link-session.js";
import { activeLicense, envWithLicense, jsonRequest, mockFetch, jsonResponse } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";
const URL_ = ORIGIN + "/api/web-access/link-session";

function captureWarnings() {
  const lines = [];
  const original = console.warn;
  console.warn = (line) => lines.push(String(line));
  return { lines: lines, restore: () => { console.warn = original; } };
}

async function attempt(env, body, handler) {
  const fetchMock = mockFetch(handler);
  const warnings = captureWarnings();
  try {
    const response = await linkSession({ request: jsonRequest(URL_, body), env: env });
    return { response: response, body: await response.json(), log: warnings.lines.join(" | ") };
  } finally {
    warnings.restore();
    fetchMock.restore();
  }
}

const signedIn = (email) => jsonResponse({ idToken: "id-token", email: email });
const verified = (email) => jsonResponse({ users: [{ email: email, emailVerified: true }] });

test("a used or expired code says so in the log, not in the response", async () => {
  const env = envWithLicense();
  const result = await attempt(env, { email: "pilot@example.com", oobCode: "used" },
    async () => jsonResponse({ error: { message: "INVALID_OOB_CODE" } }, 400));

  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "invalid_credentials", "the caller learns nothing specific");
  assert.match(result.log, /firebase rejected the code/);
  assert.match(result.log, /INVALID_OOB_CODE/, "and the operator learns exactly what Firebase said");
});

test("an unverified Firebase account is named in the log", async () => {
  const env = envWithLicense();
  const result = await attempt(env, { email: "pilot@example.com", oobCode: "good" }, async (url) => (
    /signInWithEmailLink/.test(url)
      ? signedIn("pilot@example.com")
      : jsonResponse({ users: [{ email: "pilot@example.com", emailVerified: false }] })
  ));

  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "invalid_credentials");
  assert.match(result.log, /not email-verified/, "the one failure nobody would ever guess from the message");
});

test("a lapsed subscription is distinguishable from a bad code", async () => {
  const lapsed = activeLicense({ status: "canceled" });
  const env = envWithLicense(lapsed);
  const result = await attempt(env, { email: lapsed.email, oobCode: "good" }, async (url) => (
    /signInWithEmailLink/.test(url) ? signedIn(lapsed.email) : verified(lapsed.email)
  ));

  assert.equal(result.response.status, 403);
  assert.match(result.log, /no active licence/);
  assert.match(result.log, /status=canceled/, "including which status stopped it");
});

test("a code issued for a different address is refused and logged", async () => {
  const env = envWithLicense();
  const result = await attempt(env, { email: "pilot@example.com", oobCode: "good" },
    async () => signedIn("someone-else@example.com"));

  assert.equal(result.response.status, 401);
  assert.match(result.log, /different address/);
});

test("every refusal still looks identical from outside", async () => {
  const env = envWithLicense();
  const cases = [
    ["bad code", async () => jsonResponse({ error: { message: "EXPIRED_OOB_CODE" } }, 400)],
    ["wrong address", async () => signedIn("other@example.com")],
    ["unverified", async (url) => (/signInWithEmailLink/.test(url)
      ? signedIn("pilot@example.com")
      : jsonResponse({ users: [{ email: "pilot@example.com", emailVerified: false }] }))]
  ];

  const seen = [];
  for (const [label, handler] of cases) {
    const result = await attempt(env, { email: "pilot@example.com", oobCode: "x" }, handler);
    seen.push(label + ":" + result.response.status + ":" + JSON.stringify(result.body));
  }

  const bodies = seen.map((entry) => entry.slice(entry.indexOf(":") + 1));
  assert.equal(new Set(bodies).size, 1, "three different causes, one indistinguishable answer: " + seen.join("  "));
});

test("a good link still signs in, and says nothing in the log", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const result = await attempt(env, { email: license.email, oobCode: "good" }, async (url) => (
    /signInWithEmailLink/.test(url) ? signedIn(license.email) : verified(license.email)
  ));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.log, "", "success is not worth a log line");
});

test("the log never carries the code or a token", async () => {
  const env = envWithLicense();
  const secret = "OOB-SECRET-CODE-VALUE";
  const result = await attempt(env, { email: "pilot@example.com", oobCode: secret },
    async () => jsonResponse({ error: { message: "INVALID_OOB_CODE" } }, 400));

  assert.ok(!result.log.includes(secret), "a sign-in code must not be written to the log");
  assert.ok(!result.log.includes("id-token"), "nor an id token");
});
