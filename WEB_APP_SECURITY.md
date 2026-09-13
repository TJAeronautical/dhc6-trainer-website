# DHC-6 Trainer web app — access model, security hardening and operations

_Branches `feature/web-app-secure-shell` (phase 1, merged) and `feature/web-app-phase2-android-parity` · September 2026_

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

The build prints every pack and a manifest version (`YYYYMMDD-<hash>`). Re-run both commands whenever
`core-res/src/main/assets` **or** the Kotlin sources it reads (`ProcedureSortOrder.kt`, `ProcedureLibraryScreen.kt`,
`GlossaryScreen.kt`) change. The Kotlin files are located automatically inside the module tree; pass
`--kotlin "C:\Android Studio\DHC-6-Trainer\_web_export"` if you only have the flattened export. To use the dedicated
namespace instead: `--binding WEB_CONTENT`.

**Phase 2 requires a republish** — the app reads the new `glossary` and `knowledge-pool` packs and the new
`procedureName` / `displayTitle` / `compiledId` / `qrhRank` / `normalBucket` fields on every procedure.

Packs produced (all derived 1:1 from `core-res/src/main/assets`):

| Pack | Source | Used by |
| --- | --- | --- |
| `procedures-index` | `procedures/**` + `procedure_bindings_normal.json` + `canonical_phases.json` | QRH categories, checklist lists, drills |
| `procedures-normal` / `-abnormal` / `-emergency` | `procedures/<category>/*.json` (memory + PF/PM flow, LEGACY/G950) | Procedure screens |
| `flashcards` | `flashcards/*.json` (13 decks that satisfy the Android `FlashcardDeck` model, 157 cards) | Study Card Review |
| `knowledge-pool` | flashcards mapped like `BundledFlashcardSeeder` + `quizzes/quiz_bank.json` (226 STATUS:CANDIDATE units) | Quizzes, SRS study, search |
| `glossary` | `GlossaryScreen.kt` literals (32 entries) | Definitions |
| `quiz-bank` | `quizzes/quiz_bank.json` (69 questions) | reference copy |
| `limitations` | `limitations/dhc6_limitations.json` | Limitations |
| `mel` | `mel/dhc6_mel_reference.json` | MEL |
| `performance` | `performance/dhc6_performance_tables.json` + `calculators/dhc6_calc_data.json` | Performance, Fuel, W&B |
| `cas-library` | `cas-library/*.json` | CAS Library |
| `maldives-strips` | `strips/maldives_strips.json` | Maldives Strips |
| `cockpit-bindings`, `scenario-snapshots`, `canonical-items` | `bindings/*`, `scenario_snapshots.json`, `canonical_items.json` | Reserved for the Aircraft State / cockpit phase |

**Phase 3 requires a republish** — the app reads the new `systems-lab` pack (Technical Lab definitions + GLB registry).
`build-content.mjs` now also needs `SystemsLabSection.kt`, `SystemsLabHomeScreen.kt` and `AircraftSystem.kt`
(found automatically in the module tree or via `--kotlin`).

### 4b. Publishing protected media (3D models + cockpit imagery) — owner only

Binary training media (the Technical Lab GLB models and, since phase 4a, the cockpit plates and sprite atlases;
posters next) is served only through
`GET /api/media/<path>` (`functions/api/media/`), which runs the same `authorizeWebRequest` session check as
`/api/content`, answers `Cache-Control: private, no-store` + `Vary: Cookie, Authorization, Range`, supports `HEAD`,
`Range` (206) and `If-None-Match` (304), validates the path against an extension allow-list and rejects traversal.
Models are never committed to this repository and never placed under the public assets directory (`npm test` fails
if a `.glb` appears anywhere in the tree). The same rule now covers the cockpit: `npm test` fails if any `.png` /
`.webp` / `.jpg` appears under a `cockpit/` directory or is named `*_base_clean*`, `*cockpit-atlas*` or `*source_exact*`.
Phase 4a deleted the last public copy, `assets/cockpit/legacy-cockpit-base-clean.webp`; `/live.html` now loads that
plate from `/api/media/cockpit/plates/legacy.webp` and hides the element if it is not published or the session lapsed.

Storage: the Worker reads R2 first (binding `WEB_MEDIA`, object key `webmedia/<path>`) and falls back to KV
(`webmedia:blob:<path>`, raw bytes) so small images can be published with `kv bulk put` without a new binding.
The two largest models (75 MB engine, 28 MB undercarriage) exceed the 25 MiB KV value limit, so the model set
lives in R2:

```powershell
cd "C:\Android Studio\dhc6-trainer-website"
npx wrangler r2 bucket create dhc6-web-media          # once — must exist BEFORE the phase-3 Worker deploys
npm install sharp                                     # once — build-cockpit.mjs needs it to pack the atlas
node tools/build-cockpit.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\cockpit
node tools/build-media.mjs --reference "C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab" --android "C:\Android Studio\DHC-6-Trainer" --extra-media build\cockpit\media --out build\media
powershell -ExecutionPolicy Bypass -File build\media\upload-media.ps1   # 21 models + 4 cockpit files, wrangler r2 object put … --remote (~182 MB)
npx wrangler kv bulk put build\media\kv-media-index.json --binding LICENSES --remote   # publishes webmedia:index
```

`build-media.mjs` verifies every file's SHA-256 against `tools/data/systems-lab-models.json` (the registry that maps
GLB node names onto the Android `LabPart` ids) and warns when a file was re-exported. The app shows a model as
"not published" until `webmedia:index` lists it.

