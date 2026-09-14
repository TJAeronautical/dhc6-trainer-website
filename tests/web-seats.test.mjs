/*
  One licence, a limited number of browsers.

  The hole: desktop activations capped at three, but a web session was bound to
  nothing - not a device, not a count. One key shared with fifty people gave
  fifty working sessions, and while that was true every other protection on the
  3D models was decoration.

  The two things these tests have to hold apart:
    - a shared key must not scale, and
    - a pilot with a phone, a tablet and a laptop must never be locked out.
  Most of what follows is the second one.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as webSession } from "../functions/api/web-access/session.js";
import { onRequestPost as linkSession } from "../functions/api/web-access/link-session.js";
import { onRequestPost as requestLink } from "../functions/api/web-access/request-link.js";
import { onRequestPost as logout } from "../functions/api/web-access/logout.js";
import { onRequestGet as devicesGet, onRequestPost as devicesPost } from "../functions/api/web-access/devices.js";
import { onRequestGet as verify } from "../functions/api/web-access/verify.js";
import { SESSION_COOKIE, createOwnerWebSession } from "../functions/api/web-access/_session.js";
import { deviceLabel, readSeats, seatLimitFor, DEFAULT_SEAT_LIMIT } from "../functions/api/web-access/_seats.js";
import { activeLicense, envWithLicense, jsonRequest, memoryKv, mockFetch, jsonResponse } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://dhc6trainer.com";

const UA_LAPTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36";
const UA_PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1";

function device(n) {
  return String(n).padStart(2, "0").repeat(16).slice(0, 32);
}

/* Sign in with the purchase email and licence key, as the web app does. */
async function signIn(env, license, body, userAgent) {
  const response = await webSession({
    request: jsonRequest(ORIGIN + "/api/web-access/session", Object.assign({
      email: license.email,
      licenseKey: license.key
    }, body || {}), { "User-Agent": userAgent || UA_LAPTOP }),
    env: env
  });
  return { response: response, status: response.status, body: await response.json() };
}

function tokenOf(result) {
  return result.body.token;
}

async function verifyToken(env, token) {
  const response = await verify({
    request: new Request(ORIGIN + "/api/web-access/verify", { headers: { cookie: SESSION_COOKIE + "=" + token } }),
    env: env
  });
  return { status: response.status, body: await response.json() };
}

async function fillSeats(env, license, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(await signIn(env, license, { deviceId: device(i + 1) }));
  }
  return out;
}

/* ------------------------------------------------------------ The limit */

test("a fourth browser is refused, and told what is holding the seats", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const first = await fillSeats(env, license, 3);
  first.forEach(function (result, i) {
    assert.equal(result.status, 200, "browser " + (i + 1) + " is within the limit");
  });

  const fourth = await signIn(env, license, { deviceId: device(4) });
  assert.equal(fourth.status, 403);
  assert.equal(fourth.body.error, "seat_limit");
  assert.equal(fourth.body.limit, 3);
  assert.equal(fourth.body.devices.length, 3, "the subscriber must see what to sign out, not just that they cannot in");
  assert.equal(fourth.body.token, undefined, "a refusal issues no token");
});

test("the same browser signing in again reuses its seat", async () => {
  /* The difference between "three browsers" and "three sign-ins". A pilot who
     signs in every morning on the same laptop must not be locked out by
     Thursday. */
  const license = activeLicense();
  const env = envWithLicense(license);

  for (let i = 0; i < 6; i++) {
    const result = await signIn(env, license, { deviceId: device(1) });
    assert.equal(result.status, 200, "sign-in " + (i + 1) + " from the same browser");
  }
  assert.equal((await readSeats(env, license.key)).length, 1, "six sign-ins, one browser, one seat");
});

test("a replaced session on the same browser stops working", async () => {
  /* Otherwise a copied cookie would outlive the sign-in that replaced it, and
     a seat would quietly carry two live sessions. */
  const license = activeLicense();
  const env = envWithLicense(license);

  const first = await signIn(env, license, { deviceId: device(1) });
  const second = await signIn(env, license, { deviceId: device(1) });

  assert.equal((await verifyToken(env, tokenOf(second))).body.ok, true, "the current session works");
  const replaced = await verifyToken(env, tokenOf(first));
  assert.equal(replaced.body.ok, false, "the one it replaced does not");
  assert.equal(replaced.body.error, "session_revoked", "and it is revoked, not merely unrecognised");
});

