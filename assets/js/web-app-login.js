(function () {
  "use strict";

  /*
    Subscriber / owner sign-in for the browser app.
    The session is an HttpOnly cookie set by the API; nothing secret is kept
    in sessionStorage or localStorage. `dhc6WebSessionHint` only records that a
    session probably exists so pages can skip a round-trip.
  */
  const HINT_KEY = "dhc6WebSessionHint";
  const LINK_EMAIL_KEY = "dhc6WebLinkEmail";
  const LEGACY_TOKEN_KEY = "dhc6WebAccessToken";

  const form = document.getElementById("web-access-form");
  const message = document.getElementById("web-access-message");
  const ownerForm = document.getElementById("owner-access-form");
  const ownerMessage = document.getElementById("owner-access-message");
  const linkForm = document.getElementById("email-link-form");
  const linkMessage = document.getElementById("email-link-message");
  const params = new URLSearchParams(window.location.search);

  try { window.sessionStorage.removeItem(LEGACY_TOKEN_KEY); } catch (error) { /* ignore */ }

  function safeNext() {
    const next = params.get("next") || "";
    if (/^\/(?:app(?:\/|$)|live(?:\.html)?(?:$|[?#]))/.test(next) && next.indexOf("//") !== 0) return next;
    return "/app/";
  }

  function setText(node, text, good) {
    if (!node) return;
    node.textContent = text;
    node.style.color = good ? "#7dffb7" : "#ffb0b8";
  }

  function rememberSession(data) {
    try {
      window.localStorage.setItem(HINT_KEY, JSON.stringify({ role: data.role || "subscriber", plan: data.plan || "", expiresAt: data.expiresAt || "" }));
    } catch (error) { /* ignore */ }
  }

  function openApp() {
    window.location.assign(safeNext());
  }

  async function postJson(path, body) {
    const response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await response.json(); } catch (error) { data = {}; }
    return { ok: response.ok, status: response.status, data: data };
  }

  async function verifyExisting() {
    const response = await fetch("/api/web-access/verify", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) {
      try { window.localStorage.removeItem(HINT_KEY); } catch (error) { /* ignore */ }
      return false;
    }
    const data = await response.json();
    if (data && data.ok) {
      rememberSession(data);
      openApp();
      return true;
    }
    return false;
  }

  function describeError(code, fallback) {
    switch (code) {
      case "rate_limited": return "Too many attempts. Wait a few minutes and try again.";
      case "web_access_not_configured": return "The web app service is not configured yet. Contact support.";
      case "owner_access_not_configured": return "Owner access needs OWNER_ACCESS_EMAIL, FIREBASE_WEB_API_KEY and LICENSE_SIGNING_SECRET configured in Cloudflare.";
      case "owner_email_unverified": return "The owner Firebase account must have a verified email address before it can sign in here.";
      case "email_link_not_configured": return "Email sign-in links are not enabled in Firebase Authentication yet. Use your licence key instead.";
      case "subscription_inactive": return "This subscription is not active. Check the Manage licence page.";
      case "cross_site_request": return "Sign-in must be started from dhc6trainer.com.";
      default: return fallback;
    }
  }

  if (form) form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const email = document.getElementById("webAccessEmail").value.trim();
    const licenseKey = document.getElementById("webAccessKey").value.trim().toUpperCase();
    button.disabled = true;
    setText(message, "Checking your active subscription…", true);
    try {
      const result = await postJson("/api/web-access/session", { email: email, licenseKey: licenseKey });
      if (!result.ok || !result.data.ok) throw new Error(result.data.error || "access_denied");
      rememberSession(result.data);
      setText(message, "Subscription confirmed. Opening the web app…", true);
      openApp();
    } catch (error) {
      setText(message, describeError(error.message, "Access could not be confirmed. Check your purchase email and licence key."), false);
      button.disabled = false;
    }
  });

  if (ownerForm) ownerForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const ownerButton = ownerForm.querySelector("button[type=submit]");
    const email = document.getElementById("ownerAccessEmail").value.trim();
    const passwordField = document.getElementById("ownerAccessPassword");
    const password = passwordField.value;
    ownerButton.disabled = true;
    setText(ownerMessage, "Authenticating owner account…", true);
    try {
      const result = await postJson("/api/web-access/owner-session", { email: email, password: password });
      passwordField.value = "";
      if (!result.ok || !result.data.ok) throw new Error(result.data.error || "access_denied");
      rememberSession(result.data);
      setText(ownerMessage, "Owner access confirmed. Opening the web app…", true);
      openApp();
    } catch (error) {
      setText(ownerMessage, describeError(error.message, "Owner sign-in failed. Check the owner email and Firebase password."), false);
      ownerButton.disabled = false;
    }
  });

  if (linkForm) linkForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    const linkButton = linkForm.querySelector("button[type=submit]");
    const email = document.getElementById("emailLinkAddress").value.trim();
    linkButton.disabled = true;
    setText(linkMessage, "Requesting your sign-in link…", true);
    try {
      const result = await postJson("/api/web-access/request-link", { email: email });
      if (!result.ok || !result.data.ok) throw new Error(result.data.error || "request_failed");
      try { window.localStorage.setItem(LINK_EMAIL_KEY, email); } catch (error) { /* ignore */ }
      setText(linkMessage, "If an active subscription is linked to that email, a sign-in link is on its way. Open it on this device.", true);
    } catch (error) {
      setText(linkMessage, describeError(error.message, "The sign-in link could not be requested right now."), false);
    }
    linkButton.disabled = false;
  });

  async function completeEmailLink() {
    const oobCode = params.get("oobCode");
    if (!oobCode) return false;
    let email = "";
    try { email = window.localStorage.getItem(LINK_EMAIL_KEY) || ""; } catch (error) { email = ""; }
    if (!email) email = window.prompt("Confirm the purchase email this sign-in link was sent to:") || "";
    email = email.trim();
    if (!email) {
      setText(linkMessage, "Enter the purchase email to finish signing in with the link.", false);
      return false;
    }
    setText(linkMessage, "Verifying your sign-in link…", true);
    const result = await postJson("/api/web-access/link-session", { email: email, oobCode: oobCode });
    if (!result.ok || !result.data.ok) {
      setText(linkMessage, describeError(result.data.error, "This sign-in link is invalid or has expired. Request a new one."), false);
      return false;
    }
    try { window.localStorage.removeItem(LINK_EMAIL_KEY); } catch (error) { /* ignore */ }
    rememberSession(result.data);
    setText(linkMessage, "Signed in. Opening the web app…", true);
    openApp();
    return true;
  }

  if (params.get("status") === "signin-required") {
    setText(message, "Sign in to open the subscriber web app.", false);
  } else if (params.get("status") === "signed-out") {
    setText(message, "You have been signed out.", true);
  }

  completeEmailLink().then(function (done) {
    if (!done) return verifyExisting();
    return true;
  }).catch(function () { /* stay on the sign-in page */ });
})();
