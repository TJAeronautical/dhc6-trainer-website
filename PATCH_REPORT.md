# DHC-6 Trainer Website — Patch 01: Paddle Desktop Subscription

**Goal:** upgrade the website so customers can pay for a desktop-app subscription
and receive a licence key the desktop app activates.
**Type:** Additive. No installers included in this ZIP. Existing pages/styles preserved.
**Provider:** Paddle (merchant of record — handles payment, invoicing, and global tax).

## What changed

| File | Change |
|---|---|
| `desktop.html` | Replaced "coming soon" with a real **pricing/subscribe** section (monthly + yearly), a Paddle overlay checkout, and an **"already subscribed"** licence-verify form. Loads Paddle.js + the two scripts below. |
| `access.html` | Reframed from "coming soon / paused" to **manage / recover licence + support**. |
| `assets/js/paddle-checkout.js` | **NEW** — Paddle.js v2 init + `Paddle.Checkout.open()`. One `PADDLE_CONFIG` block holds environment, client token, and price IDs. |
| `assets/js/desktop-license-gate.js` | **Rewritten** — verifies a key against `/api/license/validate`, with graceful email fallback if no backend is deployed. |
| `functions/api/_middleware.js` | **NEW** — CORS for `/api/*` only. |
| `functions/api/_shared.js` | **NEW** — HMAC (Web Crypto), key generation, Paddle signature verify, JSON helpers. |
| `functions/api/health.js` | **NEW** — `GET /api/health`. |
| `functions/api/paddle/webhook.js` | **NEW** — verifies the Paddle signature, mints `DHC6-XXXX-XXXX-XXXX`, and tracks the subscription lifecycle in KV. |
| `functions/api/license/validate.js` | **NEW** — `POST /api/license/validate` → active/expired/canceled. |
| `functions/api/license/activate.js` | **NEW** — `POST /api/license/activate` → device-limited activation + signed offline-grace token. |
| `wrangler.jsonc` | Added the `LICENSES` KV binding and excluded `functions/**` from static asset upload. |
| `PADDLE_SUBSCRIPTION_SETUP.md` | **NEW** — full account/deploy/test/go-live guide + desktop activation hook spec. |

## Why this shape

- Paddle as **merchant of record** means you carry **zero sales-tax liability** and
  a Paddle payout is treated as an export of services from South Africa — the
  reliable choice for selling worldwide from ZA.
- Paddle Billing does **not** generate licence keys itself, so the standard pattern
  is: Paddle handles money + tax, your webhook mints and stores the key. That lives
  as a Cloudflare Pages Function, which fits your existing `wrangler.jsonc` setup.
- The licence-key format matches what the desktop gate already expects
  (`DHC6-XXXX-XXXX-XXXX`).

## Apply

```bash
# Termux / Linux / macOS — from the folder holding the ZIP
unzip -o dhc6-website-patch-01-paddle-subscription.zip -d dhc6-web-patch-01
cp -rv dhc6-web-patch-01/dhc6-website-patch-01-paddle-subscription/* /path/to/DHC-6-Trainer-Website-GitHub/
```
```powershell
# Windows PowerShell — from the folder holding the ZIP
Expand-Archive -Path .\dhc6-website-patch-01-paddle-subscription.zip -DestinationPath .\dhc6-web-patch-01 -Force
Copy-Item -Recurse -Force .\dhc6-web-patch-01\dhc6-website-patch-01-paddle-subscription\* "C:\Android Studio\DHC-6-Trainer-Website-GitHub\"
```

## Configure, deploy, test

See `PADDLE_SUBSCRIPTION_SETUP.md` — the 7 steps: create product + prices, paste
IDs/token into `paddle-checkout.js`, create the KV namespace + secrets, point a
Paddle Notifications destination at `/api/paddle/webhook`, deploy with
`npx wrangler pages deploy .`, then run the sandbox test purchase.

## Verify (after deploy)

1. `curl https://<domain>/api/health` → `{"ok":true,...,"kv":true}`.
2. `desktop.html` → Subscribe → Paddle **sandbox** checkout opens and completes.
3. `npx wrangler kv key list --binding LICENSES` shows a new `license:DHC6-...`.
4. `desktop.html#activate` → key + email → "Licence verified".
5. `POST /api/license/activate` returns `{"activated":true,...,"token":"..."}`.

## Static verification already done

- JS (browser + ESM) syntax: all 8 scripts pass `node --check`.
- HTML wiring: every id the scripts need is present in `desktop.html`; tags balanced.
- Function import paths (`../_shared.js`) resolve.
- `wrangler.jsonc` parses as valid JSONC.

## Boundaries / not in this patch

- **Live payment, webhook delivery, and activation can't be tested from a build
  sandbox** — they need your Paddle account and a deployed URL. Step 6 covers it.
- **Installer download streaming** is unchanged (the separate private-R2 plan).
- **Desktop app activation client** is a separate desktop-project patch — the
  exact contract is specified in the setup guide; say the word and I'll build it
  against the desktop app.
- Prices are editable placeholders (`$XX` / `$XXX`) in `desktop.html`, and Paddle
  price IDs are placeholders in `paddle-checkout.js`.