test("three people cannot become four by taking turns quietly", async () => {
  /* The reason the limit refuses instead of evicting: silent eviction lets a
     shared key keep working forever, with everybody just signing in again. */
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);

  for (let i = 4; i <= 8; i++) {
    const result = await signIn(env, license, { deviceId: device(i) });
    assert.equal(result.status, 403, "browser " + i + " is refused, not silently seated");
  }
  assert.equal((await readSeats(env, license.key)).length, 3, "the three original seats are untouched");
});

/* ------------------------------------------------- The way out, for a real user */

test("signing the others out lets the new browser in, and stops the old ones", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const held = await fillSeats(env, license, 3);

  const refused = await signIn(env, license, { deviceId: device(4) });
  assert.equal(refused.status, 403);

  const retry = await signIn(env, license, { deviceId: device(4), signOutOthers: true });
  assert.equal(retry.status, 200, "the way out has to actually work");
  assert.equal((await readSeats(env, license.key)).length, 1, "one browser left: this one");

  for (const previous of held) {
    const check = await verifyToken(env, tokenOf(previous));
    assert.notEqual(check.body.ok, true, "a signed-out browser must lose its session, not just its seat");
  }
  assert.equal((await verifyToken(env, tokenOf(retry))).body.ok, true, "and this one keeps working");
});

test("signing out gives the seat back", async () => {
  /* A pilot who tidies up after themselves on a borrowed machine must not be
     punished for it by holding a seat for thirty days. */
  const license = activeLicense();
  const env = envWithLicense(license);
  const sessions = await fillSeats(env, license, 3);

  const response = await logout({
    request: new Request(ORIGIN + "/api/web-access/logout", {
      method: "POST",
      headers: { cookie: SESSION_COOKIE + "=" + tokenOf(sessions[2]) }
    }),
    env: env
  });
  assert.equal(response.status, 200);
  assert.equal((await readSeats(env, license.key)).length, 2, "the seat is free again");

  const fourth = await signIn(env, license, { deviceId: device(4) });
  assert.equal(fourth.status, 200, "and the next browser is let in");
});

test("a caller that cannot keep a device id is never locked out", async () => {
  /* An old cached copy of the sign-in page, or a browser with storage refused,
     sends no device id. It cannot be recognised next time, so refusing it
     would lock its owner out after three attempts for a fault that is not
     theirs. It recycles the least recently used seat instead - which still
     holds the concurrent total at the limit, which is the number that matters
     against a shared key. */
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);

  for (let i = 0; i < 5; i++) {
    const anonymous = await signIn(env, license, {});
    assert.equal(anonymous.status, 200, "attempt " + (i + 1) + " is seated, not refused");
    assert.match(String(anonymous.body.deviceId), /^[0-9a-f]{32}$/, "and is handed an id so its next visit is recognised");
  }
  assert.equal((await readSeats(env, license.key)).length, 3, "the total never exceeds the limit");
});

/* -------------------------------------------------------- The devices endpoint */

test("Settings lists this licence's browsers and marks the current one", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  await signIn(env, license, { deviceId: device(1) }, UA_LAPTOP);
  const phone = await signIn(env, license, { deviceId: device(2) }, UA_PHONE);

  const response = await devicesGet({
    request: new Request(ORIGIN + "/api/web-access/devices", { headers: { cookie: SESSION_COOKIE + "=" + tokenOf(phone) } }),
    env: env
  });
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.limit, 3);
  assert.equal(body.used, 2);
  assert.deepEqual(body.devices.map(function (d) { return d.label; }), ["Chrome on Windows", "Safari on iPhone"]);
  assert.deepEqual(body.devices.map(function (d) { return d.current; }), [false, true],
    "the current browser is the one holding this session, not one the caller named");
});

