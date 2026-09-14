import test from "node:test";
import assert from "node:assert/strict";
import { createWebSession, createOwnerWebSession, verifyWebSession, authorizeWebRequest, revokeWebSession, SESSION_COOKIE, sessionCookie } from "../functions/api/web-access/_session.js";
import { onRequestPost as sessionPost } from "../functions/api/web-access/session.js";
import { onRequestPost as ownerPost } from "../functions/api/web-access/owner-session.js";
import { onRequestGet as verifyGet } from "../functions/api/web-access/verify.js";
import { onRequestPost as logoutPost } from "../functions/api/web-access/logout.js";
import { onRequestPost as requestLinkPost } from "../functions/api/web-access/request-link.js";
import { onRequestPost as linkSessionPost } from "../functions/api/web-access/link-session.js";
import { hmacHex } from "../functions/api/_shared.js";
import { activeLicense, envWithLicense, jsonRequest, cookieFrom, mockFetch, jsonResponse } from "./helpers.mjs";

const SECRET = "test-signing-secret";

function b64url(value) {
  return Buffer.from(value, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function forgeToken(payload, secret) {
  const encoded = b64url(JSON.stringify(payload));
  return encoded + "." + await hmacHex(secret || SECRET, encoded);
}

/* ------------------------------------------------------------ token core */
test("signed sessions round-trip and carry a session id", async () => {
  const session = await createWebSession(SECRET, activeLicense());
  const payload = await verifyWebSession(SECRET, session.token);
  assert.equal(payload.role, "subscriber");
  assert.equal(payload.key, "DHC6-ABCD-EFGH-JKLM");
  assert.match(payload.sid, /^[0-9a-f]{32}$/);
  assert.ok(payload.exp - payload.iat === 12 * 60 * 60);
});

test("malformed, tampered, expired, legacy and wrong-secret tokens are rejected", async () => {
  const good = await createWebSession(SECRET, activeLicense());
  assert.equal(await verifyWebSession(SECRET, ""), null);
  assert.equal(await verifyWebSession(SECRET, "not-a-token"), null);
  assert.equal(await verifyWebSession(SECRET, "a.b.c"), null);
  assert.equal(await verifyWebSession(SECRET, good.token.slice(0, -2) + "zz"), null);
  assert.equal(await verifyWebSession("other-secret", good.token), null);
  const [body] = good.token.split(".");
  const tampered = body.replace(/^./, "Q") + "." + good.token.split(".")[1];
  assert.equal(await verifyWebSession(SECRET, tampered), null);
  const now = Math.floor(Date.now() / 1000);
  assert.equal(await verifyWebSession(SECRET, await forgeToken({ v: 2, sid: "x", role: "subscriber", key: "K", email: "e", iat: now - 100, exp: now - 1 })), null);
  assert.equal(await verifyWebSession(SECRET, await forgeToken({ v: 1, key: "K", email: "e", iat: now, exp: now + 100 })), null, "v1 tokens without a session id are no longer accepted");
  assert.equal(await verifyWebSession(SECRET, await forgeToken({ v: 2, sid: "x", role: "admin", email: "e", iat: now, exp: now + 100 })), null);
  assert.equal(await verifyWebSession(SECRET, await forgeToken({ v: 2, sid: "x", role: "subscriber", email: "e", iat: now, exp: now + 100 })), null, "subscriber tokens need a licence key");
  assert.equal(await verifyWebSession(SECRET, "x".repeat(5000)), null);
});

test("cookie attributes are HttpOnly, Secure and SameSite=Strict", () => {
  const cookie = sessionCookie("abc");
  assert.match(cookie, new RegExp("^" + SESSION_COOKIE + "=abc; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Strict$"));
});

/* --------------------------------------------------------- subscriber login */
test("subscriber session requires matching email + active licence and sets the cookie", async () => {
  const env = envWithLicense();
  const bad = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "pilot@example.com", licenseKey: "DHC6-ZZZZ-ZZZZ-ZZZZ" }), env });
  assert.equal(bad.status, 401);
  const mismatch = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "other@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  assert.equal(mismatch.status, 401);
  const ok = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "Pilot@Example.com", licenseKey: "dhc6-abcd-efgh-jklm" }), env });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.role, "subscriber");
  assert.match(ok.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Strict/);
  assert.equal(cookieFrom(ok), SESSION_COOKIE + "=" + body.token);
});

