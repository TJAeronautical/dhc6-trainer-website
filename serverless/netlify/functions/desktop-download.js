/*
  Netlify Function: /api/desktop-download
  Deploy note:
  - Rename/copy this file to netlify/functions/desktop-download.js in a Netlify project.
  - Configure redirects so /.netlify/functions/desktop-download is available as /api/desktop-download.
  - Do NOT use public GitHub release assets as the protected file.
  - Store installers in private cloud storage and return a short-lived signed URL.
*/

const crypto = require("crypto");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON" }) };
  }

  const licenseKey = String(body.licenseKey || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();

  if (!licenseKey || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing licenseKey or email" }) };
  }

  /*
    Minimal placeholder validation:
    DESKTOP_LICENSE_HASHES should contain comma-separated sha256 hashes of "email|licenseKey".
    Example generation in PowerShell:
      $value = "pilot@example.com|DHC6-AAAA-BBBB-CCCC"
      $bytes = [Text.Encoding]::UTF8.GetBytes($value.ToLower())
      [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace("-","").ToLower()
  */
  const allowedHashes = (process.env.DESKTOP_LICENSE_HASHES || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  const submittedHash = sha256(`${email}|${licenseKey}`.toLowerCase());

  if (!allowedHashes.includes(submittedHash)) {
    return { statusCode: 403, body: JSON.stringify({ error: "License not valid" }) };
  }

  /*
    Replace this with a short-lived signed URL from private storage.
    Do not put a permanent public GitHub Release URL here.
  */
  const signedDownloadUrl = process.env.DESKTOP_WINDOWS_EXE_SIGNED_URL;

  if (!signedDownloadUrl) {
    return { statusCode: 500, body: JSON.stringify({ error: "Download URL not configured" }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({ downloadUrl: signedDownloadUrl })
  };
};
