/*
  Offline access ends with the paid period.

  It did not. `grantOffline` set the window to thirty days from the moment of
  every successful check, so a subscriber who opened the app daily always had
  thirty days banked - and cancelling handed them a free month on any device
  they simply kept off the network. Pay once, take the whole training corpus,
  cancel, carry on.

  The window is now the SHORTER of two things: thirty days from this check, and
  the end of the period actually paid for, plus a week. The week is not
  generosity - a pilot can be on a strip with no signal when their card
  renews, and locking them out mid-trip for paying would be the wrong failure.

  And the window is measured against a clock its owner controls, so winding it
  back is checked for.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { authorizeWebRequest, createWebSession, createOwnerWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { onRequestGet as verify } from "../functions/api/web-access/verify.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://dhc6trainer.com";
const DAY = 24 * 60 * 60 * 1000;

const gate = fs.readFileSync(path.join(root, "assets", "js", "subscriber-gate.js"), "utf8");

/*
  The REAL function, lifted out of the browser file and evaluated.

  A transcription would have been easier and would have been worth much less:
  reverting the fix in subscriber-gate.js left a copied rule passing happily,
  and only a separate assertion about the file's text noticed. Running the
  shipped source means every case below tests what actually ships.
*/
const OFFLINE_GRACE_MS = 30 * DAY;
const RENEWAL_GRACE_MS = 7 * DAY;

const offlineWindowEnd = (function () {
  const source = /function offlineWindowEnd\(entitledUntil, now\) \{[\s\S]*?\n  \}/.exec(gate);
  if (!source) throw new Error("offlineWindowEnd not found in subscriber-gate.js - has it been renamed?");
  return new Function(
    "OFFLINE_GRACE_MS", "RENEWAL_GRACE_MS",
    source[0] + "\nreturn offlineWindowEnd;"
  )(OFFLINE_GRACE_MS, RENEWAL_GRACE_MS);
})();

async function verifyAs(env, license) {
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const request = new Request(ORIGIN + "/api/web-access/verify", {
    headers: { cookie: SESSION_COOKIE + "=" + session.token }
  });
  return (await verify({ request: request, env: env })).json();
}

test("verify reports when the paid period ends, not just the session", async () => {
  /* These are different numbers and conflating them is what caused this: the
     session lasts 12 hours, the entitlement lasts until the next billing
     date. The browser needs the second one to bound offline access. */
  const license = activeLicense({ expiresAt: "2026-10-21T12:00:00.000Z" });
  const body = await verifyAs(envWithLicense(license), license);

  assert.equal(body.ok, true);
  assert.equal(body.entitledUntil, "2026-10-21T12:00:00.000Z");
  assert.notEqual(body.entitledUntil, body.expiresAt, "the session expiry is a different thing entirely");
});

test("an owner has no paid period to run out", async () => {
  const env = envWithLicense();
  env.OWNER_ACCESS_EMAIL = "owner@example.com";
  const session = await createOwnerWebSession(env.LICENSE_SIGNING_SECRET, "owner@example.com");
  const request = new Request(ORIGIN + "/api/web-access/verify", {
    headers: { cookie: SESSION_COOKIE + "=" + session.token }
  });
  const body = await (await verify({ request: request, env: env })).json();

  assert.equal(body.ok, true);
  assert.equal(body.entitledUntil, null, "null means nothing to cap against, not zero days");
});

test("a licence with no expiry is not cut off by the change", async () => {
  /* Some records carry no expiresAt. They must keep the rolling window rather
     than being locked out by a date that was never set. */
  const license = activeLicense();
  delete license.expiresAt;
  const body = await verifyAs(envWithLicense(license), license);
  assert.equal(body.entitledUntil, null);

  const now = Date.parse("2026-09-14T00:00:00.000Z");
  assert.equal(offlineWindowEnd(null, now), now + OFFLINE_GRACE_MS);
});

test("cancelling no longer buys a free month", async () => {
  /* The scenario, in numbers. A monthly subscriber pays on the 14th, so the
     period ends on 14 October. They open the app on 13 October - one day
     before the end - and then cancel and stay offline.

     Before: 13 Oct + 30 days = 12 November. A month of the product, free.
     Now:    14 Oct + 7 days  = 21 October. */
  const lastCheck = Date.parse("2026-10-13T09:00:00.000Z");
  const periodEnd = "2026-10-14T12:00:00.000Z";

  const granted = offlineWindowEnd(periodEnd, lastCheck);
  assert.equal(granted, Date.parse(periodEnd) + RENEWAL_GRACE_MS);

  const daysFromCheck = (granted - lastCheck) / DAY;
  assert.ok(daysFromCheck < 9, "about a week past the period end, not thirty from the last check");
  assert.ok(granted < lastCheck + OFFLINE_GRACE_MS, "the old rule must no longer be the one that applies");
});

