/*
  POST /api/paddle/webhook
  Receives Paddle Billing notifications, verifies the signature, and keeps a
  licence record in KV in step with the subscription lifecycle.

  Required bindings / secrets (set in Cloudflare Pages > Settings):
    - KV namespace binding: LICENSES
    - Secret: PADDLE_WEBHOOK_SECRET   (Paddle > Notifications > your destination)

  KV layout:
    license:<KEY>          -> { key, email, status, plan, subscriptionId, customerId, createdAt, expiresAt, activations:[] }
    sub:<subscriptionId>   -> <KEY>            (so lifecycle events find the key)
    email:<email>          -> <KEY>            (so the customer can recover it)
*/

import {
  json,
  generateLicenseKey,
  verifyPaddleSignature,
  getLicense,
  writeLicense,
  normalizeEmail,
  paddleApi,
  planFromConfiguredPrice,
  activationLimitFromPlan
} from "../_shared.js";

async function readKey(env, subscriptionId) {
  if (!subscriptionId) return null;
  return env.LICENSES.get("sub:" + subscriptionId);
}

function priceIdFrom(data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const first = items[0] || {};
  return first.price_id || (first.price && first.price.id) || data.price_id || null;
}

function subscriptionIdFrom(type, data) {
  if (data.subscription_id) return data.subscription_id;
  if (String(type).indexOf("subscription.") === 0) return data.id || null;
  return null;
}

function planFrom(data, env) {
  const priceId = priceIdFrom(data);
  const configuredPlan = planFromConfiguredPrice(env, priceId);
  if (configuredPlan) return configuredPlan;
  const custom = data.custom_data || {};
  if (custom.plan && custom.billing_cycle) return custom.plan + "_" + custom.billing_cycle;
  const interval =
    data.billing_cycle && data.billing_cycle.interval
      ? data.billing_cycle.interval
      : null;
  if (interval === "year") return "desktop_annual";
  if (interval === "month") return "desktop_monthly";
  return priceId ? "desktop" : "desktop";
}

function emailFrom(data) {
  return normalizeEmail(
    (data.customer && data.customer.email) ||
      (data.billing_details && data.billing_details.email) ||
      data.customer_email ||
      data.email ||
      ""
  );
}

async function emailFromCustomer(context, customerId) {
  if (!customerId) return "";
  const result = await paddleApi(context, "/customers/" + customerId, { method: "GET" });
  if (!result.ok || !result.data || !result.data.data) return "";
  return normalizeEmail(result.data.data.email || "");
}

function periodEndFrom(data) {
  return (
    (data.current_billing_period && data.current_billing_period.ends_at) ||
    data.next_billed_at ||
    data.billed_at ||
    null
  );
}

function statusFromPaddle(type, status) {
  if (type === "subscription.canceled") return "canceled";
  if (type === "subscription.paused") return "paused";
  if (type === "subscription.past_due") return "past_due";
  if (status === "active" || status === "trialing") return "active";
  if (status === "paused") return "paused";
  if (status === "past_due") return "past_due";
  if (status === "canceled") return "canceled";
  return null;
}

async function markEventSeen(env, eventId) {
  if (eventId) await env.LICENSES.put("event:" + eventId, "1", { expirationTtl: 2592000 });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("Paddle-Signature");

  const verified = await verifyPaddleSignature(
    signature,
    rawBody,
    env.PADDLE_WEBHOOK_SECRET,
    env.PADDLE_WEBHOOK_TOLERANCE_SECONDS || 5
  );
  if (!verified) {
    return json({ ok: false, error: "invalid_signature" }, 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const type = event.event_type || "";
  const data = event.data || {};
  const eventId = event.event_id || event.id || null;
  const subscriptionId = subscriptionIdFrom(type, data);
  const customerId = data.customer_id || null;
  const email = emailFrom(data) || await emailFromCustomer(context, customerId);
  const nextBilledAt = periodEndFrom(data);
  const paddleStatus = statusFromPaddle(type, data.status);
  const plan = planFrom(data, env);

  const duplicate = eventId ? Boolean(await env.LICENSES.get("event:" + eventId)) : false;

  // Subscription created/activated, or a paid transaction with a subscription
  // link -> ensure a licence exists and is active.
  if (
    type === "subscription.activated" ||
    type === "subscription.created" ||
    (subscriptionId && (type === "transaction.completed" || type === "transaction.paid"))
  ) {
    let key = await readKey(env, subscriptionId);
    let record = await getLicense(env, key);

    if (!record) {
      key = generateLicenseKey();
      record = {
        key: key,
        email: email,
        status: paddleStatus || "active",
        plan: plan,
        priceId: priceIdFrom(data),
        subscriptionId: subscriptionId,
        customerId: customerId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: nextBilledAt,
        activationLimit: activationLimitFromPlan(plan),
        activations: []
      };
    } else {
      record.status = paddleStatus || "active";
      record.plan = plan || record.plan;
      record.priceId = priceIdFrom(data) || record.priceId;
      record.customerId = customerId || record.customerId;
      record.expiresAt = nextBilledAt || record.expiresAt;
      record.activationLimit = activationLimitFromPlan(record.plan);
      if (email && !record.email) record.email = email;
    }

    await writeLicense(env, record);
    await markEventSeen(env, eventId);
    // Paddle sends the receipt email; surface the key there or via your own
    // transactional email using record.key + record.email.
    return json({ ok: true, duplicate: duplicate, licenseKey: record.key });
  }

  // Renewal / period change -> push the expiry forward.
  if (
    type === "subscription.updated" ||
    type === "subscription.paused" ||
    type === "subscription.resumed" ||
    type === "subscription.past_due" ||
    type === "transaction.completed" ||
    type === "transaction.paid"
  ) {
    const key = await readKey(env, subscriptionId);
    const record = await getLicense(env, key);
    if (record) {
      if (paddleStatus) record.status = paddleStatus;
      if (type === "subscription.resumed" || type === "transaction.completed" || type === "transaction.paid") record.status = "active";
      record.plan = plan || record.plan;
      record.priceId = priceIdFrom(data) || record.priceId;
      record.customerId = customerId || record.customerId;
      record.activationLimit = activationLimitFromPlan(record.plan);
      if (email && !record.email) record.email = email;
      if (nextBilledAt) record.expiresAt = nextBilledAt;
      record.cancelAt = data.scheduled_change && data.scheduled_change.effective_at
        ? data.scheduled_change.effective_at
        : record.cancelAt || null;
      await writeLicense(env, record);
    }
    await markEventSeen(env, eventId);
    return json({ ok: true, duplicate: duplicate });
  }

  // Cancellation -> mark canceled (keep the record for recovery/audit).
  if (type === "subscription.canceled") {
    const key = await readKey(env, subscriptionId);
    const record = await getLicense(env, key);
    if (record) {
      record.status = "canceled";
      record.canceledAt = data.canceled_at || new Date().toISOString();
      await writeLicense(env, record);
    }
    await markEventSeen(env, eventId);
    return json({ ok: true, duplicate: duplicate });
  }

  // Acknowledge everything else so Paddle does not retry.
  await markEventSeen(env, eventId);
  return json({ ok: true, duplicate: duplicate, ignored: type });
}
