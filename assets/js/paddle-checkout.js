(function () {
  "use strict";

  const LOCAL_SANDBOX_CONFIG = {
    environment: "sandbox",
    clientToken: "test_d8128820fe75450386eccfcc326",
    prices: {
      premium: { monthly: "pri_01kxk3xtqq51jna7weqk9z374m", annual: "pri_01kxk418gk6pgmzm9pw61eyfqm" },
      instructor: { monthly: "pri_01kxk45ny35mgkwy64xqdq849n", annual: "pri_01kxk46sfrf7t6pck4cweh4k11" },
      enterprise: { monthly: "pri_01kxk48gyh6e7v7awr0b01svpc", annual: "pri_01kxk49k3ybfsaxhgds952ebba" }
    },
    successUrl: "https://dhc6trainer.com/access.html?status=purchased&download=1#download",
    configured: true,
    source: "local-sandbox"
  };

  let config = null;
  let state = "loading";
  let initializationPromise = null;
  let activeAttempt = null;
  let redirectScheduled = false;

  const statusBox = document.getElementById("checkout-status");
  const statusMessage = document.getElementById("checkout-message");
  const retryButton = document.querySelector("[data-checkout-retry]");
  const checkoutButtons = Array.from(document.querySelectorAll("[data-plan][data-cycle]"));

  function setState(nextState, message) {
    state = nextState;
    if (statusBox) statusBox.dataset.state = nextState === "ready" ? "ready" : (nextState === "error" ? "error" : "loading");
    if (statusMessage) statusMessage.textContent = message || "";
    checkoutButtons.forEach(function (button) {
      button.disabled = nextState !== "ready";
      button.setAttribute("aria-disabled", String(nextState !== "ready"));
    });
    if (retryButton) retryButton.hidden = nextState !== "error";
  }

  function isLocalHost() {
    const host = window.location.hostname;
    return window.location.protocol === "file:" || !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
  }

  function normalizeConfig(raw) {
    raw = raw || {};
    return {
      environment: raw.environment === "sandbox" ? "sandbox" : "production",
      clientToken: String(raw.clientToken || "").trim(),
      prices: raw.prices || {},
      successUrl: String(raw.successUrl || (window.location.origin + "/access.html?status=purchased&download=1#download")),
      configured: raw.configured !== false,
      missing: Array.isArray(raw.missing) ? raw.missing : [],
      source: raw.source || "worker"
    };
  }

  function validateConfig(value) {
    if (!value || !value.configured) return "Secure checkout is not fully configured on the production server.";
    if (!value.clientToken) return "Secure checkout is missing its public client token.";
    if (value.environment === "production" && !value.clientToken.startsWith("live_")) return "The production checkout token is not a live Paddle token.";
    if (value.environment === "sandbox" && !value.clientToken.startsWith("test_")) return "The sandbox checkout token is not a test Paddle token.";
    const plans = ["premium", "instructor", "enterprise"];
    const cycles = ["monthly", "annual"];
    for (const plan of plans) {
      for (const cycle of cycles) {
        const price = value.prices[plan] && value.prices[plan][cycle];
        if (!String(price || "").startsWith("pri_")) return "One or more checkout price references are missing or invalid.";
      }
    }
    if (!/^https:\/\//i.test(value.successUrl) && !isLocalHost()) return "The checkout completion URL must use HTTPS.";
    return "";
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = window.setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadConfig() {
    try {
      const response = await fetchWithTimeout("/api/billing/config", { cache: "no-store", headers: { "Accept": "application/json" } }, 10000);
      if (!response.ok) throw new Error("Billing configuration returned HTTP " + response.status);
      const data = await response.json();
      if (!data || data.ok !== true) throw new Error("Billing configuration response was invalid");
      return normalizeConfig(data);
    } catch (error) {
      if (isLocalHost()) return normalizeConfig(LOCAL_SANDBOX_CONFIG);
      throw error;
    }
  }

  function waitForPaddle(timeoutMs) {
    return new Promise(function (resolve, reject) {
      const started = Date.now();
      (function check() {
        if (window.Paddle && window.Paddle.Initialize && window.Paddle.Checkout) return resolve(window.Paddle);
        if (Date.now() - started >= timeoutMs) return reject(new Error("Paddle.js did not load"));
        window.setTimeout(check, 100);
      })();
    });
  }

  function rememberCheckout(event) {
    const data = (event && event.data) || {};
    const customer = data.customer || {};
    const payload = {
      email: customer.email || "",
      customerId: customer.id || data.customer_id || "",
      checkoutId: data.id || "",
      transactionId: data.transaction_id || data.transactionId || "",
      plan: activeAttempt ? activeAttempt.plan : "",
      cycle: activeAttempt ? activeAttempt.cycle : "",
      completedAt: new Date().toISOString()
    };
    try { window.sessionStorage.setItem("dhc6TrainerCheckout", JSON.stringify(payload)); } catch (error) { /* optional */ }
  }

  function scheduleCompletionRedirect() {
    if (redirectScheduled || !config || !config.successUrl) return;
    redirectScheduled = true;
    window.setTimeout(function () {
      window.location.assign(config.successUrl);
    }, 900);
  }

  function onPaddleEvent(event) {
    if (!event || !event.name) return;
    if (event.name === "checkout.loaded") {
      setState("ready", "Secure checkout opened. Complete payment in the Paddle window.");
    } else if (event.name === "checkout.completed") {
      rememberCheckout(event);
      setState("ready", "Payment complete. Opening licence recovery and download tools…");
      scheduleCompletionRedirect();
    } else if (event.name === "checkout.closed") {
      if (!redirectScheduled) setState("ready", "Checkout closed. Select a plan whenever you are ready.");
    } else if (event.name === "checkout.error") {
      console.warn("Paddle checkout error", { attempt: activeAttempt, event: event });
      setState("error", "Checkout could not be opened with the selected plan. No charge was made. Retry or contact support.");
    }
  }

  async function initializeCheckout(force) {
    if (initializationPromise && !force) return initializationPromise;
    initializationPromise = (async function () {
      setState("loading", "Checking secure checkout availability…");
      config = await loadConfig();
      const configError = validateConfig(config);
      if (configError) throw new Error(configError);

      const paddle = await waitForPaddle(8000);
      if (config.environment === "sandbox") paddle.Environment.set("sandbox");
      paddle.Initialize({
        token: config.clientToken,
        checkout: { settings: { displayMode: "overlay", theme: "dark", locale: "en", successUrl: config.successUrl } },
        eventCallback: onPaddleEvent
      });
      setState("ready", config.environment === "sandbox" ? "Sandbox checkout ready for local testing." : "Secure checkout ready. Prices and tax are confirmed inside Paddle before payment.");
      return true;
    })().catch(function (error) {
      console.error("Checkout initialization failed", error);
      setState("error", (error && error.message) || "Secure checkout is unavailable. Retry or contact support.");
      initializationPromise = null;
      return false;
    });
    return initializationPromise;
  }

  function priceIdFor(plan, cycle) {
    return config && config.prices && config.prices[plan] ? String(config.prices[plan][cycle] || "") : "";
  }

  async function openCheckout(button) {
    if (state !== "ready") {
      const ready = await initializeCheckout(false);
      if (!ready) return;
    }
    const plan = button.dataset.plan;
    const cycle = button.dataset.cycle;
    const priceId = priceIdFor(plan, cycle);
    if (!priceId) {
      setState("error", "The selected plan is not configured. Retry or contact support.");
      return;
    }

    activeAttempt = { plan: plan, cycle: cycle, priceId: priceId, startedAt: new Date().toISOString() };
    button.disabled = true;
    setState("loading", "Opening " + plan + " " + cycle + " checkout…");

    const emailInput = document.getElementById("checkoutEmail");
    const email = emailInput ? emailInput.value.trim() : "";
    const checkoutOptions = {
      items: [{ priceId: priceId, quantity: 1 }],
      customData: { product: "dhc6_trainer_desktop", plan: plan, billing_cycle: cycle },
      settings: { displayMode: "overlay", theme: "dark", locale: "en", successUrl: config.successUrl }
    };
    if (email) checkoutOptions.customer = { email: email };

    try {
      window.Paddle.Checkout.open(checkoutOptions);
      window.setTimeout(function () {
        if (!redirectScheduled && state === "loading") setState("ready", "Checkout opened. Complete payment in the Paddle window.");
      }, 1200);
    } catch (error) {
      console.error("Paddle.Checkout.open failed", activeAttempt, error);
      setState("error", "Checkout could not open. No charge was made. Retry or contact support.");
    }
  }

  checkoutButtons.forEach(function (button) {
    button.addEventListener("click", function () { openCheckout(button); });
  });
  if (retryButton) retryButton.addEventListener("click", function () { initializeCheckout(true); });

  initializeCheckout(false);
})();
