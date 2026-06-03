/*
  Netlify Function: /api/desktop-download

  Purpose:
  - License-gated desktop installer download endpoint.
  - Validates email + license key against DESKTOP_LICENSE_HASHES.
  - Returns a configured installer URL for the requested file type.

  Security note:
  - For real paid distribution, installer URLs should point to private storage
    signed URLs or a backend-generated temporary URL.
  - Public GitHub Release URLs are acceptable only if you accept that anyone
    with the URL can download the installer.
*/

const crypto = require("crypto");

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(payload)
  };
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeType(value) {
  const type = String(value || "exe").trim().toLowerCase();
  if (type === "exe" || type === "msi") return type;
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Invalid JSON" });
  }

  const licenseKey = String(body.licenseKey || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  const type = normalizeType(body.type);

  if (!licenseKey || !email) {
    return json(400, { error: "Missing licenseKey or email" });
  }

  if (!type) {
    return json(400, { error: "Invalid download type. Use exe or msi." });
  }

  const allowedHashes = (process.env.DESKTOP_LICENSE_HASHES || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (allowedHashes.length === 0) {
    return json(500, { error: "License system not configured" });
  }

  const submittedHash = sha256(`${email}|${licenseKey}`.toLowerCase());

  if (!allowedHashes.includes(submittedHash)) {
    return json(403, { error: "License not valid" });
  }

  const urls = {
    exe: process.env.DESKTOP_WINDOWS_EXE_SIGNED_URL,
    msi: process.env.DESKTOP_WINDOWS_MSI_SIGNED_URL
  };

  const downloadUrl = urls[type];

  if (!downloadUrl) {
    return json(500, { error: `Download URL not configured for ${type}` });
  }

  return json(200, {
    platform: "windows",
    type,
    downloadUrl
  });
};
