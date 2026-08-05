(function () {
  "use strict";

  const doc = document;
  const body = doc.body;

  function currentFile() {
    const path = window.location.pathname.replace(/\/+$/, "");
    return (path.split("/").pop() || "index.html").toLowerCase();
  }

  function enhanceNavigation() {
    const header = doc.querySelector(".topbar");
    const nav = header && header.querySelector("nav");
    const links = nav && nav.querySelector(".navlinks");
    if (!header || !nav || !links) return;

    const file = currentFile();
    links.querySelectorAll("a").forEach(function (link) {
      const href = (link.getAttribute("href") || "").split("#")[0].split("?")[0];
      const target = (href.split("/").pop() || "index.html").toLowerCase();
      const homeMatch = (file === "index.html" || file === "") && (target === "index.html" || target === "" || href === "./");
      if (homeMatch || (target && target === file)) link.setAttribute("aria-current", "page");
    });

    let actions = nav.querySelector(".nav-actions");
    if (!actions) {
      actions = doc.createElement("div");
      actions.className = "nav-actions";
      Array.from(nav.children).forEach(function (child) {
        if (child.classList && child.classList.contains("btn")) {
          child.classList.add("desktop-only");
          actions.appendChild(child);
        }
      });
      nav.appendChild(actions);
    }

    const toggle = doc.createElement("button");
    toggle.className = "menu-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-label", "Open navigation menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = "<span></span>";
    actions.appendChild(toggle);

    const panel = doc.createElement("div");
    panel.className = "mobile-nav-panel";
    panel.id = "mobile-navigation";
    panel.setAttribute("aria-hidden", "true");
    links.querySelectorAll("a").forEach(function (link) {
      panel.appendChild(link.cloneNode(true));
    });
    const primary = actions.querySelector(".desktop-only.btn");
    if (primary) {
      const clone = primary.cloneNode(true);
      clone.classList.remove("desktop-only");
      panel.appendChild(clone);
    }
    header.insertAdjacentElement("afterend", panel);
    toggle.setAttribute("aria-controls", panel.id);

    function closeMenu() {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open navigation menu");
      panel.classList.remove("is-open");
      panel.setAttribute("aria-hidden", "true");
    }

    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", open ? "Close navigation menu" : "Open navigation menu");
      panel.classList.toggle("is-open", open);
      panel.setAttribute("aria-hidden", String(!open));
    });
    panel.addEventListener("click", function (event) {
      if (event.target.closest("a")) closeMenu();
    });
    doc.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeMenu();
    });
    doc.addEventListener("click", function (event) {
      if (!panel.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });

    const updateHeader = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 10);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  function addGlobalA11y() {
    if (!doc.querySelector(".skip-link")) {
      const skip = doc.createElement("a");
      skip.className = "skip-link";
      skip.href = "#main-content";
      skip.textContent = "Skip to main content";
      body.insertAdjacentElement("afterbegin", skip);
    }
    const main = doc.querySelector("main");
    if (main && !main.id) main.id = "main-content";

    doc.querySelectorAll('a[target="_blank"]').forEach(function (link) {
      const rel = new Set((link.getAttribute("rel") || "").split(/\s+/).filter(Boolean));
      rel.add("noopener");
      rel.add("noreferrer");
      link.setAttribute("rel", Array.from(rel).join(" "));
    });
  }

  function addScrollProgress() {
    const bar = doc.createElement("div");
    bar.className = "scroll-progress";
    bar.setAttribute("aria-hidden", "true");
    body.insertAdjacentElement("afterbegin", bar);
    let scheduled = false;
    function update() {
      const max = doc.documentElement.scrollHeight - window.innerHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, (window.scrollY / max) * 100)) : 0;
      bar.style.width = pct + "%";
      scheduled = false;
    }
    window.addEventListener("scroll", function () {
      if (!scheduled) {
        scheduled = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  function addRevealMotion() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const items = doc.querySelectorAll(".card, .dark-panel, .preview-img, .section-head, .cta-band, .legal-card");
    items.forEach(function (item) { item.classList.add("reveal"); });
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: "0px 0px -8%", threshold: 0.08 });
    items.forEach(function (item) { observer.observe(item); });
  }

  function addScreenshotLightbox() {
    const shots = doc.querySelectorAll(".shot img");
    if (!shots.length) return;

    const lightbox = doc.createElement("div");
    lightbox.className = "lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Screenshot preview");
    lightbox.innerHTML = '<div class="lightbox-dialog"><button class="lightbox-close" type="button" aria-label="Close screenshot">×</button><img alt=""></div>';
    body.appendChild(lightbox);
    const largeImage = lightbox.querySelector("img");
    const closeButton = lightbox.querySelector("button");
    let previousFocus = null;

    function close() {
      lightbox.classList.remove("is-open");
      body.style.overflow = "";
      if (previousFocus) previousFocus.focus();
    }
    function open(image, trigger) {
      previousFocus = trigger;
      largeImage.src = image.currentSrc || image.src;
      largeImage.alt = image.alt || "DHC-6 Trainer screenshot";
      lightbox.classList.add("is-open");
      body.style.overflow = "hidden";
      closeButton.focus();
    }

    shots.forEach(function (image) {
      const parent = image.parentElement;
      if (parent && parent.tagName === "BUTTON") {
        parent.addEventListener("click", function () { open(image, parent); });
        return;
      }
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", "Enlarge " + (image.alt || "screenshot"));
      parent.insertBefore(button, image);
      button.appendChild(image);
      button.addEventListener("click", function () { open(image, button); });
    });
    closeButton.addEventListener("click", close);
    lightbox.addEventListener("click", function (event) { if (event.target === lightbox) close(); });
    doc.addEventListener("keydown", function (event) { if (event.key === "Escape" && lightbox.classList.contains("is-open")) close(); });
  }

  function enhanceBillingToggle() {
    const toggle = doc.querySelector("[data-billing-toggle]");
    if (!toggle) return;
    const buttons = toggle.querySelectorAll("button[data-cycle]");
    const cards = doc.querySelectorAll(".price-card[data-price-card]");

    function setCycle(cycle) {
      buttons.forEach(function (button) {
        button.setAttribute("aria-pressed", String(button.dataset.cycle === cycle));
      });
      cards.forEach(function (card) {
        const amount = card.querySelector("[data-price-amount]");
        const cadence = card.querySelector("[data-price-cadence]");
        const checkout = card.querySelector("[data-plan]");
        const note = card.querySelector("[data-price-note]");
        if (amount) amount.textContent = card.dataset[cycle + "Price"] || "—";
        if (cadence) cadence.textContent = cycle === "annual" ? "/year" : "/month";
        if (checkout) {
          checkout.dataset.cycle = cycle;
          checkout.textContent = cycle === "annual" ? "Start annual trial" : "Start monthly trial";
        }
        if (note) note.textContent = cycle === "annual" ? (card.dataset.annualNote || "Billed annually") : "Billed monthly";
      });
      try { window.localStorage.setItem("dhc6BillingCycle", cycle); } catch (error) { /* optional */ }
    }

    buttons.forEach(function (button) {
      button.addEventListener("click", function () { setCycle(button.dataset.cycle); });
    });
    let saved = "annual";
    try { saved = window.localStorage.getItem("dhc6BillingCycle") || "annual"; } catch (error) { /* optional */ }
    setCycle(saved === "monthly" ? "monthly" : "annual");
  }

  function addInstallPrompt() {
    const buttons = doc.querySelectorAll("[data-install-app]");
    if (!buttons.length) return;
    let deferredPrompt = null;
    buttons.forEach(function (button) { button.hidden = true; });
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredPrompt = event;
      buttons.forEach(function (button) { button.hidden = false; });
    });
    buttons.forEach(function (button) {
      button.addEventListener("click", async function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        buttons.forEach(function (item) { item.hidden = true; });
      });
    });
  }


  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (window.location.protocol !== "https:" && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("/sw.js").catch(function (error) {
        console.warn("DHC-6 Trainer service worker registration failed", error);
      });
    });
  }

  function updateDynamicText() {
    doc.querySelectorAll("[data-current-year]").forEach(function (node) {
      node.textContent = String(new Date().getFullYear());
    });
    const networkNodes = doc.querySelectorAll("[data-network-status]");
    function updateNetwork() {
      networkNodes.forEach(function (node) {
        node.textContent = navigator.onLine ? "Online" : "Offline — browser trainer data remains local";
      });
    }
    updateNetwork();
    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);
  }

  function init() {
    addGlobalA11y();
    enhanceNavigation();
    addScrollProgress();
    enhanceBillingToggle();
    addScreenshotLightbox();
    addInstallPrompt();
    registerServiceWorker();
    updateDynamicText();
    addRevealMotion();
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();
})();
