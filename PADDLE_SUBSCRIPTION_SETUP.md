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

The billing system also includes:

- `POST /api/billing/status` for account status and activated devices.
- `POST /api/billing/portal` for Paddle-hosted subscription management.
- `POST /api/license/deactivate` to release a desktop device seat.
- `access.html#account` as the customer account console.

---

## Sandbox catalog created

Current sandbox product and price mapping:

| Plan | Product ID | Price | Price ID | Paddle amount |
| --- | --- | --- | --- | --- |
| Premium | `pro_01kxk3k651jztcw4pe9xt1zq3z` | Monthly $14.99 | `pri_01kxk3xtqq51jna7weqk9z374m` | `"1499"` |
| Premium | `pro_01kxk3k651jztcw4pe9xt1zq3z` | Annual $149.99 | `pri_01kxk418gk6pgmzm9pw61eyfqm` | `"14999"` |
| Instructor | `pro_01kxk446c7wktesx3cj8m8n379` | Monthly $29.99 | `pri_01kxk45ny35mgkwy64xqdq849n` | `"2999"` |
| Instructor | `pro_01kxk446c7wktesx3cj8m8n379` | Annual $299.99 | `pri_01kxk46sfrf7t6pck4cweh4k11` | `"29999"` |
| Enterprise | `pro_01kxk476nhtewg2tyqvtxpzyv2` | Monthly $99.99 | `pri_01kxk48gyh6e7v7awr0b01svpc` | `"9999"` |
| Enterprise | `pro_01kxk476nhtewg2tyqvtxpzyv2` | Annual $999.99 | `pri_01kxk49k3ybfsaxhgds952ebba` | `"99999"` |

Activation limits:

- Premium: 3 devices
- Instructor: 10 devices
- Enterprise: 50 devices

All sandbox prices include a 7-day trial and GB/IE/AU local price overrides.

---

## Step 1 — Paddle account and product

1. Create a Paddle account and start in the **sandbox** (Paddle dashboard has a sandbox/live switch).
2. **Catalog > Products**: create one product per tier:
   - `DHC-6 Trainer Desktop Premium`
   - `DHC-6 Trainer Desktop Instructor`
   - `DHC-6 Trainer Desktop Enterprise`
3. Add two **recurring prices** to each product:
   - Monthly
   - Annual
4. Copy each **price ID** (looks like `pri_01h...`).
5. **Developer tools > Authentication**: copy a **client-side token**
   (sandbox tokens start with `test_`, live with `live_`).

## Step 2 — Put your IDs in the site

Edit `assets/js/paddle-checkout.js`, top `PADDLE_CONFIG` block:

```js
environment: "sandbox",                 // "production" when live
clientToken: "test_...",                // your client-side token
prices: {
  premium: {
    monthly: "pri_...",
    annual: "pri_..."
  },
  instructor: {
    monthly: "pri_...",
    annual: "pri_..."
  },
  enterprise: {
    monthly: "pri_...",
    annual: "pri_..."
  }
}
```

The displayed prices in `desktop.html` already match the sandbox catalog above.
When you create live Paddle prices later, update both `assets/js/paddle-checkout.js`
and the visible pricing labels in `desktop.html`.

## Step 3 — Create the licence store (KV) and secrets

```bash
# Termux / Linux / macOS  (run from the website root)
npx wrangler kv namespace create LICENSES
# copy the printed id into wrangler.jsonc -> kv_namespaces[0].id

npx wrangler pages secret put PADDLE_WEBHOOK_SECRET     # paste from Step 4
npx wrangler pages secret put PADDLE_API_KEY            # Paddle API key for portal sessions
npx wrangler pages secret put PADDLE_ENVIRONMENT        # sandbox or production
npx wrangler pages secret put LICENSE_SIGNING_SECRET    # any long random string
```

```powershell
# Windows PowerShell  (run from the website root)
npx wrangler kv namespace create LICENSES
# copy the printed id into wrangler.jsonc -> kv_namespaces[0].id

npx wrangler pages secret put PADDLE_WEBHOOK_SECRET
npx wrangler pages secret put PADDLE_API_KEY
npx wrangler pages secret put PADDLE_ENVIRONMENT
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
     `subscription.canceled`, `subscription.paused`,
     `subscription.resumed`, `subscription.past_due`,
     `transaction.completed`, `transaction.paid`
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
# expect: {"ok":true,"service":"dhc6-trainer-billing","kv":true,"paddleApi":true}
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
5. On `access.html#account`, enter the purchase email + key. Expect active
   status, renewal/expiry date, and a device-seat summary.
6. Click **Open billing portal**. Expect Paddle's hosted customer portal.
7. Test activation directly:
   ```bash
   curl -X POST https://<your-pages-domain>/api/license/activate \
     -H "Content-Type: application/json" \
     -d '{"licenseKey":"DHC6-XXXX-XXXX-XXXX","deviceId":"test-device-1"}'
   # expect: {"activated":true,...,"token":"..."}
   ```
8. Return to `access.html#account`, refresh status, and confirm the test device
   appears. Release it and confirm the activation count drops.

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

Defaults you can tune:
`activationLimit = 3` devices per licence record, and `GRACE_DAYS = 7` offline
days in `functions/api/license/activate.js`.

---

## Billing API contract

### Check account status

```http
POST /api/billing/status
Content-Type: application/json

{
  "email": "buyer@example.com",
  "licenseKey": "DHC6-XXXX-XXXX-XXXX"
}
```

Returns `{ ok:true, license:{ status, plan, expiresAt, activationCount, activationLimit, activations } }`.

### Open Paddle billing portal

```http
POST /api/billing/portal
Content-Type: application/json

{
  "email": "buyer@example.com",
  "licenseKey": "DHC6-XXXX-XXXX-XXXX"
}
```

Returns `{ ok:true, url:"https://..." }`. Redirect the customer to `url`.

### Release a device seat

```http
POST /api/license/deactivate
Content-Type: application/json

{
  "email": "buyer@example.com",
  "licenseKey": "DHC6-XXXX-XXXX-XXXX",
  "deviceId": "stable-machine-id"
}
```

Returns the updated public licence state.

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
