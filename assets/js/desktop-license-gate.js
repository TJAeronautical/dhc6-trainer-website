/*
  DHC-6 Trainer desktop licence gate.
  Verifies a paid licence key against the Paddle-backed licence API
  (/api/license/validate). If the backend is not deployed yet, it falls
  back to the manual email path so the page still works on plain hosting.
*/

/* ======================= CONFIG ======================= */
// Leave blank to use same-origin Cloudflare Pages Functions ("/api/...").
// Set to "https://api.dhc6trainer.com" if you host the API separately.
const LICENSE_API_BASE = "";
const SUPPORT_EMAIL = "tj.aeronautical@outlook.com";
/* ===================== END CONFIG ===================== */

const form = document.getElementById("desktop-license-form");
const message = document.getElementById("license-gate-message");
const KEY_PATTERN = /^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

function setMessage(text, ok) {
  if (!message) return;
  message.textContent = text;
  message.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  message.style.fontWeight = "900";
}

function mailtoFallback(email, licenseKey) {
  const subject = encodeURIComponent("DHC-6 Trainer Desktop Licence Activation");
  const body = encodeURIComponent(
    "Licence activation request\n\n" +
      "Email: " + email + "\n" +
      "Licence key: " + licenseKey + "\n\n" +
      "Please confirm my subscription and send desktop activation instructions."
  );
  window.location.href =
    "mailto:" + SUPPORT_EMAIL + "?subject=" + subject + "&body=" + body;
}

async function verifyLicense(licenseKey, email) {
  const endpoint = (LICENSE_API_BASE || "") + "/api/license/validate";

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ licenseKey: licenseKey, email: email })
    });
  } catch (networkError) {
    // Backend not reachable (e.g. plain static hosting). Use manual path.
    setMessage(
      "Online verification is unavailable right now. Opening an email request instead.",
      true
    );
    mailtoFallback(email, licenseKey);
    return;
  }

  if (response.status === 404) {
    setMessage(
      "Licence verification is not active on this host yet. Opening an email request instead.",
      true
    );
    mailtoFallback(email, licenseKey);
    return;
  }

  let data = {};
  try {
    data = await response.json();
  } catch (parseError) {
    data = {};
  }

  if (response.ok && data.valid && data.status === "active") {
    setMessage(
      "Licence verified. Open the DHC-6 Trainer desktop app and enter this key to unlock full access.",
      true
    );
  } else if (data.status === "expired") {
    setMessage("This subscription has expired. Renew from the desktop pricing section to continue.", false);
  } else if (data.status === "canceled") {
    setMessage("This subscription was canceled. Resubscribe to restore desktop access.", false);
  } else {
    setMessage("That licence key was not recognised. Check the key from your purchase email and try again.", false);
  }
}

if (form) {
  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const licenseKey = (document.getElementById("licenseKey")?.value || "").trim();
    const email = (document.getElementById("licenseEmail")?.value || "").trim();

    if (!licenseKey || !email) {
      setMessage("Enter your licence key and the email used at purchase.", false);
      return;
    }

    if (!KEY_PATTERN.test(licenseKey)) {
      setMessage("Licence key format should look like DHC6-XXXX-XXXX-XXXX.", false);
      return;
    }

    setMessage("Verifying licence...", true);
    verifyLicense(licenseKey, email);
  });
}
