# Android → web feature manifest

Source of truth: `TJAeronautical/DHC-6-Trainer` (private). Inventory taken from
`core-res/src/main/assets` (536 files, 261 MB) and the `app/src/main/java/com/dhc6trainer/ui/navigation`
graph names (`Dashboard`, `Qrh`, `Training`, `Knowledge`, `Library`, `Cockpit`, `SettingsAdmin`, `Auth`).
The Kotlin screen sources are still being exported for exact theme/route parity (see `_web_export`
instructions in the delivery notes); everything marked **Available** below already runs on the
authoritative JSON data.

Status legend: **Available** = fully usable from Android data · **Partial** = usable, port in progress ·
**Later** = present in Android, not yet in the browser · **Blocked** = needs an authoritative source or a decision.

| Android area | Android data / logic | Web module (`/app/#/…`) | Status | Notes |
| --- | --- | --- | --- | --- |
| Home / dashboard, recent activity | DashboardNavGraph, progress repository | `home` | Available | Hero, quick tiles (QRH · Drill · Checklists · Performance), recent activity, module list with status pills |
| QRH procedures & memory items | `procedures/emergency/*`, `procedures/abnormal/*` (64 procedures, LEGACY + G950 variants) | `qrh`, `qrh/group/:g`, `procedure/:id` | Available | Categories = `procedureGroup` from the JSON; All items + Favorites tabs; memory items with PF/PM tags and confirmation markers; "hide responses" drill mode; per-variant checklist progress |
| Normal / abnormal / emergency checklists | `procedures/normal/*` (46) + `procedure_bindings_normal.json` ordering, `normalSplit` | `checklists` | Available | Everyday Actions / System Tests / Weather-Special sections in source `sortOrder` |
| CRM / PF-PM challenge–response flows | `variants.*.flow` steps with `intent` | inside every procedure (PF / PM flow tab) | Partial | Data complete; standalone CRM drill screen and scoring pending |
| Drills / quiz sessions | `quizzes/quiz_bank.json` (69 Q) + procedure memory steps | `drill`, `drill/memory/:id` | Partial | Reveal-and-grade knowledge drill with timer + memory-item drill. Android multiple-choice generator lives in `feature-training` Kotlin — port pending export |
| Flashcards & study sessions | `flashcards/*.json` (15 decks, 177 cards, cited) | `flashcards`, `flashcards/:deck` | Available | Shuffle, flip, "review again" re-queue, per-deck best score |
| Limitations | `limitations/dhc6_limitations.json` | `limitations` | Available | Bands (red/amber/normal), conditions, notes, references |
| MEL | `mel/dhc6_mel_reference.json` | `mel` | Available | GO / GO with restriction / NO GO, placards, crew + maintenance actions, disclaimer |
| Performance calculator (takeoff / landing / VREF / speeds) | `performance/dhc6_performance_tables.json` | `performance` | Partial | Exact authored-table lookups only (seaplane, flaps 20°/37.5°, PA 0 ft, 28/30/32 °C), VREF by weight & flap, reference speeds & summary. The Android `engine` module's full calculator (landplane, elevation, wind, surface — as in the verified screenshot) is not in the JSON: **needs the Kotlin engine source** before it can be ported without guessing |
| Fuel planning | `calculators/dhc6_calc_data.json` (tanks, burn rates, reserve rule) | `fuel` | Partial | Reference data + endurance-to-reserve estimate labelled as training estimate; planner UI pending |
| Weight & balance | `calculators/dhc6_calc_data.json` | `wb` | Partial | Limits, datum, CG limits, standard weights/arms shown; interactive loading sheet pending |
| CAS / annunciator library | `cas-library/*_legacy.json`, `*_g950.json` | `cas` | Available | Follows the LEGACY/G950 variant chip |
| Maldives strips & operational reference | `strips/maldives_strips.json` (82 entries) | `strips` | Available | Search, runways, fuel, customs, ILS, notes, disclaimer |
| Debrief logbook | Local progress repository (Room) | `logbook` | Partial | Local attempts/scores in browser storage; cloud sync (Firebase progress repo) pending |
| Aircraft State scenarios & frozen cockpit snapshots | `scenario_snapshots.json` (78 procedures, 2 baselines), `bindings/*` hitboxes, `cockpit/**` (200 images, 22 MB) | `aircraft-state` | Later | Packs `scenario-snapshots`, `cockpit-bindings`, `canonical-items` already published; cockpit imagery must go to R2 (phase 5) |
| Legacy cockpit & G950 variants | variant envelopes in every procedure, CAS libraries | variant chip (top bar) + Settings | Available | Switching re-renders procedures/CAS for the selected cockpit |
| Knowledge & aircraft systems, 2D diagrams / PNG references | `systems/**` (50 files, 26 MB) | `knowledge` | Later | Needs R2 for images; system descriptions schema present |
| Manuals, documents, published library | `LibraryNavGraph`, `packs/`, content-pack manager | `documents` | Later | Requires document storage (R2) and a decision on which PDFs may be published to the web |
| Technical Lab & 3D models | `models/**` (120 files, 204 MB) | `technical-lab` | Later | Needs R2 + `<model-viewer>`/three.js; phase 7 |
| Premium AI oral exam | `/api/ai/oral-exam` (Firebase-token gated), `feature-ai` | `oral-exam` | Later | Needs a web-session-gated proxy variant + entitlement check; phase 7 |
| Check Ride Readiness / competency | evaluation + analytics repositories | `readiness` | Later | Depends on logbook cloud sync |
| Account, settings, admin, corporate | SettingsScreen, AdminDashboardScreen, corporate repos | `settings` (+ `access.html`) | Partial | Variant, theme, session, local data, licence management; admin/corporate later |
| Entitlement & access behaviour | AccessPolicy / ProtectedDestination (Play Billing) | Worker gate + session cookie | Available | Paddle licence or owner session; 12 h sessions, live re-validation, revocation |

## Open items that need Trevor's input

1. **Verified screenshot vs. current data** — the Performance screen in `assets/actual-android-app.jpeg` (airport elevation, OAT, weight, surface, flaps 10°) and the QRH categories it shows (e.g. "Pressurization") do not exist in the current `core-res` JSON, and its Engine Fire in Flight steps differ from `procedures/emergency/engine_fire_in_flight.json`. Please confirm which build the screenshot came from; the web app follows the JSON.
2. **Performance engine** — export the `engine` module Kotlin (`_web_export` command) so the landplane calculator can be ported 1:1 instead of the interim table lookups.
3. **Documents / 3D / images** — approve creating an R2 bucket (or reusing `DESKTOP_RELEASES` under a `web-content/` prefix) for cockpit imagery, systems PNGs, manuals and GLB models.
