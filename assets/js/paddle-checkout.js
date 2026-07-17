/*
  DHC-6 Trainer - Paddle subscription checkout (Paddle Billing / Paddle.js v2)
  -------------------------------------------------------------------------
  Production billing is loaded from /api/billing/config so live Paddle IDs
  can be managed as Cloudflare Worker variables. The static config below is
  only a local sandbox fallback for file:// or localhost previews.

  Paddle.js is loaded from https://cdn.paddle.com/paddle/v2/paddle.js in
  desktop.html. For security/compliance Paddle.js must be loaded only from
  that CDN URL.
*/

/* ======================= LOCAL SANDBOX FALLBACK ======================= */
const STATIC_SANDBOX_PADDLE_CONFIG = {
  environment: "sandbox",
  clientToken: "test_d8128820fe75450386eccfcc326",
  prices: {
    premium: {
      monthly: "pri_01kxk3xtqq51jna7weqk9z374m",
      annual: "pri_01kxk418gk6pgmzm9pw61eyfqm"
    },
    instructor: {
      monthly: "pri_01kxk45ny35mgkwy64xqdq849n",
      annual: "pri_01kxk46sfrf7t6pck4cweh4k11"
    },
    enterprise: {
      monthly: "pri_01kxk48gyh6e7v7awr0b01svpc",
      annual: "pri_01kxk49k3ybfsaxhgds952ebba"
    }
  },
  successUrl: "https://dhc6trainer.com/access.html?status=purchased&download=1#download"
};
/* =================== END LOCAL SANDBOX FALLBACK ======================= */

let PADDLE_CONFIG = null;
let paddleReady = false;
let paddleLoading = false;
let lastCheckoutAttempt = null;

function rememberCompletedCheckout(event) {
  if (!event || !event.data) return;
  const customer = event.data.customer || {};
  const payload = {
    email: customer.email || "",
    customerId: customer.id || "",
    checkoutId: event.data.id || "",
    transactionId: event.data.transaction_id || "",
    completedAt: new Date().toISOString()
  };
  try {
    window.sessionStorage.setItem("dhc6TrainerCheckout", JSON.stringify(payload));
  } catch (storageError) {
    // Non-critical: the access page still works when storage is unavailable.
  }
}

function setCheckoutMessage(text, ok) {
  const el = document.getElementById("checkout-message");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  el.style.fontWeight = "800";
}

function isLocalCheckoutHost() {
  const host = window.location.hostname;
  return (
    !host ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".local")
  );
}

function canUseSandboxFallback() {
  return window.location.protocol === "file:" || isLocalCheckoutHost();
}

function normalizePaddleConfig(raw) {
  raw = raw || {};
  return {
    environment: raw.environment === "sandbox" ? "sandbox" : "production",
    clientToken: String(raw.clientToken || ""),
    prices: raw.prices || {},
    successUrl:
      raw.successUrl ||
      window.location.origin + "/access.html?status=purchased&download=1#download"
  };
}

async function loadPaddleConfig() {
  try {
    const response = await fetch("/api/billing/config", { cache: "no-store" });
    if (response.ok) {
      const data = await response.json();
      if (data && data.ok) return normalizePaddleConfig(data);
    }
  } catch (e) {
    // Local file/static previews cannot reach the Worker config endpoint.
  }

  if (canUseSandboxFallback()) {
    return normalizePaddleConfig(STATIC_SANDBOX_PADDLE_CONFIG);
  }

  return normalizePaddleConfig({
    environment: "production",
    clientToken: "",
    prices: {},
    successUrl: window.location.origin + "/access.html?status=purchased&download=1#download"
  });
}

function isPlaceholder(value) {
  return !value || String(value).indexOf("REPLACE") > -1;
}

function priceIdFor(plan, cycle) {
  const tier = (PADDLE_CONFIG && PADDLE_CONFIG.prices && PADDLE_CONFIG.prices[plan]) || {};
  return tier[cycle] || "";
}

