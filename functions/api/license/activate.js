/*
  POST /api/license/activate
  Body: { "licenseKey": "DHC6-....", "deviceId": "stable-machine-id", "deviceName": "optional" }

  Binds a device to a licence (up to record.activationLimit, default 3) and returns a signed
  activation token the desktop app can cache for an offline grace period.

  Required:
    - KV namespace binding: LICENSES
    - Secret: LICENSE_SIGNING_SECRET   (any long random string you set)
*/

import { json, normalizeKey, hmacHex, isExpired, getLicense, writeLicense } from "../_shared.js";

const GRACE_DAYS = 7;               // offline grace before re-validation

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

  const record = await getLicense(env, key);
  if (!record) {
    return json({ activated: false, status: "not_found" }, 200);
  }

  if (record.status !== "active" || isExpired(record)) {
    return json({ activated: false, status: isExpired(record) ? "expired" : record.status }, 200);
  }

  record.activations = Array.isArray(record.activations) ? record.activations : [];
  const activationLimit = record.activationLimit || 3;
  let device = record.activations.find(function (d) { return d.deviceId === deviceId; });

  if (!device) {
    if (record.activations.length >= activationLimit) {
      return json({ activated: false, status: "activation_limit", max: activationLimit }, 200);
    }
    device = {
      deviceId: deviceId,
      deviceName: deviceName,
      activatedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
    record.activations.push(device);
  } else {
    device.deviceName = deviceName || device.deviceName;
    device.lastSeenAt = new Date().toISOString();
  }
  await writeLicense(env, record);

  // Signed token: app stores it and works offline until graceExpiresAt.
  const graceExpiresAt = new Date(Date.now() + GRACE_DAYS * 86400000).toISOString();
  const payload = key + "|" + deviceId + "|" + graceExpiresAt;
  const signature = await hmacHex(env.LICENSE_SIGNING_SECRET, payload);

  return json({
    activated: true,
    status: "active",
    plan: record.plan || "desktop",
    expiresAt: record.expiresAt || null,
    activationCount: record.activations.length,
    activationLimit: activationLimit,
    graceExpiresAt: graceExpiresAt,
    token: payload + "|" + signature
  });
}
