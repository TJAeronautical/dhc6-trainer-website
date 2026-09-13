import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as content } from "../functions/api/content/index.js";
import { onRequestPost as billingStatus } from "../functions/api/billing/status.js";
import { onRequestPost as billingPortal } from "../functions/api/billing/portal.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense, jsonRequest, memoryKv } from "./helpers.mjs";

const SECRET = "test-signing-secret";

async function subscriberCookie() {
  const session = await createWebSession(SECRET, activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

/* ------------------------------------------------------- content endpoint */
test("protected content refuses anonymous, expired and revoked sessions", async () => {
  const env = envWithLicense();
  const anon = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest"), env });
  assert.equal(anon.status, 401);
  const garbage = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest", { headers: { Authorization: "Bearer garbage.garbage" } }), env });
  assert.equal(garbage.status, 401);
  const lapsedEnv = envWithLicense(activeLicense({ status: "expired" }));
  const lapsed = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest", { headers: { Cookie: await subscriberCookie() } }), env: lapsedEnv });
  assert.equal(lapsed.status, 403);
  const pack = await content({ request: new Request("https://dhc6trainer.com/api/content/pack/procedures-normal"), env });
  assert.equal(pack.status, 401);
});

test("manifest reports unpublished state and serves packs with no-store for valid sessions", async () => {
  const env = envWithLicense();
  const cookie = await subscriberCookie();
  const empty = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest", { headers: { Cookie: cookie } }), env });
  assert.equal(empty.status, 200);
  const emptyBody = await empty.json();
  assert.equal(emptyBody.published, false);
  assert.deepEqual(emptyBody.packs, []);

  await env.LICENSES.put("webcontent:manifest", JSON.stringify({ version: "v1", packs: [{ id: "limitations", sha256: "abc", bytes: 10 }] }));
  await env.LICENSES.put("webcontent:pack:limitations", JSON.stringify({ id: "limitations", data: { sections: [] } }));
  const manifest = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest", { headers: { Cookie: cookie } }), env });
  const manifestBody = await manifest.json();
  assert.equal(manifestBody.published, true);
  assert.equal(manifestBody.version, "v1");
  assert.equal(manifest.headers.get("Cache-Control"), "private, no-store");
  assert.match(manifest.headers.get("Vary"), /Cookie/);

  const pack = await content({ request: new Request("https://dhc6trainer.com/api/content/pack/limitations", { headers: { Cookie: cookie } }), env });
  assert.equal(pack.status, 200);
  assert.equal(pack.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await pack.json()).id, "limitations");

  const missing = await content({ request: new Request("https://dhc6trainer.com/api/content/pack/does-not-exist", { headers: { Cookie: cookie } }), env });
  assert.equal(missing.status, 404);
  const badId = await content({ request: new Request("https://dhc6trainer.com/api/content/pack/..%2Fetc", { headers: { Cookie: cookie } }), env });
  assert.equal(badId.status, 400);
});

test("a dedicated WEB_CONTENT namespace takes precedence and owners can read content", async () => {
  const env = envWithLicense();
  env.WEB_CONTENT = memoryKv({ "webcontent:manifest": JSON.stringify({ version: "dedicated", packs: [] }) });
  await env.LICENSES.put("webcontent:manifest", JSON.stringify({ version: "shared", packs: [] }));
  const owner = await createOwnerWebSession(SECRET, "owner@example.com");
  const response = await content({ request: new Request("https://dhc6trainer.com/api/content/manifest", { headers: { Authorization: "Bearer " + owner.token } }), env });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, "dedicated");
});

/* -------------------------------------------------------- billing status */
test("billing status never reveals a licence key from an email alone", async () => {
  const env = envWithLicense();
  const response = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "pilot@example.com" }), env });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.license.masked, true);
  assert.equal(body.license.key, undefined);
  assert.equal(body.license.customerId, undefined);
  assert.equal(body.license.subscriptionId, undefined);
  assert.equal(body.license.activations, undefined);
  assert.equal(body.license.keyHint, "DHC6-••••-••••-JKLM");
  assert.equal(body.license.status, "active");
  assert.equal(JSON.stringify(body).includes("DHC6-ABCD-EFGH-JKLM"), false);
});

test("billing status returns full details with the licence key or a signed-in web session", async () => {
  const env = envWithLicense();
  const withKey = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "pilot@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  const keyBody = await withKey.json();
  assert.equal(keyBody.license.key, "DHC6-ABCD-EFGH-JKLM");
  assert.equal(keyBody.license.masked, undefined);

  const wrongEmail = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "other@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  assert.equal((await wrongEmail.json()).status, "email_mismatch");

  const cookie = await subscriberCookie();
  const withSession = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "pilot@example.com" }, { Cookie: cookie }), env });
  const sessionBody = await withSession.json();
  assert.equal(sessionBody.viaSession, true);
  assert.equal(sessionBody.license.key, "DHC6-ABCD-EFGH-JKLM");

  const otherSession = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "someone@example.com" }, { Cookie: cookie }), env });
  assert.equal((await otherSession.json()).status, "email_mismatch");

  const unknown = await billingStatus({ request: jsonRequest("https://dhc6trainer.com/api/billing/status", { email: "unknown@example.com" }), env: Object.assign({}, env, { PADDLE_API_KEY: "" }) });
  assert.equal((await unknown.json()).status, "not_found");
});

test("billing portal requires the licence key and the matching purchase email", async () => {
  const env = envWithLicense();
  const keyOnly = await billingPortal({ request: jsonRequest("https://dhc6trainer.com/api/billing/portal", { licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  assert.equal((await keyOnly.json()).status, "credentials_required");
  const emailOnly = await billingPortal({ request: jsonRequest("https://dhc6trainer.com/api/billing/portal", { email: "pilot@example.com" }), env });
  assert.equal((await emailOnly.json()).status, "credentials_required");
  const mismatch = await billingPortal({ request: jsonRequest("https://dhc6trainer.com/api/billing/portal", { email: "other@example.com", licenseKey: "DHC6-ABCD-EFGH-JKLM" }), env });
  assert.equal((await mismatch.json()).status, "email_mismatch");
});
