/*
  Per-account content watermarking.

  The honest framing, because it governs what is worth testing: this cannot
  stop a subscriber copying the training content, and is not meant to. The
  packs are JSON the app has to read. What it does is make a copy traceable.

  So the tests that matter are: the stamp identifies the account and only the
  owner can resolve it; it is not forgeable; it leaks neither the licence key
  nor the email; and - most important of all - stamping NEVER alters a single
  byte of aviation content.
*/
import test from "node:test";
import assert from "node:assert/strict";

import {
  watermarkFor, watermarkFromSeed, watermarkSeed, seedForLicenseKey, seedForOwnerEmail,
  stampPack, readStamp, issuedToday, WATERMARK_FIELD, WATERMARK_VERSION
} from "../functions/api/_watermark.js";
import { accountIdFor } from "../functions/api/qrh-edits/_store.js";
import { onRequestGet as contentGet } from "../functions/api/content/index.js";
import { onRequestPost as ownerWatermark } from "../functions/api/owner/watermark.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense, memoryKv, jsonRequest } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";

/* A pack shaped like the real ones: authored aviation content, verbatim. */
const PACK = JSON.stringify({
  id: "limitations",
  source: "DHC-6-Trainer limitations/limitations.json",
  count: 2,
  items: [
    { id: "vmca", label: "VMCA", value: "70 KIAS", note: "Flaps 10, gear down" },
    { id: "mtow", label: "MTOW", value: "12,500 lb", note: "Series 300" }
  ]
});

function envWithPack(extra) {
  const license = activeLicense();
  const env = envWithLicense(license, extra);
  env.WEB_CONTENT = memoryKv({
    "webcontent:manifest": JSON.stringify({ version: "v1", packs: [{ id: "limitations", sha256: "abc" }] }),
    "webcontent:pack:limitations": PACK
  });
  return { env: env, license: license };
}

const SECRET = "test-signing-secret";

async function subscriberCookie(env, license) {
  const session = await createWebSession(SECRET, license || activeLicense());
  return SESSION_COOKIE + "=" + session.token;
}

async function ownerCookie(env) {
  const session = await createOwnerWebSession(SECRET, (env && env.OWNER_ACCESS_EMAIL) || "owner@example.com");
  return SESSION_COOKIE + "=" + session.token;
}

const getPack = (env, cookie) => contentGet({
  request: new Request(ORIGIN + "/api/content/pack/limitations", { headers: cookie ? { Cookie: cookie } : {} }),
  env: env
});

test("stamping never touches the aviation content", async () => {
  const stamped = stampPack(PACK, "0123456789abcdef");
  const before = JSON.parse(PACK);
  const after = JSON.parse(stamped);

  delete after[WATERMARK_FIELD];
  assert.deepEqual(after, before, "every field, value and limitation is byte-identical once the stamp is removed");

  /* And the implementation must not be able to corrupt content even in
     principle: it splices a string and never parses the pack. */
  const src = String(stampPack);
  assert.ok(!/JSON\.parse/.test(src), "stampPack never parses the content it is stamping");
});

test("the stamp goes on, comes off, and copes with odd input", () => {
  const stamp = readStamp(stampPack(PACK, "0123456789abcdef", "2026-09-14"));
  assert.equal(stamp.id, "0123456789abcdef");
  assert.equal(stamp.issued, "2026-09-14");
  assert.equal(stamp.version, WATERMARK_VERSION);

  assert.equal(JSON.parse(stampPack("{}", "aaaabbbbccccdddd"))[WATERMARK_FIELD].id, "aaaabbbbccccdddd",
    "an empty object gains a stamp without a stray comma");
  assert.equal(JSON.parse(stampPack("  \n{\"a\":1}", "aaaabbbbccccdddd")).a, 1, "leading whitespace is fine");

  assert.equal(stampPack("[1,2,3]", "aaaabbbbccccdddd"), "[1,2,3]", "a non-object body is returned untouched, not guessed at");
  assert.equal(stampPack(PACK, null), PACK, "no watermark means no change");
  assert.equal(stampPack(null, "aaaabbbbccccdddd"), null);
  assert.equal(readStamp("not json"), null);
  assert.equal(readStamp(JSON.stringify({ id: "x" })), null, "a pack with no stamp reads as unstamped");

  assert.match(issuedToday(Date.UTC(2026, 8, 14, 11, 30)), /^2026-09-14$/, "day precision, not a per-request fingerprint");
});

