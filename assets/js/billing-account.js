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

let loadedAccount = null;

function billingSetMessage(text, ok) {
  if (!billingMessage) return;
  billingMessage.textContent = text || "";
  billingMessage.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  billingMessage.style.fontWeight = "900";
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

  if (!email || !licenseKey) {
    billingSetMessage("Enter your purchase email and licence key.", false);
    return;
  }
  if (!BILLING_KEY_PATTERN.test(licenseKey)) {
    billingSetMessage("Licence key format should look like DHC6-XXXX-XXXX-XXXX.", false);
    return;
  }

  billingSetMessage("Loading billing status...", true);
  const data = await postJson("/api/billing/status", { email: email, licenseKey: licenseKey });
  if (!data.ok || !data.license) {
    renderAccount(null);
    billingSetMessage("No matching subscription was found.", false);
    return;
  }
  renderAccount(data.license);
  billingSetMessage("Billing status loaded.", true);
}

async function openPortal() {
  if (!loadedAccount) return;
  const email = (document.getElementById("billingEmail")?.value || "").trim();
  const licenseKey = (document.getElementById("billingKey")?.value || "").trim().toUpperCase();
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
  const licenseKey = (document.getElementById("billingKey")?.value || "").trim().toUpperCase();
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