test("the device list carries no token, no session id and no address", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const session = await signIn(env, license, { deviceId: device(1) });

  const response = await devicesGet({
    request: new Request(ORIGIN + "/api/web-access/devices", { headers: { cookie: SESSION_COOKIE + "=" + tokenOf(session) } }),
    env: env
  });
  const text = await response.text();

  assert.equal(text.indexOf(license.email), -1, "no address");
  assert.equal(text.indexOf(license.key), -1, "no licence key");
  assert.equal(text.indexOf(tokenOf(session)), -1, "no token");
  assert.equal(/"sid"|"id":"[0-9a-f]{32}"/.test(text), false, "no session or device id");
});

test("Settings can sign the other browsers out", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const sessions = await fillSeats(env, license, 3);

  const response = await devicesPost({
    request: jsonRequest(ORIGIN + "/api/web-access/devices", {}, { cookie: SESSION_COOKIE + "=" + tokenOf(sessions[0]) }),
    env: env
  });
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.signedOut, 2);
  assert.equal(body.used, 1);
  assert.equal((await verifyToken(env, tokenOf(sessions[0]))).body.ok, true, "the browser that asked keeps its session");
  assert.notEqual((await verifyToken(env, tokenOf(sessions[1]))).body.ok, true);
});

test("the devices endpoint refuses anonymous and lapsed sessions", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const session = await signIn(env, license, { deviceId: device(1) });

  const anonymous = await devicesGet({ request: new Request(ORIGIN + "/api/web-access/devices"), env: env });
  assert.equal(anonymous.status, 401);

  const lapsed = Object.assign({}, license, { status: "canceled" });
  await env.LICENSES.put("license:" + license.key, JSON.stringify(lapsed));
  const after = await devicesGet({
    request: new Request(ORIGIN + "/api/web-access/devices", { headers: { cookie: SESSION_COOKIE + "=" + tokenOf(session) } }),
    env: env
  });
  assert.equal(after.status, 403);
});

test("one account can never sign out another account's browsers", async () => {
  const mine = activeLicense();
  const theirs = activeLicense({ key: "DHC6-ZZZZ-YYYY-XXXX", email: "other@example.com", subscriptionId: "sub_999" });
  const env = envWithLicense(mine);
  await env.LICENSES.put("license:" + theirs.key, JSON.stringify(theirs));
  await env.LICENSES.put("email:" + theirs.email, theirs.key);

  const ours = await signIn(env, mine, { deviceId: device(1) });
  await signIn(env, theirs, { deviceId: device(5) });
  await signIn(env, theirs, { deviceId: device(6) });

  await devicesPost({
    request: jsonRequest(ORIGIN + "/api/web-access/devices", {}, { cookie: SESSION_COOKIE + "=" + tokenOf(ours) }),
    env: env
  });

  assert.equal((await readSeats(env, theirs.key)).length, 2, "the other licence's seats are untouched");
});

test("an owner is never seat-limited and is told the limit does not apply", async () => {
  const env = envWithLicense();
  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, "owner@example.com");
  const response = await devicesGet({
    request: new Request(ORIGIN + "/api/web-access/devices", { headers: { cookie: SESSION_COOKIE + "=" + session.token } }),
    env: env
  });
  const body = await response.json();

  assert.equal(body.ok, true);
  assert.equal(body.applies, false, "an owner has no licence record and so no seats");
  assert.deepEqual(body.devices, []);
});

/* --------------------------------------------------------------- The limit value */

test("the limit follows the licence, then the deployment, then three", () => {
  assert.equal(seatLimitFor({}, {}), DEFAULT_SEAT_LIMIT);
  assert.equal(seatLimitFor({ WEB_SEAT_LIMIT: "5" }, {}), 5, "a deployment-wide setting needs no code change");
  assert.equal(seatLimitFor({ WEB_SEAT_LIMIT: "5" }, { activationLimit: 10 }), 10,
    "an operator who bought ten desktop seats gets ten browsers");
  assert.equal(seatLimitFor({ WEB_SEAT_LIMIT: "5" }, { activationLimit: 10, webSeatLimit: 2 }), 2,
    "and an explicit per-licence value wins over both");
});

test("a malformed limit is ignored rather than read as no limit", () => {
  /* The failure that matters: "unlimited" must never be something a typo can
     produce. */
  ["", null, 0, -1, "lots", NaN, {}].forEach(function (value) {
    assert.equal(seatLimitFor({ WEB_SEAT_LIMIT: value }, { activationLimit: value, webSeatLimit: value }), DEFAULT_SEAT_LIMIT,
      "a limit of " + JSON.stringify(value) + " falls through to the default");
  });
});

