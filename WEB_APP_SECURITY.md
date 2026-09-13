# DHC-6 Trainer web app — access model, security hardening and operations

_Branch `feature/web-app-secure-shell` · September 2026_

## 1. What changed and why

| Area | Before (`main` @ 8f0e1a5) | Now |
| --- | --- | --- |
| Protected app page | `/live.html` hidden with CSS (`visibility:hidden`) — fully fetchable by anyone | `/app/` **and** `/live.html` are refused by the Worker (302 → sign-in) unless a valid signed session cookie is presented |
| Session storage | Bearer token in `sessionStorage` | HttpOnly · Secure · SameSite=Strict cookie `dhc6_web_session` (bearer header still accepted by the API for scripts) |
| Revocation | None (12 h HMAC token stayed valid after "logout") | Every token carries a session id; `POST /api/web-access/logout` writes a KV revocation marker until natural expiry; every check re-reads the licence / owner email live |
| Licence recovery | `POST /api/billing/status` with **email only** returned the full record **including the licence key** (and the account page auto-filled it) | Email-only lookups return a masked status (no key, ids or devices). Full details need the key or a signed-in web session. New passwordless **email-link sign-in** covers the "lost key" case |
| Billing portal | Key alone opened the Paddle portal | Key **and** matching purchase email required |
| Training content | Hand-typed inside public `live.html` | Transformed from the Android repo's `core-res` assets into KV packs, served only by `GET /api/content/*` with `Cache-Control: private, no-store` |
| Service worker | Cached every navigation incl. `/live.html`; precached concept images | Never touches `/app*`, `/live*`, `/api/*`; `clear-protected` message; concept images removed from precache |
| Owner sign-in | Firebase password check, no `emailVerified` check | Adds `accounts:lookup` and requires `emailVerified === true`, rejects disabled accounts, rate-limited |
| Abuse control | none | KV-backed per-IP throttles: session 20/15 min, owner 10/15 min, email link 5/15 min (+3 per address per hour), same-origin checks on all sign-in POSTs |

No Paddle, webhook, licence, desktop-download, Play or Firebase-Android code paths were changed. New purchases remain suspended.

## 2. Request flow

```
Browser ──POST /api/web-access/session (email+key)────────────▶ Worker ──KV LICENSES──▶ active? ──▶ Set-Cookie dhc6_web_session
        ──POST /api/web-access/owner-session (email+password)─▶ Worker ──Firebase signInWithPassword + accounts:lookup (emailVerified)
        ──POST /api/web-access/request-link (email)───────────▶ Worker ──KV/Paddle: active? ──▶ Firebase sendOobCode EMAIL_SIGNIN
        ──POST /api/web-access/link-session (email+oobCode)───▶ Worker ──Firebase signInWithEmailLink + lookup ──▶ Set-Cookie
        ──GET  /app/  (cookie)───────────────────────────────▶ Worker: verify signature/expiry/revocation + live entitlement, else 302
        ──GET  /api/content/manifest | /api/content/pack/:id ─▶ same check, private no-store JSON from KV
        ──GET  /api/web-access/verify (every 5 min + on focus)─▶ same check; 401/403 ⇒ client clears caches and returns to sign-in
        ──POST /api/web-access/logout ────────────────────────▶ revoke sid, clear cookie, Clear-Site-Data: "cache"
```

## 3. Cloudflare configuration (manual steps)

Existing bindings are reused; **no new binding is required** for the first deployment.

| Setting | Type | Required | Notes |
| --- | --- | --- | --- |
| `LICENSE_SIGNING_SECRET` | secret | yes (exists) | Signs web sessions. Rotating it signs every subscriber out. |
| `OWNER_ACCESS_EMAIL` | secret/var | yes for owner sign-in | Exact Firebase owner email. Never committed. |
| `FIREBASE_WEB_API_KEY` | secret | yes (exists) | Used for owner password sign-in, `accounts:lookup` and email-link sign-in. |
| `LICENSES` | KV binding | yes (exists) | Now also stores `websession-revoked:*`, `ratelimit:*` (with TTL) and `webcontent:*` packs. |
| `WEB_CONTENT` | KV binding | optional | If you prefer a dedicated namespace for content: `npx wrangler kv namespace create WEB_CONTENT`, add the binding to `wrangler.jsonc`, publish packs there. The Worker uses it automatically when bound. |

