# Android → web feature manifest

Source of truth: `TJAeronautical/DHC-6-Trainer` (private). Phase 2 was built from the exported Kotlin
sources (`_web_export`, 126 files) plus `core-res/src/main/assets`. Every screen listed as **Available**
is a port of the named Compose screen; its data comes from the protected content packs
(`tools/build-content.mjs` → KV `webcontent:*`), never from hand-typed values.

Status legend: **Available** = fully usable from Android data/logic · **Partial** = usable, port in progress ·
**Later** = present in Android, not yet in the browser · **Blocked** = needs an authoritative source or a decision.

## Navigation (PrimaryNavigation.kt / BottomNavBar.kt / AppNavigationRail.kt)

| Android | Web route | Notes |
| --- | --- | --- |
| HOME (Screen.Dashboard, `dashboard`) | `/app/#/dashboard` | Bottom nav on phones (`NavigationBar`, accent-sky selected state); 104 px rail with the `DHC-6 / TRAINER` header on ≥ 900 px |
| PROCS (Screen.Systems, `systems`) | `/app/#/systems` | ProcedureLibraryScreen |
| AIRCRAFT (Screen.Live, `live`) | `/app/#/live`, `/live/cockpit`, `/live/procedures`, `/scenario/*`, `/drill/run/:id` | CockpitHomeScreen, ScenarioProceduresScreen, ScenarioSelectorScreen, ScenarioStateScreen, FrozenSnapshotScreen, CockpitScreen, ScenarioDrillRunScreen |
| QRH (Screen.Qrh, `qrh`) | `/app/#/qrh`, `/qrh/category/:c`, `/qrh/detail/:id` | QrhHub / QrhList / QrhDetail |
| SETTINGS (`settings`) | `/app/#/settings` | SettingsScreen sections |
| Tab ownership | `owningTab()` in `app/js/core.js` | Same prefix rules as `owningPrimaryTab` (training/* → HOME, library/* + quizzes → PROCS, …) |

Theme: `app/app.css` transcribes `AviationColors.kt` (surface ramp, AccentSky, semantic ramp, drill surfaces,
tile blues), the day/night schemes from `DHC6TrainerTheme.kt` (night = true-dark canonical ramp; day = blue-derived
`#0E3A56` scheme), `LibraryTheme.kt` background (`lerp(lerp(bg, primaryContainer, .72), black, .10)` → `#062439` night /
`#082F49` day), `Typography.kt` (display 30/27/24 … label 13/12/11) and `Shapes.kt` (8/12/16/22/28).
Tile artwork is the real `core-res/drawable-nodpi` set converted to WebP (`app/assets/tiles`, 47 files, ≤ 960 px).
`procedure_tile_takeoff.webp` was removed in phase 4a: it is a watermarked Getty Images comp of an A340 — see
"Assumptions to confirm" §5.

## Screens

| Android screen | Web module (`/app/#/…`) | Status | What is ported |
| --- | --- | --- | --- |
| DashboardScreen + DashboardViewModel | `dashboard` | Available | Change-variant button (LEGACY → G950 → BOTH cycle + toast), Dashboard card with Procedures / Aircraft State / Library buttons, recommended next procedure, 13 Quick Launch image tiles (2 per row, 4 on desktop), Training Signals (`computeInsights` port), Reference Color Guide |
| ProcedureLibraryScreen | `systems` | Available | Search over name/steps/references, ALL/NORMAL/ABNORMAL/EMERGENCY pills, pinned filter (local), normal sub-sections DAILY / TEST / WX-SPECI with counts and section headers, category/bucket/memory/MCC/critical/readiness badges, tile art from `procedureTileImageRes`, PIN and → drill launch |
| QrhHubScreen | `qrh` | Available | Copy, category chip row, three hero cards (`procedure_tile_qrh/abnormal/emergency`), status badges |
| QrhListScreen (+ ProcedureSortOrder, ProcedureTitleFormatter) | `qrh/category/:c` | Available | Search, ordering by the Excel index rank parsed from `ProcedureSortOrder.kt`, then title / variant / id; Memory n / QRH n pills; tile art table |
| QrhDetailScreen + QrhProcedureMapper | `procedures/detail/:id`, `qrh/detail/:id` | Available | Condition / Trigger, Memory Items, Complete QRH Checklist panels with the exact `formatProcedureStep` line format, Edit QRH lock message, notes |
| ProcedureDrillPane | inside procedure detail | Available | MEMORY (tap-to-reveal, GOT IT / MISSED, scored strip) → FLOW (tap-to-check rows with role / CRITICAL / CALLOUT pills) → SUMMARY (score cards, missed review, restart); result mapped by `ProcedureDrillLogbookMapper` into the local logbook |
| QuizHomeScreen / QuizRunScreen / QuizLogbookMapper | `quizzes`, `quizzes/run/:variant/:length?sys=` | Available | Candidate pool = `knowledge-pool` pack (BundledFlashcardSeeder units + quiz_bank), `buildQuiz` / `chooseQuizDistractors` / snippet rules ported 1:1, A–D options, Grade → Next, result summary with missed items, Save & exit → logbook |
| PerformanceCalcScreen / PerformanceCalculator | `training/performance` | Available | Weight + OAT sliders (table bounds), VREF flap chips, bilinear take-off / landing interpolation, VREF interpolation, reference speeds, performance summary, sources & notes — all from `performance/dhc6_performance_tables.json` |
| FuelPlanScreen / FuelPlanCalculator | `training/fuel-plan` | Available | Flight time / alternate / contingency / fuel-on-board sliders, trip / reserve / taxi / total / margin rows, tank split, warnings and notes |
| WeightBalanceScreen / WeightBalanceCalculator | `training/weight-balance` | Available | APS/DOW + DOI entry, crew slider, 5 × 3 seat map (Empty → M → F → C → FI), baggage and fuel sliders, CG arm / %MAC / moment, SVG CG envelope chart (POH Fig 2-2 geometry), warnings and notes |
| GlossaryScreen (Definitions) | `knowledge/definitions` | Available | 32 entries parsed from the Kotlin literals into the `glossary` pack; search; tap an entry to filter |
| StudyHomeScreen | `knowledge/home` | Partial | Variant bubble, Search / Library / Knowledge sections with the Android tiles and copy; tiles carry status pills |
| SrsStudyScreen / SpacedRepetitionEngine | `study/srs` | Available | SM-2 engine, session builder (20 cards, ≤ 8 new), flip card, Again → Perfect rating row, completion stats; records persist per browser |
| FlashcardsScreen (Study Card Review) | `study/flashcards`, `study/flashcards/:deck` | Partial | Read-only deck / card browser (13 decks · 157 cards — the two decks whose JSON fails the Android `FlashcardDeck` model are skipped for parity). Review / Approved / Delete lanes and editing are authoring tools and stay app-only |
| LimitationsScreen | `study/limitations` | Available | Section tabs, band-coloured limit cards, engine parameter tables, VREF table |
| MelReferenceScreen | `study/mel-reference` | Available | Search, GO / GO WITH RESTRICTION / NO GO pills, placards, crew and maintenance actions |
| MaldivesStripsScreen (Aerodromes & Waterways) | `study/maldives-strips` | Available | Search, operating notes, 82 entries |
| CAS library (web-only presentation of `cas-library/*`) | `study/cas` | Available | Warning / caution / advisory lists for the selected variant |
| KnowledgeSearchScreen | `knowledge/search` | Partial | Searches knowledge units, procedure steps and definitions; published-library search comes with the Library phase |
| LogbookScreen | `training/logbook` | Partial | Local entries only (procedure drills + quizzes); Android cloud logbook sync later |
| CockpitHomeScreen (Aircraft State) | `live` | Available | Entry cards, resume, variant badge, Day-to-Day Operations and free-play cockpit launchers |
| ScenarioProceduresScreen | `live/procedures` | Available | Six entry contexts (`ScenarioEntryContext`), per-context procedure lists built from the `procedures-index` pack with the Android `matchesContext` / `matchesBucket` / `matchesSearch` rules, bucket pills, search, tile art (`scenarioContextDrawableRes`) |
| ScenarioSelectorScreen | `scenario/select/:id` | Available | `allowedScenarioContextsForProcedure`, `ScenarioLaunchPreset` notes and focus targets |
| ScenarioStateScreen | `scenario/state/:id/:phase` | Available | BEFORE / DURING / AFTER phase switch, resolved snapshot counts, frozen plate preview, launcher for drill list, MCC flow, cockpit entry and phase review |
| FrozenSnapshotScreen | `scenario/focus/:id/:phase` | Available | Focus-target regions highlighted on the plate, scrim, humanized annunciator / instrument / control review |
| CockpitScreen (free play + scenario run) | `live/cockpit`, `scenario/run/:id/:phase` | Available | Canonical plate render (LEGACY 3748 × 5276 / G950 3744 × 5276 contain-fit), 125 hitboxes, control sprites from the packed atlas, gauges, annunciator lamps, master WARNING/CAUTION, G950 PFD/CAS/MFD, pan / pinch / wheel zoom, tap-to-toggle switches, lever drag with the Android gate bands, live `EngineSystemsModel` at 30 Hz, `FailureStateEvaluator` → `CasSystem` indications HUD |
| ScenarioDrillRunScreen (memory + MCC flow) | `drill/run/:id?preset=` | Available | `DrillStepEvaluator` port: expected cockpit targets per step, Next locked until the control is in the required position, already-correct confirm, wrong-role / callout / timing counters, the Android score table (−20 / −15 / −10 / −3), score band, instructor feedback and the logbook entry; MCC flow adds Web Speech callouts |
| LibraryHubScreen | `library/home` (+ sources / import / published) | Partial / Later | Read-only hub; storage decision pending |
| CompetencyDashboardScreen, OralExamScreen, CrmDrillScreen | `training/competency-dashboard`, `training/oral-exam`, `training/crm-drill` | Later | Explained on-screen |
| SystemsLabHomeScreen (Systems Lab) | `systems/lab` | Available | Full-aircraft explorer (`DHC6WHEELS.glb`, orbit / pinch, the 7 Android exterior hotspots projected from the bounding box, internal-system chips), Aircraft / My Notes lanes, all-systems grid with model size / publish status, component-replica row |
| SystemsLabDetailScreen + SystemsLabSection + SystemsLab3dViewerCard (Technical Lab) | `systems/lab/:system` | Available | 16 systems × 21 models (18 `DHC6_REFERENCE_LIBRARY/System-Lab` replicas + 3 Android-bundled models for electrical / pitot-static / environmental): live controls + readout (`labSimulation` port with the authored fault branches and normal-state templates), 3D card with model chips, numbered pins (Android `LabPart`s mapped to the real node names via `tools/data/systems-lab-models.json`, plus model-only groups), highlight / isolate / wireframe / reset / auto-rotate, embedded animation clips grouped and scrubbable, archived-part toggle, tap-to-identify nodes, selected-pin card with per-part study notes (local), fault mode with the fault simulation card, drill cue + training bridge, action cards (QRH / Flashcards / Procedures / Quiz). Models stream from the protected media API and are cached per browser until sign-out. Not ported: Android's procedural exploded view, the retired Open/Normal/Reverse governor states, the Android bleed-valve piston travel, poster "Reference:" bubbles (posters not yet published) |
| AircraftSystemsHome / SystemDetailScreen (Knowledge → Systems) | `systems/home` | Later | 22 `systems/*.json` descriptions + 27 posters; needs the poster media publish (same `/api/media` path as the models) |
| SettingsScreen | `settings` | Available | Account, Plan, Offline Access (+ refresh / clear local progress), Procedure Packs (later), Display (Dark Mode), Audio, Help, Privacy, Cockpit Mode variant selector |

## Content packs (all derived from the private repo; never committed)

| Pack | Source | Consumers |
| --- | --- | --- |
| `procedures-index`, `procedures-normal/-abnormal/-emergency` | `procedures/**` (+ `procedureName`, `displayTitle`, `compiledId`, `qrhRank`, `normalBucket` computed from `ProcedureSortOrder.kt`, `ProcedureTitleFormatter.kt`, `ProcedureLibraryScreen.kt`) | PROCS, QRH, procedure detail, search |
| `knowledge-pool` (new) | flashcards (BundledFlashcardSeeder mapping) + `quizzes/quiz_bank.json` | Quizzes, SRS study, search |
| `glossary` (new) | `GlossaryScreen.kt` literals | Definitions, search |
| `flashcards` | `flashcards/*.json` (Android-valid decks only) | Study Card Review |
| `performance` | `performance/dhc6_performance_tables.json` + `calculators/dhc6_calc_data.json` | Performance |
| `limitations`, `mel`, `maldives-strips`, `cas-library` | as before | Study screens |
| `cockpit-bindings`, `scenario-snapshots`, `canonical-items`, `quiz-bank` | as before | Aircraft State (bindings + snapshots), reference |
| `cockpit-plates` (new) | `tools/build-cockpit.mjs` over `core-res/src/main/assets/cockpit` (hitboxes, `source_exact` sprite families, instruments, annunciators, plates) | Aircraft State cockpit render |
| `systems-lab` (new) | `SystemsLabSection.kt` (definitions, parts, faults, `labSimulation` branches / templates, training bridges, short titles, lever defaults), `SystemsLabHomeScreen.kt` (explorer lists, hotspots), `AircraftSystem.kt` (display titles) + `tools/data/systems-lab-models.json` (GLB registry: file, sha256, node-name selectors per part, hidden archive groups, clip groups) | Systems Lab home + Technical Lab |

### Protected media (new)

| Path (`/api/media/<path>`) | Store | Source |
| --- | --- | --- |
| `models/systems-lab/<FILE>.glb` × 21 | R2 bucket `dhc6-web-media` (binding `WEB_MEDIA`) — two files exceed the 25 MiB KV value limit | `C:\Android Studio\DHC6_REFERENCE_LIBRARY\System-Lab` (18) + `core-res/…/models/systems_lab/models` (3) |
| `cockpit/plates/{legacy,g950}.webp` | R2 bucket `dhc6-web-media` | `tools/build-cockpit.mjs` (canonical plate downscaled to 2000 px wide) |
| `cockpit/atlas/{legacy,g950}.webp` | R2 bucket `dhc6-web-media` | `tools/build-cockpit.mjs` (shelf-packed sprite / instrument / annunciator atlas, trimmed to opaque bounds) |
| `webmedia:index` | KV (`LICENSES`) | `tools/build-media.mjs` |

The cockpit plate and atlas are **protected training content**: they are never committed to this
public repo, `/live.html` loads the legacy plate through `/api/media/cockpit/plates/legacy.webp`, and
`app/js/cockpit.js` drops both the decoded bitmaps and the `dhc6-media-v1` cache entries on 401/403.

Publish: `node tools/build-cockpit.mjs --android "…\DHC-6-Trainer" --out build\cockpit` first (it writes
`build/cockpit/cockpit-pack.json`, consumed by `build-content.mjs`, and `build/cockpit/media`, picked up by
`build-media.mjs --extra-media`), then `node tools/build-media.mjs --reference "…\System-Lab" --android "…\DHC-6-Trainer" --out build\media`, then run `build\media\upload-media.ps1` and the `kv bulk put` line it prints (see `WEB_APP_SECURITY.md` §4b).

Build: `node tools/build-content.mjs --android "C:\Android Studio\DHC-6-Trainer" --out build\content`
(the Kotlin sources are read from the module tree; add `--kotlin <dir>` when only a flattened export is available).

## Assumptions to confirm

1. **SRS / quiz pool for a specific variant** — `KnowledgeRepository.listByStatusTag(variant, …)` is not in the export. The web
   treats a LEGACY/G950 selection as "own rows + shared BOTH rows" (otherwise every bundled deck, all `BOTH`, would vanish).
2. **QRH line text** — the Kotlin `cleanQrhLine` strips only the leading `PF `/`PM ` token, so Android shows lines as
   `— Fuel lever OFF • ANNOUNCE • CONFIRM`; the web reproduces that verbatim. If you would rather see the clean action
   text, it is a one-line change in both apps.
3. **`intent` field** — the procedure JSON carries no `intent`, so every step defaults to `ANNOUNCE` (Moshi default), which
   is why every flow row shows the CALLOUT pill. Same as Android.
4. **Verified screenshot** — `assets/actual-android-app.jpeg` shows a bottom bar and a landplane performance screen that
   do not exist in the exported Kotlin (bottom bar is HOME / PROCS / AIRCRAFT / QRH / SETTINGS; the performance
   calculator is the seaplane QRH table set). The web follows the Kotlin.
5. **Stock tile art** — `procedure_tile_takeoff.webp` carried a visible *gettyimages* watermark (and showed an
   Airbus A340, not a DHC-6). It was deleted from this repo and the Takeoff / Initial Climb context now uses
   `procedure_tile_takeoff_custom.webp`. The remaining tiles are unwatermarked airliner stock photos carried over
   from the Android bundle — **confirm you hold a licence for them**, and replace the watermarked file in the
   Android app too.
6. **Documented Android deviation (cockpit)** — the Android snapshot renderer paints the master WARNING and
   CAUTION lamp artwork unconditionally (QUIRK-3). The web paints them only when lit, so an unlit cockpit does not
   show two permanently glowing masters. Every other documented quirk (QUIRK-1, 2, 4, 5, 6, 7 and the missing
   `switch_button` family, G1) is reproduced exactly and covered by `tests/cockpit.test.mjs`.
