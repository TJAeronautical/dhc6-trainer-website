/*
  The email that carries a new subscriber's licence key.

  There wasn't one. Paddle sends a receipt with no key in it and this service
  sent nothing at all, so a buyer who closed the tab had nothing in their inbox
  to come back to - the key lived only behind a sign-in link they had to know
  to go and find.

  Two things these tests care about above all: the key reaches the buyer, and a
  mail failure never costs them the licence.
*/
import test from "node:test";
import assert from "node:assert/strict";

import { welcomeEmail, planLabel, sendWelcomeEmail } from "../functions/api/_welcome-email.js";
import { activeLicense } from "./helpers.mjs";

function mailbox(behaviour) {
  const sent = [];
  return {
    sent: sent,
    binding: {
      send: async function (message) {
        sent.push(message);
        if (behaviour === "throw") throw new Error("upstream refused");
        return { messageId: "msg_123" };
      }
    }
  };
}

test("the key is in the email, in both the text and the HTML", () => {
  const license = activeLicense({ key: "DHC6-ABCD-EFGH-JKLM", plan: "premium_annual", expiresAt: "2027-09-21T00:00:00.000Z" });
  const mail = welcomeEmail(license, "https://dhc6trainer.com");

  assert.ok(mail.text.includes("DHC6-ABCD-EFGH-JKLM"), "a welcome email without the key is the problem, not the fix");
  assert.ok(mail.html.includes("DHC6-ABCD-EFGH-JKLM"));
  assert.match(mail.subject, /licence key/i);

  /* Both routes in, because a buyer has no key habit yet. */
  assert.ok(mail.text.includes("/web-app.html"));
  assert.ok(mail.text.includes("/access.html"));
  assert.ok(mail.html.includes('href="https://dhc6trainer.com/web-app.html"'));
});

test("it keeps the training-support-only statement", () => {
  /* Somebody may print this and file it with their notes. It should not be the
     one artefact that omits the disclaimer. */
  const mail = welcomeEmail(activeLicense(), "https://dhc6trainer.com");
  for (const source of [mail.text, mail.html]) {
    assert.match(source, /training support only/i);
    assert.match(source, /AFM/);
    assert.match(source, /QRH/);
    assert.match(source, /MEL/);
  }
});

test("a trial is described as a trial, not as a paid subscription", () => {
  const trial = welcomeEmail(activeLicense({ trial: true, expiresAt: "2026-09-21T00:00:00.000Z" }), "https://dhc6trainer.com");
  assert.match(trial.text, /trial has started/i);
  assert.match(trial.text, /Trial ends: 2026-09-21/);
  assert.match(trial.subject, /trial/i);

  const paid = welcomeEmail(activeLicense({ trial: false, expiresAt: "2027-09-21T00:00:00.000Z" }), "https://dhc6trainer.com");
  assert.match(paid.text, /subscription is active/i);
  assert.match(paid.text, /Renews or expires: 2027-09-21/);
  assert.doesNotMatch(paid.subject, /trial/i);
});

test("nothing is invented when the record is thin", () => {
  const bare = { key: "DHC6-AAAA-BBBB-CCCC", email: "a@b.com" };
  const mail = welcomeEmail(bare, "https://dhc6trainer.com");
  assert.doesNotMatch(mail.text, /Renews|Trial ends/, "no expiry in the record means no date in the email");
  assert.doesNotMatch(mail.text, /undefined|null|NaN/);
  assert.doesNotMatch(mail.html, /undefined|null|NaN/);
  assert.ok(mail.text.includes("up to 3 devices"), "the default seat count, not a blank");
});

test("a hostile plan name cannot inject markup", () => {
  const mail = welcomeEmail(activeLicense({ plan: "<script>alert(1)</script>" }), "https://dhc6trainer.com");
  /* Case-insensitive: planLabel title-cases what it is given, so the tag
     arrives at the escaper as "<Script>". What matters is that no raw angle
     bracket from the record survives into the markup. */
  assert.doesNotMatch(mail.html, /<script/i, "everything interpolated is escaped");
  assert.match(mail.html, /&lt;script&gt;/i);
});

test("planLabel reads as a person would write it", () => {
  assert.equal(planLabel("premium_annual"), "Premium Annual");
  assert.equal(planLabel("instructor-monthly"), "Instructor Monthly");
  assert.equal(planLabel(""), "Subscription");
  assert.equal(planLabel(undefined), "Subscription");
});

