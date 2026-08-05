import test from "node:test";
import assert from "node:assert/strict";
import { onRequestGet as billingConfig } from "../functions/api/billing/config.js";
import { activationLimitFromPlan, generateLicenseKey, hmacHex, planFromConfiguredPrice, verifyPaddleSignature } from "../functions/api/_shared.js";
import { onRequest as apiMiddleware } from "../functions/api/_middleware.js";

const prices = {
  PADDLE_PRICE_PREMIUM_MONTHLY: "pri_pm",
  PADDLE_PRICE_PREMIUM_ANNUAL: "pri_pa",
  PADDLE_PRICE_INSTRUCTOR_MONTHLY: "pri_im",
  PADDLE_PRICE_INSTRUCTOR_ANNUAL: "pri_ia",
  PADDLE_PRICE_ENTERPRISE_MONTHLY: "pri_em",
  PADDLE_PRICE_ENTERPRISE_ANNUAL: "pri_ea"
};

test("billing config reports missing production setup safely", async () => {
  const response = await billingConfig({ request: new Request("https://dhc6trainer.com/api/billing/config"), env: { PADDLE_ENVIRONMENT: "production" } });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.ok(body.missing.includes("PADDLE_CLIENT_TOKEN"));
  assert.match(body.successUrl, /^https:\/\/dhc6trainer\.com\/access\.html/);
});

test("billing config returns complete live plan map", async () => {
  const env = { ...prices, PADDLE_ENVIRONMENT: "production", PADDLE_CLIENT_TOKEN: "live_public_token" };
  const response = await billingConfig({ request: new Request("https://dhc6trainer.com/api/billing/config"), env });
  const body = await response.json();
  assert.equal(body.configured, true);
  assert.equal(body.prices.instructor.annual, "pri_ia");
  assert.equal(body.environment, "production");
});

test("licence keys and plan limits are valid", () => {
  const key = generateLicenseKey();
  assert.match(key, /^DHC6-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(activationLimitFromPlan("premium_annual"), 3);
  assert.equal(activationLimitFromPlan("instructor_monthly"), 10);
  assert.equal(activationLimitFromPlan("enterprise_annual"), 50);
  assert.equal(planFromConfiguredPrice(prices, "pri_ia"), "instructor_annual");
});

test("Paddle signatures accept current payloads and reject stale payloads", async () => {
  const secret = "pdl_test_secret";
  const raw = JSON.stringify({ event_type: "subscription.created" });
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await hmacHex(secret, `${ts}:${raw}`);
  assert.equal(await verifyPaddleSignature(`ts=${ts};h1=${sig}`, raw, secret, 5), true);
  const stale = String(Math.floor(Date.now() / 1000) - 60);
  const staleSig = await hmacHex(secret, `${stale}:${raw}`);
  assert.equal(await verifyPaddleSignature(`ts=${stale};h1=${staleSig}`, raw, secret, 5), false);
});

test("API CORS only reflects approved browser origins", async () => {
  const approved = await apiMiddleware({ request: new Request("https://dhc6trainer.com/api/health", { headers: { Origin: "https://dhc6trainer.com" } }), next: async () => new Response("ok") });
  assert.equal(approved.headers.get("Access-Control-Allow-Origin"), "https://dhc6trainer.com");
  const rejected = await apiMiddleware({ request: new Request("https://dhc6trainer.com/api/health", { headers: { Origin: "https://evil.example" } }), next: async () => new Response("ok") });
  assert.equal(rejected.headers.get("Access-Control-Allow-Origin"), null);
});
