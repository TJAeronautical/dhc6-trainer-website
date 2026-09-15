# What the Android app may ask this website for

_Current as of `main` @ `0be82ec` · September 2026_

**Read this before proposing a change to this repository from the Android side.**

This file exists because the same four files were proposed twice from the
Android repository: once written directly into this working tree (which broke
`npm test`), and once re-sent after they had already been reviewed, hardened and
merged. Both times the proposal was built against a picture of this repo that
was five phases old. There was no way for that session to know, because nothing
here stated the contract.

Now it does. If something below is wrong or in the way, say so — but check it
against `git log` before rewriting the code it describes.

---

## 1. The one rule

**A Firebase account is not a purchase.**

`FIREBASE_WEB_API_KEY` ships inside the APK and is public by design. Anyone can
read it out, call Firebase's own `signUp` endpoint, and hold a valid ID token
for this project within seconds. So a valid token establishes only that somebody
signed up. It is **authentication**, and no endpoint here may treat it as
**authorization**.

Every mobile caller names the entitlement it needs, and the answer comes from
the list Google Play validation wrote to Firestore at
`users/<uid>/entitlements/current` — never from a tier string, never from a plan
name, never from the existence of the account.

Why not a tier: `tierForPlan()` in `functions/api/_entitlements.js` resolves an
unrecognised plan to `PRO` on purpose, so a typo in a Paddle plan name can never
cost a paying web subscriber their training content. An Android free account's
plan string is the literal word `"free"`, which that rule would read as PRO.
Right default, wrong caller. See `functions/api/_account.js` and
`functions/api/_mobile_session.js`.

---

## 2. What an Android session may read

| Endpoint | Android | Why |
|---|---|---|
| `GET /api/media/models/systems-lab/*.glb` | **yes**, with `SYSTEMS_LAB_3D` | What `SystemsLabMediaClient` actually requests |
| `GET /api/media/<anything else>` | no | Cockpit plates, atlases and reference posters stay browser-only |
| `GET /api/media/index` | no | The client's bundled registry already carries every path, hash and size |
| `GET /api/media/offline-manifest` | no | The entire library in one response |
| `POST /api/ai/oral-exam` | **yes**, with `AI_TRAINER` | The client the feature was built for |
| `/api/library`, `/api/logbook`, `/api/qrh-edits` | **no** | See §4 — these are not ready for a mobile session |

Scope is checked against the **normalised** path, after traversal is rejected,
so no amount of percent-encoding dresses a poster up as a model.

`SYSTEMS_LAB_3D` is **PRO and up**. `FREE_ENTITLEMENTS` is
`["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"]`. If free Android accounts *should*
browse the Lab, that is a pricing decision for the owner and it becomes a
deliberate grant — not a side effect of an auth shape.

---

## 3. What the client must send, and what it gets

```
GET https://dhc6trainer.com/api/media/models/systems-lab/<FILE>.glb
Authorization: Bearer <Firebase ID token>
```

Every `.glb` is watermarked per account before it is sent, so the delivered body
is **longer than the registry `bytes`** and its whole-file hash will never match.
Two things change: the stamp chunk is appended after the source bytes, **and the
GLB header's declared total length at offset 8 is rewritten** to cover it.

That second change is easy to miss, and missing it breaks every model. Hashing
the first `model.bytes` bytes as they arrive does NOT reproduce the source file —
those bytes differ from it at offsets 8..11, so the check fails on all 21 models
and each one is discarded with `VERIFICATION_FAILED` and no model on screen.

Undo the header bump first, then hash:

```
if (body.length < model.bytes) -> discard
head = copy of body[0 .. model.bytes)      // a copy: do not edit the response
writeUInt32LE(head, offset 8, model.bytes)  // restore the source's declared length
sha256(head) == model.sha256
```

`head` is then byte-identical to the file in the reference library, and
`body[model.bytes ..]` is the account stamp. A short body or a mismatched hash
should be discarded rather than handed to the viewer.