function checkoutConfigError(config) {
  if (!config || isPlaceholder(config.clientToken)) {
    return config && config.environment === "production"
      ? "Production checkout is not configured yet. Add the live Paddle client token in Cloudflare."
      : "Sandbox checkout is not configured yet. Add the Paddle sandbox client-side token.";
  }

  if (config.environment === "production" && config.clientToken.indexOf("live_") !== 0) {
    return "Production checkout needs a live Paddle client token.";
  }

  if (config.environment === "sandbox" && config.clientToken.indexOf("test_") !== 0) {
    return "Sandbox checkout needs a test Paddle client token.";
  }

  const plans = ["premium", "instructor", "enterprise"];
  const cycles = ["monthly", "annual"];
  for (let i = 0; i < plans.length; i++) {
    for (let j = 0; j < cycles.length; j++) {
      if (isPlaceholder((config.prices[plans[i]] || {})[cycles[j]])) {
        return config.environment === "production"
          ? "Production checkout is missing one or more live Paddle price IDs."
          : "Sandbox checkout is missing one or more Paddle price IDs.";
      }
    }
  }

  return "";
}

async function initPaddle() {
  if (paddleLoading || paddleReady) return;
  paddleLoading = true;

  PADDLE_CONFIG = await loadPaddleConfig();

  if (typeof Paddle === "undefined") {
    setCheckoutMessage(
      "Checkout failed to load. Refresh the page or email tj.aeronautical@outlook.com.",
      false
    );
    paddleLoading = false;
    return;
  }

  const configError = checkoutConfigError(PADDLE_CONFIG);
  if (configError) {
    setCheckoutMessage(configError, false);
    paddleLoading = false;
    return;
  }

  if (PADDLE_CONFIG.environment === "sandbox") {
    Paddle.Environment.set("sandbox");
  }

  try {
    Paddle.Initialize({
      token: PADDLE_CONFIG.clientToken,
      checkout: {
        settings: {
          displayMode: "overlay",
          theme: "dark",
          locale: "en",
          successUrl: PADDLE_CONFIG.successUrl
        }
      },
      eventCallback: function (event) {
        // Full event reference: developer.paddle.com/paddlejs/events
        if (!event || !event.name) return;
        if (event.name === "checkout.completed") {
          rememberCompletedCheckout(event);
          setCheckoutMessage(
            "Payment complete. Opening your licence and download page...",
            true
          );
        } else if (event.name === "checkout.error") {
          if (window.console && window.console.warn) {
            window.console.warn("Paddle checkout error", {
              attempt: lastCheckoutAttempt,
              event: event
            });
          }
          const label = lastCheckoutAttempt
            ? lastCheckoutAttempt.plan + " " + lastCheckoutAttempt.cycle
            : "checkout";
          setCheckoutMessage(
            "Checkout for " + label + " could not be completed. No charge was made. Please try again.",
            false
          );
        }
      }
    });
  } catch (e) {
    setCheckoutMessage("Checkout could not be initialized. Check the Paddle production settings.", false);
    paddleLoading = false;
    return;
  }

  paddleReady = true;
  paddleLoading = false;
}

function openDesktopCheckout(plan, cycle) {
  const priceId = priceIdFor(plan, cycle);

  if (!paddleReady) {
    setCheckoutMessage("Checkout is still loading. Please try again in a moment.", false);
    return;
  }

  if (!priceId || priceId.indexOf("pri_REPLACE") === 0) {
    setCheckoutMessage(
      "Billing is not configured yet. (Set the Paddle price IDs in assets/js/paddle-checkout.js.)",
      false
    );
    return;
  }

  lastCheckoutAttempt = { plan: plan, cycle: cycle, priceId: priceId };
  setCheckoutMessage("Opening " + plan + " " + cycle + " checkout...", true);

  try {
    Paddle.Checkout.open({
      items: [{ priceId: priceId, quantity: 1 }],
      customData: {
        product: "dhc6_trainer_desktop",
        plan: plan,
        billing_cycle: cycle
      },
      settings: {
        displayMode: "overlay",
        theme: "dark",
        locale: "en",
        successUrl: PADDLE_CONFIG.successUrl
      }
    });
  } catch (e) {
    if (window.console && window.console.error) {
      window.console.error("Paddle checkout open failed", lastCheckoutAttempt, e);
    }
    setCheckoutMessage(
      "Checkout for " + plan + " " + cycle + " could not be opened. Please try again.",
      false
    );
  }
}

function bindCheckoutButtons() {
  const buttons = document.querySelectorAll("[data-plan][data-cycle]");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      openDesktopCheckout(btn.getAttribute("data-plan"), btn.getAttribute("data-cycle"));
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    initPaddle();
    bindCheckoutButtons();
  });
} else {
  initPaddle();
  bindCheckoutButtons();
}
