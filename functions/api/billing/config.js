/*
  GET /api/billing/config
  Returns public Paddle checkout configuration for the browser.

  These values are not secrets, but keeping them in Worker vars lets production
  switch from sandbox to live Paddle without editing and redeploying static JS.
*/

import { json } from "../_shared.js";

const PRICE_ENV_KEYS = {
  premium: {
    monthly: "PADDLE_PRICE_PREMIUM_MONTHLY",
    annual: "PADDLE_PRICE_PREMIUM_ANNUAL"
  },
  instructor: {
    monthly: "PADDLE_PRICE_INSTRUCTOR_MONTHLY",
    annual: "PADDLE_PRICE_INSTRUCTOR_ANNUAL"
  },
  enterprise: {
    monthly: "PADDLE_PRICE_ENTERPRISE_MONTHLY",
    annual: "PADDLE_PRICE_ENTERPRISE_ANNUAL"
  }
};

function checkoutEnvironment(env) {
  return env.PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
}

function defaultSuccessUrl(request) {
  const url = new URL(request.url);
  return url.origin + "/access.html?status=purchased&download=1#download";
}

function buildPrices(env) {
  const prices = {};
  const missing = [];

  Object.keys(PRICE_ENV_KEYS).forEach(function (plan) {
    prices[plan] = {};
    Object.keys(PRICE_ENV_KEYS[plan]).forEach(function (cycle) {
      const key = PRICE_ENV_KEYS[plan][cycle];
      const value = String(env[key] || "").trim();
      prices[plan][cycle] = value;
      if (!value) missing.push(key);
    });
  });

  return { prices: prices, missing: missing };
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const environment = checkoutEnvironment(env);
  const clientToken = String(env.PADDLE_CLIENT_TOKEN || "").trim();
  const priceConfig = buildPrices(env);
  const missing = priceConfig.missing.slice();

  if (!clientToken) missing.push("PADDLE_CLIENT_TOKEN");

  return json({
    ok: true,
    configured: missing.length === 0,
    environment: environment,
    clientToken: clientToken,
    prices: priceConfig.prices,
    successUrl: String(env.PADDLE_SUCCESS_URL || "").trim() || defaultSuccessUrl(request),
    missing: missing
  });
}
