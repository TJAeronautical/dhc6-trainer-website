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
  const DEVICE_KEY = "dhc6.webDevice.v1";

  /*
    A name for this browser, so signing in again from it reuses the seat it
    already holds instead of spending another one. It identifies a browser and
    nothing else: it is random, it is never sent anywhere but this site's own
    sign-in, and losing it costs a seat rather than access - the server issues
    a fresh one and, at the limit, recycles the least recently used seat.
  */
  function deviceId() {
    let id = "";
    try { id = window.localStorage.getItem(DEVICE_KEY) || ""; } catch (error) { id = ""; }
    if (/^[0-9a-f]{32}$/.test(id)) return id;
    id = "";
    try {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      for (let i = 0; i < bytes.length; i++) id += bytes[i].toString(16).padStart(2, "0");
    } catch (error) {
      /* No crypto, or storage refused: the server issues one per sign-in and
         recycles rather than refusing, so this degrades to "works, but uses a
         seat each time" instead of failing. */
      return "";
    }
    try { window.localStorage.setItem(DEVICE_KEY, id); } catch (error) { /* private window */ }
    return id;
  }

  function rememberDevice(data) {
    if (!data || !/^[0-9a-f]{32}$/.test(String(data.deviceId || ""))) return;
    try { window.localStorage.setItem(DEVICE_KEY, data.deviceId); } catch (error) { /* ignore */ }
  }

  const form = document.getElementById("web-access-form");
  const message = document.getElementById("web-access-message");
  const ownerForm = document.getElementById("owner-access-form");
  const ownerMessage = document.getElementById("owner-access-message");
  const linkForm = document.getElementById("email-link-form");
  const linkMessage = document.getElementById("email-link-message");
  const params = new URLSearchParams(window.location.search);

  /* Captured before the address bar is cleaned, below. */
  const linkCode = params.get("oobCode") || "";
  const linkIntent = params.get("t") || "";
  let linkPending = false;

  try { window.sessionStorage.removeItem(LEGACY_TOKEN_KEY); } catch (error) { /* ignore */ }

  /*
    A sign-in code works exactly once. Leaving it in the address bar means a
    reload, a back-navigation or a restored tab spends it a second time, and
    the second attempt is refused - which reads as "this link is broken" when
    the link was fine and the first attempt is what used it up. Take it out of
    the URL before using it, not after.
  */
  function stripOneTimeParams() {
    if (!linkCode || !window.history || !window.history.replaceState) return;
    try {
      const url = new URL(window.location.href);
      ["oobCode", "apiKey", "lang", "t", "continueUrl", "mode"].forEach(function (name) {
        url.searchParams.delete(name);
      });
      url.searchParams.set("mode", "link");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    } catch (error) { /* an unchanged address bar is survivable; a spent code is not */ }
  }

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
      case "seat_limit": return "This licence is already signed in on the maximum number of browsers.";
      default: return fallback;
    }
  }

  function seenLabel(iso) {
    const when = Date.parse(iso || "");
    if (!isFinite(when)) return "";
    const days = Math.floor((Date.now() - when) / 86400000);
    if (days <= 0) return "last used today";
    if (days === 1) return "last used yesterday";
    return "last used " + days + " days ago";
  }

  /*
    Refused at the limit, with a way through.

    A limit a subscriber cannot clear themselves is a support ticket, so the
    refusal lists what is holding the seats and offers to end those sessions.
    The retry carries the same credentials the refused attempt already proved -
    nothing is stored, and no second endpoint accepts a sign-out without them.
  */
  function offerSeatRelease(node, data, retry) {
    if (!node) return;
    node.replaceChildren();
    node.style.color = "#ffb0b8";

    const limit = Number(data && data.limit) || 0;
    const heading = document.createElement("div");
    heading.textContent = limit
      ? "This licence is signed in on " + limit + " browsers already, which is its limit."
      : "This licence is signed in on the maximum number of browsers.";
    node.appendChild(heading);

    const devices = (data && Array.isArray(data.devices)) ? data.devices : [];
    if (devices.length) {
      const list = document.createElement("ul");
      list.style.margin = "8px 0";
      list.style.paddingLeft = "20px";
      devices.forEach(function (device) {
        const item = document.createElement("li");
        const seen = seenLabel(device.lastSeenAt);
        item.textContent = (device.label || "Unknown browser") + (seen ? " — " + seen : "");
        list.appendChild(item);
      });
      node.appendChild(list);
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn secondary";
    button.textContent = "Sign out the other browsers and continue";
    button.addEventListener("click", function () {
      button.disabled = true;
      setText(node, "Signing the other browsers out…", true);
      retry();
    });
    node.appendChild(button);

    const note = document.createElement("div");
    note.style.marginTop = "8px";
    note.textContent = "Anyone using this licence elsewhere will be signed out. Their saved drills stay on their own device.";
    node.appendChild(note);
  }

  if (form) form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    const email = document.getElementById("webAccessEmail").value.trim();
    const licenseKey = document.getElementById("webAccessKey").value.trim().toUpperCase();

    const attempt = async function (signOutOthers) {
      button.disabled = true;
      if (!signOutOthers) setText(message, "Checking your active subscription…", true);
      try {
        const result = await postJson("/api/web-access/session", {
          email: email,
          licenseKey: licenseKey,
          deviceId: deviceId(),
          signOutOthers: signOutOthers === true
        });
        /* Refused for seats, not for credentials: the way out is a button, not
           a retyped licence key. */
        if (result.status === 403 && result.data && result.data.error === "seat_limit") {
          offerSeatRelease(message, result.data, function () { attempt(true); });
          button.disabled = false;
          return;
        }
        if (!result.ok || !result.data.ok) throw new Error(result.data.error || "access_denied");
        rememberSession(result.data);
        rememberDevice(result.data);
        setText(message, "Subscription confirmed. Opening the web app…", true);
        openApp();
      } catch (error) {
        setText(message, describeError(error.message, "Access could not be confirmed. Check your purchase email and licence key."), false);
        button.disabled = false;
      }
    };

    await attempt(false);
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

    /* Arrived here holding a code and only missing the address: finish that
       sign-in rather than sending a second link and spending the first. */
    if (linkPending) {
      if (!email) { setText(linkMessage, "Enter the purchase email this link was sent to.", false); return; }
      linkButton.disabled = true;
      const outcome = await submitEmailLink(email);
      if (outcome !== "done") linkButton.disabled = false;
      return;
    }

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

  async function submitEmailLink(email, grant) {
    if (!grant) setText(linkMessage, "Verifying your sign-in link…", true);
    /*
      The retry after a seat refusal sends the grant the server handed back,
      not the code: verifying the code spent it, and resending a spent code
      would report a broken link for a problem that is nothing to do with the
      link.
    */
    const result = await postJson("/api/web-access/link-session", grant ? {
      grant: grant,
      deviceId: deviceId(),
      signOutOthers: true
    } : {
      email: email,
      intent: linkIntent,
      oobCode: linkCode,
      deviceId: deviceId()
    });
    if (result.status === 403 && result.data && result.data.error === "seat_limit") {
      const handle = result.data.grant;
      if (!handle) {
        setText(linkMessage, "This licence is signed in on too many browsers. Sign one out from Settings on that device, or use your licence key here.", false);
        return "seat-limit";
      }
      offerSeatRelease(linkMessage, result.data, function () { submitEmailLink(email, handle); });
      return "seat-limit";
    }
    if (!result.ok || !result.data.ok) {
      setText(linkMessage, describeError(result.data.error, "This sign-in link did not work. Each link can only be opened once — request a fresh one below."), false);
      return "failed";
    }
    try { window.localStorage.removeItem(LINK_EMAIL_KEY); } catch (error) { /* ignore */ }
    rememberSession(result.data);
    rememberDevice(result.data);
    setText(linkMessage, "Signed in. Opening the web app…", true);
    openApp();
    return "done";
  }

  /*
    The address is asked for in the page, never through window.prompt: Gmail's
    in-app browser and several others suppress prompt() silently, which is
    precisely where a link opened from an email tends to land.
  */
  function askForAddressInPage() {
    linkPending = true;
    const button = linkForm && linkForm.querySelector("button[type=submit]");
    if (button) button.textContent = "Finish signing in";
    setText(linkMessage, "Confirm the purchase email this link was sent to, then press Finish signing in.", true);
    const field = document.getElementById("emailLinkAddress");
    if (field) { try { field.focus(); } catch (error) { /* ignore */ } }
  }

  async function completeEmailLink() {
    if (!linkCode) return "no-link";
    stripOneTimeParams();

    let email = "";
    try { email = window.localStorage.getItem(LINK_EMAIL_KEY) || ""; } catch (error) { email = ""; }
    email = email.trim();

    /* The server-side handle covers the cross-device case; this only runs for
       a link issued before that existed, opened away from its own browser. */
    if (!email && !linkIntent) {
      askForAddressInPage();
      return "waiting";
    }
    return submitEmailLink(email);
  }

  if (params.get("status") === "signin-required") {
    setText(message, "Sign in to open the subscriber web app.", false);
  } else if (params.get("status") === "signed-out") {
    setText(message, "You have been signed out.", true);
  } else if (params.get("status") === "offline-expired") {
    /* Reached only when this device has gone 30 days without reaching the
       server. Nothing has been deleted - anything recorded offline is still
       on the device and syncs once this account signs back in. */
    setText(message, "This device has been offline for 30 days. Sign in once to carry on — your offline drills are still saved here and will sync.", true);
  }

  /*
    Only a visitor with no sign-in code falls through to an existing session.
    Doing it after a failed link is what made a refused subscriber link open
    the app as Owner: the real outcome was replaced by an unrelated session
    that happened to be valid, and the reason was never shown to anyone.
  */
  completeEmailLink().then(function (outcome) {
    if (outcome === "no-link") return verifyExisting();
    return true;
  }).catch(function () {
    if (linkCode) setText(linkMessage, "This sign-in link could not be checked. Request a fresh one below.", false);
  });
})();
