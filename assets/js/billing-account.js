/*
  DHC-6 Trainer billing account console.
  Uses same-origin Cloudflare Pages Functions by default.
*/

const BILLING_API_BASE = "";
const BILLING_KEY_PATTERN = /^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i;

const billingForm = document.getElementById("billing-status-form");
const billingMessage = document.getElementById("billing-message");
const billingSummary = document.getElementById("billing-summary");
const deviceList = document.getElementById("device-list");
const portalButton = document.getElementById("billing-portal-button");
const purchaseNotice = document.getElementById("purchase-complete-notice");
const downloadMessage = document.getElementById("desktop-download-message");
const downloadButtons = document.querySelectorAll("[data-desktop-download]");

let loadedAccount = null;

function billingSetMessage(text, ok) {
  if (!billingMessage) return;
  billingMessage.textContent = text || "";
  billingMessage.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  billingMessage.style.fontWeight = "900";
}

function downloadSetMessage(text, ok) {
  if (!downloadMessage) return;
  downloadMessage.textContent = text || "";
  downloadMessage.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  downloadMessage.style.fontWeight = "900";
}

function esc(text) {
  return String(text || "").replace(/[&<>"']/g, function (ch) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch];
  });
}

function fmtDate(value) {
  if (!value) return "Not set";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit"
    });
  } catch (e) {
    return value;
  }
}

function statusLabel(status) {
  if (status === "active") return "Active";
  if (status === "past_due") return "Payment past due";
  if (status === "paused") return "Paused";
  if (status === "canceled") return "Canceled";
  if (status === "expired") return "Expired";
  return status || "Unknown";
}

function isActiveLicense(license) {
  return Boolean(license && license.status === "active");
}

function updateDownloadUi(license) {
  const enabled = isActiveLicense(license);
  downloadButtons.forEach(function (button) {
    button.disabled = !enabled;
    button.setAttribute("aria-disabled", enabled ? "false" : "true");
  });

  if (!downloadButtons.length) return;
  if (enabled) {
    downloadSetMessage("Licence active. Choose an installer to start a protected download.", true);
  } else if (!license) {
    downloadSetMessage("Load your subscription first, then the installer buttons will unlock.", true);
  } else {
    downloadSetMessage("Downloads unlock when the subscription status is active.", false);
  }
}

