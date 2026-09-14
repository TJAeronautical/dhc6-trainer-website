/*
  Refunds and chargebacks revoking access.

  Found in production, not in review: a customer was refunded and kept full
  access. Paddle treats refunding and cancelling as different things - a refund
  returns the money and leaves the subscription Active - so no cancellation
  event was ever sent and the licence stayed active. The money went back and
  the product did not.

  The rule these tests hold: a FULL refund or a chargeback revokes, a PARTIAL
  refund does not. Cutting off someone who is still paying, because they were
  given a goodwill credit, would be the worse failure of the two.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as webhook, revocationFrom } from "../functions/api/paddle/webhook.js";
import { hmacHex, getLicense } from "../functions/api/_shared.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const SECRET = "pdl_test_secret";
const SUB = "sub_01m17vctc2v5qs0jg25cpgv390";

function envWithSubscription(overrides) {
  const license = activeLicense(Object.assign({ subscriptionId: SUB }, overrides || {}));
  const env = envWithLicense(license, { PADDLE_WEBHOOK_SECRET: SECRET });
  env.LICENSES.map.set("sub:" + SUB, license.key);
  return { env: env, license: license };
}

async function send(env, event) {
  const raw = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await hmacHex(SECRET, ts + ":" + raw);
  const request = new Request("https://dhc6trainer.com/api/paddle/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Paddle-Signature": "ts=" + ts + ";h1=" + sig },
    body: raw
  });
  const response = await webhook({ request: request, env: env });
  return { response: response, body: await response.json() };
}

const statusOf = (env, license) => getLicense(env, license.key).then((r) => r.status);

test("Paddle decides full versus partial, and we read its answer", () => {
  assert.equal(revocationFrom("transaction.updated", { status: "refunded" }), "refunded");
  assert.equal(revocationFrom("transaction.updated", { status: "REFUNDED" }), "refunded", "case does not matter");
  assert.equal(revocationFrom("transaction.updated", { status: "partially_refunded" }), null,
    "a goodwill credit must not cut off someone who is still paying");
  assert.equal(revocationFrom("transaction.updated", { status: "completed" }), null);

  assert.equal(revocationFrom("adjustment.created", { action: "chargeback" }), "chargeback");
  assert.equal(revocationFrom("adjustment.updated", { action: "chargeback" }), "chargeback");
  assert.equal(revocationFrom("adjustment.created", { action: "refund" }), null,
    "an adjustment alone does not say how much of the transaction it covers - the transaction status does");
  assert.equal(revocationFrom("adjustment.created", { action: "credit" }), null);

  assert.equal(revocationFrom("subscription.updated", { status: "refunded" }), null, "wrong event type");
  assert.equal(revocationFrom("transaction.updated", null), null, "a missing payload does not throw");
});

test("a full refund revokes the licence", async () => {
  const { env, license } = envWithSubscription();
  assert.equal(await statusOf(env, license), "active");

  const { body } = await send(env, {
    event_id: "evt_refund_1",
    event_type: "transaction.updated",
    data: { id: "txn_1", subscription_id: SUB, status: "refunded" }
  });

  assert.equal(body.revoked, "refunded");
  const record = await getLicense(env, license.key);
  assert.equal(record.status, "refunded");
  assert.ok(record.revokedAt, "when it happened is recorded, for the support conversation");
  assert.equal(record.revokedReason, "refunded");
});

test("a partial refund leaves a paying customer alone", async () => {
  const { env, license } = envWithSubscription();
  const { body } = await send(env, {
    event_id: "evt_partial_1",
    event_type: "transaction.updated",
    data: { id: "txn_2", subscription_id: SUB, status: "partially_refunded" }
  });

  assert.equal(body.revoked, undefined);
  assert.equal(await statusOf(env, license), "active", "a goodwill credit is not a cancellation");
});

test("a chargeback revokes, as the published Terms already say", async () => {
  const { env, license } = envWithSubscription();
  const { body } = await send(env, {
    event_id: "evt_cb_1",
    event_type: "adjustment.created",
    data: { id: "adj_1", subscription_id: SUB, action: "chargeback", status: "approved" }
  });

  assert.equal(body.revoked, "chargeback");
  const record = await getLicense(env, license.key);
  assert.equal(record.status, "chargeback");
  assert.equal(record.revokedReason, "chargeback");
});

test("a revoked licence is refused everywhere, because every gate is an allowlist", async () => {
  /*
    "refunded" and "chargeback" are new status values. Nothing had to be taught
    about them: every entitlement check in the API asks whether the status IS
    "active" rather than whether it is one of a list of bad ones, so an unknown
    status denies. This test states that dependency out loud so nobody later
    "tidies" a gate into a denylist.
  */
  const gates = [
    "functions/api/web-access/_session.js",
    "functions/api/web-access/session.js",
    "functions/api/web-access/link-session.js",
    "functions/api/web-access/request-link.js",
    "functions/api/desktop/download.js"
  ];
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

  for (const file of gates) {
    const src = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(src, /status (===|!==) "active"/, file + " still decides on 'active', not on a list of bad statuses");
  }

  /* And end to end: a refunded account can no longer open a web session. */
  const { env, license } = envWithSubscription();
  await send(env, {
    event_id: "evt_refund_2",
    event_type: "transaction.updated",
    data: { id: "txn_3", subscription_id: SUB, status: "refunded" }
  });

  const { onRequestPost: sessionPost } = await import("../functions/api/web-access/session.js");
  const response = await sessionPost({
    request: new Request("https://dhc6trainer.com/api/web-access/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://dhc6trainer.com" },
      body: JSON.stringify({ email: license.email, licenseKey: license.key })
    }),
    env: env
  });
  assert.notEqual(response.status, 200, "a refunded licence cannot sign in to the web app");
});

