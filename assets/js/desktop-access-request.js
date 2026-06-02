(function () {
  const form = document.getElementById("desktop-access-form");
  const copyButton = document.getElementById("copy-request");
  const status = document.getElementById("desktop-access-status");

  const supportEmail = "tj.aeronautical@outlook.com";

  function valueOf(id) {
    const el = document.getElementById(id);
    return el ? String(el.value || "").trim() : "";
  }

  function setStatus(message, isError) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("error", Boolean(isError));
  }

  function buildRequestBody() {
    const name = valueOf("requestName");
    const email = valueOf("requestEmail");
    const organisation = valueOf("requestOrg") || "Not provided";
    const role = valueOf("requestRole");
    const seats = valueOf("requestSeats");
    const platform = valueOf("requestPlatform");
    const useCase = valueOf("requestUse") || "Not provided";

    return [
      "DHC-6 Trainer Desktop Access Request",
      "",
      "Requester details",
      "-----------------",
      "Name: " + name,
      "Email: " + email,
      "Organisation / company: " + organisation,
      "Role: " + role,
      "Seats required: " + seats,
      "Platform: " + platform,
      "",
      "Intended use",
      "------------",
      useCase,
      "",
      "Acknowledgement",
      "---------------",
      "I understand that the DHC-6 Trainer Desktop build is license-gated, privately distributed, and intended for training/study support only. It does not replace approved aircraft manuals, QRH, company procedures, or regulatory requirements.",
      "",
      "Requested from: " + window.location.href
    ].join("\n");
  }

  function validateForm() {
    const name = valueOf("requestName");
    const email = valueOf("requestEmail");

    if (!name) {
      setStatus("Enter your full name.", true);
      return false;
    }

    if (!email || !email.includes("@")) {
      setStatus("Enter a valid email address.", true);
      return false;
    }

    return true;
  }

  function openPrefilledEmail() {
    if (!validateForm()) return;

    const subject = "DHC-6 Trainer Desktop Access Request";
    const body = buildRequestBody();

    const mailto =
      "mailto:" + encodeURIComponent(supportEmail) +
      "?subject=" + encodeURIComponent(subject) +
      "&body=" + encodeURIComponent(body);

    window.location.href = mailto;

    setStatus("Opening your email app with a prefilled desktop access request.", false);
  }

  async function copyRequestDetails() {
    if (!validateForm()) return;

    const body = buildRequestBody();

    try {
      await navigator.clipboard.writeText(body);
      setStatus("Request details copied. Email them to " + supportEmail + ".", false);
    } catch (error) {
      setStatus("Could not copy automatically. Select the form text manually or open the prefilled email.", true);
    }
  }

  if (form) {
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      openPrefilledEmail();
    });
  }

  if (copyButton) {
    copyButton.addEventListener("click", copyRequestDetails);
  }
})();

