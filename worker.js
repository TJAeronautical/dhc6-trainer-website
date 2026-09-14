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
import { onRequestPost as webAccessSession } from "./functions/api/web-access/session.js";
import { onRequestGet as webAccessVerify } from "./functions/api/web-access/verify.js";
import { onRequestPost as ownerWebAccessSession } from "./functions/api/web-access/owner-session.js";
import { onRequestPost as webAccessLogout } from "./functions/api/web-access/logout.js";
import { onRequestPost as webAccessRequestLink } from "./functions/api/web-access/request-link.js";
import { onRequestPost as webAccessLinkSession } from "./functions/api/web-access/link-session.js";
import { onRequestGet as webAccessDevicesGet, onRequestPost as webAccessDevicesPost } from "./functions/api/web-access/devices.js";
import { onRequestPost as ownerWatermark } from "./functions/api/owner/watermark.js";
import { onRequestGet as protectedContent } from "./functions/api/content/index.js";
import { onRequestGet as protectedMedia } from "./functions/api/media/index.js";
import { onRequestGet as qrhEditsGet, onRequestPut as qrhEditsPut, onRequestDelete as qrhEditsDelete } from "./functions/api/qrh-edits/index.js";
import { onRequestGet as logbookGet, onRequestPut as logbookPut, onRequestDelete as logbookDelete } from "./functions/api/logbook/index.js";
import { onRequestGet as libraryGet, onRequestHead as libraryHead, onRequestPost as libraryPost, onRequestDelete as libraryDelete } from "./functions/api/library/index.js";
import { authorizeWebRequest } from "./functions/api/web-access/_session.js";

export const API_ROUTES = [
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
  "/api/play/validate-purchase",
  "/api/web-access/session",
  "/api/web-access/verify",
  "/api/web-access/owner-session",
  "/api/web-access/logout",
  "/api/web-access/request-link",
  "/api/web-access/link-session",
  "/api/web-access/devices",
  "/api/owner/watermark",
  "/api/content/manifest",
  "/api/content/pack/:id",
  "/api/media/index",
  "/api/media/offline-manifest",
  "/api/media/:path",
  "/api/qrh-edits",
  "/api/qrh-edits/:procedureId",
  "/api/logbook",
  "/api/library",
  "/api/library/doc/:shelf/:docId"
];

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
    return json({ ok: true, service: "dhc6-trainer-billing", routes: API_ROUTES });
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
  if (method === "POST" && path === "/api/web-access/session") return webAccessSession(context);
  if (method === "GET" && path === "/api/web-access/verify") return webAccessVerify(context);
  if (method === "POST" && path === "/api/web-access/owner-session") return ownerWebAccessSession(context);
  if (method === "POST" && path === "/api/web-access/logout") return webAccessLogout(context);
  if (method === "POST" && path === "/api/web-access/request-link") return webAccessRequestLink(context);
  if (method === "POST" && path === "/api/web-access/link-session") return webAccessLinkSession(context);
  if (method === "GET" && path === "/api/web-access/devices") return webAccessDevicesGet(context);
  if (method === "POST" && path === "/api/web-access/devices") return webAccessDevicesPost(context);
  if (method === "POST" && path === "/api/owner/watermark") return ownerWatermark(context);
  if (method === "GET" && (path === "/api/content/manifest" || path.startsWith("/api/content/pack/"))) return protectedContent(context);
  if ((method === "GET" || method === "HEAD") && (path === "/api/media" || path.startsWith("/api/media/"))) return protectedMedia(context);
  if (path === "/api/qrh-edits" || path.startsWith("/api/qrh-edits/")) {
    if (method === "GET") return qrhEditsGet(context);
    if (method === "PUT") return qrhEditsPut(context);
    if (method === "DELETE") return qrhEditsDelete(context);
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (path === "/api/logbook") {
    if (method === "GET") return logbookGet(context);
    if (method === "PUT") return logbookPut(context);
    if (method === "DELETE") return logbookDelete(context);
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }
  if (path === "/api/library" || path.startsWith("/api/library/")) {
    if (method === "GET") return libraryGet(context);
    if (method === "HEAD") return libraryHead(context);
    if (method === "POST") return libraryPost(context);
    if (method === "DELETE") return libraryDelete(context);
    return json({ ok: false, error: "method_not_allowed" }, 405);
  }

  return json({ ok: false, error: "api_route_not_found" }, 404);
}

