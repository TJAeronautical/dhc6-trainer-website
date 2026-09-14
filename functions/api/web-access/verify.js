/*
  GET /api/web-access/verify
  Accepts the session as `Authorization: Bearer <token>` or the HttpOnly
  dhc6_web_session cookie. Re-checks signature, expiry, revocation and the
  live entitlement (KV licence or OWNER_ACCESS_EMAIL) on every call.
*/

import { json } from "../_shared.js";
import { authorizeWebRequest } from "./_session.js";

export async function onRequestGet(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  return json({
    ok: true,
    role: auth.role,
    plan: auth.plan,
    tier: auth.tier,
    entitlements: auth.entitlements,
    email: auth.payload.email,
    /* When the paid period ends. The browser caps its offline window by this,
       so lapsing ends offline access rather than granting another 30 days. */
    entitledUntil: auth.entitledUntil || null,
    expiresAt: auth.expiresAt
  });
}