test("a refund cannot be quietly re-activated by a later status update", async () => {
  /*
    The renewal branch sets status back to "active" on transaction.completed.
    The revocation branch runs first, so the refund wins within one event; and
    a genuinely new completed payment SHOULD restore access, because that is
    someone paying again.
  */
  const src = (await import("node:fs")).readFileSync(
    (await import("node:path")).resolve(
      (await import("node:path")).dirname((await import("node:url")).fileURLToPath(import.meta.url)),
      "../functions/api/paddle/webhook.js"
    ), "utf8");
  const revocationAt = src.indexOf("const revocation = revocationFrom(type, data);");
  const renewalAt = src.indexOf("// Renewal / period change");
  assert.ok(revocationAt > -1 && renewalAt > -1);
  assert.ok(revocationAt < renewalAt, "revocation is checked before the branch that can set active");

  const { env, license } = envWithSubscription();
  await send(env, { event_id: "evt_r1", event_type: "transaction.updated", data: { id: "txn_4", subscription_id: SUB, status: "refunded" } });
  assert.equal(await statusOf(env, license), "refunded");

  await send(env, { event_id: "evt_r2", event_type: "transaction.completed", data: { id: "txn_5", subscription_id: SUB, status: "completed" } });
  assert.equal(await statusOf(env, license), "active", "paying again restores access, which is correct");
});

test("an unsigned refund event changes nothing", async () => {
  const { env, license } = envWithSubscription();
  const raw = JSON.stringify({ event_id: "evt_forged", event_type: "transaction.updated", data: { subscription_id: SUB, status: "refunded" } });
  const response = await webhook({
    request: new Request("https://dhc6trainer.com/api/paddle/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Paddle-Signature": "ts=1;h1=deadbeef" },
      body: raw
    }),
    env: env
  });
  assert.equal(response.status, 401);
  assert.equal(await statusOf(env, license), "active", "nobody can revoke a competitor's licence by posting JSON");
});
