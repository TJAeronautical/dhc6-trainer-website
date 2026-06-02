/*
  DHC-6 Trainer desktop license gate.
  This client-side file is only a UI layer. It is NOT the security boundary.
  Real protection must happen server-side in /api/desktop-download or an equivalent backend.
*/

const form = document.getElementById("desktop-license-form");
const message = document.getElementById("license-gate-message");

function setMessage(text, ok = false) {
  if (!message) return;
  message.textContent = text;
  message.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  message.style.fontWeight = "900";
}

if (form) {
  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const licenseKey = document.getElementById("licenseKey")?.value?.trim();
    const email = document.getElementById("licenseEmail")?.value?.trim();

    if (!licenseKey || !email) {
      setMessage("Enter your license key and email.");
      return;
    }

    if (!/^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(licenseKey)) {
      setMessage("License key format should look like DHC6-XXXX-XXXX-XXXX.");
      return;
    }

    setMessage("Checking license...");

    try {
      const response = await fetch("/api/desktop-download", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ licenseKey, email, platform: "windows-exe" })
      });

      if (!response.ok) {
        setMessage("License could not be verified. Check your key or request access.");
        return;
      }

      const data = await response.json();

      if (!data.downloadUrl) {
        setMessage("License verified, but no download URL was issued. Contact support.");
        return;
      }

      setMessage("License verified. Starting secure download...", true);
      window.location.href = data.downloadUrl;
    } catch (error) {
      setMessage("Secure download backend is not active on this host yet. Request access by email or deploy the provided serverless function.");
    }
  });
}