test("subscriber session rejects inactive or expired licences, cross-site posts and bad JSON", async () => {
  const expired = envWithLicense(activeLicense({ expiresAt: "2020-01-01T00:00:00.000Z" }));
  assert.equal((await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "pilot@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env: expired })).status, 401);
  const canceled = envWithLicense(activeLicense({ status: "canceled" }));
  assert.equal((await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "pilot@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env: canceled })).status, 401);
  const env = envWithLicense();
  const cross = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "pilot@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }, { Origin: "https://evil.example" }), env });
  assert.equal(cross.status, 403);
  const badJson = await sessionPost({ request: new Request("https://dhc6trainer.com/api/web-access/session", { method: "POST", body: "{", headers: { "Content-Type": "application/json" } }), env });
  assert.equal(badJson.status, 400);
  const unconfigured = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", {}), env: { LICENSES: env.LICENSES } });
  assert.equal(unconfigured.status, 503);
});

test("subscriber session is rate limited per IP", async () => {
  const env = envWithLicense();
  let last;
  for (let i = 0; i < 21; i++) {
    last = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "x@example.com", licenseKey: "DHC6-ZZZZ-ZZZZ-ZZZZ" }, { "CF-Connecting-IP": "203.0.113.9" }), env });
  }
  assert.equal(last.status, 429);
  const other = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "x@example.com", licenseKey: "DHC6-ZZZZ-ZZZZ-ZZZZ" }, { "CF-Connecting-IP": "203.0.113.10" }), env });
  assert.equal(other.status, 401);
});

/* -------------------------------------------------------------- owner login */
test("owner session never contacts Firebase for a non-owner email and requires a verified account", async () => {
  const env = envWithLicense();
  const fetchMock = mockFetch(async () => jsonResponse({}, 500));
  try {
    const wrongEmail = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "intruder@example.com", password: "pw" }), env });
    assert.equal(wrongEmail.status, 401);
    assert.equal(fetchMock.calls.length, 0, "password must not be forwarded when the email is not the owner");
    const emptyPassword = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "owner@example.com", password: "" }), env });
    assert.equal(emptyPassword.status, 401);
    assert.equal(fetchMock.calls.length, 0);
  } finally { fetchMock.restore(); }

  const badPassword = mockFetch(async () => jsonResponse({ error: { message: "INVALID_PASSWORD" } }, 400));
  try {
    const response = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "owner@example.com", password: "wrong" }), env });
    assert.equal(response.status, 401);
    assert.equal(badPassword.calls.length, 1);
    assert.match(badPassword.calls[0].url, /signInWithPassword/);
  } finally { badPassword.restore(); }

  const unverified = mockFetch(async (url) => /signInWithPassword/.test(url)
    ? jsonResponse({ email: "owner@example.com", idToken: "id-token" })
    : jsonResponse({ users: [{ localId: "u1", email: "owner@example.com", emailVerified: false }] }));
  try {
    const response = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "owner@example.com", password: "pw" }), env });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "owner_email_unverified");
  } finally { unverified.restore(); }

  const spoofed = mockFetch(async (url) => /signInWithPassword/.test(url)
    ? jsonResponse({ email: "someone-else@example.com", idToken: "id-token" })
    : jsonResponse({ users: [{ localId: "u1", email: "someone-else@example.com", emailVerified: true }] }));
  try {
    const response = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "owner@example.com", password: "pw" }), env });
    assert.equal(response.status, 401);
  } finally { spoofed.restore(); }
});

test("owner session succeeds for the verified owner account and issues an owner cookie", async () => {
  const env = envWithLicense();
  const fetchMock = mockFetch(async (url, init) => {
    if (/signInWithPassword/.test(url)) {
      const body = JSON.parse(init.body);
      assert.equal(body.email, "owner@example.com");
      assert.equal(body.password, "correct horse");
      return jsonResponse({ email: "owner@example.com", idToken: "id-token" });
    }
    return jsonResponse({ users: [{ localId: "u1", email: "owner@example.com", emailVerified: true }] });
  });
  try {
    const response = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "OWNER@example.com", password: "correct horse" }), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.role, "owner");
    const payload = await verifyWebSession(SECRET, body.token);
    assert.equal(payload.role, "owner");
    assert.equal(payload.email, "owner@example.com");
    assert.match(response.headers.get("Set-Cookie"), /HttpOnly; Secure; SameSite=Strict/);
  } finally { fetchMock.restore(); }
  const unconfigured = await ownerPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/owner-session", { email: "owner@example.com", password: "pw" }), env: { LICENSES: env.LICENSES, LICENSE_SIGNING_SECRET: SECRET } });
  assert.equal(unconfigured.status, 503);
});

