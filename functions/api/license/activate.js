/*
  POST /api/license/activate
  Body: { "licenseKey": "DHC6-....", "deviceId": "stable-machine-id", "deviceName": "optional" }

  Binds a device to a licence (up to MAX_ACTIVATIONS) and returns a signed
  activation token the desktop app can cache for an offline grace period.

  Required:
    - KV namespace binding: LICENSES
    - Secret: LICENSE_SIGNING_SECRET   (any long random string you set)
*/

import { json, normalizeKey, hmacHex } from "../_shared.js";

const MAX_ACTIVATIONS = 3;          // devices per subscription
const GRACE_DAYS = 7;               // offline grace before re-validation

function isExpired(record) {
  if (!record.expiresAt) return false;
  return new Date(record.expiresAt).getTime() < Date.now();
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ activated: false, error: "kv_not_bound" }, 500);
  }
  if (!env.LICENSE_SIGNING_SECRET) {
    return json({ activated: false, error: "signing_secret_missing" }, 500);
  }

  let body = {};
  try {
    body = await request.json();
  } catch (e) {
    return json({ activated: false, error: "bad_json" }, 400);
  }

  const key = normalizeKey(body.licenseKey);
  const deviceId = String(body.deviceId || "").trim();
  const deviceName = String(body.deviceName || "").slice(0, 80);

  if (!deviceId) {
    return json({ activated: false, error: "missing_device_id" }, 400);
  }

  const raw = await env.LICENSES.get("license:" + key);
  if (!raw) {
    return json({ activated: false, status: "not_found" }, 200);
  }

  const record = JSON.parse(raw);
  if (record.status !== "active" || isExpired(record)) {
    return json({ activated: false, status: isExpired(record) ? "expired" : record.status }, 200);
  }

  record.activations = Array.isArray(record.activations) ? record.activations : [];
  let device = record.activations.find(function (d) { return d.deviceId === deviceId; });

  if (!device) {
    if (record.activations.length >= MAX_ACTIVATIONS) {
      return json({ activated: false, status: "activation_limit", max: MAX_ACTIVATIONS }, 200);
    }
    device = { deviceId: deviceId, deviceName: deviceName, activatedAt: new Date().toISOString() };
    record.activations.push(device);
    await env.LICENSES.put("license:" + key, JSON.stringify(record));
  }

  // Signed token: app stores it and works offline until graceExpiresAt.
  const graceExpiresAt = new Date(Date.now() + GRACE_DAYS * 86400000).toISOString();
  const payload = key + "|" + deviceId + "|" + graceExpiresAt;
  const signature = await hmacHex(env.LICENSE_SIGNING_SECRET, payload);

  return json({
    activated: true,
    status: "active",
    plan: record.plan || "desktop",
    expiresAt: record.expiresAt || null,
    graceExpiresAt: graceExpiresAt,
    token: payload + "|" + signature
  });
}
