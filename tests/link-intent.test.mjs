/*
  A sign-in link has to work on the phone the email was read on.

  Firebase puts only the one-time code in the link. The address it was issued
  for came from localStorage on the device that requested it - which is the
  desktop, while the mail is opened on a phone. There the store is empty and
  the page fell back to window.prompt(), which Gmail's in-app browser and
  others suppress with no error at all. The link failed on the one device
  people actually open links from, and failed silently.

  The address now travels as a random handle the server minted and stored.
  These tests hold that handle to three lines: it must not change what
  /request-link answers, it must not authenticate anything on its own, and a
  link carrying one must complete with no help from the browser that asked.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as requestLink, resolveLinkIntent } from "../functions/api/web-access/request-link.js";
import { onRequestPost as linkSession } from "../functions/api/web-access/link-session.js";
import { activeLicense, envWithLicense, jsonRequest, mockFetch, jsonResponse } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://dhc6trainer.com";

function captureWarnings() {
  const lines = [];
  const original = console.warn;
  console.warn = (line) => lines.push(String(line));
  return { lines: lines, restore: () => { console.warn = original; } };
}

/* Runs /request-link and reports the continueUrl Firebase was handed. */
async function requestFor(env, email) {
  let continueUrl = "";
  const fetchMock = mockFetch(async (url, init) => {
    if (/sendOobCode/.test(url)) {
      continueUrl = JSON.parse(init.body).continueUrl;
      return jsonResponse({ email: email });
    }
    return jsonResponse({}, 404);
  });
  try {
    const response = await requestLink({
      request: jsonRequest(ORIGIN + "/api/web-access/request-link", { email: email }),
      env: env
    });
    return { response: response, body: await response.json(), continueUrl: continueUrl };
  } finally {
    fetchMock.restore();
  }
}

function handleFrom(continueUrl) {
  return new URL(continueUrl).searchParams.get("t") || "";
}

async function complete(env, body, handler) {
  const fetchMock = mockFetch(handler);
  const warnings = captureWarnings();
  try {
    const response = await linkSession({
      request: jsonRequest(ORIGIN + "/api/web-access/link-session", body),
      env: env
    });
    return { response: response, body: await response.json(), log: warnings.lines.join(" | ") };
  } finally {
    warnings.restore();
    fetchMock.restore();
  }
}

const signedIn = (email) => jsonResponse({ idToken: "id-token", email: email });
const verified = (email) => jsonResponse({ users: [{ email: email, emailVerified: true }] });
const firebaseOk = (email) => async (url) => (
  /signInWithEmailLink/.test(url) ? signedIn(email) : verified(email)
);

test("the emailed link carries a handle, and the handle names the address", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);

  const sent = await requestFor(env, license.email);
  const handle = handleFrom(sent.continueUrl);

  assert.match(handle, /^[0-9a-f]{32}$/, "128 bits of randomness, not a guessable counter");
  assert.equal(await resolveLinkIntent(env, handle), license.email);
  assert.match(sent.continueUrl, /^https:\/\/dhc6trainer\.com\/web-app\.html\?/, "and it lands on our own page");
});

test("the handle changes nothing about what /request-link answers", async () => {
  /* The whole point of this endpoint is that it cannot be used to ask whether
     an address is a customer. A handle minted only on the active path must
     never reach the caller. */
  const license = activeLicense();
  const env = envWithLicense(license);

  const customer = await requestFor(env, license.email);
  const stranger = await requestFor(env, "nobody@example.com");

  assert.equal(customer.response.status, stranger.response.status);
  assert.deepEqual(customer.body, stranger.body, "one reply, whoever asks");
  assert.equal(JSON.stringify(customer.body).indexOf(handleFrom(customer.continueUrl)), -1,
    "the handle exists only inside the email");
  assert.equal(stranger.continueUrl, "", "and no email was sent at all for a stranger");
});

test("a link opened on a device that never asked for it still signs in", async () => {
  /* The failure this whole change exists for: no localStorage, no prompt, no
     email in the request body - just the code and the handle from the URL. */
  const license = activeLicense();
  const env = envWithLicense(license);
  const handle = handleFrom((await requestFor(env, license.email)).continueUrl);

  const result = await complete(env, { oobCode: "good", intent: handle }, firebaseOk(license.email));

  assert.equal(result.response.status, 200, result.log);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.role, "subscriber");
});

test("the handle proves nothing on its own", async () => {
  /* It names an address. The Firebase code is still what shows the reader
     controls that address, so a leaked handle with no code is worthless. */
  const license = activeLicense();
  const env = envWithLicense(license);
  const handle = handleFrom((await requestFor(env, license.email)).continueUrl);

  const result = await complete(env, { oobCode: "stolen-or-guessed", intent: handle },
    async () => jsonResponse({ error: { message: "INVALID_OOB_CODE" } }, 400));

  assert.equal(result.response.status, 401);
  assert.equal(result.body.error, "invalid_credentials");
});

test("a handle paired with a different address is refused", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const handle = handleFrom((await requestFor(env, license.email)).continueUrl);

  const result = await complete(env,
    { oobCode: "good", intent: handle, email: "someone-else@example.com" },
    firebaseOk(license.email));

  assert.equal(result.response.status, 401);
  assert.match(result.log, /different address than the page submitted/);
});

test("a stale handle falls back to the typed address and says so", async () => {
  /* Handles expire after 30 minutes; the link itself lives longer. Falling
     back keeps that link usable instead of failing on a detail. */
  const license = activeLicense();
  const env = envWithLicense(license);

  const result = await complete(env,
    { oobCode: "good", intent: "0".repeat(32), email: license.email },
    firebaseOk(license.email));

  assert.equal(result.response.status, 200);
  assert.match(result.log, /handle has expired/);
});

test("a malformed handle reads nothing out of the store", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);

  for (const bad of ["license:" + license.key, "email:" + license.email, "../secret", "", "ZZ", null]) {
    assert.equal(await resolveLinkIntent(env, bad), "", JSON.stringify(bad) + " must not be looked up");
  }
});

test("links issued before this change still complete", async () => {
  /* Mail already in somebody's inbox has no handle in it. */
  const license = activeLicense();
  const env = envWithLicense(license);

  const result = await complete(env, { oobCode: "good", email: license.email }, firebaseOk(license.email));

  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
});

test("the sign-in page never spends a code twice, and never asks through a dialog", () => {
  const login = fs.readFileSync(path.join(root, "assets", "js", "web-app-login.js"), "utf8");

  assert.doesNotMatch(login, /window\.prompt\s*\(/,
    "prompt() is suppressed without warning in several in-app browsers, which is where emailed links open");
  assert.match(login, /replaceState/,
    "the one-time code must leave the address bar before use, or a reload spends it again");
  assert.match(login, /oobCode["']\)?[\s\S]{0,400}?searchParams\.delete/,
    "and it must be stripped, not merely read");
});

test("a refused link is not papered over by an unrelated session", () => {
  /* This produced the worst report of the lot: a subscriber link was refused,
     the page silently fell through to an owner session that happened to be
     valid, and opened the app labelled Owner. The refusal was never shown. */
  const login = fs.readFileSync(path.join(root, "assets", "js", "web-app-login.js"), "utf8");
  assert.match(login, /outcome === "no-link"[\s\S]{0,80}verifyExisting/,
    "only a visitor arriving with no code at all falls through to an existing session");
});
