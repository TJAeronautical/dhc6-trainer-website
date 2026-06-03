/*
  DHC-6 Trainer desktop access form.
  This static website does not issue installer downloads directly.
  Desktop installers require manual approval or a future private backend.
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
  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const licenseKey = document.getElementById("licenseKey")?.value?.trim();
    const email = document.getElementById("licenseEmail")?.value?.trim();
    const type = document.getElementById("downloadType")?.value || "exe";

    if (!licenseKey || !email) {
      setMessage("Enter your license key and email.");
      return;
    }

    if (type !== "exe" && type !== "msi") {
      setMessage("Choose either the EXE or MSI installer.");
      return;
    }

    if (!/^DHC6-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(licenseKey)) {
      setMessage("License key format should look like DHC6-XXXX-XXXX-XXXX.");
      return;
    }

    const subject = encodeURIComponent("DHC-6 Trainer Desktop Access Request");
    const body = encodeURIComponent(
`Desktop access request

Email: ${email}
License key: ${licenseKey}
Requested installer: Windows ${type.toUpperCase()}

Please verify my license and send the approved desktop installer access instructions.`
    );

    setMessage("Opening email request. Desktop downloads are issued after license verification.", true);
    window.location.href = `mailto:tj.aeronautical@outlook.com?subject=${subject}&body=${body}`;
  });
}