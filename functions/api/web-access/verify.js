import { json, getLicense, isExpired, normalizeEmail } from "../_shared.js";
import { verifyWebSession } from "./_session.js";

export async function onRequestGet(context) {
  const { request, env } = context;
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  const payload = await verifyWebSession(env.LICENSE_SIGNING_SECRET, token);
  if (!payload) return json({ ok: false, error: "session_invalid" }, 401);
  if (payload.role === "owner") {
    const allowedOwner = normalizeEmail(env.OWNER_ACCESS_EMAIL);
    if (!allowedOwner || normalizeEmail(payload.email) !== allowedOwner) {
      return json({ ok: false, error: "owner_access_revoked" }, 403);
    }
    return json({ ok: true, plan: "owner", role: "owner", expiresAt: new Date(payload.exp * 1000).toISOString() });
  }

  const record = await getLicense(env, payload.key);
  const active = record && record.status === "active" && !isExpired(record);
  if (!active || normalizeEmail(record.email) !== normalizeEmail(payload.email)) {
    return json({ ok: false, error: "subscription_inactive" }, 403);
  }

  return json({ ok: true, plan: record.plan || "desktop", expiresAt: new Date(payload.exp * 1000).toISOString() });
}
