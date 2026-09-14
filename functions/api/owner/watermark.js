/*
  POST /api/owner/watermark    (OWNER SESSION ONLY)

  Resolves a content watermark, in whichever direction you need:

    { "watermark": "a1b2c3d4e5f60718" }
        -> which account that stamp belongs to

    { "email": "buyer@example.com" }  or  { "licenseKey": "DHC6-..." }
        -> that account's stamp, so you can check a suspicion directly

  This is the other half of _watermark.js. A stamp you cannot resolve is not
  evidence of anything, and the identifier is an HMAC precisely so that only
  someone holding LICENSE_SIGNING_SECRET can map it back - which means this
  endpoint, and only for the owner.

  It is deliberately not open to subscribers, even for their own account: a
  subscriber who can read their own stamp learns exactly which field to strip.
*/

import { json, normalizeEmail, normalizeKey, getLicense, getLicenseByEmail, isExpired } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { watermarkFromSeed, seedForLicenseKey, seedForOwnerEmail, WATERMARK_VERSION } from "../_watermark.js";

const WATERMARK_PATTERN = /^[0-9a-f]{16}$/i;
const SCAN_PAGE = 200;
const SCAN_LIMIT = 20000;

/*
  What an investigation needs, and nothing beyond it. Deliberately not
  publicLicense(): that returns the full licence key, Paddle customer and
  subscription ids, and the device list, none of which help identify a leak.
*/
function accountSummary(record) {
  if (!record) return null;
  const status = record.status === "active" && isExpired(record) ? "expired" : record.status;
  const key = String(record.key || "");
  return {
    email: record.email || null,
    plan: record.plan || "desktop",
    status: status,
    keyHint: key ? key.slice(0, 4) + "-••••-••••-" + key.slice(-4) : null,
    createdAt: record.createdAt || null
  };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role !== "owner") return json({ ok: false, error: "owner_only" }, 403);
  if (!env.LICENSE_SIGNING_SECRET) return json({ ok: false, error: "signing_secret_not_configured" }, 503);
  if (!env.LICENSES) return json({ ok: false, error: "licenses_not_configured" }, 503);

  let body = {};
  try { body = await request.json(); } catch (error) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  /* Forward: an account -> its stamp. */
  const email = normalizeEmail(body.email || "");
  const key = normalizeKey(body.licenseKey || "");
  if (email || key) {
    const record = key ? await getLicense(env, key) : await getLicenseByEmail(env, email);
    if (!record) return json({ ok: false, error: "account_not_found" }, 404);
    const stamp = await watermarkFromSeed(env, seedForLicenseKey(record.key));
    return json({ ok: true, version: WATERMARK_VERSION, watermark: stamp, account: accountSummary(record) });
  }

  /* Reverse: a stamp -> the account. */
  const wanted = String(body.watermark || "").trim().toLowerCase();
  if (!WATERMARK_PATTERN.test(wanted)) return json({ ok: false, error: "bad_watermark" }, 400);

  /* The owner's own stamp is not in the licence store, so check it first. */
  if (env.OWNER_ACCESS_EMAIL) {
    const ownerStamp = await watermarkFromSeed(env, seedForOwnerEmail(env.OWNER_ACCESS_EMAIL));
    if (ownerStamp === wanted) return json({ ok: true, version: WATERMARK_VERSION, match: { role: "owner" } });
  }

  /*
    Then walk the licences. There is no reverse of an HMAC, so the stamp is
    recomputed per key until one matches. That is fine here: this runs when a
    leak is being investigated, not on any hot path.
  */
  let cursor;
  let scanned = 0;
  do {
    const page = await env.LICENSES.list({ prefix: "license:", limit: SCAN_PAGE, cursor: cursor });
    for (const entry of page.keys || []) {
      const licenseKey = String(entry.name || "").slice("license:".length);
      if (!licenseKey) continue;
      scanned += 1;
      const stamp = await watermarkFromSeed(env, seedForLicenseKey(licenseKey));
      if (stamp === wanted) {
        const record = await getLicense(env, licenseKey);
        return json({
          ok: true,
          version: WATERMARK_VERSION,
          match: record
            ? Object.assign({ role: "subscriber" }, accountSummary(record))
            : { role: "subscriber", status: "record_missing" },
          scanned: scanned
        });
      }
      if (scanned >= SCAN_LIMIT) break;
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor && scanned < SCAN_LIMIT);

  return json({ ok: true, version: WATERMARK_VERSION, match: null, scanned: scanned });
}
