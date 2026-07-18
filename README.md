# DHC-6 Trainer Website

Static public hub for DHC-6 Trainer.

## Added in this patch

- `mobile.html` for Play Store/mobile positioning.
- `desktop.html` for desktop subscription, licence verification, and installed-app launch.
- `live.html` for limited browser trainer preview positioning.
- `changelog.html` for release status.
- `downloads/desktop/` for installer files and release manifest.
- `tools/Build-DesktopInstallers-Windows.ps1` to build Windows desktop installers from the main project.
- `tools/Stage-DesktopInstallers.ps1` to copy installer outputs into this website.

## Desktop installer flow

1. Keep this website folder beside the standalone desktop project at `C:\Android Studio\DHC-6-Trainer-Desktop`, or pass `-ProjectRoot`.
2. From Windows PowerShell in this website folder, run:

```powershell
.\tools\Build-DesktopInstallers-Windows.ps1 -ProjectRoot "C:\Android Studio\DHC-6-Trainer-Desktop" -WebsiteRoot .
```

3. Copy resulting installer files into `downloads/desktop/`.
4. Upload installers to private storage for `/api/desktop/download` or configure private expiring installer URLs.
5. Deploy the website to Cloudflare Pages/Workers so the payment, licence, and download APIs run.

The current website flow expects these filenames:

- `DHC6TrainerDesktop-1.7.0.exe`
- `DHC6TrainerDesktop-1.7.0.msi`
- `DHC6TrainerDesktop-1.7.0.dmg`
- `DHC6TrainerDesktop-1.7.0.deb`

Installer binaries must stay out of Git. The checkout success page unlocks
download buttons through `/api/desktop/download` after a paid licence is active.

## Production payment setup

Production checkout is loaded from `/api/billing/config`; do not hard-code live
Paddle IDs into `assets/js/paddle-checkout.js`.

Required production Worker variables:

- `PADDLE_ENVIRONMENT=production`
- `PADDLE_CLIENT_TOKEN=live_...`
- `PADDLE_PRICE_PREMIUM_MONTHLY`
- `PADDLE_PRICE_PREMIUM_ANNUAL`
- `PADDLE_PRICE_INSTRUCTOR_MONTHLY`
- `PADDLE_PRICE_INSTRUCTOR_ANNUAL`
- `PADDLE_PRICE_ENTERPRISE_MONTHLY`
- `PADDLE_PRICE_ENTERPRISE_ANNUAL`
- `PADDLE_SUCCESS_URL=https://dhc6trainer.com/access.html?status=purchased&download=1#download`

Required production secrets:

- `PADDLE_API_KEY`
- `PADDLE_WEBHOOK_SECRET`
- `LICENSE_SIGNING_SECRET`
- `OPENAI_API_KEY`
- `FIREBASE_WEB_API_KEY`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`

Required mobile backend variables:

- `FIREBASE_PROJECT_ID=dhc-6-trainer`
- `MOBILE_ANDROID_PACKAGE=com.dhc6trainer`
- `OPENAI_MODEL=gpt-4.1-mini`

Mobile release APIs:

- `POST /api/ai/oral-exam` verifies the Firebase user token, then proxies the
  Oral Examiner request to OpenAI without exposing the OpenAI key in the app.
- `POST /api/play/validate-purchase` verifies the Firebase user token, checks
  Google Play purchase status with the Android Publisher API, acknowledges the
  purchase server-side when needed, and writes the verified entitlement snapshot
  to Firestore.

Required private download source:

- R2 bucket `dhc6-trainer-private-releases` bound as `DESKTOP_RELEASES`, or
- `DESKTOP_WINDOWS_EXE_URL` and `DESKTOP_WINDOWS_MSI_URL` private expiring links

Check `/api/health` after deploy. Production is not ready until
`paddleCheckoutConfigured`, `paddleApi`, `paddleWebhookSecret`,
`licenseSigningSecret`, `desktopDownloadConfigured`, and
`mobileBackendConfigured` are all `true`.

## Website-to-desktop launch

The live website now exposes installed-app launch links using:

```text
dhc6trainer://live
```

Buttons with `data-desktop-launch` try that protocol first and fall back to
`live.html` if the installed desktop app does not respond. The desktop app
should register the `dhc6trainer` URL protocol and route `/live` to its main
trainer/home experience. Do not pass licence keys or customer data through this
URL; activation still happens inside the desktop app.
