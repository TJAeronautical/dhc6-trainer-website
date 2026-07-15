# DHC-6 Trainer — Paddle Desktop Subscription: Setup & Go-Live

This patch makes the website sell a **desktop subscription** through **Paddle**
(merchant of record) and issue a **licence key** the desktop app activates.

> Important: the licence API runs as **Cloudflare Pages Functions** (the
> `functions/` folder). These run on **Cloudflare Pages**, not GitHub Pages.
> The static pages still work anywhere, but the buy/activate loop needs the
> site deployed to Cloudflare Pages.

The flow:

```
desktop.html  --(Paddle.js overlay)-->  Paddle checkout (payment + tax)
      |                                          |
      |                              subscription.activated webhook
      |                                          v
      |                         functions/api/paddle/webhook.js
      |                          generates DHC6-XXXX-XXXX-XXXX, stores in KV
      v                                          |
customer email (key)  <------------------------- + Paddle receipt
      |
      v
desktop app  --(POST /api/license/activate)-->  unlock (signed offline grace)
```

---

## Step 1 — Paddle account and product

1. Create a Paddle account and start in the **sandbox** (Paddle dashboard has a sandbox/live switch).
2. **Catalog > Products**: create one product, e.g. `DHC-6 Trainer Desktop`.
3. Add two **recurring prices** to that product:
   - Monthly (your monthly amount + currency)
   - Yearly (your annual amount + currency)
4. Copy each **price ID** (looks like `pri_01h...`).
5. **Developer tools > Authentication**: copy a **client-side token**
   (sandbox tokens start with `test_`, live with `live_`).

## Step 2 — Put your IDs in the site

Edit `assets/js/paddle-checkout.js`, top `PADDLE_CONFIG` block:

```js
environment: "sandbox",                 // "production" when live
clientToken: "test_...",                // your client-side token
prices: {
  monthly: "pri_...",                   // monthly price ID
  annual:  "pri_..."                    // yearly price ID
}
```

Then edit the displayed `$XX/month` and `$XXX/year` text in `desktop.html`
(section `#pricing`) to match what you set in Paddle. The actual charge always
comes from Paddle; this text is only the marketing label.

## Step 3 — Create the licence store (KV) and secrets

```bash
# Termux / Linux / macOS  (run from the website root)
npx wrangler kv namespace create LICENSES
# copy the printed id into wrangler.jsonc -> kv_namespaces[0].id

npx wrangler pages secret put PADDLE_WEBHOOK_SECRET     # paste from Step 4
npx wrangler pages secret put LICENSE_SIGNING_SECRET    # any long random string
```

```powershell
# Windows PowerShell  (run from the website root)
npx wrangler kv namespace create LICENSES
# copy the printed id into wrangler.jsonc -> kv_namespaces[0].id

npx wrangler pages secret put PADDLE_WEBHOOK_SECRET
npx wrangler pages secret put LICENSE_SIGNING_SECRET
```

Generate a signing secret quickly:

```bash
# Termux / Linux / macOS
head -c 32 /dev/urandom | base64
```
```powershell
# Windows PowerShell
[Convert]::ToBase64String((1..32 | ForEach-Object {Get-Random -Max 256}))
```

## Step 4 — Point Paddle at the webhook

1. Deploy once first (Step 5) so your URL exists.
2. Paddle **Developer tools > Notifications** (sandbox): add a destination:
   - URL: `https://<your-pages-domain>/api/paddle/webhook`
   - Events: `subscription.activated`, `subscription.updated`,
     `subscription.canceled`, `transaction.completed`
3. Copy the destination's **secret key** and set it as `PADDLE_WEBHOOK_SECRET`
   (Step 3). Re-deploy after setting secrets.

## Step 5 — Deploy to Cloudflare Pages

```bash
# Termux / Linux / macOS
npx wrangler pages deploy .
```
```powershell
# Windows PowerShell
npx wrangler pages deploy .
```

