/*
  DHC-6 Trainer - Paddle subscription checkout (Paddle Billing / Paddle.js v2)
  -------------------------------------------------------------------------
  This is the ONLY file you normally edit to wire up billing.
  Everything you must change lives in the CONFIG block below.

  Paddle.js is loaded from https://cdn.paddle.com/paddle/v2/paddle.js in
  desktop.html. For security/compliance Paddle.js must be loaded only from
  that CDN URL.
*/

/* ======================= CONFIG - EDIT THESE ======================= */
const PADDLE_CONFIG = {
  // "sandbox" while testing, "production" when you go live.
  environment: "sandbox",

  // Client-side token from Paddle > Developer tools > Authentication.
  // Sandbox tokens start with "test_", live tokens start with "live_".
  clientToken: "test_REPLACE_WITH_YOUR_CLIENT_SIDE_TOKEN",

  // Price IDs from Paddle > Catalog > Products (look like "pri_...").
  // Create ONE product ("DHC-6 Trainer Desktop") with two recurring prices.
  prices: {
    monthly: "pri_REPLACE_WITH_MONTHLY_PRICE_ID",
    annual: "pri_REPLACE_WITH_ANNUAL_PRICE_ID"
  },

  // Where the desktop app / customer activates the key after purchase.
  successUrl: "https://dhc6trainer.com/access.html?status=purchased"
};
/* =================== END CONFIG - EDIT THESE ======================= */

let paddleReady = false;

function setCheckoutMessage(text, ok) {
  const el = document.getElementById("checkout-message");
  if (!el) return;
  el.textContent = text || "";
  el.style.color = ok ? "#9ff0bd" : "#ffd6d6";
  el.style.fontWeight = "800";
}

function initPaddle() {
  if (typeof Paddle === "undefined") {
    setCheckoutMessage(
      "Checkout failed to load. Refresh the page or email tj.aeronautical@outlook.com.",
      false
    );
    return;
  }

  if (PADDLE_CONFIG.environment === "sandbox") {
    Paddle.Environment.set("sandbox");
  }

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
        setCheckoutMessage(
          "Payment complete. Your licence key is on its way by email - " +
            "enter it below or in the desktop app to activate.",
          true
        );
      } else if (event.name === "checkout.error") {
        setCheckoutMessage(
          "Checkout could not be completed. No charge was made. Please try again.",
          false
        );
      }
    }
  });

  paddleReady = true;
}

function openDesktopCheckout(plan) {
  const priceId = PADDLE_CONFIG.prices[plan];

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

  setCheckoutMessage("", true);

  Paddle.Checkout.open({
    items: [{ priceId: priceId, quantity: 1 }],
    settings: {
      displayMode: "overlay",
      theme: "dark",
      locale: "en",
      successUrl: PADDLE_CONFIG.successUrl
    }
  });
}

function bindCheckoutButtons() {
  const buttons = document.querySelectorAll("[data-plan]");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      openDesktopCheckout(btn.getAttribute("data-plan"));
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