test("a daily user cannot bank thirty days over and over", async () => {
  /* The mechanism behind the hole: every check reset the clock, so the window
     marched forward for as long as somebody kept opening the app.

     Early in the period the rolling thirty days is genuinely the shorter of
     the two and rightly wins - that is the rule working, not a leak. What
     matters is that no check, ever, reaches past the ceiling, and that once
     the ceiling is what binds, further checks move nothing. */
  const periodEnd = "2026-10-14T12:00:00.000Z";
  const ceiling = Date.parse(periodEnd) + RENEWAL_GRACE_MS;

  const checks = ["2026-09-20", "2026-10-01", "2026-10-10", "2026-10-13"]
    .map((d) => offlineWindowEnd(periodEnd, Date.parse(d + "T00:00:00.000Z")));

  for (const window of checks) {
    assert.ok(window <= ceiling, "no check may grant access past the paid period plus its grace");
  }

  const [, second, third, fourth] = checks;
  assert.equal(second, ceiling, "once inside the ceiling's reach it is the ceiling that applies");
  assert.equal(third, second, "and more checks change nothing");
  assert.equal(fourth, second);

  const lastCheck = Date.parse("2026-10-13T00:00:00.000Z");
  assert.ok(fourth < lastCheck + OFFLINE_GRACE_MS,
    "the last check before cancelling must not still be worth thirty days");
});

test("early in a period the rolling window is still the shorter one", async () => {
  /* An annual subscriber must not get 365 days of offline access. Thirty days
     from the last sign-in remains the cap when the period end is far away. */
  const now = Date.parse("2026-09-14T00:00:00.000Z");
  const annual = "2027-09-14T00:00:00.000Z";
  assert.equal(offlineWindowEnd(annual, now), now + OFFLINE_GRACE_MS,
    "whichever comes first - here that is the rolling thirty days");
});

test("renewing while out of signal does not lock a paying pilot out on the day", async () => {
  /* The reason the grace is not zero. Their card is charged on the 14th; they
     are on a strip and cannot learn it. They keep working for a week. */
  const periodEnd = "2026-10-14T12:00:00.000Z";
  const granted = offlineWindowEnd(periodEnd, Date.parse("2026-10-10T00:00:00.000Z"));
  assert.ok(granted > Date.parse(periodEnd), "access must not stop at the stroke of the renewal");
  assert.equal(granted - Date.parse(periodEnd), RENEWAL_GRACE_MS);
});

test("the browser holds the same rule, and the same numbers", () => {
  /* The arithmetic above is a transcription. If the file drifts from it, this
     test is what notices. */
  assert.match(gate, /const OFFLINE_GRACE_DAYS = 30;/);
  assert.match(gate, /const RENEWAL_GRACE_MS = 7 \* 24 \* 60 \* 60 \* 1000;/);
  assert.match(gate, /Math\.min\(rolling, ends \+ RENEWAL_GRACE_MS\)/,
    "the window must be the shorter of the two, not the longer");
  assert.match(gate, /grantOffline\(data\.email, data\.entitledUntil\)/,
    "and the entitlement end has to actually reach it");
});

test("a clock wound backwards is not trusted", () => {
  /* The window is measured against a clock its owner controls. Setting it back
     a year was the obvious way to keep a dead grant alive. */
  assert.match(gate, /const CLOCK_TOLERANCE_MS = 24 \* 60 \* 60 \* 1000;/);
  assert.match(gate, /seen: Math\.max\(now, \(previous && Number\(previous\.seen\)\) \|\| 0\)/,
    "the high-water mark must never go down");
  assert.match(gate, /grant\.seen && now \+ CLOCK_TOLERANCE_MS < grant\.seen/,
    "and a large step backwards must force an online check");
});

test("what Settings promises matches what the code does", () => {
  /* The old copy said 'sign in at least once every 30 days', which is no
     longer the whole rule and would now be a promise the app breaks. */
  const misc = fs.readFileSync(path.join(root, "app", "js", "screens", "misc.js"), "utf8");
  assert.doesNotMatch(misc, /once every 30 days/,
    "that sentence describes the behaviour this change removed");
  assert.match(misc, /end of your paid period/);
  assert.match(misc, /whichever comes first/);
});

test("the entitlement end is carried on the session result, not invented", async () => {
  /* authorizeWebRequest is the single place that knows both the session and
     the licence. The value must come from the licence record. */
  const license = activeLicense({ expiresAt: "2027-01-01T00:00:00.000Z" });
  const env = envWithLicense(license);
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const auth = await authorizeWebRequest({
    request: new Request(ORIGIN + "/api/media/index", { headers: { cookie: SESSION_COOKIE + "=" + session.token } }),
    env: env
  });

  assert.equal(auth.ok, true);
  assert.equal(auth.entitledUntil, license.expiresAt);
});
