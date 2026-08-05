# DHC-6 Trainer Website v2.0 Upgrade Report

Date: 5 August 2026

## Scope completed

### Product design and conversion

- Rebuilt the shared design system in `assets/site-redesign.css`.
- Reworked the homepage into a product-led training journey with stronger visual hierarchy, platform selection, study-loop explanation, richer feature content, screenshot inspection, FAQs, and clear calls to action.
- Rebuilt `mobile.html`, `desktop.html`, and `access.html` around the intended user journey rather than isolated feature lists.
- Unified privacy, deletion, changelog, live trainer, and error-page presentation.

### User experience and accessibility

- Added responsive mobile navigation and active-page indication.
- Added skip navigation, visible keyboard focus, semantic status regions, reduced-motion handling, and improved responsive grids.
- Added screenshot lightboxes and scroll-position feedback.
- Added dynamic year, network state hooks, install prompt support, and safer external-link handling.

### Purchasing and licence flow

- Replaced the fragile checkout bootstrap with an explicit readiness state machine.
- Checkout controls remain disabled until `/api/billing/config`, Paddle.js, the live token, and all price IDs validate.
- Added fetch timeout, production/sandbox token validation, missing-price validation, retry controls, checkout event feedback, optional purchase-email prefill, session completion data, and success redirect fallback.
- Reworked desktop pricing into a monthly/annual selector with plan-specific savings and one unambiguous action per plan.
- Expanded licence recovery, protected download, device-seat, portal, and troubleshooting guidance.

### Backend and security

- Corrected CORS so only approved origins are reflected.
- Added `nosniff`, referrer, permissions, opener, and HSTS headers to static responses.
- Preserved raw-body Paddle signature verification and the five-second replay tolerance.
- Kept APIs out of offline caches.

### Offline, SEO, and discoverability

- Added `sw.js` with network-first navigation and cache-first static asset recovery.
- Upgraded the web manifest with install metadata and shortcuts.
- Added `sitemap.xml` and linked it from `robots.txt`.
- Added improved canonical, Open Graph, Twitter, and structured application metadata on primary pages.

## Validation completed

`npm test` passes 11 automated tests covering:

- Billing configuration readiness.
- Licence key format and activation limits.
- Paddle signature acceptance and stale-signature rejection.
- Approved and rejected CORS origins.
- Page metadata and shared styling.
- Internal links and local assets.
- Duplicate HTML IDs.
- Purchase and account control wiring.
- Service-worker precache integrity.
- JavaScript syntax across all frontend and backend files.

## Deployment actions still required

Code cannot supply production Paddle credentials, live price IDs, Paddle domain approval, webhook destination configuration, Cloudflare secrets, or installer binaries. Complete the production checklist in `README.md`, deploy, then verify `/api/health` and perform an end-to-end live transaction.