test("sending stamps the licence so it is never sent twice", async () => {
  const license = activeLicense();
  const box = mailbox();
  const env = { EMAIL: box.binding };

  const first = await sendWelcomeEmail(env, license, "https://dhc6trainer.com");
  assert.equal(first.sent, true);
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, license.email);
  assert.equal(box.sent[0].from, "noreply@dhc6trainer.com");
  assert.ok(license.welcomeEmailAt, "the record remembers");
  assert.equal(license.welcomeEmailId, "msg_123");

  const second = await sendWelcomeEmail(env, license, "https://dhc6trainer.com");
  assert.equal(second.sent, false);
  assert.equal(second.reason, "already_sent");
  assert.equal(box.sent.length, 1, "a redelivered Paddle event must not mail the customer again");
});

test("a mail failure never costs the customer their licence", async () => {
  /* Paddle retries any callback that is not 2xx. If a mail outage threw here,
     a purchase event would be redelivered because the email service was down -
     which is the wrong thing to couple together. */
  const license = activeLicense();
  const box = mailbox("throw");

  const result = await sendWelcomeEmail({ EMAIL: box.binding }, license, "https://dhc6trainer.com");

  assert.equal(result.sent, false, "it reports the failure");
  assert.match(license.welcomeEmailError, /upstream refused/, "and writes it where support can read it");
  assert.equal(license.welcomeEmailAt, undefined, "without claiming it was sent");
});

test("an unconfigured binding is a quiet no, not a crash", async () => {
  const license = activeLicense();
  const result = await sendWelcomeEmail({}, license, "https://dhc6trainer.com");
  assert.equal(result.sent, false);
  assert.equal(result.reason, "email_not_configured");
  assert.equal(license.welcomeEmailAt, undefined);
});

test("a record with no address is not mailed into the void", async () => {
  const box = mailbox();
  const result = await sendWelcomeEmail({ EMAIL: box.binding }, { key: "DHC6-A-B-C" }, "https://dhc6trainer.com");
  assert.equal(result.sent, false);
  assert.equal(result.reason, "incomplete_record");
  assert.equal(box.sent.length, 0);
});

test("the sender address is overridable without touching code", async () => {
  const license = activeLicense();
  const box = mailbox();
  await sendWelcomeEmail({ EMAIL: box.binding, WELCOME_EMAIL_FROM: "hello@dhc6trainer.com" }, license, "https://dhc6trainer.com");
  assert.equal(box.sent[0].from, "hello@dhc6trainer.com");
});

/* ---------------------------------------------------------------------- */
/* Through the real webhook, because that is the only path that ever runs. */

import { onRequestPost as webhook } from "../functions/api/paddle/webhook.js";
import { hmacHex, getLicense } from "../functions/api/_shared.js";
import { envWithLicense } from "./helpers.mjs";

const SECRET = "pdl_test_secret";

async function purchase(env, event) {
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

function newPurchaseEnv(mail) {
  const env = envWithLicense(activeLicense(), { PADDLE_WEBHOOK_SECRET: SECRET });
  if (mail) env.EMAIL = mail;
  return env;
}

const CREATED = {
  event_id: "evt_welcome_1",
  event_type: "subscription.created",
  data: {
    id: "sub_welcome_1",
    status: "trialing",
    customer_id: "ctm_1",
    customer: { email: "newbuyer@example.com" },
    items: [{ price: { id: "pri_x" } }]
  }
};

test("a real purchase event mails the key to the buyer", async () => {
  const box = mailbox();
  const env = newPurchaseEnv(box.binding);

  const result = await purchase(env, CREATED);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.welcomeEmail, true, "the handler reports whether the buyer was told");

  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, "newbuyer@example.com");
  assert.ok(box.sent[0].text.includes(result.body.licenseKey), "the key it mailed is the key it wrote");

  const stored = await getLicense(env, result.body.licenseKey);
  assert.ok(stored.welcomeEmailAt, "and the licence in KV remembers it went");
});

test("a mail outage does not make Paddle redeliver the purchase", async () => {
  /* Paddle retries anything that is not 2xx. A non-2xx here because the email
     service is down would redeliver a purchase event - coupling the customer's
     licence to an unrelated outage. */
  const box = mailbox("throw");
  const env = newPurchaseEnv(box.binding);

  const result = await purchase(env, CREATED);
  assert.equal(result.response.status, 200, "the licence was written; that is what 2xx is acknowledging");
  assert.equal(result.body.welcomeEmail, false, "honestly reported, not claimed");

  const stored = await getLicense(env, result.body.licenseKey);
  assert.equal(stored.status, "active", "the customer has what they paid for");
  assert.match(stored.welcomeEmailError, /upstream refused/, "with the reason on the record for support");
});

test("with no email binding at all, purchases still work exactly as before", async () => {
  const env = newPurchaseEnv(null);
  const result = await purchase(env, CREATED);
  assert.equal(result.response.status, 200);
  assert.equal(result.body.welcomeEmail, false);
  assert.ok(result.body.licenseKey, "the licence is the deliverable; the email is a courtesy");
});