test("a seat store that cannot be read does not lock a subscriber out", async () => {
  /* Failing closed here would deny a paying customer over an infrastructure
     blip. Failing open costs at most the limit for one sign-in. */
  const license = activeLicense();
  const env = envWithLicense(license);
  const broken = Object.create(env.LICENSES);
  broken.get = async function (key) {
    if (String(key).startsWith("webseats:")) throw new Error("KV unavailable");
    return env.LICENSES.get(key);
  };
  const result = await webSession({
    request: jsonRequest(ORIGIN + "/api/web-access/session",
      { email: license.email, licenseKey: license.key, deviceId: device(1) }, { "User-Agent": UA_LAPTOP }),
    env: Object.assign({}, env, { LICENSES: broken })
  });
  assert.equal(result.status, 200);
});

test("a browser that has not been seen for over thirty days no longer holds a seat", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  const old = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString();
  await env.LICENSES.put("webseats:" + license.key, JSON.stringify({
    v: 1,
    seats: [1, 2, 3].map(function (n) {
      return { id: device(n), sid: "sid" + n, exp: 0, label: "Chrome on Windows", firstSeenAt: old, lastSeenAt: old };
    })
  }));

  assert.equal((await readSeats(env, license.key)).length, 0, "stale seats are not counted");
  assert.equal((await signIn(env, license, { deviceId: device(9) })).status, 200);
});

test("deviceLabel names a browser without keeping a fingerprint", () => {
  assert.equal(deviceLabel(UA_LAPTOP), "Chrome on Windows");
  assert.equal(deviceLabel(UA_PHONE), "Safari on iPhone");
  assert.equal(deviceLabel("Mozilla/5.0 (Macintosh) Firefox/130.0"), "Firefox on Mac");
  assert.equal(deviceLabel(""), "Unknown browser");
  assert.ok(deviceLabel(UA_LAPTOP).length < 40, "coarse, not the whole user-agent string");
  assert.equal(deviceLabel(UA_LAPTOP).indexOf("537.36"), -1, "no version numbers to fingerprint with");
});

/* ------------------------------------------------------- The magic-link path */

const signedIn = (email) => jsonResponse({ idToken: "id-token", email: email });
const verified = (email) => jsonResponse({ users: [{ email: email, emailVerified: true }] });
const firebaseOk = (email) => async (url) => (
  /signInWithEmailLink/.test(url) ? signedIn(email) : verified(email)
);

async function linkSignIn(env, email, body, handler) {
  const fetchMock = mockFetch(handler || firebaseOk(email));
  try {
    const response = await linkSession({
      request: jsonRequest(ORIGIN + "/api/web-access/link-session", Object.assign({ email: email, oobCode: "good" }, body || {}), { "User-Agent": UA_PHONE }),
      env: env
    });
    return { status: response.status, body: await response.json() };
  } finally {
    fetchMock.restore();
  }
}

test("a magic link is held to the same limit as a licence key", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);

  const result = await linkSignIn(env, license.email, { deviceId: device(4) });
  assert.equal(result.status, 403);
  assert.equal(result.body.error, "seat_limit");
});

test("the retry after a link refusal does not resend a spent code", async () => {
  /*
    The defect this exists to prevent. Firebase codes are single-use and the
    refused attempt already spent this one, so a retry that resent it would
    report a broken link for a problem that has nothing to do with the link -
    and cost the pilot a second email to fix it.

    The refusal hands back a grant instead. If the retry below ever reaches
    Firebase, this test fails.
  */
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);

  const refused = await linkSignIn(env, license.email, { deviceId: device(4) });
  assert.match(String(refused.body.grant), /^[0-9a-f]{32}$/, "a refusal must offer a way to retry");

  const fetchMock = mockFetch(async () => { throw new Error("Firebase must not be called again"); });
  try {
    const response = await linkSession({
      request: jsonRequest(ORIGIN + "/api/web-access/link-session",
        { grant: refused.body.grant, deviceId: device(4), signOutOthers: true }, { "User-Agent": UA_PHONE }),
      env: env
    });
    const body = await response.json();
    assert.equal(response.status, 200, "the retry signs in");
    assert.equal(body.role, "subscriber");
  } finally {
    fetchMock.restore();
  }
  assert.equal((await readSeats(env, license.key)).length, 1);
});

