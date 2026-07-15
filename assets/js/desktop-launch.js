(function () {
  const DEFAULT_LAUNCH_URL = "dhc6trainer://live";
  const DEFAULT_FALLBACK_URL = "live.html";
  const FALLBACK_DELAY_MS = 1400;

  function setLaunchStatus(trigger, message, isError) {
    const selector = trigger.getAttribute("data-launch-status");
    if (!selector) return;

    const status = document.querySelector(selector);
    if (!status) return;

    status.textContent = message;
    status.style.color = isError ? "#ffd6d6" : "#9ff0bd";
    status.style.fontWeight = "900";
  }

  function launchDesktop(event) {
    event.preventDefault();

    const trigger = event.currentTarget;
    const launchUrl = trigger.getAttribute("data-launch-url") || DEFAULT_LAUNCH_URL;
    const fallbackUrl = trigger.getAttribute("data-fallback-url") || DEFAULT_FALLBACK_URL;
    let pageWasHidden = false;

    function markAway() {
      pageWasHidden = true;
    }

    function markHidden() {
      if (document.hidden || document.visibilityState === "hidden") {
        pageWasHidden = true;
      }
    }

    document.addEventListener("visibilitychange", markHidden);
    window.addEventListener("blur", markAway, { once: true });

    setLaunchStatus(trigger, "Opening DHC-6 Trainer Desktop...", false);
    window.location.href = launchUrl;

    window.setTimeout(function () {
      document.removeEventListener("visibilitychange", markHidden);
      window.removeEventListener("blur", markAway);

      if (pageWasHidden) return;

      setLaunchStatus(
        trigger,
        "Desktop app did not respond. Opening the live web trainer instead.",
        true
      );

      if (fallbackUrl) {
        window.location.href = fallbackUrl;
      }
    }, FALLBACK_DELAY_MS);
  }

  function bindLaunchButtons() {
    const launchers = document.querySelectorAll("[data-desktop-launch]");
    launchers.forEach(function (launcher) {
      launcher.addEventListener("click", launchDesktop);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindLaunchButtons);
  } else {
    bindLaunchButtons();
  }
})();
