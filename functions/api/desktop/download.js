/*
  POST /api/desktop/download
  Body: { "licenseKey": "DHC6-....", "email": "buyer@example.com", "installerType": "exe" }

  Returns a short-lived download URL for an active desktop subscriber. The
  follow-up GET streams from a private R2 binding when configured, or redirects
  to a private installer URL stored in the environment.

  Optional bindings / variables:
    - KV namespace binding: LICENSES
    - R2 bucket binding: DESKTOP_RELEASES
    - DESKTOP_RELEASE_VERSION
    - DESKTOP_WINDOWS_EXE_URL / DESKTOP_WINDOWS_MSI_URL
    - DESKTOP_WINDOWS_EXE_R2_KEY / DESKTOP_WINDOWS_MSI_R2_KEY
*/

import {
  json,
  normalizeKey,
  normalizeEmail,
  getLicense,
  isExpired
} from "../_shared.js";

const TOKEN_TTL_SECONDS = 15 * 60;
const DEFAULT_VERSION = "1.7.0";
const INSTALLERS = {
  exe: {
    envUrl: "DESKTOP_WINDOWS_EXE_URL",
    envKey: "DESKTOP_WINDOWS_EXE_R2_KEY",
    contentType: "application/vnd.microsoft.portable-executable"
  },
  msi: {
    envUrl: "DESKTOP_WINDOWS_MSI_URL",
    envKey: "DESKTOP_WINDOWS_MSI_R2_KEY",
    contentType: "application/octet-stream"
  }
};

function installerTypeFrom(value) {
  const type = String(value || "exe").trim().toLowerCase();
  return INSTALLERS[type] ? type : "";
}

function releaseVersion(env) {
  return String((env && env.DESKTOP_RELEASE_VERSION) || DEFAULT_VERSION).trim() || DEFAULT_VERSION;
}

function fileNameFor(env, installerType) {
  return "DHC6TrainerDesktop-" + releaseVersion(env) + "." + installerType;
}

function r2KeyFor(env, installerType) {
  const config = INSTALLERS[installerType];
  return (
    (env && env[config.envKey]) ||
    "desktop/windows/" + releaseVersion(env) + "/" + fileNameFor(env, installerType)
  );
}

function configuredUrlFor(env, installerType) {
  const config = INSTALLERS[installerType];
  return env && env[config.envUrl] ? String(env[config.envUrl]) : "";
}

function tokenKey(token) {
  return "download-token:" + token;
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

async function findLicensedRecord(env, licenseKey) {
  const key = normalizeKey(licenseKey);
  if (!/^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) return null;
  return getLicense(env, key);
}

function licenseStatus(record) {
  if (!record) return "not_found";
  if (record.status === "active" && isExpired(record)) return "expired";
  return record.status || "inactive";
}

function assertDownloadConfigured(env, installerType) {
  if (env && env.DESKTOP_RELEASES) return true;
  return Boolean(configuredUrlFor(env, installerType));
}

function downloadUrlFromRequest(request, token) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}

async function readJson(request) {
  try {
    return await request.json();
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  const body = await readJson(request);
  if (!body) {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const installerType = installerTypeFrom(body.installerType);
  if (!installerType) {
    return json({ ok: false, status: "unsupported_installer" }, 400);
  }

  const record = await findLicensedRecord(env, body.licenseKey);
  if (!record) {
    return json({ ok: false, status: "not_found" }, 200);
  }

  const requestedEmail = normalizeEmail(body.email);
  if (requestedEmail && record.email && normalizeEmail(record.email) !== requestedEmail) {
    return json({ ok: false, status: "email_mismatch" }, 200);
  }

  const status = licenseStatus(record);
  if (status !== "active") {
    return json({ ok: false, status: status }, 200);
  }

  if (!assertDownloadConfigured(env, installerType)) {
    return json({ ok: false, status: "download_not_configured" }, 503);
  }

  const token = randomToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString();
  const tokenRecord = {
    licenseKey: record.key,
    email: record.email || requestedEmail || null,
    installerType: installerType,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt
  };

  await env.LICENSES.put(tokenKey(token), JSON.stringify(tokenRecord), {
    expirationTtl: TOKEN_TTL_SECONDS
  });

  return json({
    ok: true,
    downloadUrl: downloadUrlFromRequest(request, token),
    expiresAt: expiresAt,
    fileName: fileNameFor(env, installerType)
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;

  if (!env.LICENSES) {
    return json({ ok: false, error: "kv_not_bound" }, 500);
  }

  const url = new URL(request.url);
  const token = String(url.searchParams.get("token") || "").trim();
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return json({ ok: false, status: "invalid_token" }, 400);
  }

  const rawToken = await env.LICENSES.get(tokenKey(token));
  if (!rawToken) {
    return json({ ok: false, status: "token_not_found" }, 404);
  }

  let tokenRecord;
  try {
    tokenRecord = JSON.parse(rawToken);
  } catch (e) {
    return json({ ok: false, status: "bad_token" }, 410);
  }

  if (new Date(tokenRecord.expiresAt).getTime() < Date.now()) {
    return json({ ok: false, status: "token_expired" }, 410);
  }

  const record = await getLicense(env, tokenRecord.licenseKey);
  if (licenseStatus(record) !== "active") {
    return json({ ok: false, status: "license_inactive" }, 403);
  }

  const installerType = installerTypeFrom(tokenRecord.installerType);
  if (!installerType) {
    return json({ ok: false, status: "unsupported_installer" }, 410);
  }

  const fileName = fileNameFor(env, installerType);
  if (env.DESKTOP_RELEASES) {
    const object = await env.DESKTOP_RELEASES.get(r2KeyFor(env, installerType));
    if (!object) {
      return json({ ok: false, status: "installer_not_found" }, 503);
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", INSTALLERS[installerType].contentType);
    headers.set("Content-Disposition", 'attachment; filename="' + fileName + '"');
    headers.set("Cache-Control", "no-store");
    if (object.size) headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers: headers });
  }

  const configuredUrl = configuredUrlFor(env, installerType);
  if (!configuredUrl) {
    return json({ ok: false, status: "download_not_configured" }, 503);
  }

  return new Response(null, {
    status: 302,
    headers: {
      "Location": configuredUrl,
      "Cache-Control": "no-store"
    }
  });
}