Set/confirm secrets:

```powershell
npx wrangler secret put OWNER_ACCESS_EMAIL
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put LICENSE_SIGNING_SECRET
```

### Firebase (for owner sign-in and the subscriber email link)

1. Firebase console → Authentication → Sign-in method → **Email/Password**: enable, and enable **Email link (passwordless sign-in)**.
2. Authentication → Settings → **Authorized domains**: add `dhc6trainer.com` (and `www.dhc6trainer.com`).
3. The owner account must show **Email verified** (Authentication → Users). If not, send yourself the verification email from the Android app or the Firebase console.
4. Optional: Templates → "Email address sign-in" — customise the sender name / text.

Until step 1–2 are done, the "Email me a sign-in link" form returns `email_link_not_configured` and licence-key sign-in keeps working.

## 4. Publishing training content (owner only)

Content is **never committed** to this public repository. Build it from your local Android checkout and upload it to KV:

```powershell
cd "C:\Android Studio\dhc6-trainer-website"
node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\content
npx wrangler kv bulk put build\content\kv-bulk.json --binding LICENSES --remote
```

The build prints every pack and a manifest version (`YYYYMMDD-<hash>`). Re-run both commands whenever `core-res/src/main/assets` changes. To use the dedicated namespace instead: `--binding WEB_CONTENT`.

Packs produced (all derived 1:1 from `core-res/src/main/assets`):

| Pack | Source | Used by |
| --- | --- | --- |
| `procedures-index` | `procedures/**` + `procedure_bindings_normal.json` + `canonical_phases.json` | QRH categories, checklist lists, drills |
| `procedures-normal` / `-abnormal` / `-emergency` | `procedures/<category>/*.json` (memory + PF/PM flow, LEGACY/G950) | Procedure screens |
| `flashcards` | `flashcards/*.json` (15 decks, 177 cards) | Flashcards |
| `quiz-bank` | `quizzes/quiz_bank.json` (69 questions) | Drill |
| `limitations` | `limitations/dhc6_limitations.json` | Limitations |
| `mel` | `mel/dhc6_mel_reference.json` | MEL |
| `performance` | `performance/dhc6_performance_tables.json` + `calculators/dhc6_calc_data.json` | Performance, Fuel, W&B |
| `cas-library` | `cas-library/*.json` | CAS Library |
| `maldives-strips` | `strips/maldives_strips.json` | Maldives Strips |
| `cockpit-bindings`, `scenario-snapshots`, `canonical-items` | `bindings/*`, `scenario_snapshots.json`, `canonical_items.json` | Reserved for the Aircraft State / cockpit phase |

## 5. Local development without Cloudflare

```powershell
node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\content
node tools/dev-server.mjs --port 8788 --kv build\content\kv-bulk.json
```

Open `http://127.0.0.1:8788/web-app.html` and sign in with `pilot@example.com` / `DHC6-TEST-TEST-TEST`. Owner sign-in and email links need real Firebase credentials in `.dev.vars` (git-ignored).

## 6. Verification checklist

- `npm test` — 41 tests: sessions (valid / expired / malformed / tampered / revoked / legacy v1), owner flow (non-owner email never reaches Firebase, unverified email rejected), email-link flow (enumeration-safe), protected content (anonymous, lapsed, dedicated namespace), Worker gate (redirects, no-store, deep links, public assets), billing status masking, portal credentials, service-worker bypass + cache clearing, content build from a synthetic fixture, HTML links/ids/imagery labelling.
- Browser walkthrough (Playwright, phone 390×844 / tablet 820×1180 / desktop 1440×900): sign-in → home → QRH → category → procedure → checklists → drill → flashcards → limitations → MEL → performance → fuel → settings → sign-out → `/app/` redirects back to sign-in. No page errors.
- Production: **not deployed by this branch.** After merge, confirm `https://dhc6trainer.com/app/` returns `302 → /web-app.html?status=signin-required` when signed out, and `200` with `Cache-Control: private, no-store` when signed in.