async function postJson(path, body) {
  const response = await fetch((BILLING_API_BASE || "") + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  if (!response.ok) {
    const err = new Error(data.status || data.error || "request_failed");
    err.data = data;
    throw err;
  }
  return data;
}

function renderAccount(license) {
  loadedAccount = license;
  if (portalButton) portalButton.disabled = !license || !license.customerId;
  updateDownloadUi(license);
  const keyInput = document.getElementById("billingKey");
  if (license && keyInput && !keyInput.value.trim()) keyInput.value = license.key;

  if (!license) {
    billingSummary.innerHTML = "<h2>No account loaded</h2><p>Load your subscription to see current status, renewal date, and activated devices.</p>";
    deviceList.innerHTML = "<p>No devices loaded yet.</p>";
    return;
  }

  billingSummary.innerHTML =
    '<h2>' + esc(statusLabel(license.status)) + '</h2>' +
    '<div class="hero-stats">' +
      '<div class="stat"><strong>' + esc(String(license.activationCount)) + " / " + esc(String(license.activationLimit)) + '</strong><span>Device seats used</span></div>' +
      '<div class="stat"><strong>' + esc(license.plan || "desktop") + '</strong><span>Plan</span></div>' +
      '<div class="stat"><strong>' + esc(fmtDate(license.expiresAt)) + '</strong><span>Renews or expires</span></div>' +
    '</div>' +
    '<p style="margin-top:14px">Licence key: <code>' + esc(license.key) + '</code></p>';

  const devices = Array.isArray(license.activations) ? license.activations : [];
  if (!devices.length) {
    deviceList.innerHTML = "<p>No devices are activated yet. Activate the desktop app to use a seat.</p>";
    return;
  }

  deviceList.innerHTML = devices.map(function (device) {
    return '<div class="flow-row">' +
      '<b>PC</b><div><span>' + esc(device.deviceName || "Unnamed device") + '</span><small>Activated ' + esc(fmtDate(device.activatedAt)) + ' · Last seen ' + esc(fmtDate(device.lastSeenAt)) + '</small><small style="display:block">Device ID: ' + esc(device.deviceId) + '</small></div>' +
      '<button class="btn ghost" type="button" data-release-device="' + esc(device.deviceId) + '" style="min-height:36px;padding:8px 12px">Release</button>' +
    '</div>';
  }).join("");
}

async function loadBillingStatus() {
  const email = (document.getElementById("billingEmail")?.value || "").trim();
  const licenseKey = (document.getElementById("billingKey")?.value || "").trim().toUpperCase();

  if (!email) {
    billingSetMessage("Enter your purchase email.", false);
    return;
  }
  if (licenseKey && !BILLING_KEY_PATTERN.test(licenseKey)) {
    billingSetMessage("Licence key format should look like DHC6-XXXX-XXXX-XXXX.", false);
    return;
  }

  billingSetMessage("Loading billing status...", true);
  const data = await postJson("/api/billing/status", { email: email, licenseKey: licenseKey });
  if (!data.ok || !data.license) {
    renderAccount(null);
    billingSetMessage("No subscription was found for that email yet. If you just purchased, wait a minute and try again.", false);
    return null;
  }
  renderAccount(data.license);
  billingSetMessage("Billing status loaded. Your licence key is shown on the right.", true);
  return data.license;
}

function downloadFailureMessage(status) {
  if (status === "download_not_configured") {
    return "The payment check passed, but the private installer location is not configured yet.";
  }
  if (status === "expired") return "This subscription has expired. Renew before downloading.";
  if (status === "canceled") return "This subscription was canceled. Resubscribe before downloading.";
  if (status === "past_due") return "Payment is past due. Update billing before downloading.";
  if (status === "email_mismatch") return "That email does not match this licence key.";
  if (status === "not_found") return "No active licence was found for that key.";
  return "The installer could not be prepared. Try again later or email support.";
}

async function startDesktopDownload(installerType) {
  let account = loadedAccount;
  if (!isActiveLicense(account)) {
    account = await loadBillingStatus();
  }

  if (!isActiveLicense(account)) {
    downloadSetMessage("Load an active subscription before downloading.", false);
    return;
  }

  const email = (document.getElementById("billingEmail")?.value || "").trim();
  const licenseKey = ((document.getElementById("billingKey")?.value || "").trim() || account.key || "").toUpperCase();

  downloadSetMessage("Preparing protected installer link...", true);
  let data;
  try {
    data = await postJson("/api/desktop/download", {
      email: email,
      licenseKey: licenseKey,
      platform: "windows",
      installerType: installerType
    });
  } catch (err) {
    downloadSetMessage(downloadFailureMessage(err && err.data && (err.data.status || err.data.error)), false);
    return;
  }

  if (data.ok && data.downloadUrl) {
    downloadSetMessage("Download link ready. Your browser should start the installer download now.", true);
    window.location.href = data.downloadUrl;
  } else {
    downloadSetMessage(downloadFailureMessage(data.status || data.error), false);
  }
}

function prefillFromCompletedCheckout() {
  const params = new URLSearchParams(window.location.search);
  const purchased = params.get("status") === "purchased" || params.get("download") === "1";
  if (purchaseNotice) purchaseNotice.hidden = !purchased;

  if (purchased) {
    downloadSetMessage("Payment complete. Load your subscription to unlock the installer buttons.", true);
  }

  try {
    const storage = window.sessionStorage;
    if (!storage) return;
    const raw = storage.getItem("dhc6TrainerCheckout");
    if (!raw) return;
    const checkout = JSON.parse(raw);
    const emailInput = document.getElementById("billingEmail");
    if (checkout.email && emailInput && !emailInput.value.trim()) {
      emailInput.value = checkout.email;
      if (purchased) {
        loadBillingStatus().catch(function () {
          billingSetMessage("Payment was completed. If your licence is not ready yet, wait a minute and check again.", false);
        });
      }
    }
  } catch (e) {
    // Ignore malformed session storage; the form still works manually.
  }
}

async function openPortal() {
  if (!loadedAccount) return;
  const email = (document.getElementById("billingEmail")?.value || "").trim();
  const licenseKey = ((document.getElementById("billingKey")?.value || "").trim() || loadedAccount.key || "").toUpperCase();
  billingSetMessage("Opening Paddle billing portal...", true);
  const data = await postJson("/api/billing/portal", { email: email, licenseKey: licenseKey });
  if (data.ok && data.url) {
    window.location.href = data.url;
  } else {
    billingSetMessage("Billing portal could not be opened. Email support for help.", false);
  }
}

async function releaseDevice(deviceId) {
  const email = (document.getElementById("billingEmail")?.value || "").trim();
  const licenseKey = ((document.getElementById("billingKey")?.value || "").trim() || (loadedAccount && loadedAccount.key) || "").toUpperCase();
  billingSetMessage("Releasing device seat...", true);
  const data = await postJson("/api/license/deactivate", { email: email, licenseKey: licenseKey, deviceId: deviceId });
  if (data.ok && data.license) {
    renderAccount(data.license);
    billingSetMessage("Device seat released.", true);
  } else {
    billingSetMessage("That device could not be released.", false);
  }
}

if (billingForm) {
  billingForm.addEventListener("submit", function (event) {
    event.preventDefault();
    loadBillingStatus().catch(function () {
      billingSetMessage("Billing status is unavailable right now. Try again later or email support.", false);
    });
  });
}

if (portalButton) {
  portalButton.addEventListener("click", function () {
    openPortal().catch(function () {
      billingSetMessage("Billing portal is unavailable right now. Try again later or email support.", false);
    });
  });
}

if (deviceList) {
  deviceList.addEventListener("click", function (event) {
    const btn = event.target.closest("[data-release-device]");
    if (!btn) return;
    releaseDevice(btn.getAttribute("data-release-device")).catch(function () {
      billingSetMessage("Device release failed. Try again later or email support.", false);
    });
  });
}

downloadButtons.forEach(function (button) {
  button.addEventListener("click", function () {
    startDesktopDownload(button.getAttribute("data-desktop-download")).catch(function () {
      downloadSetMessage("Download preparation failed. Try again later or email support.", false);
    });
  });
});

prefillFromCompletedCheckout();
updateDownloadUi(loadedAccount);