An earlier revision of this document prescribed the check without the header
restore. It was wrong, and `tests/mobile-media.test.mjs` now executes the rule
written above against a really stamped model so this paragraph cannot be wrong
again without failing the suite.

Ranges are refused on models (`Accept-Ranges: none`): a range into a stamped
body would be measured against the wrong length, and serving it unstamped would
hand over an unmarked copy for the price of one header.

### Refusals

| Status | Body `error` | Meaning |
|---|---|---|
| 401 | `firebase_token_invalid` | Token bad, expired, or not this project |
| 403 | `firebase_account_disabled` | Account disabled in Firebase |
| 403 | `entitlement_required` | Signed in, has not bought it. Carries `entitlement` and `requiredTier` |
| 403 | `android_media_scope` | Authenticated and entitled, but that path is browser-only |
| 429 | `ai_rate_limited` | Oral exam only. Carries `limit`, `window`, `Retry-After` |
| 503 | `mobile_access_not_configured` | A Cloudflare binding is missing at our end |
| 503 | `entitlement_check_unavailable` | Firestore or the service account could not be read |

**Both 503s mean "try again", never "you do not have this".** Showing a paying
subscriber an upgrade prompt because of an outage at our end is the failure mode
worth most care in the client.

---

## 4. The identity trap, twice found

`watermarkSeed()` read `auth.payload.key`. A mobile session has no licence key,
so every Android account seeded the literal string `"license:"` and shared **one
watermark** — a mobile leak attributable to nobody. Caught from the Android side
and fixed.

`accountIdFor()` had the identical bug, and it is worse: the Library, the
Logbook and the QRH editor all key their **storage namespaces** on it. Every
Android account would have shared one namespace and read each other's documents
and logbooks. It has never happened only because those three endpoints authorise
with `authorizeWebRequest` alone.

So, for anyone extending this: **anything deriving an identity from
`auth.payload.key` must be checked against a mobile session before it is
trusted.** The failure is always silent and always collapses many accounts into
one. `functions/api/_account.js` now returns `null` for a caller it cannot
identify, and every account-scoped endpoint refuses rather than serving a shared
bucket.

This is why §2 says no to `/api/library`, `/api/logbook` and `/api/qrh-edits`.
The namespace is correct now; the endpoints have never been exercised by a
mobile session and have no tests for one. Opening them is a deliberate piece of
work, not a one-line auth change.

---

## 5. Configuration

Bound already — the AI examiner and Play validation depend on them:

`FIREBASE_WEB_API_KEY` · `FIREBASE_PROJECT_ID` ·
`GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL` · `GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY`

The mobile path **fails closed** without them: `503`, never a way through.

Optional, with safe defaults, changeable without a deploy:

| Var | Default | |
|---|---|---|
| `AI_BURST_LIMIT` | 15 per 5 min | per account |
| `AI_DAILY_LIMIT` | 80 per 24 h | per account |
| `WEB_SEAT_LIMIT` | 3 | browsers per licence |

Android side, in `local.properties`:

```properties
systems_lab_media_url=https://dhc6trainer.com/api/media
```

---

## 6. Where the code is

| | |
|---|---|
| `functions/api/_mobile_session.js` | Firebase + Play entitlement authorisation |
| `functions/api/_account.js` | `accountSeed` / `accountIdFor`, mobile-aware |
| `functions/api/_entitlements.js` | The one tier table, shared with Play validation |
| `functions/api/media/index.js` | Dual-path auth and the Systems Lab scope |
| `functions/api/ai/_spend.js` | The examiner's per-account budget |
| `functions/api/_watermark.js` | Per-account stamping, packs and models |
| `tests/mobile-media.test.mjs` | 20 tests over the above |
| `tests/ai-spend.test.mjs` | 13 more |

A test asserts the entitlement and path prefix quoted in §2 match the code, so
this file cannot drift from it silently.
