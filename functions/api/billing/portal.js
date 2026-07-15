/*
  POST /api/billing/portal
  Body: { "licenseKey": "DHC6-....", "email": "buyer@example.com" }

  Creates a Paddle customer portal session so subscribers can manage payment,
  invoices, renewal, and cancellation with Paddle.
*/

import {
  json,
  normalizeKey,
  normalizeEmail,
  getLicense,
  paddleApi
} from "../_shared.js";

function extractPortalUrl(data) {
  const root = data && data.data ? data.data : data || {};
  return (
    root.url ||
    (root.urls && root.urls.general && root.urls.general.overview) ||
    (root.urls && root.urls.subscriptions && root.urls.subscriptions.overview) ||
    null
  );
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
  const record = await getLicense(env, key);

  if (!record) {
    return json({ ok: false, status: "not_found" }, 200);
  }
  if (record.email && email && normalizeEmail(record.email) !== email) {
    return json({ ok: false, status: "email_mismatch" }, 200);
  }
  if (!record.customerId) {
    return json({ ok: false, status: "missing_customer_id" }, 200);
  }

  const result = await paddleApi(context, "/customers/" + record.customerId + "/portal-sessions", {
    method: "POST",
    body: {
      subscription_ids: record.subscriptionId ? [record.subscriptionId] : []
    }
  });

  if (!result.ok) {
    return json({ ok: false, status: "portal_error", details: result.data }, result.status || 502);
  }

  const url = extractPortalUrl(result.data);
  if (!url) {
    return json({ ok: false, status: "portal_url_missing", details: result.data }, 502);
  }

  return json({ ok: true, url: url });
}
