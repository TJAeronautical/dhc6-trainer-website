/*
  A free trial is an active subscription. It is not a paid one.

  Paddle opens a 7-day trial with a transaction of exactly US$0.00, marked
  Paid, and the subscription sits at status "trialing". statusFromPaddle maps
  that to "active" on purpose - a trial user should get the whole app online,
  which is what a trial is for. But "active" alone cannot tell a paying
  customer from day one of a free week, and the offline imagery library is a
  download worth keeping behind a payment that actually happened: trial,
  download everything, cancel before day seven, and the 30-day offline window
  carries on from there.

  So the licence remembers which it is, and the bulk download asks.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { onTrial, grandTotal } from "../functions/api/paddle/webhook.js";
import { onRequestGet as media } from "../functions/api/media/index.js";
import { MEDIA_KV_PREFIX } from "../functions/api/media/_store.js";
import { createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";

function get(path, token) {
  return new Request(ORIGIN + path, {
    headers: token ? { cookie: SESSION_COOKIE + "=" + token } : {}
  });
}

/* The media index has to exist for the manifest to have anything to withhold. */
function envWithMedia(license) {
  const env = envWithLicense(license);
  env.LICENSES.map.set(MEDIA_KV_PREFIX + "index", JSON.stringify({
    version: "v1",
    items: [
      { path: "systems/fuel.png", contentType: "image/png", size: 120000 },
      { path: "models/FLAP_SYSTEM.glb", contentType: "model/gltf-binary", size: 9000000 }
    ]
  }));
  return env;
}

test("a zero-value transaction is not a payment", () => {
  /* The bug this test exists for: "First payment US$0.00 Paid" is how Paddle
     opens a trial. Reading transaction.completed as proof of payment would
     clear the trial flag on day one and hand over the thing it guards. */
  const free = { details: { totals: { grand_total: "0" } } };
  assert.equal(onTrial("transaction.completed", free), true, "nothing was paid, so nothing is unlocked");

  const real = { details: { totals: { grand_total: "1499" } } };
  assert.equal(onTrial("transaction.completed", real), false, "money moved: this is a paying customer");

  assert.equal(grandTotal(free), 0);
  assert.equal(grandTotal({}), null, "an event with no totals says nothing rather than guessing zero");
});

test("Paddle's own words decide, and silence changes nothing", () => {
  assert.equal(onTrial("subscription.created", { status: "trialing" }), true);
  assert.equal(onTrial("subscription.updated", { status: "active" }), false, "a trial that converted");
  assert.equal(onTrial("subscription.updated", { status: "past_due" }), null,
    "an event about something else must not promote a trial or demote a payer");
  assert.equal(onTrial("transaction.completed", {}), null, "an unreadable total is not a licence decision");
});

test("a trial gets the whole app online: the index is never withheld", async () => {
  /* Withholding the index would break diagrams and the Technical Lab, which
     are exactly what a trial is meant to show off. */
  const license = activeLicense({ trial: true });
  const env = envWithMedia(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);

  const response = await media({ request: get("/api/media/index", session.token), env: env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.published, true);
  assert.equal(body.items.length, 2, "a trial user can still see what exists");
  assert.equal(body.offlineDownload, false, "but is told the bulk download is not theirs yet");
});

test("a trial cannot take the library away", async () => {
  const license = activeLicense({ trial: true });
  const env = envWithMedia(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);

  const response = await media({ request: get("/api/media/offline-manifest", session.token), env: env });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "trial_offline_unavailable");
});

test("a paying subscriber can", async () => {
  const license = activeLicense({ trial: false });
  const env = envWithMedia(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);

  const response = await media({ request: get("/api/media/offline-manifest", session.token), env: env });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.items.length, 2);

  const index = await media({ request: get("/api/media/index", session.token), env: env });
  assert.equal((await index.json()).offlineDownload, true);
});

test("a licence written before trials existed is treated as paid", async () => {
  /* Every existing subscriber's record has no `trial` field at all. Absent
     must mean paid, or opening sales would have cut off the customers who
     were already here. */
  const license = activeLicense();
  delete license.trial;
  const env = envWithMedia(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);

  const response = await media({ request: get("/api/media/offline-manifest", session.token), env: env });
  assert.equal(response.status, 200, "an absent flag is not a trial");
});

test("the owner is never refused their own library", async () => {
  const env = envWithMedia(activeLicense({ trial: true }));
  env.OWNER_ACCESS_EMAIL = "owner@example.com";
  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, "owner@example.com");

  const response = await media({ request: get("/api/media/offline-manifest", session.token), env: env });
  assert.equal(response.status, 200);
});

test("an anonymous request gets nothing, trial or not", async () => {
  const env = envWithMedia(activeLicense({ trial: false }));
  const response = await media({ request: get("/api/media/offline-manifest"), env: env });
  assert.equal(response.status, 401);
});

test("the downloader asks the endpoint that gates, not the one that lists", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync(new URL("../app/js/offlinemedia.js", import.meta.url), "utf8");
  assert.match(source, /offline-manifest/, "the bulk download must go through the gated endpoint");
  assert.doesNotMatch(source, /fetch\("\/api\/media\/index"/, "and not round it via the ungated listing");
});
