import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("billing config reports missing production setup safely", async () => {
  const response = await billingConfig({ request: new Request("https://dhc6trainer.com/api/billing/config"), env: { PADDLE_ENVIRONMENT: "production" } });
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.ok(body.missing.includes("PADDLE_CLIENT_TOKEN"));
  assert.match(body.successUrl, /^https:\/\/dhc6trainer\.com\/access\.html/);
});

test("checkout opens only when the config is complete AND sales are on", async () => {
  const ask = (env) => billingConfig({ request: new Request("https://dhc6trainer.com/api/billing/config"), env })
    .then((r) => r.json());

  const live = await ask({ ...prices, PADDLE_ENVIRONMENT: "production", PADDLE_CLIENT_TOKEN: "live_public_token" });
  assert.equal(live.suspended, false, "sales are open");
  assert.equal(live.configured, true, "and the config is complete, so checkout can start");
  assert.equal(live.environment, "production");
  assert.equal(live.prices.instructor.annual, "pri_ia");
  assert.deepEqual(live.missing, []);

  /*
    The rule that matters, whichever way the switch is set: an INCOMPLETE
    config never opens a checkout. Taking money through a half-configured
    Paddle setup is worse than not taking it, because the customer is charged
    and the plan cannot be resolved from a price id that was never set.
  */
  const { PADDLE_PRICE_ENTERPRISE_ANNUAL, ...incomplete } = prices;
  const partial = await ask({ ...incomplete, PADDLE_ENVIRONMENT: "production", PADDLE_CLIENT_TOKEN: "live_public_token" });
  assert.equal(partial.configured, false, "one missing price closes the checkout");
  assert.ok(partial.missing.includes("PADDLE_PRICE_ENTERPRISE_ANNUAL"), "and says which one");

  /* The server is the real gate: the browser flag only hides buttons. */
  const clientSource = fs.readFileSync(path.join(root, "assets/js/paddle-checkout.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(root, "functions/api/billing/config.js"), "utf8");
  const flagOf = (src) => /SUBSCRIPTIONS_SUSPENDED = (true|false)/.exec(src)[1];
  assert.equal(flagOf(clientSource), flagOf(serverSource),
    "the two switches must agree, or the buttons and the API disagree about whether you can buy");
});

test("the sandbox price ids can never reach a real customer", async () => {
  /*
    paddle-checkout.js carries a hard-coded sandbox config so the pricing page
    works on a developer machine with no Worker. Those price ids belong to a
    different Paddle account: if that fallback ever applied on dhc6trainer.com,
    buyers would be run through a sandbox checkout - charged nothing, licensed
    nothing, and convinced they had bought something. Worth pinning now that
    real money is involved.
  */
  const src = fs.readFileSync(path.join(root, "assets/js/paddle-checkout.js"), "utf8");
  const guard = /function isLocalHost\(\)[\s\S]*?\n  \}/.exec(src);
  assert.ok(guard, "the fallback is still gated by a host check");

  const body = guard[0];
  assert.match(body, /host === "localhost"/);
  assert.match(body, /host === "127\.0\.0\.1"/);
  assert.match(body, /protocol === "file:"/);
  assert.ok(!/dhc6trainer/.test(body), "and the production host is not in the local list");

  /* The sandbox config is only ever reachable through that guard. */
  const uses = src.split("LOCAL_SANDBOX_CONFIG").length - 1;
  assert.equal(uses, 2, "declared once, used once");
  assert.match(src, /if \(isLocalHost\(\)\) return normalizeConfig\(LOCAL_SANDBOX_CONFIG\);/,
    "the single use sits behind the host check");
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
