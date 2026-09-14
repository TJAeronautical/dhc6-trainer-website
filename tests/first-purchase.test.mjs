/*
  The first five minutes after somebody pays.

  Sales opened with a gap nobody would find until a stranger hit it: the
  licence key is deliberately never returned from an email alone, so a
  brand-new buyer loading their subscription saw "Subscription found. Enter
  the licence key to unlock devices, billing and downloads" - an instruction
  to produce something they had never been given. The way out was real, but it
  sat inside a collapsed FAQ headed "I lost the licence key", which is not how
  a first-time buyer describes a key they never had.

  These tests hold the page's copy to what the server actually does.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { onRequestPost as billingStatus } from "../functions/api/billing/status.js";
import { createWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense, jsonRequest } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://dhc6trainer.com";

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("an email alone withholds the key, and a session reveals it", async () => {
  /* The behaviour the page has to describe correctly. */
  const license = activeLicense();
  const env = envWithLicense(license);

  const byEmail = await billingStatus({
    request: jsonRequest(ORIGIN + "/api/billing/status", { email: license.email }),
    env: env
  });
  const masked = await byEmail.json();
  assert.equal(masked.license.masked, true);
  assert.equal(JSON.stringify(masked).includes(license.key), false,
    "no part of the key reaches a caller holding only an address");

  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const signedIn = await billingStatus({
    request: jsonRequest(ORIGIN + "/api/billing/status", { email: license.email }, {
      cookie: SESSION_COOKIE + "=" + session.token
    }),
    env: env
  });
  const full = await signedIn.json();
  assert.equal(full.license.key, license.key, "a signed-in subscriber sees their own key in full");
});

test("a buyer is told how to get the key, not asked to produce one", () => {
  const js = read("assets/js/billing-account.js");
  const maskedBranch = /masked\s*\?\s*("(?:[^"\\]|\\.)*")/.exec(js);
  assert.ok(maskedBranch, "the masked-status message should still be the first branch of that ternary");

  const message = maskedBranch[1];
  assert.doesNotMatch(message, /Enter the licence key/i,
    "somebody who has just bought has no key to enter");
  assert.match(message, /sign-in link/i, "name the route that actually produces the key");
});

test("the payment-complete notice points at that route, with a link", () => {
  const html = read("access.html");
  const notice = /<section id="purchase-complete-notice"[\s\S]*?<\/section>/.exec(html);
  assert.ok(notice, "the notice a fresh buyer reads must still exist");

  assert.match(notice[0], /href="web-app\.html"/,
    "a collapsed FAQ headed 'I lost the licence key' is not discoverable to someone who never had one");
  assert.match(notice[0], /sign-in link/i);
});

test("the page never promises the key from an email alone", () => {
  /* If this copy and the server ever disagree, the copy is the one that gets
     a customer stuck, so it is the one pinned here. */
  const js = read("assets/js/billing-account.js");
  const html = read("access.html");
  const shown = /never shown from an email alone/i;
  assert.match(js, shown);
  assert.match(html, shown);
});
