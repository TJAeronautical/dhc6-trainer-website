import { onRequest as apiMiddleware } from "./functions/api/_middleware.js";
import { onRequestGet as health } from "./functions/api/health.js";
import { onRequestGet as billingConfig } from "./functions/api/billing/config.js";
import { onRequestPost as billingPortal } from "./functions/api/billing/portal.js";
import { onRequestPost as billingStatus } from "./functions/api/billing/status.js";
import { onRequestPost as oralExamProxy } from "./functions/api/ai/oral-exam.js";
import {
  onRequestGet as desktopDownloadGet,
  onRequestPost as desktopDownloadPost
} from "./functions/api/desktop/download.js";
import { onRequestPost as licenseActivate } from "./functions/api/license/activate.js";
import { onRequestPost as licenseDeactivate } from "./functions/api/license/deactivate.js";
import { onRequestPost as licenseValidate } from "./functions/api/license/validate.js";
import { onRequestPost as paddleWebhook } from "./functions/api/paddle/webhook.js";
import { onRequestPost as playValidatePurchase } from "./functions/api/play/validate-purchase.js";

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

async function routeApi(context) {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const method = context.request.method.toUpperCase();

  if (method === "GET" && path === "/api") {
    return json({
      ok: true,
      service: "dhc6-trainer-billing",
      routes: [
        "/api/health",
        "/api/billing/config",
        "/api/billing/status",
        "/api/billing/portal",
        "/api/ai/oral-exam",
        "/api/desktop/download",
        "/api/license/activate",
        "/api/license/deactivate",
        "/api/license/validate",
        "/api/paddle/webhook",
        "/api/play/validate-purchase"
      ]
    });
  }

  if (method === "GET" && path === "/api/health") return health(context);
  if (method === "GET" && path === "/api/billing/config") return billingConfig(context);
  if (method === "POST" && path === "/api/billing/status") return billingStatus(context);
  if (method === "POST" && path === "/api/billing/portal") return billingPortal(context);
  if (method === "POST" && path === "/api/ai/oral-exam") return oralExamProxy(context);
  if (method === "GET" && path === "/api/desktop/download") return desktopDownloadGet(context);
  if (method === "POST" && path === "/api/desktop/download") return desktopDownloadPost(context);
  if (method === "POST" && path === "/api/license/activate") return licenseActivate(context);
  if (method === "POST" && path === "/api/license/deactivate") return licenseDeactivate(context);
  if (method === "POST" && path === "/api/license/validate") return licenseValidate(context);
  if (method === "POST" && path === "/api/paddle/webhook") return paddleWebhook(context);
  if (method === "POST" && path === "/api/play/validate-purchase") return playValidatePurchase(context);

  return json({ ok: false, error: "api_route_not_found" }, 404);
}

function shouldInjectPrimaryLegalLinks(pathname) {
  return pathname === "/" || pathname === "/index.html" || pathname === "/desktop" || pathname === "/desktop.html";
}

class LegalFooterLinks {
  element(element) {
    element.prepend(
      '<p class="footer-legal-links"><a href="terms.html">Terms of Service</a> · <a href="privacy.html">Privacy Policy</a> · <a href="refund.html">Refund Policy</a></p>',
      { html: true }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return apiMiddleware({
        request: request,
        env: env,
        waitUntil: ctx.waitUntil.bind(ctx),
        next: function () {
          return routeApi({ request: request, env: env, waitUntil: ctx.waitUntil.bind(ctx) });
        }
      });
    }

    let assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("Content-Type") || "";
    if (assetResponse.ok && request.method === "GET" && contentType.includes("text/html") && shouldInjectPrimaryLegalLinks(url.pathname)) {
      assetResponse = new HTMLRewriter()
        .on("footer .footer-bottom", new LegalFooterLinks())
        .transform(assetResponse);
    }

    const headers = new Headers(assetResponse.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers: headers });
  }
};
