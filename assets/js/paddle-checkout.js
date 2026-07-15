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
  clientToken: "test_d8128820fe75450386eccfcc326",

  // Price IDs from Paddle > Catalog > Products (look like "pri_...").
  // These are sandbox IDs for the three desktop tiers.
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

  // Where the desktop app / customer activates the key after purchase.
  successUrl: "https://dhc6trainer.com/access.html?status=purchased#account"
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

  if (!PADDLE_CONFIG.clientToken || PADDLE_CONFIG.clientToken.indexOf("REPLACE") > -1) {
    setCheckoutMessage(
      "Checkout prices are configured. Add your Paddle sandbox client-side token to enable checkout.",
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

function openDesktopCheckout(plan, cycle) {
  const tier = PADDLE_CONFIG.prices[plan] || {};
  const priceId = tier[cycle];

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
