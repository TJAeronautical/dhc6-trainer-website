(function () {
  "use strict";

  const form = document.getElementById("web-access-form");
  const message = document.getElementById("web-access-message");
  const button = form && form.querySelector("button[type=submit]");
  const storageKey = "dhc6WebAccessToken";

  function setMessage(text, good) {
    if (!message) return;
    message.textContent = text;
    message.style.color = good ? "#7dffb7" : "#ffb0b8";
  }

  async function verifyExisting() {
    const token = window.sessionStorage.getItem(storageKey);
    if (!token) return;
    const response = await fetch("/api/web-access/verify", {
      cache: "no-store",
      headers: { "Authorization": "Bearer " + token }
    });
    if (response.ok) window.location.replace("live.html");
    else window.sessionStorage.removeItem(storageKey);
  }

  if (form) form.addEventListener("submit", async function (event) {
    event.preventDefault();
    const email = document.getElementById("webAccessEmail").value.trim();
    const licenseKey = document.getElementById("webAccessKey").value.trim().toUpperCase();
    button.disabled = true;
    setMessage("Checking your active subscription…", true);
    try {
      const response = await fetch("/api/web-access/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, licenseKey: licenseKey })
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.token) throw new Error(data.error || "access_denied");
      window.sessionStorage.setItem(storageKey, data.token);
      setMessage("Subscription confirmed. Opening the web app…", true);
      window.location.assign("live.html");
    } catch (error) {
      setMessage("Access could not be confirmed. Check your purchase email and licence key.", false);
      button.disabled = false;
    }
  });

  verifyExisting().catch(function () { window.sessionStorage.removeItem(storageKey); });
})();