test("a grant works once, and proves nothing on its own", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);
  const refused = await linkSignIn(env, license.email, { deviceId: device(4) });

  const use = async function (grant) {
    const fetchMock = mockFetch(async () => jsonResponse({}, 500));
    try {
      const response = await linkSession({
        request: jsonRequest(ORIGIN + "/api/web-access/link-session", { grant: grant, deviceId: device(4), signOutOthers: true }),
        env: env
      });
      return response.status;
    } finally {
      fetchMock.restore();
    }
  };

  assert.equal(await use(refused.body.grant), 200);
  assert.equal(await use(refused.body.grant), 401, "a grant is single use");
  assert.equal(await use("f".repeat(32)), 401, "and an invented one is worth nothing");
});

test("a grant stops working when the licence does", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  await fillSeats(env, license, 3);
  const refused = await linkSignIn(env, license.email, { deviceId: device(4) });

  await env.LICENSES.put("license:" + license.key, JSON.stringify(Object.assign({}, license, { status: "canceled" })));

  const fetchMock = mockFetch(async () => jsonResponse({}, 500));
  try {
    const response = await linkSession({
      request: jsonRequest(ORIGIN + "/api/web-access/link-session", { grant: refused.body.grant, signOutOthers: true }),
      env: env
    });
    assert.equal(response.status, 401, "a grant is not a licence");
  } finally {
    fetchMock.restore();
  }
});

/* ------------------------------------------------------------- What ships */

test("the browser names itself, and is offered a way out rather than a dead end", () => {
  const login = fs.readFileSync(path.join(root, "assets", "js", "web-app-login.js"), "utf8");

  assert.match(login, /const DEVICE_KEY = "dhc6\.webDevice\.v1";/);
  assert.match(login, /deviceId: deviceId\(\)/, "the device id has to actually be sent");
  assert.match(login, /rememberDevice\(result\.data\)/, "and a server-issued one has to be kept, or every sign-in spends a seat");
  assert.match(login, /error === "seat_limit"/, "the refusal is handled, not shown as a bad password");
  assert.match(login, /offerSeatRelease/);
  assert.match(login, /grant: grant/, "the link retry sends the grant, never the spent code");
  assert.doesNotMatch(login, /oobCode: linkCode,\s*\n\s*deviceId: deviceId\(\),\s*\n\s*signOutOthers/,
    "the retry must not carry the code");
});

test("the app shows which browsers are signed in, and the Worker routes it", () => {
  const misc = fs.readFileSync(path.join(root, "app", "js", "screens", "misc.js"), "utf8");
  assert.match(misc, /\/api\/web-access\/devices/);
  assert.match(misc, /devicesCard\(ctx, render\)/, "the card has to be rendered, not just defined");
  assert.match(misc, /Sign out other browsers/);

  const worker = fs.readFileSync(path.join(root, "worker.js"), "utf8");
  assert.match(worker, /"\/api\/web-access\/devices"/);
  assert.match(worker, /method === "GET" && path === "\/api\/web-access\/devices"/);
  assert.match(worker, /method === "POST" && path === "\/api\/web-access\/devices"/);
});

test("seats live in their own key, away from the record the webhook writes", async () => {
  /* Phase 32: a read-modify-write on the licence record from two paths is what
     minted duplicate licences. Seats must never reopen that. */
  const license = activeLicense();
  const env = envWithLicense(license);
  const before = await env.LICENSES.get("license:" + license.key);
  await signIn(env, license, { deviceId: device(1) });

  assert.equal(await env.LICENSES.get("license:" + license.key), before, "the licence record is not touched");
  assert.ok(await env.LICENSES.get("webseats:" + license.key), "the seats have their own key");

  const seats = fs.readFileSync(path.join(root, "functions", "api", "web-access", "_seats.js"), "utf8");
  assert.doesNotMatch(seats, /writeLicense/, "nothing here may write the licence record");
});