function shouldInjectPrimaryLegalLinks(pathname) {
  return pathname === "/" || pathname === "/index.html" || pathname === "/desktop" || pathname === "/desktop.html";
}

/*
  Protected HTML: the browser app shell and the earlier live trainer page.
  Static assets under /app/ that are pure code (JS/CSS/icons) are served
  normally; every HTML document and every unknown /app/* path needs a valid
  session cookie. Training content itself is only reachable via /api/content.
*/
export function isProtectedPage(pathname) {
  if (pathname === "/live.html" || pathname === "/live") return true;
  if (pathname === "/app" || pathname === "/app/") return true;
  if (pathname.startsWith("/app/")) {
    return !/\.(?:js|mjs|css|png|svg|webp|jpg|jpeg|ico|woff2?|json|webmanifest|map)$/i.test(pathname);
  }
  return false;
}

export function signInRedirect(url) {
  const target = new URL("/web-app.html", url.origin);
  target.searchParams.set("status", "signin-required");
  target.searchParams.set("next", url.pathname + url.search);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": target.toString(),
      "Cache-Control": "private, no-store",
      "Vary": "Cookie"
    }
  });
}

class LegalFooterLinks {
  element(element) {
    element.prepend(
      '<p class="footer-legal-links"><a href="terms.html">Terms of Service</a> · <a href="privacy.html">Privacy Policy</a> · <a href="refund.html">Refund Policy</a></p>',
      { html: true }
    );
  }
}

function withSecurityHeaders(assetResponse, url, extra) {
  const headers = new Headers(assetResponse.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (url.protocol === "https:") headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  if (extra) Object.keys(extra).forEach(function (key) { headers.set(key, extra[key]); });
  return new Response(assetResponse.body, { status: assetResponse.status, statusText: assetResponse.statusText, headers: headers });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const waitUntil = ctx && ctx.waitUntil ? ctx.waitUntil.bind(ctx) : function () {};

    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return apiMiddleware({
        request: request,
        env: env,
        waitUntil: waitUntil,
        next: function () {
          return routeApi({ request: request, env: env, waitUntil: waitUntil });
        }
      });
    }

    if (isProtectedPage(url.pathname)) {
      const auth = await authorizeWebRequest({ request: request, env: env });
      if (!auth.ok) return signInRedirect(url);
      // Deep links such as /app/qrh/engine-fire are handled by the shell's
      // client-side router: serve the canonical /app/ document for them.
      // Everything else is passed through unchanged so the asset layer's own
      // canonical redirects (/app -> /app/) keep working without loops.
      let target = request;
      if (url.pathname.startsWith("/app/") && url.pathname !== "/app/" && !/\.[a-z0-9]+$/i.test(url.pathname)) {
        target = new Request(new URL("/app/" + url.search, url.origin), request);
      }
      const protectedResponse = await env.ASSETS.fetch(target);
      return withSecurityHeaders(protectedResponse, url, {
        "Cache-Control": "private, no-store",
        "Vary": "Cookie",
        "X-Robots-Tag": "noindex, nofollow"
      });
    }

    let assetResponse = await env.ASSETS.fetch(request);
    const contentType = assetResponse.headers.get("Content-Type") || "";
    if (assetResponse.ok && request.method === "GET" && contentType.includes("text/html") && shouldInjectPrimaryLegalLinks(url.pathname) && typeof HTMLRewriter !== "undefined") {
      assetResponse = new HTMLRewriter()
        .on("footer .footer-bottom", new LegalFooterLinks())
        .transform(assetResponse);
    }

    return withSecurityHeaders(assetResponse, url);
  }
};