/* ------------------------------------------------------------------ verify */
test("verify accepts bearer or cookie, and enforces revocation and live entitlement", async () => {
  const env = envWithLicense();
  const login = await sessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/session", { email: "pilot@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  const token = (await login.json()).token;

  assert.equal((await verifyGet({ request: new Request("https://dhc6trainer.com/api/web-access/verify"), env })).status, 401);
  assert.equal((await verifyGet({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + token } }), env })).status, 200);
  const viaCookie = await verifyGet({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Cookie: "other=1; " + SESSION_COOKIE + "=" + token } }), env });
  assert.equal(viaCookie.status, 200);
  assert.equal((await viaCookie.json()).role, "subscriber");

  // Entitlement lapses after login -> 403.
  await env.LICENSES.put("license:DHC6-ABCD-EFGH-JKLM", JSON.stringify(activeLicense({ status: "canceled" })));
  const lapsed = await verifyGet({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + token } }), env });
  assert.equal(lapsed.status, 403);
  assert.equal((await lapsed.json()).error, "subscription_inactive");
  await env.LICENSES.put("license:DHC6-ABCD-EFGH-JKLM", JSON.stringify(activeLicense()));

  // Logout revokes the session id.
  const logout = await logoutPost({ request: new Request("https://dhc6trainer.com/api/web-access/logout", { method: "POST", headers: { Cookie: SESSION_COOKIE + "=" + token } }), env });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("Set-Cookie"), /Max-Age=0/);
  assert.equal((await logout.json()).revoked, true);
  const revoked = await verifyGet({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + token } }), env });
  assert.equal(revoked.status, 401);
  assert.equal((await revoked.json()).error, "session_revoked");
});

test("owner sessions are revoked when OWNER_ACCESS_EMAIL changes", async () => {
  const env = envWithLicense();
  const session = await createOwnerWebSession(SECRET, "owner@example.com");
  const ok = await authorizeWebRequest({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + session.token } }), env });
  assert.equal(ok.ok, true);
  assert.equal(ok.role, "owner");
  const changed = await authorizeWebRequest({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + session.token } }), env: Object.assign({}, env, { OWNER_ACCESS_EMAIL: "new-owner@example.com" }) });
  assert.equal(changed.ok, false);
  assert.equal(changed.status, 403);
  await revokeWebSession(env, await verifyWebSession(SECRET, session.token));
  const after = await authorizeWebRequest({ request: new Request("https://dhc6trainer.com/api/web-access/verify", { headers: { Authorization: "Bearer " + session.token } }), env });
  assert.equal(after.error, "session_revoked");
});

/* -------------------------------------------------------------- email link */
test("request-link is enumeration-safe and only emails active subscribers", async () => {
  const env = envWithLicense();
  const fetchMock = mockFetch(async (url, init) => {
    if (/sendOobCode/.test(url)) {
      const body = JSON.parse(init.body);
      assert.equal(body.requestType, "EMAIL_SIGNIN");
      assert.equal(body.email, "pilot@example.com");
      /* The link lands on our own sign-in page in link mode. It also carries
         the handle that lets a phone finish a sign-in the desktop started -
         see link-intent.test.mjs, which is where that is pinned down. */
      const landing = new URL(body.continueUrl);
      assert.equal(landing.origin + landing.pathname, "https://dhc6trainer.com/web-app.html");
      assert.equal(landing.searchParams.get("mode"), "link");
      return jsonResponse({ email: "pilot@example.com" });
    }
    return jsonResponse({ data: [] });
  });
  try {
    const unknown = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "nobody@example.com" }), env: Object.assign({}, env, { PADDLE_API_KEY: "" }) });
    assert.equal(unknown.status, 200);
    const unknownBody = await unknown.json();
    assert.equal(unknownBody.ok, true);
    assert.equal(fetchMock.calls.filter((c) => /sendOobCode/.test(c.url)).length, 0, "no email for unknown accounts");
    const known = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "PILOT@example.com" }), env });
    assert.equal(known.status, 200);
    assert.deepEqual(await known.json(), unknownBody);
    assert.equal(fetchMock.calls.filter((c) => /sendOobCode/.test(c.url)).length, 1);
    const invalid = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "not-an-email" }), env });
    assert.equal(invalid.status, 400);
  } finally { fetchMock.restore(); }

});

