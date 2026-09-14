/*
  One subscription must produce exactly one licence.

  Found in production KV: five licence records for three customers. Twice, two
  licences shared a single subscription id — and in one of those pairs the
  customer had been refunded, one licence read `canceled`, and the other was
  still `active`. He kept working access for nine days.

  The cause is a race, not a logic error. Paddle sends `subscription.created`
  and `transaction.completed` in the same second. Both reach the webhook at
  once, both read `sub:<id>`, both see nothing there yet, and both mint a
  random key. KV has no compare-and-set to lose that race with.

  What made it lasting damage rather than clutter: revocation resolves exactly
  one key through `sub:<id>`, so the loser of the race is invisible to every
  later billing event. Nothing can ever revoke it.

  Deriving the key from the subscription removes the race instead of narrowing
  it: both handlers compute the same key, so last-write-wins leaves one record.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { onRequestPost as webhook } from "../functions/api/paddle/webhook.js";
import { licenseKeyFor, hmacHex, getLicense } from "../functions/api/_shared.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const SECRET = "pdl_test_secret";
const SUB = "sub_01m2fygej280d906q52w8cj2q5";

/*
  A KV that takes a moment to answer.

  Without this the test is worthless: the in-memory double resolves inside the
  same microtask, so two "concurrent" handlers serialise - the first writes
  `sub:<id>` before the second reads it, and the race the production bug is
  made of never happens. Delaying reads lets both handlers look before either
  writes, which is exactly the window Paddle drives a truck through by sending
  two events in the same second.

  Verified by reverting the fix: with a random key, these tests fail.
*/
function racyKv(store) {
  const slow = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  return {
    map: store.map,
    async get(key, type) { await slow(5); return store.get(key, type); },
    /* Writes are slower than reads, which is both true of real KV and
       necessary here: with an instant put, the first handler's whole
       create-and-write chain is microtasks and drains before the second
       handler's read timer fires, so it sees the write and no race occurs.
       A write that takes time is what lets both handlers look at an empty
       `sub:<id>` - the actual production condition. */
    async put(key, value, options) { await slow(10); return store.put(key, value, options); },
    async delete(key) { await slow(5); return store.delete(key); },
    async list(options) { return store.list(options); }
  };
}

function env() {
  const e = envWithLicense(activeLicense(), { PADDLE_WEBHOOK_SECRET: SECRET });
  e.LICENSES = racyKv(e.LICENSES);
  return e;
}

async function request(event) {
  const raw = JSON.stringify(event);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await hmacHex(SECRET, ts + ":" + raw);
  return new Request("https://dhc6trainer.com/api/paddle/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Paddle-Signature": "ts=" + ts + ";h1=" + sig },
    body: raw
  });
}

const created = {
  event_id: "evt_created_1",
  event_type: "subscription.created",
  data: {
    id: SUB, status: "trialing", customer_id: "ctm_1",
    customer: { email: "buyer@example.com" },
    items: [{ price: { id: "pri_x" } }]
  }
};

/* The second half of the pair, as Paddle actually sends it: same second, same
   subscription, different event. */
const completed = {
  event_id: "evt_completed_1",
  event_type: "transaction.completed",
  data: {
    id: "txn_1", subscription_id: SUB, status: "completed", customer_id: "ctm_1",
    customer: { email: "buyer@example.com" },
    details: { totals: { grand_total: "0" } },
    items: [{ price: { id: "pri_x" } }]
  }
};

function licenceKeysIn(store) {
  return Array.from(store.map.keys()).filter((k) => k.startsWith("license:"));
}

test("two events in the same instant leave one licence, not two", async () => {
  /* The production failure, reproduced. Both requests are in flight before
     either has written `sub:<id>`, which is precisely the case that used to
     mint two keys. */
  const e = env();
  /* Both requests built BEFORE either handler starts: an await between the
     two calls would let the first finish, and the race would vanish again. */
  const first = await request(created);
  const second = await request(completed);
  const [a, b] = await Promise.all([
    webhook({ request: first, env: e }).then((r) => r.json()),
    webhook({ request: second, env: e }).then((r) => r.json())
  ]);

  assert.equal(a.licenseKey, b.licenseKey,
    "both handlers must land on the same key: " + a.licenseKey + " vs " + b.licenseKey);

  const keys = licenceKeysIn(e.LICENSES).filter((k) => k !== "license:" + activeLicense().key);
  assert.equal(keys.length, 1, "one subscription, one licence record - found: " + keys.join(", "));
});

test("the surviving licence is the one sub: points at", async () => {
  /* The orphan was dangerous because nothing could reach it. Whatever record
     exists must be the one revocation will resolve. */
  const e = env();
  const first = await request(created);
  const second = await request(completed);
  await Promise.all([
    webhook({ request: first, env: e }),
    webhook({ request: second, env: e })
  ]);

  const pointer = await e.LICENSES.get("sub:" + SUB);
  const record = await getLicense(e, pointer);
  assert.ok(record, "sub: must resolve to a record that exists");

  const keys = licenceKeysIn(e.LICENSES).filter((k) => k !== "license:" + activeLicense().key);
  assert.deepEqual(keys, ["license:" + pointer],
    "every licence for this subscription is reachable through sub:");
});

test("a derived key is stable for a subscription and unique between them", async () => {
  const e = { LICENSE_SIGNING_SECRET: "s3cret" };
  const first = await licenseKeyFor(e, SUB);
  const second = await licenseKeyFor(e, SUB);

  assert.equal(first, second, "the same subscription always derives the same key - that is the whole point");
  assert.notEqual(await licenseKeyFor(e, "sub_other"), first);
  assert.notEqual(await licenseKeyFor({ LICENSE_SIGNING_SECRET: "different" }, SUB), first,
    "and the secret is what makes it unguessable, so a different secret gives a different key");
});

test("a derived key is a licence key, indistinguishable from a rolled one", async () => {
  const key = await licenseKeyFor({ LICENSE_SIGNING_SECRET: "s3cret" }, SUB);
  assert.match(key, /^DHC6-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
    "same shape, same alphabet - no I, O, 0 or 1 for anyone reading it off a screen");
});

test("with no secret or no subscription it still produces a key, randomly", async () => {
  /* Never withhold a licence because a secret is missing: the customer paid. */
  const a = await licenseKeyFor({}, SUB);
  const b = await licenseKeyFor({}, SUB);
  assert.match(a, /^DHC6-/);
  assert.notEqual(a, b, "without a secret there is nothing to derive from, so fall back to random");

  assert.match(await licenseKeyFor({ LICENSE_SIGNING_SECRET: "s" }, null), /^DHC6-/,
    "a one-off transaction with no subscription still gets a key");
});

test("an existing licence is never replaced by a derived one", async () => {
  /* Every licence issued before this change has a random key. They must keep
     it: readKey finds them first, and a customer's key cannot change under
     them. */
  const existing = activeLicense({ key: "DHC6-OLDK-EYYY-YYYY", subscriptionId: SUB });
  const e = envWithLicense(existing, { PADDLE_WEBHOOK_SECRET: SECRET });
  e.LICENSES.map.set("sub:" + SUB, existing.key);

  const result = await webhook({ request: await request(created), env: e }).then((r) => r.json());

  assert.equal(result.licenseKey, existing.key, "the customer keeps the key they were given");
  assert.equal(await e.LICENSES.get("sub:" + SUB), existing.key);
});
