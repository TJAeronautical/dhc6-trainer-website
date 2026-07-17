/*
  POST /api/billing/status
  Body: { "licenseKey": "DHC6-....", "email": "buyer@example.com" }

  Returns the subscription and activation state for the account page.
*/

import {
  json,
  normalizeKey,
  normalizeEmail,
  getLicense,
  getLicenseByEmail,
  publicLicense,
  generateLicenseKey,
  writeLicense,
  paddleApi,
  planFromConfiguredPrice,
  activationLimitFromPlan
} from "../_shared.js";

function priceIdFromSubscription(subscription) {
  const items = Array.isArray(subscription.items) ? subscription.items : [];
  const firstActive = items.find(function (item) {
    return item && item.status !== "deleted";
  });
  const item = firstActive || items[0] || {};
  return item.price_id || (item.price && item.price.id) || null;
}

function periodEndFromSubscription(subscription) {
  return (
    (subscription.current_billing_period && subscription.current_billing_period.ends_at) ||
    subscription.next_billed_at ||
    null
  );
}

function statusFromSubscription(status) {
  if (status === "active" || status === "trialing") return "active";
  if (status === "past_due") return "past_due";
  if (status === "paused") return "paused";
  if (status === "canceled") return "canceled";
  return status || "active";
}

function canRecoverSubscription(subscription) {
  return (
    subscription &&
    (subscription.status === "active" ||
      subscription.status === "trialing" ||
      subscription.status === "past_due" ||
      subscription.status === "paused")
  );
}

function newestFirst(a, b) {
  return new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime();
}

async function recoverLicenseFromPaddle(context, email) {
  const { env } = context;
  if (!email || !env.PADDLE_API_KEY) return null;

  const customerQuery = new URLSearchParams({
    email: email,
    per_page: "10"
  });
  const customerResult = await paddleApi(context, "/customers?" + customerQuery.toString(), { method: "GET" });
  if (!customerResult.ok) return null;

  const customers = Array.isArray(customerResult.data && customerResult.data.data)
    ? customerResult.data.data
    : [];

  for (const customer of customers) {
    if (normalizeEmail(customer.email) !== email) continue;

    const subscriptionQuery = new URLSearchParams({
      customer_id: customer.id,
      per_page: "50"
    });
    const subscriptionResult = await paddleApi(context, "/subscriptions?" + subscriptionQuery.toString(), {
      method: "GET"
    });
    if (!subscriptionResult.ok) continue;

    const subscriptions = Array.isArray(subscriptionResult.data && subscriptionResult.data.data)
      ? subscriptionResult.data.data.slice().sort(newestFirst)
      : [];

    for (const subscription of subscriptions) {
      if (!canRecoverSubscription(subscription)) continue;

      const priceId = priceIdFromSubscription(subscription);
      const plan = planFromConfiguredPrice(env, priceId);
      if (!plan) continue;

      const existingKey = await env.LICENSES.get("sub:" + subscription.id);
      let record = await getLicense(env, existingKey);

      if (!record) {
        record = {
          key: generateLicenseKey(),
          email: email,
          status: statusFromSubscription(subscription.status),
          plan: plan,
          priceId: priceId,
          subscriptionId: subscription.id,
          customerId: customer.id,
          createdAt: subscription.started_at || subscription.created_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          expiresAt: periodEndFromSubscription(subscription),
          activationLimit: activationLimitFromPlan(plan),
          activations: []
        };
      } else {
        record.email = record.email || email;
        record.status = statusFromSubscription(subscription.status);
        record.plan = plan || record.plan;
        record.priceId = priceId || record.priceId;
        record.subscriptionId = subscription.id || record.subscriptionId;
        record.customerId = customer.id || record.customerId;
        record.expiresAt = periodEndFromSubscription(subscription) || record.expiresAt;
        record.activationLimit = activationLimitFromPlan(record.plan);
        if (!Array.isArray(record.activations)) record.activations = [];
      }

      await writeLicense(env, record);
      return record;
    }
  }

  return null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const key = normalizeKey(body.licenseKey);
  const email = normalizeEmail(body.email);

  let record = key ? await getLicense(env, key) : null;
  if (!record && email) {
    record = await getLicenseByEmail(env, email);
  }
  if (!record && email) {
    record = await recoverLicenseFromPaddle(context, email);
  }

  if (!record) {
    return json({ ok: false, status: "not_found" }, 200);
  }

  if (email && record.email && normalizeEmail(record.email) !== email) {
    return json({ ok: false, status: "email_mismatch" }, 200);
  }

  return json({ ok: true, license: publicLicense(record) });
}
