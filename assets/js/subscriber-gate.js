(function () {
  "use strict";
  const storageKey = "dhc6WebAccessToken";

  async function authorize() {
    const token = window.sessionStorage.getItem(storageKey);
    if (!token) throw new Error("missing_session");
    const response = await fetch("/api/web-access/verify", {
      cache: "no-store",
      headers: { "Authorization": "Bearer " + token }
    });
    if (!response.ok) throw new Error("inactive_subscription");
    const data = await response.json();
    if (!data.ok) throw new Error("access_denied");
    document.body.classList.remove("subscriber-locked");
    document.body.classList.add("subscriber-authorized");
  }

  authorize().catch(function () {
    window.sessionStorage.removeItem(storageKey);
    window.location.replace("web-app.html?status=signin-required");
  });
})();