(Or connect the GitHub repo in the Cloudflare Pages dashboard for auto-deploys.)

Check the API is alive:

```bash
curl https://<your-pages-domain>/api/health
# expect: {"ok":true,"service":"dhc6-trainer-licenses","kv":true}
```

## Step 6 — Test in sandbox (no real money)

1. Open `desktop.html`, click **Subscribe monthly**.
2. Complete the Paddle **sandbox** checkout using Paddle's published sandbox
   test card (see Paddle's "Test payments / sandbox" docs for the current
   test card number — do not use a real card in sandbox).
3. Confirm the webhook created a record:
   ```bash
   npx wrangler kv key list --binding LICENSES
   ```
   You should see a `license:DHC6-...`, `sub:...`, and `email:...` entry.
4. On `desktop.html#activate`, enter the key + purchase email → expect
   "Licence verified".
5. Test activation directly:
   ```bash
   curl -X POST https://<your-pages-domain>/api/license/activate \
     -H "Content-Type: application/json" \
     -d '{"licenseKey":"DHC6-XXXX-XXXX-XXXX","deviceId":"test-device-1"}'
   # expect: {"activated":true,...,"token":"..."}
   ```

## Step 7 — Go live

1. In Paddle, move the product/prices to the **live** environment (live price IDs).
2. In `assets/js/paddle-checkout.js`: set `environment: "production"`, swap in
   the **live** client token and **live** price IDs.
3. Add a **live** Notifications destination in Paddle and set its secret as
   `PADDLE_WEBHOOK_SECRET` for the live deployment.
4. Re-deploy. Do one real low-value purchase to confirm end to end, then refund
   it from the Paddle dashboard if you wish.

---

## Desktop app activation hook (separate desktop-project patch)

The website issues and validates keys; the **desktop app** needs a small
activation client. This is not in this website patch because the desktop
project is a different repo — I can deliver it as its own patch. The contract:

- On first unlock, the app collects the key the user pastes and a stable
  `deviceId` (e.g. a hashed machine GUID), then:
  ```
  POST https://<your-pages-domain>/api/license/activate
  { "licenseKey": "...", "deviceId": "...", "deviceName": "..." }
  ```
- On success it receives `{ activated:true, expiresAt, graceExpiresAt, token }`.
  Store `token` + `graceExpiresAt` locally (e.g. in the existing
  `java.util.prefs.Preferences` store used by the desktop app).
- On launch, if `now < graceExpiresAt`, unlock immediately (offline grace).
  Otherwise re-call `/api/license/validate` (or `/activate`) and refresh.
- The token is `key|deviceId|graceExpiresAt|hmac`; the app can verify the HMAC
  with a copy of `LICENSE_SIGNING_SECRET` baked in, or simply trust the server
  response. Server-side remains the source of truth.

Defaults you can tune in `functions/api/license/activate.js`:
`MAX_ACTIVATIONS = 3` devices, `GRACE_DAYS = 7` offline days.

---

## Desktop app launch hook

The website can now launch an installed desktop app with:

```text
dhc6trainer://live
```

Pages use `assets/js/desktop-launch.js` to try the custom protocol and then
fall back to `live.html` if the app does not respond. The desktop app should
register the `dhc6trainer` protocol during installation and route `/live` to the
main trainer/home surface. Keep licence keys out of this URL; activation remains
inside the app.

---

## Notes & limits

- The website does **not** stream the installer in this patch. Installer
  distribution stays the separately-planned private R2 flow (see
  `API_BACKEND_PLAN.md`); subscription + key issuance is what this patch adds.
- License keys are minted by your webhook (Paddle Billing does not generate
  keys itself), so the loop is fully under your control and stored in your KV.
- Everything here was verified statically (JS/ESM syntax, HTML wiring, function
  import paths, JSONC validity). The live payment, webhook delivery, and
  activation must be tested by you in the Paddle sandbox per Step 6 — those
  need your Paddle account and a deployed URL, which can't be exercised from a
  build sandbox.