test("a failed send does not turn request-link into a subscriber oracle", async () => {
  const env = envWithLicense();

  /* The reference answer: what a NON-subscriber gets. Every other case below
     has to match this byte for byte, or the endpoint tells you who is a
     customer by how it fails. */
  const quiet = mockFetch(async () => jsonResponse({ data: [] }));
  let baselineStatus, baselineBody;
  try {
    const response = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "nobody@example.com" }), env: Object.assign({}, env, { PADDLE_API_KEY: "" }) });
    baselineStatus = response.status;
    baselineBody = await response.text();
  } finally { quiet.restore(); }

  /* Each of these is reachable ONLY for an active subscriber, because the send
     is attempted only on that branch. Firebase misconfigured, Firebase down,
     and the address itself rejected. */
  const failures = [
    { label: "Firebase sign-in method disabled", body: { error: { message: "OPERATION_NOT_ALLOWED" } }, status: 400 },
    { label: "domain not authorised", body: { error: { message: "UNAUTHORIZED_DOMAIN" } }, status: 400 },
    { label: "Firebase unavailable", body: { error: { message: "INTERNAL_ERROR" } }, status: 500 },
    { label: "address rejected", body: { error: { message: "INVALID_RECIPIENT_EMAIL" } }, status: 400 }
  ];

  for (const failure of failures) {
    const broken = mockFetch(async (url) => (/sendOobCode/.test(url)
      ? jsonResponse(failure.body, failure.status)
      : jsonResponse({ data: [] })));
    try {
      const response = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "pilot@example.com" }), env });
      assert.equal(response.status, baselineStatus, failure.label + ": status must match a non-subscriber's");
      assert.equal(await response.text(), baselineBody, failure.label + ": body must match a non-subscriber's");
    } finally { broken.restore(); }
  }

  /* And the internal Firebase wording never reaches the caller. */
  const leaky = mockFetch(async (url) => (/sendOobCode/.test(url)
    ? jsonResponse({ error: { message: "UNAUTHORIZED_DOMAIN" } }, 400)
    : jsonResponse({ data: [] })));
  try {
    const response = await requestLinkPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "pilot@example.com" }), env });
    const text = await response.text();
    assert.ok(!/UNAUTHORIZED_DOMAIN|firebase/i.test(text), "no Firebase internals in the response");
  } finally { leaky.restore(); }

  /* The globally-unconfigured case still reports to the caller, because it is
     decided before any email is looked up and so cannot distinguish anyone. */
  const unconfigured = await requestLinkPost({
    request: jsonRequest("https://dhc6trainer.com/api/web-access/request-link", { email: "pilot@example.com" }),
    env: Object.assign({}, env, { FIREBASE_WEB_API_KEY: "" })
  });
  assert.equal(unconfigured.status, 503);
  assert.equal((await unconfigured.json()).error, "email_link_not_configured");
});

test("link-session verifies the Firebase code, email verification and an active licence", async () => {
  const env = envWithLicense();
  const bad = mockFetch(async () => jsonResponse({ error: { message: "INVALID_OOB_CODE" } }, 400));
  try {
    const response = await linkSessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/link-session", { email: "pilot@example.com", oobCode: "nope" }), env });
    assert.equal(response.status, 401);
  } finally { bad.restore(); }

  const good = mockFetch(async (url) => /signInWithEmailLink/.test(url)
    ? jsonResponse({ email: "pilot@example.com", idToken: "id-token", localId: "u2" })
    : jsonResponse({ users: [{ localId: "u2", email: "pilot@example.com", emailVerified: true }] }));
  try {
    const response = await linkSessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/link-session", { email: "pilot@example.com", oobCode: "code" }), env });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.role, "subscriber");
    const payload = await verifyWebSession(SECRET, body.token);
    assert.equal(payload.key, "DHC6-ABCD-EFGH-JKLM");
    const inactiveEnv = envWithLicense(activeLicense({ status: "paused" }));
    const inactive = await linkSessionPost({ request: jsonRequest("https://dhc6trainer.com/api/web-access/link-session", { email: "pilot@example.com", oobCode: "code" }), env: inactiveEnv });
    assert.equal(inactive.status, 403);
  } finally { good.restore(); }
});