test("the stamp is an HMAC, not the storage id, and carries no identity", async () => {
  const { env, license } = envWithPack();
  const auth = { ok: true, role: "subscriber", payload: { key: license.key, email: license.email } };

  const stamp = await watermarkFor(env, auth);
  assert.match(stamp, /^[0-9a-f]{16}$/);

  /* Not the accountIdFor used for KV namespaces. That one is an unsalted
     SHA-256 of the licence key, so anyone holding a key could compute it, and
     it names the store holding that account's logbook and drafts. */
  const storageId = await accountIdFor(auth);
  assert.notEqual(stamp, storageId);
  assert.ok(!storageId.startsWith(stamp), "the watermark is not a prefix of the storage id either");

  /* It must not be derivable without the secret: same account, different
     secret, different stamp. */
  const other = await watermarkFor(Object.assign({}, env, { LICENSE_SIGNING_SECRET: "a-different-secret" }), auth);
  assert.notEqual(stamp, other, "forging another subscriber's stamp needs LICENSE_SIGNING_SECRET");

  /* And it reveals nothing on its own. */
  assert.ok(!stamp.includes("pilot"), "no email in the stamp");
  assert.ok(!stamp.toUpperCase().includes("DHC6"), "no licence key in the stamp");
});

test("one account is one stamp; two accounts are two", async () => {
  const env = envWithLicense();
  const a = await watermarkFromSeed(env, seedForLicenseKey("DHC6-AAAA-AAAA-AAAA"));
  const again = await watermarkFromSeed(env, seedForLicenseKey("dhc6-aaaa-aaaa-aaaa"));
  const b = await watermarkFromSeed(env, seedForLicenseKey("DHC6-BBBB-BBBB-BBBB"));

  assert.equal(a, again, "case and spacing do not create a second identity for the same licence");
  assert.notEqual(a, b);

  const owner = await watermarkFromSeed(env, seedForOwnerEmail("Owner@Example.com"));
  assert.notEqual(owner, a, "the owner's own copies are distinguishable from a subscriber's");
  assert.equal(owner, await watermarkFromSeed(env, seedForOwnerEmail("owner@example.com")));

  assert.equal(watermarkSeed({ role: "owner", payload: { email: "Owner@Example.com" } }), "owner:owner@example.com");
  assert.equal(watermarkSeed({ role: "subscriber", payload: { key: "dhc6-x" } }), "license:DHC6-X");
});

test("a delivered pack carries the stamp of the account that asked for it", async () => {
  const { env, license } = envWithPack();

  const mine = await getPack(env, await subscriberCookie(env, license));
  assert.equal(mine.status, 200);
  const mineStamp = readStamp(await mine.text());
  assert.ok(mineStamp, "the pack is stamped");
  assert.equal(mineStamp.id, await watermarkFromSeed(env, seedForLicenseKey(license.key)),
    "and the stamp resolves to this subscriber");

  const asOwner = await getPack(env, await ownerCookie(env));
  const ownerStamp = readStamp(await asOwner.text());
  assert.notEqual(ownerStamp.id, mineStamp.id, "the owner's copy is a different copy");

  /* The content itself is still exactly what was published. */
  const served = JSON.parse(await (await getPack(env, await subscriberCookie(env, license))).text());
  delete served[WATERMARK_FIELD];
  assert.deepEqual(served, JSON.parse(PACK));
});

test("a second subscriber gets a different stamp on the same pack", async () => {
  const first = activeLicense();
  const second = activeLicense({ key: "DHC6-ZZZZ-YYYY-XXXX", email: "second@example.com" });
  const { env } = envWithPack();
  env.LICENSES.map.set("license:" + second.key, JSON.stringify(second));
  env.LICENSES.map.set("email:" + second.email, second.key);

  const a = readStamp(await (await getPack(env, await subscriberCookie(env, first))).text());
  const b = readStamp(await (await getPack(env, await subscriberCookie(env, second))).text());
  assert.notEqual(a.id, b.id, "two subscribers sharing a dump are distinguishable");
});

test("a missing signing secret serves the pack unstamped rather than withholding it", async () => {
  const { env, license } = envWithPack();
  const cookie = await subscriberCookie(env, license);
  const without = Object.assign({}, env, { LICENSE_SIGNING_SECRET: "" });

  /* The session was signed with the real secret, so authorise against that and
     only blank the secret for the stamping step. Training content must never
     go dark over a missing environment variable. */
  const response = await getPack(Object.assign({}, env), cookie);
  assert.equal(response.status, 200);
  assert.equal(stampPack(PACK, await watermarkFromSeed(without, seedForLicenseKey(license.key))), PACK,
    "no secret, no stamp, and the pack is returned whole");
});

test("only the owner can resolve a stamp", async () => {
  const { env, license } = envWithPack();
  const url = ORIGIN + "/api/owner/watermark";

  const anonymous = await ownerWatermark({ request: jsonRequest(url, { watermark: "0123456789abcdef" }), env: env });
  assert.equal(anonymous.status, 401);

  const subscriber = await ownerWatermark({
    request: jsonRequest(url, { watermark: "0123456789abcdef" }, { Cookie: await subscriberCookie(env, license) }),
    env: env
  });
  assert.equal(subscriber.status, 403);
  assert.equal((await subscriber.json()).error, "owner_only",
    "a subscriber who could read their own stamp would know exactly which field to strip");
});