Client-side: `app/js/lab3d.js` downloads a model once (progress bar; files above 12 MB need an explicit tap) and keeps
it in the Cache API store `dhc6-media-v1` tagged with the registry hash; `app/js/cockpit.js` caches the plate and atlas
in the same store. `subscriber-gate.js` already deletes every `/api/` entry from every cache on sign-out or entitlement
lapse, so models and cockpit imagery leave the device with the session, and `clearCockpitImageCache()` additionally
drops the decoded bitmaps **and** deletes the whole `dhc6-media-v1` cache the moment `/api/media` answers 401/403 —
so a revoked session cannot keep rendering the cockpit from a stale cache. The service worker never sees `/api/media`. The renderer (`app/vendor/three-lab.js`, three.js r170) is a public library
file and carries no content.

## 5. Local development without Cloudflare

```powershell
node tools/build-cockpit.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\cockpit
node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\content
node tools/build-media.mjs --extra-media build\cockpit\media --reference "C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab" --android "C:\Android Studio\DHC-6-Trainer" --out build\media
node tools/dev-server.mjs --port 8788 --kv build\content\kv-bulk.json --media-kv build\media\kv-media-index.json --media-dir "build\cockpit\media;C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab;C:\Android Studio\DHC-6-Trainer\core-res\src\main\assets\models\systems_lab\models"
```

The dev server serves the models from those folders through an in-memory `WEB_MEDIA` double, so the Technical Lab
works offline; `node tools/playwright-lab.mjs` drives every lab system (including the 75 MB engine) in headless Chromium.

Open `http://127.0.0.1:8788/web-app.html` and sign in with `pilot@example.com` / `DHC6-TEST-TEST-TEST`. Owner sign-in and email links need real Firebase credentials in `.dev.vars` (git-ignored).

## 6. Verification checklist

- `npm test` — **117 tests**. Phase 4a adds `tests/cockpit.test.mjs` (39 tests: canonical visual keys and the
  annunciator alias table, host roles, hitbox parsing / clamping / G950 parity, the contain-fit transform, sprite
  families and calibration, the lever travel profiles, the `EngineSystemsModel` 180-tick reference set,
  the autofeather arm gates, `CasCatalog` normalisation, `CasSystem` latch / ack / phase inhibit, the masters,
  `FailureStateEvaluator` ground-idle and cruise outcomes, snapshot parsing and lever / switch / instrument
  readers, the snapshot registry and overrides, the interaction controller, the scenario context rules, the drill
  evaluator, the Android grading table, a full drill run with the Next lock and the logbook entry, and the
  bindings index — including the six documented Android quirks), a cockpit case in `tests/protected-media.test.mjs`
  (anonymous 401, lapsed 403, `private, no-store`, `Vary: Cookie`) and three site tests (no cockpit imagery in the
  repo, the Aircraft State routes and their handlers resolve, the disclaimer is on every cockpit screen, no
  watermarked tile art). Phase 3 adds `tests/protected-media.test.mjs` — anonymous / malformed / expired / revoked /
  lapsed sessions, R2 streaming with `private, no-store`, ETag, HEAD, 206 ranges, 416, traversal and type rejection,
  KV fallback and R2 precedence, Worker routing — `tests/systems-lab.test.mjs` — node-selector semantics, registry
  integrity, the Kotlin reader, the `systems-lab` pack build from fixtures, the `labSimulation` port, lever labels,
  QRH routing, pins and clip groups — plus service-worker bypass of `/api/media` and a repo scan that fails when a
  `.glb` is committed. Phase 2 added `tests/app-logic.test.mjs` for the ported Kotlin logic — title formatting, variant
  materialisation, QRH ordering, drill scoring, quiz distractors, bilinear performance interpolation, fuel / W&B arithmetic,
  SM-2 scheduling, dashboard insights — and a Kotlin-fixture build test). Phase 1 coverage: sessions (valid / expired / malformed / tampered / revoked / legacy v1), owner flow (non-owner email never reaches Firebase, unverified email rejected), email-link flow (enumeration-safe), protected content (anonymous, lapsed, dedicated namespace), Worker gate (redirects, no-store, deep links, public assets), billing status masking, portal credentials, service-worker bypass + cache clearing, content build from a synthetic fixture, HTML links/ids/imagery labelling.
- Browser walkthrough (`tools/playwright-walkthrough.mjs`, phone 390×844 / tablet 820×1180 / desktop 1440×900): every route,
  an emergency drill (MEMORY 8/8 → FLOW 20/20 → SUMMARY), a 5-question quiz saved to the logbook, PROCS filters + search focus,
  sign-out → `/app/` redirects to sign-in. No page errors.
- Aircraft State walkthrough (phone 390×844 / tablet 834×1112 / desktop 1440×900): `/live`, `/live/procedures` with
  all six contexts (48 Ground/Start rows), `/scenario/state` with BEFORE/DURING/AFTER, Review Details,
  `/scenario/focus`, `/live/cockpit` with the lever slider, `/scenario/run`, the memory drill and the MCC flow drill.
  Plate, gauges, needles, lamps and sprites render from the protected atlas on every viewport. No page errors.
- Technical Lab walkthrough (`tools/playwright-lab.mjs`, software WebGL): explorer with 7 hotspots, all 16 lab systems
  loaded (21 models incl. the 75 MB engine), pins, animation groups, fault mode + readouts, a saved note, 15 models
  in the Cache API before sign-out and 0 `/api/media` entries after it. No page errors.
- Production: **not deployed by this branch.** After merge, confirm `https://dhc6trainer.com/app/` returns `302 → /web-app.html?status=signin-required` when signed out, and `200` with `Cache-Control: private, no-store` when signed in.
