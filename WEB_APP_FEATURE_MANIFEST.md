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
| AIRCRAFT (Screen.Live, `live`) | `/app/#/live` | CockpitHomeScreen structure, marked Later |
| QRH (Screen.Qrh, `qrh`) | `/app/#/qrh`, `/qrh/category/:c`, `/qrh/detail/:id` | QrhHub / QrhList / QrhDetail |
| SETTINGS (`settings`) | `/app/#/settings` | SettingsScreen sections |
| Tab ownership | `owningTab()` in `app/js/core.js` | Same prefix rules as `owningPrimaryTab` (training/* → HOME, library/* + quizzes → PROCS, …) |

Theme: `app/app.css` transcribes `AviationColors.kt` (surface ramp, AccentSky, semantic ramp, drill surfaces,
tile blues), the day/night schemes from `DHC6TrainerTheme.kt` (night = true-dark canonical ramp; day = blue-derived
`#0E3A56` scheme), `LibraryTheme.kt` background (`lerp(lerp(bg, primaryContainer, .72), black, .10)` → `#062439` night /
`#082F49` day), `Typography.kt` (display 30/27/24 … label 13/12/11) and `Shapes.kt` (8/12/16/22/28).
Tile artwork is the real `core-res/drawable-nodpi` set converted to WebP (`app/assets/tiles`, 48 files, ≤ 960 px).

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
| CockpitHomeScreen (Aircraft State) | `live` | Later | Structure and copy in place; needs cockpit imagery in R2 (phase 5) |
| LibraryHubScreen | `library/home` (+ sources / import / published) | Partial / Later | Read-only hub; storage decision pending |
| CompetencyDashboardScreen, OralExamScreen, CrmDrillScreen | `training/competency-dashboard`, `training/oral-exam`, `training/crm-drill` | Later | Explained on-screen |
| AircraftSystemsHome / SystemsLabHome | `systems/home`, `systems/lab` | Later | Need R2 imagery / GLB models |
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
| `cockpit-bindings`, `scenario-snapshots`, `canonical-items`, `quiz-bank` | as before | reserved / reference |

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
