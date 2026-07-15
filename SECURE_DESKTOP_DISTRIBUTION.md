# Secure Desktop Distribution Patch — DHC-6 Trainer

## What this patch does

This patch changes the desktop website flow from direct public installer downloads to a license-gated desktop access page.

Included files:

- `desktop.html` — replacement desktop page with no public EXE/MSI links.
- `access.html` — desktop access request page.
- `assets/js/desktop-license-gate.js` — client-side license form UI.
- `serverless/netlify/functions/desktop-download.js` — example backend license verifier.
- `netlify.toml` — Netlify redirect example for `/api/desktop-download`.

## Important security point

A static GitHub Pages website cannot securely protect a file download if the installer URL is public.

If the EXE/MSI remains uploaded as a public GitHub Release asset, anyone with the link can download it, even if the website hides the button.

## Immediate action

1. Go to the existing GitHub Release:
   `https://github.com/TJAeronautical/dhc6-trainer-website/releases/tag/desktop-v1.6.9`

2. Edit the release.

3. Delete the public installer assets:
   - `DHC6TrainerDesktop-1.6.9.exe`
   - `DHC6TrainerDesktop-1.6.9.msi`

4. Keep the release notes if desired, but do not attach public installer assets unless you accept that they are free to download.

## Recommended secure options

### Fastest commercial option
Use a digital product platform such as Gumroad, Lemon Squeezy, Paddle, or Stripe payment links with file delivery. Link `access.html` to the purchase page.

### Best technical option
Deploy the website to Netlify, Vercel, Cloudflare Pages, Firebase Hosting, or Supabase and use:

- user login or license key check
- private storage bucket
- short-lived signed download URLs
- optional app-side activation check

### Strongest product protection
Add license activation inside the desktop app too. Even if someone shares the installer, the app should require activation before full use.

Recommended app behavior:
- Free/unactivated: launch screen, limited demo, no full QRH/procedure/cockpit access.
- Activated: full desktop access.
- Offline grace: store a signed license token locally and allow a limited offline period.

## Deploying this patch to the website repo

Copy the patch files into:

`C:\Android Studio\DHC-6-Trainer-Website-GitHub`

Then run:

```powershell
cd "C:\Android Studio\DHC-6-Trainer-Website-GitHub"

git add desktop.html access.html assets/js/desktop-license-gate.js netlify.toml serverless/netlify/functions/desktop-download.js SECURE_DESKTOP_DISTRIBUTION.md

git commit -m "Lock desktop downloads behind license access page"

git push origin main
```

## Current limitation on GitHub Pages

The form will show a backend-not-active message on GitHub Pages because GitHub Pages cannot run `/api/desktop-download`.

That is intentional. Until a backend is deployed, use `access.html` to collect desktop access requests manually.
