# DHC-6 Trainer Website

Production website, browser trainer, Cloudflare Worker APIs, desktop billing/licensing flow, and Android backend support for DHC-6 Trainer.

## Website v2.0 upgrade

The August 2026 upgrade adds:

- A completely rebuilt cockpit-dark visual system shared across the public, account, legal, and training pages.
- Responsive desktop/mobile navigation, active-page states, scroll progress, keyboard focus treatment, skip links, reduced-motion support, and screenshot lightboxes.
- A rewritten product homepage with clearer training workflow, platform selection, feature architecture, FAQs, and conversion paths.
- Expanded Android, desktop subscription, licence-management, privacy, deletion, and 404 experiences.
- A hardened Paddle checkout client with production configuration validation, disabled controls until readiness is confirmed, retry handling, event feedback, completion storage, and redirect fallback.
- Corrected CORS reflection, static security headers, sitemap/robots discovery, and an installable service worker for offline web-trainer access.
- Automated Node tests for links, assets, HTML IDs, JavaScript syntax, checkout wiring, billing configuration, licence keys, webhook signatures, service-worker precache entries, and CORS.

See `WEBSITE_UPGRADE_REPORT.md` for the detailed implementation record.

## Run locally

```bash
python -m http.server 8080
```

Open `http://localhost:8080/`. Local desktop checkout uses the bundled Paddle sandbox fallback. Real purchases require the deployed Cloudflare Worker configuration.

## Test

Node.js 20 or newer is required.

```bash
npm test
```

## Cloudflare deployment

Deploy the repository root as the Worker asset directory using `wrangler.jsonc`.

Required production variables:

- `PADDLE_ENVIRONMENT=production`
- `PADDLE_CLIENT_TOKEN=live_...`
- `PADDLE_PRICE_PREMIUM_MONTHLY`
- `PADDLE_PRICE_PREMIUM_ANNUAL`
- `PADDLE_PRICE_INSTRUCTOR_MONTHLY`
- `PADDLE_PRICE_INSTRUCTOR_ANNUAL`
- `PADDLE_PRICE_ENTERPRISE_MONTHLY`
- `PADDLE_PRICE_ENTERPRISE_ANNUAL`
- `PADDLE_SUCCESS_URL=https://dhc6trainer.com/access.html?status=purchased&download=1#download`
- `FIREBASE_PROJECT_ID=dhc-6-trainer`
- `MOBILE_ANDROID_PACKAGE=com.dhc6trainer`
- `OPENAI_MODEL=gpt-4.1-mini`

Required production secrets:

- `PADDLE_API_KEY`
- `PADDLE_WEBHOOK_SECRET`
- `LICENSE_SIGNING_SECRET`
- `OPENAI_API_KEY`
- `FIREBASE_WEB_API_KEY`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`

Required bindings:

- KV namespace `LICENSES`
- R2 bucket `DESKTOP_RELEASES`, or private expiring Windows installer URL variables
- Static asset binding `ASSETS`

## Paddle production checklist

1. Verify the live Paddle account and approve `dhc6trainer.com` as a checkout domain.
2. Create the six live recurring prices and place each `pri_...` ID in the matching Worker variable.
3. Create a live client-side token and set `PADDLE_CLIENT_TOKEN`.
4. Configure a Paddle notification destination at `https://dhc6trainer.com/api/paddle/webhook`.
5. Store that destination's current secret as `PADDLE_WEBHOOK_SECRET`.
6. Subscribe the destination to transaction and subscription lifecycle events used by `functions/api/paddle/webhook.js`.
7. Deploy and verify `/api/health` reports the required billing, licence, desktop download, and mobile backend flags as `true`.
8. Complete a live low-risk purchase and confirm licence recovery, billing portal access, protected download, device activation, cancellation, and renewal status.

## Desktop installer flow

Build and stage installers using the scripts in `tools/`, then upload the release files to the private R2 bucket or configure private expiring URL variables. The current default release version is controlled by `DESKTOP_RELEASE_VERSION` in `wrangler.jsonc`.

Expected Windows formats:

- `DHC6TrainerDesktop-<version>.exe`
- `DHC6TrainerDesktop-<version>.msi`

Installer binaries must remain outside Git. `/api/desktop/download` creates protected, short-lived access only for active desktop licences.

## Website-to-desktop launch

Installed-app buttons use:

```text
dhc6trainer://live
```

The browser falls back to `live.html` when the protocol is unavailable. Licence keys and customer data are never passed through the custom URL.

## Operational disclaimer

DHC-6 Trainer is a study and training-support product. It is not an approved AFM, QRH, MEL, checklist, company manual, or operational authority.