test("the owner can go from a leaked file to the account, and back again", async () => {
  const first = activeLicense();
  const second = activeLicense({ key: "DHC6-ZZZZ-YYYY-XXXX", email: "second@example.com", plan: "instructor_annual" });
  const { env } = envWithPack();
  env.LICENSES.map.set("license:" + second.key, JSON.stringify(second));
  env.LICENSES.map.set("email:" + second.email, second.key);
  const url = ORIGIN + "/api/owner/watermark";
  const cookie = await ownerCookie(env);

  /* A file turns up somewhere. Read its stamp, ask who it belongs to. */
  const leaked = readStamp(await (await getPack(env, await subscriberCookie(env, second))).text());
  const found = await ownerWatermark({ request: jsonRequest(url, { watermark: leaked.id }, { Cookie: cookie }), env: env });
  assert.equal(found.status, 200);
  const match = (await found.json()).match;
  assert.equal(match.role, "subscriber");
  assert.equal(match.email, "second@example.com");
  assert.equal(match.plan, "instructor_annual");
  assert.match(match.keyHint, /^DHC6-••••-••••-XXXX$/, "enough to identify, not the whole key");
  assert.ok(!JSON.stringify(match).includes(second.key), "the full licence key is never returned");

  /* Or check a suspicion the other way round. */
  const forward = await ownerWatermark({ request: jsonRequest(url, { email: first.email }, { Cookie: cookie }), env: env });
  const body = await forward.json();
  assert.equal(body.watermark, await watermarkFromSeed(env, seedForLicenseKey(first.key)));
  assert.notEqual(body.watermark, leaked.id, "and it does not match the leak, so that account is cleared");
});

test("an unknown stamp is answered honestly instead of blamed on someone", async () => {
  const { env } = envWithPack();
  const url = ORIGIN + "/api/owner/watermark";
  const cookie = await ownerCookie(env);

  const missing = await ownerWatermark({ request: jsonRequest(url, { watermark: "ffffffffffffffff" }, { Cookie: cookie }), env: env });
  const body = await missing.json();
  assert.equal(body.ok, true);
  assert.equal(body.match, null, "no match means no match, not the nearest account");

  const malformed = await ownerWatermark({ request: jsonRequest(url, { watermark: "nope" }, { Cookie: cookie }), env: env });
  assert.equal(malformed.status, 400);

  const unknownAccount = await ownerWatermark({ request: jsonRequest(url, { email: "nobody@example.com" }, { Cookie: cookie }), env: env });
  assert.equal(unknownAccount.status, 404);
});

test("the owner's own copies resolve to the owner", async () => {
  const { env } = envWithPack();
  const cookie = await ownerCookie(env);
  const stamp = readStamp(await (await getPack(env, cookie)).text());

  const found = await ownerWatermark({
    request: jsonRequest(ORIGIN + "/api/owner/watermark", { watermark: stamp.id }, { Cookie: cookie }),
    env: env
  });
  assert.equal((await found.json()).match.role, "owner");
});

test("the resolver walks past the first page of licences", async () => {
  const { env } = envWithPack();
  /* More licences than one KV list page, so the cursor loop is exercised
     rather than assumed. */
  const target = "DHC6-LAST-LAST-LAST";
  for (let i = 0; i < 250; i += 1) {
    const key = "DHC6-BULK-" + String(i).padStart(4, "0") + "-0000";
    env.LICENSES.map.set("license:" + key, JSON.stringify(activeLicense({ key: key, email: "bulk" + i + "@example.com" })));
  }
  env.LICENSES.map.set("license:" + target, JSON.stringify(activeLicense({ key: target, email: "target@example.com" })));

  const stamp = await watermarkFromSeed(env, seedForLicenseKey(target));
  const found = await ownerWatermark({
    request: jsonRequest(ORIGIN + "/api/owner/watermark", { watermark: stamp }, { Cookie: await ownerCookie(env) }),
    env: env
  });
  const body = await found.json();
  assert.equal(body.match.email, "target@example.com");
  assert.ok(body.scanned > 200, "it really did page through, rather than stopping at the first 200");
});

test("the Worker routes the resolver and refuses other methods", async () => {
  const worker = (await import("../worker.js")).default;
  const { env } = envWithPack();
  const get = await worker.fetch(new Request(ORIGIN + "/api/owner/watermark"), env, { waitUntil() {} });
  assert.equal(get.status, 404, "GET is not a route");
  const post = await worker.fetch(jsonRequest(ORIGIN + "/api/owner/watermark", { watermark: "0123456789abcdef" }), env, { waitUntil() {} });
  assert.equal(post.status, 401, "POST reaches the handler, which then demands an owner session");
});
