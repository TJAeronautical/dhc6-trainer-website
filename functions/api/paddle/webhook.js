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

import { json, generateLicenseKey, verifyPaddleSignature } from "../_shared.js";

async function readKey(env, subscriptionId) {
  if (!subscriptionId) return null;
  return env.LICENSES.get("sub:" + subscriptionId);
}

async function writeLicense(env, record) {
  await env.LICENSES.put("license:" + record.key, JSON.stringify(record));
  if (record.subscriptionId) {
    await env.LICENSES.put("sub:" + record.subscriptionId, record.key);
  }
  if (record.email) {
    await env.LICENSES.put("email:" + record.email.toLowerCase(), record.key);
  }
}

async function getLicense(env, key) {
  if (!key) return null;
  const raw = await env.LICENSES.get("license:" + key);
  return raw ? JSON.parse(raw) : null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  const rawBody = await request.text();
  const signature = request.headers.get("Paddle-Signature");

  const verified = await verifyPaddleSignature(signature, rawBody, env.PADDLE_WEBHOOK_SECRET);
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
  const subscriptionId = data.id || data.subscription_id || null;
  const customerId = data.customer_id || null;
  const email =
    (data.customer && data.customer.email) ||
    (data.billing_details && data.billing_details.email) ||
    null;
  const nextBilledAt = (data.current_billing_period && data.current_billing_period.ends_at) ||
    data.next_billed_at || null;

  // Subscription created/activated -> ensure a licence exists and is active.
  if (type === "subscription.activated" || type === "subscription.created") {
    let key = await readKey(env, subscriptionId);
    let record = await getLicense(env, key);

    if (!record) {
      key = generateLicenseKey();
      record = {
        key: key,
        email: email,
        status: "active",
        plan: "desktop",
        subscriptionId: subscriptionId,
        customerId: customerId,
        createdAt: new Date().toISOString(),
        expiresAt: nextBilledAt,
        activations: []
      };
    } else {
      record.status = "active";
      record.expiresAt = nextBilledAt || record.expiresAt;
      if (email && !record.email) record.email = email;
    }

    await writeLicense(env, record);
    // Paddle sends the receipt email; surface the key there or via your own
    // transactional email using record.key + record.email.
    return json({ ok: true, licenseKey: record.key });
  }

  // Renewal / period change -> push the expiry forward.
  if (type === "subscription.updated" || type === "transaction.completed") {
    const key = await readKey(env, subscriptionId);
    const record = await getLicense(env, key);
    if (record) {
      const status = data.status;
      if (status === "active" || status === "trialing" || type === "transaction.completed") {
        record.status = "active";
      } else if (status === "paused") {
        record.status = "paused";
      }
      if (nextBilledAt) record.expiresAt = nextBilledAt;
      await writeLicense(env, record);
    }
    return json({ ok: true });
  }

  // Cancellation -> mark canceled (keep the record for recovery/audit).
  if (type === "subscription.canceled") {
    const key = await readKey(env, subscriptionId);
    const record = await getLicense(env, key);
    if (record) {
      record.status = "canceled";
      await writeLicense(env, record);
    }
    return json({ ok: true });
  }

  // Acknowledge everything else so Paddle does not retry.
  return json({ ok: true, ignored: type });
}
