/*
  Study / Knowledge screens — ports of feature-knowledge/ui/screens:
    StudyHomeScreen, GlossaryScreen (Definitions), SrsStudyScreen (Flashcard Study),
    LimitationsScreen, MelReferenceScreen, MaldivesStripsScreen (Aerodromes & Waterways),
    KnowledgeSearchScreen, plus the web-only CAS library and deck browser.
*/
import { h, Store, Content, currentVariant, variantLabel, nextVariant, feature } from "../core.js";
import { screen, blueCard, libraryDivider, featureTile, bubble, backBubble, backText, searchField, notice, contentUnavailable, statusPill, matButton, withSearchFocus } from "../ui.js";
import { knowledgePool, allProcedures } from "../data.js";
import * as SRS from "../logic/srs.js";
import { formatProcedureDisplayTitle } from "../logic/procedures.js";
import { docHref, decodeHeaderText } from "./library.js";

function variantHeader(ctx) {
  const v = currentVariant();
  return [
    bubble("light", "Variant", { onClick: function () { Store.set("variant", nextVariant(v)); ctx.applyPrefs(); ctx.rerender(); } }),
    h("span", { class: "t-title-m w-semi", style: "color:rgba(255,255,255,.92);padding-left:10px", text: "Variant: " + variantLabel(v) })
  ];
}

/* ------------------------------------------------------------ Study home */
export async function studyHome(ctx) {
  ctx.setTopbar({ title: "Study", subtitle: "Knowledge · Library · Search" });
  let dueCount = 0;
  try { dueCount = SRS.dueCount(await knowledgePool(), Store.srsRecords(), currentVariant()); } catch (e) { dueCount = 0; }
  const K = "var(--tile-knowledge)", L = "var(--tile-library)", S = "var(--tile-search)";
  const study = function (t) { return featureTile(t, "study h-124"); };
  return screen({ title: "Study", library: true, header: variantHeader(ctx) }, [
    h("p", { class: "t-body-m clamp-4", text: "Search is first for quick lookup. Library contains sources, while Knowledge separates Systems, 3D Technical Lab, flashcards and definitions." }),
    h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }),
    blueCard([h("div", { class: "t-title-m w-bold", text: "Search" }), h("div", { class: "mt-10" }, study({ title: "Search", subtitle: "Find study items across systems, flashcards, source references, and published knowledge.", art: "dhc6_tile_safety", color: S, href: "#/knowledge/search", status: feature("search").status }))]),
    h("div", { class: "mt-4" }),
    blueCard([h("div", { class: "t-title-m w-bold", text: "Library" }), h("div", { class: "grid-2 mt-10" }, [
      study({ title: "Sources", subtitle: "Manuals, imported PDFs, images, extraction review, and publishing sources.", art: "dhc6_tile_apron_departure", color: L, href: "#/library/sources", status: feature("library").status }),
      study({ title: "Import", subtitle: "Protected document import for authorised content accounts.", art: "procedure_tile_qrh", color: L, href: "#/library/import", status: feature("import").status })
    ])]),
    h("div", { class: "mt-4" }),
    blueCard([h("div", { class: "t-title-m w-bold", text: "Knowledge" }), h("div", { class: "grid-2 wide-3 mt-10" }, [
      study({ title: "Systems", subtitle: "2D system diagrams, PNG references, system notes, aircraft manual structure, limitations and operations references.", art: "dhc6_tile_cockpit_panel", color: K, href: "#/systems/home", status: "available" }),
      /* Hardcoded "later" here while the registry and the dashboard both called
         it available: the Study home was telling a subscriber a finished,
         shipped screen was not built yet. Read the status, do not restate it. */
      study({ title: "Technical Lab", subtitle: "3D model lab only: PT6, propeller, hydraulic pack and aircraft variant models with part highlights.", art: "system_lab_tile", color: K, href: "#/systems/lab", status: feature("technical-lab").status }),
      study({ title: "Definitions", subtitle: "Acronyms used in the app: MCC, CRM, QRH, AFM, POH, MEL, MMEL, SOP, CAS, SRS, ATA and more.", art: "dhc6_tile_safety", color: K, href: "#/knowledge/definitions" }),
      study({ title: "Flashcards", subtitle: "Q&A, image cards, and memory prompts from the published study library.", art: "dhc6_tile_engine_cutaway", color: K, href: "#/study/flashcards", status: feature("study-cards").status }),
      study({ title: "SRS Study", subtitle: dueCount > 0 ? dueCount + " card" + (dueCount === 1 ? "" : "s") + " due today. Review with 1-5 recall scoring." : "No due cards right now. Open the SRS queue to review new study cards.", art: "dhc6_tile_safety", color: K, href: "#/study/srs" }),
      study({ title: "Limitations", subtitle: "Airspeeds, PT6A-27 limits, weights, and operations reminders for check-ride study.", art: "procedure_tile_qrh", color: "var(--emergency-red-dark)", href: "#/study/limitations" }),
      study({ title: "Performance", subtitle: "Seaplane take-off, landing, VREF, and key reference speeds from the bundled QRH tables.", art: "dhc6_tile_safety", color: "var(--caution-amber-dark)", href: "#/training/performance" }),
      study({ title: "MEL / CDL", subtitle: "Training reference for deferred defects, categories, placards, and dispatch restrictions.", art: "procedure_tile_qrh", color: L, href: "#/study/mel-reference" }),
      study({ title: "Aerodromes & Waterways", subtitle: "Training reference for DHC-6-relevant aerodromes, water aerodromes, and waterways beyond Maldives.", art: "dhc6_tile_apron_departure", color: S, href: "#/study/maldives-strips" }),
      study({ title: "CAS Library", subtitle: "Legacy and G950 warning / caution / advisory message library for the selected variant.", art: "dhc6_tile_cockpit_panel", color: K, href: "#/study/cas" })
    ])])
  ]);
}

/* ------------------------------------------------------------ Definitions */
const glossaryState = { query: "" };
export async function definitions(ctx) {
  ctx.setTopbar({ title: "Definitions", subtitle: "Acronyms and meanings", back: "#/knowledge/home" });
  let pack;
  try { pack = await Content.pack("glossary"); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Definitions", library: true, header: [backBubble("#/knowledge/home")] }, [contentUnavailable("glossary", error)]); }
  const entries = pack.entries || [];
  const root = h("div", { class: "stack-12" });
  function render() {
    const q = glossaryState.query.trim().toLowerCase();
    const filtered = !q ? entries : entries.filter(function (e) { return e.acronym.toLowerCase().includes(q) || e.definition.toLowerCase().includes(q) || e.note.toLowerCase().includes(q); });
    const cards = filtered.map(function (e) {
      return blueCard([
        h("div", { class: "t-title-l w-bold clamp-1", text: e.acronym }),
        h("div", { class: "t-title-s w-semi clamp-2 mt-4", text: e.definition }),
        h("div", { class: "t-body-m clamp-5 mt-4", text: e.note })
      ], { onClick: function () { glossaryState.query = e.acronym; render(); } });
    });
    if (!filtered.length) cards.push(blueCard([h("div", { class: "t-title-s w-bold", text: "No matching definition" }), h("div", { class: "t-body-m mt-4", text: "Try searching an acronym such as CRM, MCC, QRH, AFM, POH, MEL, CAS or SRS." })]));
    withSearchFocus(root, function () {
      root.replaceChildren(
        searchField("Search definitions", glossaryState.query, function (v) { glossaryState.query = v; render(); }),
        h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }),
        h("div", { class: "stack-12" }, cards)
      );
    });
  }
  render();
  return screen({ title: "Definitions", library: true, header: [backBubble("#/knowledge/home"), bubble("light", "Terms", { count: entries.length })] }, [
    blueCard([h("div", { class: "t-title-m w-bold clamp-1", text: "Definitions and acronyms" }), h("div", { class: "t-body-m clamp-4 mt-4", text: "Quick plain-language meanings for abbreviations used around the dashboard, QRH, Systems, Technical Lab and training screens." })]),
    h("div", { class: "mt-4" }),
    root
  ]);
}

/* ------------------------------------------------- Flashcard Study (SRS) */
export async function srsStudy(ctx) {
  ctx.setTopbar({ title: "Flashcard Study", subtitle: "Spaced repetition (SM-2)", back: "#/knowledge/home" });
  let units;
  try { units = await knowledgePool(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Flashcard Study", library: true, header: [backBubble("#/knowledge/home")] }, [contentUnavailable("knowledge-pool", error)]); }
  const queue = SRS.buildSession(units, Store.srsRecords(), currentVariant());
  const session = { reviewed: 0, passed: 0, failed: 0, current: null, flipped: false };
  const root = h("div", { class: "stack-12" });

  function next() {
    if (!queue.length) { session.current = null; render(); return; }
    session.current = queue.shift();
    session.flipped = false;
    render();
  }
  function rate(quality) {
    const card = session.current;
    const updated = SRS.review(card.record, quality);
    Store.saveSrsRecord(updated);
    session.reviewed += 1;
    if (quality >= 3) session.passed += 1; else session.failed += 1;
    if (quality < 3 && queue.length < SRS.MAX_SESSION_CARDS) queue.push({ unit: card.unit, record: updated, isNew: false });
    next();
  }
  function render() {
    const nextDue = SRS.nextDueDays(Store.srsRecords());
    if (!session.current) {
      if (session.reviewed === 0) {
        root.replaceChildren(h("div", { class: "stack-12 center", style: "padding:32px 0" }, [
          h("div", { class: "t-headline-s w-bold", text: "All caught up!" }),
          h("p", { class: "t-body-m c-sec", text: "All caught up! No cards due for review right now." }),
          nextDue != null ? h("p", { class: "t-body-s c-ter", text: "Next cards due in " + nextDue + " day" + (nextDue === 1 ? "" : "s") }) : null,
          matButton("Done", function () { ctx.navigate("/knowledge/home"); })
        ]));
        return;
      }
      const passRate = session.reviewed ? Math.round((session.passed / session.reviewed) * 100) : 0;
      root.replaceChildren(h("div", { class: "stack-12 center", style: "padding:24px 0" }, [
        h("div", { class: "t-headline-s w-bold", text: "Session Complete" }),
        h("div", { class: "equal-row gap-10" }, [stat("Reviewed", session.reviewed), stat("Passed", session.passed, "var(--sem-normal)"), stat("Again", session.failed, "var(--sem-emergency)"), stat("Pass rate", passRate + "%")]),
        h("p", { class: "t-body-m c-sec", text: passRate >= 90 ? "Excellent recall. Keep the streak going." : passRate >= 70 ? "Good session. Repeat the Again cards tomorrow." : "Tough session — the missed cards come back tomorrow." }),
        session.failed ? h("p", { class: "t-body-s c-ter", text: session.failed + " card" + (session.failed === 1 ? "" : "s") + " marked Again and re-scheduled for tomorrow." }) : null,
        matButton("Done", function () { ctx.navigate("/knowledge/home"); })
      ]));
      return;
    }
    const card = session.current;
    const total = session.reviewed + queue.length + 1;
    const systemLabel = String(card.unit.system || "").replace(/_/g, " ").toLowerCase().replace(/\b\w/g, function (c) { return c.toUpperCase(); });
    root.replaceChildren(h("div", { class: "stack-12" }, [
      h("div", { class: "row between" }, [h("span", { class: "t-body-s c-sec", text: session.reviewed + " done" }), h("span", { class: "t-body-s c-sec", text: (total - session.reviewed) + " remaining" })]),
      h("div", { class: "progress-outer", style: "height:5px;border-radius:999px;background:var(--hairline);overflow:hidden" }, h("div", { style: "height:100%;width:" + ((session.reviewed / total) * 100).toFixed(1) + "%;background:var(--accent-sky)" })),
      h("div", { class: "t-label-m c-sec", text: systemLabel + (card.isNew ? "  •  NEW" : "") }),
      h("button", { class: "flip-card", type: "button", onclick: function () { if (!session.flipped) { session.flipped = true; render(); } } }, [
        h("div", { class: "t-title-l w-semi", text: card.unit.title }),
        session.flipped ? h("div", { class: "answer t-body-l", text: card.unit.content }) : h("div", { class: "t-body-s c-ter", text: "Tap to reveal" })
      ]),
      !session.flipped ? matButton("Show Answer", function () { session.flipped = true; render(); }, { block: true }) : h("div", { class: "stack-8" }, [
        h("div", { class: "t-body-s c-sec center", text: "How well did you recall this?" }),
        h("div", { class: "equal-row gap-6" }, SRS.QUALITY_BUTTONS.map(function (b) {
          return h("button", { class: "quality-btn " + b.tone, type: "button", onclick: function () { rate(b.quality); } }, [h("span", { text: b.label }), h("small", { text: b.sublabel })]);
        }))
      ])
    ]));
  }
  function stat(label, value, color) { return h("div", { class: "stat-block" }, [h("span", { class: "t-label-s c-sec", text: label }), h("span", { class: "t-headline-s w-bold", style: color ? "color:" + color : "", text: String(value) })]); }
  next();
  return screen({ title: "Flashcard Study", library: true, header: [backBubble("#/knowledge/home")] }, [root]);
}

/* ---------------------------------------------- Study Card Review (decks) */
export async function deckBrowser(ctx) {
  ctx.setTopbar({ title: "Study Card Review", subtitle: "Bundled flashcard decks", back: "#/knowledge/home" });
  let pack;
  try { pack = await Content.pack("flashcards"); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Study Card Review", library: true, header: [backBubble("#/knowledge/home")] }, [contentUnavailable("flashcards", error)]); }
  const deckId = ctx.params.deck;
  const decks = pack.decks || [];
  if (deckId) {
    const deck = decks.find(function (d) { return d.deckId === deckId; });
    if (!deck) return screen({ title: "Study Card Review", library: true, header: [backBubble("#/study/flashcards")] }, [notice("Deck not found.", "warn")]);
    ctx.setTopbar({ title: deck.deckName, subtitle: deck.cards.length + " cards", back: "#/study/flashcards" });
    return screen({ title: deck.deckName, library: true, header: [backBubble("#/study/flashcards"), bubble("light", "Cards", { count: deck.cards.length })] }, [
      h("p", { class: "t-body-m", text: deck.description || "" }),
      h("div", { class: "stack-10" }, deck.cards.map(function (card) {
        return blueCard([
          h("div", { class: "t-title-m w-semi", text: card.front }),
          h("div", { class: "t-body-m mt-6", text: card.back }),
          card.references && card.references.length ? h("div", { class: "t-label-s c-ter mt-6", text: card.references.map(function (r) { return (r.source ? r.source + " " : "") + (r.locator || ""); }).join(" · ") }) : null
        ]);
      }))
    ]);
  }
  return screen({ title: "Study Card Review", library: true, header: [backBubble("#/knowledge/home"), bubble("light", "Decks", { count: decks.length })] }, [
    h("div", { class: "row wrap gap-8" }, [statusPill("partial"), h("span", { class: "t-body-s c-sec", text: "Read-only browse of the bundled decks. Review / Approved / Delete lanes and card editing are authoring tools that stay in the Android app." })]),
    h("div", { class: "stack-10" }, decks.map(function (d) {
      return blueCard([
        h("div", { class: "t-title-m w-semi clamp-2", text: d.deckName }),
        h("div", { class: "t-body-s clamp-4 mt-6", text: d.description || "" }),
        h("div", { class: "row wrap gap-8 mt-6" }, [h("span", { class: "pill info", text: d.cards.length + " cards" }), h("span", { class: "pill info", text: String(d.system || d.systemId || "").replace(/_/g, " ") }), d.difficulty ? h("span", { class: "pill info", text: d.difficulty }) : null])
      ], { href: "#/study/flashcards/" + encodeURIComponent(d.deckId) });
    }))
  ]);
}

/* ------------------------------------------------------------ Limitations */
const limitTabs = { selected: 0 };
export async function limitations(ctx) {
  ctx.setTopbar({ title: "Limitations", subtitle: "DHC-6 Series 300", back: "#/knowledge/home" });
  let data;
  try { data = (await Content.pack("limitations")).data; } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Limitations", library: true, header: [backBubble("#/knowledge/home")] }, [contentUnavailable("limitations", error)]); }
  const sections = data.sections || [];
  const root = h("div", { class: "stack-12" });
  function bandColor(band) { return band === "red" ? "var(--sem-emergency)" : band === "amber" || band === "caution" ? "var(--sem-caution)" : "var(--sem-normal)"; }
  function limitCard(item) {
    const color = bandColor(item.band);
    return h("div", { class: "blue-card", style: "border-color:" + color + "80" }, [
      h("div", { class: "row top between gap-12" }, [
        h("div", { class: "grow" }, [
          h("div", { class: "row gap-8" }, [h("span", { style: "width:10px;height:10px;border-radius:50%;background:" + color + ";flex:0 0 auto", "aria-hidden": "true" }), h("span", { class: "t-title-m w-semi", text: item.label })]),
          item.condition ? h("div", { class: "t-body-s c-sec mt-4", text: item.condition }) : null
        ]),
        h("div", { class: "center", style: "flex:0 0 auto" }, [h("div", { class: "t-title-l w-xbold", style: "color:" + color, text: item.value || "" }), item.valueSub ? h("div", { class: "t-body-s", style: "color:" + color + ";opacity:.8", text: item.valueSub }) : null])
      ]),
      item.note ? h("div", { class: "t-body-s mt-8", text: item.note }) : null,
      item.reference ? h("div", { class: "t-label-s c-ter mt-4", text: item.reference }) : null
    ]);
  }
  function engineCard(item) {
    const color = bandColor(item.band);
    return h("div", { class: "blue-card", style: "border-color:" + color + "80" }, [
      h("div", { class: "t-title-m w-semi", text: item.label }),
      h("div", { class: "table-wrap mt-8" }, h("table", { class: "data" }, [
        h("thead", {}, h("tr", {}, [h("th", { text: "Parameter" }), h("th", { text: "Limit" }), h("th", { text: "" })])),
        h("tbody", {}, (item.params || []).map(function (p) { return h("tr", {}, [h("td", { text: p.name }), h("td", { class: "w-bold", style: "color:" + color, text: p.value }), h("td", { class: "c-sec", text: p.sub || "" })]); }))
      ])),
      item.note ? h("div", { class: "t-body-s mt-8", text: item.note }) : null
    ]);
  }
  function vrefCard(section) {
    const t = section.table;
    return h("div", { class: "stack-12" }, [
      section.note ? blueCard([h("div", { class: "t-body-s c-sec", text: section.note })]) : null,
      blueCard([
        h("div", { class: "t-title-m w-bold", text: "VREF (KIAS) — By Weight and Flap Setting" }),
        h("div", { class: "table-wrap mt-8" }, h("table", { class: "data" }, [
          h("thead", {}, h("tr", {}, [h("th", { text: "Flaps" })].concat(t.weights_lb.map(function (w) { return h("th", { text: (w / 1000) + "k" }); })))),
          h("tbody", {}, t.rows.map(function (r) { return h("tr", {}, [h("td", { class: "w-bold", text: r.flaps + "°" })].concat(r.values.map(function (v) { return h("td", { text: String(v) }); }))); }))
        ])),
        h("div", { class: "t-label-s c-ter mt-8", text: "Source: " + (section.reference || data.source) })
      ])
    ].concat((section.items || []).map(limitCard)));
  }
  function render() {
    const section = sections[limitTabs.selected] || sections[0];
    const tabs = h("div", { class: "row gap-6", role: "tablist", style: "overflow-x:auto;padding-bottom:4px" }, sections.map(function (s, i) {
      return h("button", { class: "chip" + (i === limitTabs.selected ? " selected" : ""), type: "button", role: "tab", "aria-selected": i === limitTabs.selected ? "true" : "false", text: s.title.replace(/ Limitations| Limits.*$/i, "").replace(/ \(KIAS\)/, ""), onclick: function () { limitTabs.selected = i; render(); } });
    }));
    let body;
    if (section.table) body = vrefCard(section);
    else if (section.id === "engine") body = h("div", { class: "stack-12" }, (section.items || []).map(engineCard).concat(section.footer_notes && section.footer_notes.length ? [blueCard([h("div", { class: "t-title-s w-bold", text: "Additional Notes" })].concat(section.footer_notes.map(function (n, i) { return h("div", { class: "row top gap-8 mt-6" }, [h("span", { class: "t-body-s c-sec", text: (i + 1) + "." }), h("span", { class: "t-body-s", text: n })]); })))] : []));
    else body = h("div", { class: "stack-12" }, (section.items || []).map(limitCard).concat([h("div", { class: "t-label-s c-ter", text: "Reference: " + (section.reference || "") })]));
    root.replaceChildren(tabs, body);
  }
  render();
  return screen({ title: "Limitations", library: true, header: [backBubble("#/knowledge/home")] }, [
    blueCard([h("div", { class: "t-title-m w-bold", text: "DHC-6 Series 300" }), h("div", { class: "t-body-s c-sec mt-4", text: "Source: " + data.source })]),
    root
  ]);
}

/* ------------------------------------------------------------- MEL / CDL */
const melState = { query: "" };
export async function melReference(ctx) {
  ctx.setTopbar({ title: "MEL/CDL Reference", subtitle: "Training reference", back: "#/knowledge/home" });
  let data;
  try { data = (await Content.pack("mel")).data; } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "MEL/CDL Reference", library: true, header: [backText("#/knowledge/home")] }, [contentUnavailable("mel", error)]); }
  const root = h("div", { class: "stack-12" });
  const goTone = { GO: "normal", GO_WITH_RESTRICTION: "abnormal", NO_GO: "emergency" };
  function render() {
    const q = melState.query.trim().toLowerCase();
    const cats = (data.categories || []).map(function (c) {
      const items = c.items.filter(function (i) { return !q || (i.item + " " + (i.placard || "") + " " + (i.crew_procedure || "") + " " + c.title).toLowerCase().includes(q); });
      return items.length ? { title: c.title, items: items } : null;
    }).filter(Boolean);
    withSearchFocus(root, function () {
      root.replaceChildren(
        searchField("Search item...", melState.query, function (v) { melState.query = v; render(); }),
        h("div", { class: "stack-12" }, cats.length ? cats.map(function (c) {
          return h("div", { class: "stack-10" }, [h("div", { class: "t-title-m w-bold", text: c.title })].concat(c.items.map(function (i) {
            const status = String(i.go_status || "").toUpperCase();
            return blueCard([
              h("div", { class: "row top between gap-12" }, [h("div", { class: "t-title-m w-semi grow", text: i.item }), h("span", { class: "pill " + (goTone[status] || "info"), text: status.replace(/_/g, " ") })]),
              h("div", { class: "row wrap gap-8 mt-6" }, [h("span", { class: "pill info", text: "Installed " + i.qty_installed }), h("span", { class: "pill info", text: "Required " + i.qty_required }), i.category ? h("span", { class: "pill info", text: "Cat " + i.category }) : null, i.rect_interval_days ? h("span", { class: "pill info", text: i.rect_interval_days + " days" }) : null]),
              i.placard ? h("div", { class: "t-body-s mt-8" }, [h("strong", { text: "Placard: " }), i.placard]) : null,
              i.crew_procedure ? h("div", { class: "t-body-s mt-4" }, [h("strong", { text: "Crew: " }), i.crew_procedure]) : null,
              i.maintenance_action ? h("div", { class: "t-body-s mt-4" }, [h("strong", { text: "Maintenance: " }), i.maintenance_action]) : null,
              i.reference ? h("div", { class: "t-label-s c-ter mt-4", text: i.reference }) : null
            ]);
          })));
        }) : [notice("No MEL items match.", "")])
      );
    });
  }
  render();
  return screen({ title: "MEL/CDL Reference", library: true, header: [backText("#/knowledge/home")] }, [
    notice(data.disclaimer || "Training reference only.", "warn"),
    h("div", { class: "t-body-s c-sec", text: "Source: " + data.source }),
    root
  ]);
}

/* ----------------------------------------------- Aerodromes & Waterways */
const stripsState = { query: "" };
export async function aerodromes(ctx) {
  ctx.setTopbar({ title: "Aerodromes & Waterways", subtitle: "Training reference", back: "#/knowledge/home" });
  let data;
  try { data = (await Content.pack("maldives-strips")).data; } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "Aerodromes & Waterways", library: true, header: [backText("#/knowledge/home")] }, [contentUnavailable("maldives-strips", error)]); }
  const entries = data.entries || data.strips || [];
  const root = h("div", { class: "stack-12" });
  function render() {
    const q = stripsState.query.trim().toLowerCase();
    const list = entries.filter(function (e) { return !q || [e.name, e.region, e.country, e.icao, e.iata, e.type].join(" ").toLowerCase().includes(q); });
    withSearchFocus(root, function () {
      root.replaceChildren(
        searchField("Search name, region, country, ICAO...", stripsState.query, function (v) { stripsState.query = v; render(); }),
        h("div", { class: "t-body-s c-sec", text: list.length + " of " + entries.length + " entries" }),
        h("div", { class: "stack-10" }, list.map(function (e) {
          return blueCard([
            h("div", { class: "row top between gap-12" }, [h("div", { class: "grow" }, [h("div", { class: "t-title-m w-semi", text: e.name }), h("div", { class: "t-body-s c-sec", text: [e.region, e.country].filter(Boolean).join(", ") })]), h("div", { class: "t-label-l w-bold c-accent", text: [e.icao, e.iata].filter(Boolean).join(" / ") })]),
            h("div", { class: "row wrap gap-8 mt-6" }, [e.type ? h("span", { class: "pill info", text: e.type }) : null, e.elevation_ft != null ? h("span", { class: "pill info", text: e.elevation_ft + " ft" }) : null, e.rwy ? h("span", { class: "pill info", text: "RWY " + e.rwy }) : null, e.ils ? h("span", { class: "pill info", text: "ILS " + e.ils }) : null, e.customs ? h("span", { class: "pill info", text: "Customs " + e.customs }) : null]),
            e.fuel ? h("div", { class: "t-label-s mt-6", style: "color:var(--logbook-outline)", text: "Fuel: " + e.fuel }) : null,
            e.notes ? h("div", { class: "t-body-s mt-6", text: e.notes }) : null
          ]);
        }))
      );
    });
  }
  render();
  return screen({ title: "Aerodromes & Waterways", library: true, header: [backText("#/knowledge/home")] }, [
    notice(data.disclaimer || "Training reference only.", "warn"),
    data.operating_notes && data.operating_notes.length ? blueCard([h("div", { class: "t-label-l w-bold", text: "Operating Notes" })].concat(data.operating_notes.map(function (n) { return h("div", { class: "row top gap-8 mt-6" }, [h("span", { style: "color:var(--logbook-outline)", text: "•" }), h("span", { class: "t-body-s", text: n })]); }))) : null,
    root
  ]);
}

/* ------------------------------------------------------------ CAS library */
export async function casLibrary(ctx) {
  ctx.setTopbar({ title: "CAS Library", subtitle: "Annunciators for " + variantLabel(currentVariant()), back: "#/knowledge/home" });
  let pack;
  try { pack = await Content.pack("cas-library"); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ title: "CAS Library", library: true, header: [backBubble("#/knowledge/home")] }, [contentUnavailable("cas-library", error)]); }
  const v = currentVariant();
  const libs = (pack.libraries || []).filter(function (l) { return v === "BOTH" || String(l.data.variant || "").toUpperCase() === v; });
  const tone = { WARNING: "emergency", CAUTION: "abnormal", ADVISORY: "normal" };
  return screen({ title: "CAS Library", library: true, header: variantHeader(ctx) }, libs.map(function (l) {
    const name = l.file.replace(/_(legacy|g950)$/i, "").replace(/_/g, " ");
    return blueCard([
      h("div", { class: "row between" }, [h("div", { class: "t-title-m w-bold", style: "text-transform:capitalize", text: name }), h("span", { class: "pill info", text: String(l.data.variant || "") })]),
      h("div", { class: "stack-6 mt-8" }, (l.data.messages || []).map(function (m) {
        return h("div", { class: "row between gap-8" }, [h("span", { class: "mono t-body-s", text: m.display }), h("span", { class: "pill " + (tone[m.level] || "info"), text: m.level })]);
      }))
    ]);
  }));
}

/* ----------------------------------------------------------------- Search */
const searchState = { query: "" };
/*
  KnowledgeSearchScreen. Searches the bundled knowledge units, every procedure
  step, the Definitions list — and, since the Library shipped, the documents on
  this account's source index. A source you uploaded is study material; leaving
  it out of search was the last thing keeping this screen Partial.
*/
async function libraryDocuments() {
  /* Best effort: the Library may not be configured on this deployment, and a
     search screen must never fail because of it. */
  try {
    const response = await fetch("/api/library", { credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) return [];
    const data = await response.json();
    if (!data || data.ok !== true || !data.configured) return [];
    const own = (data.privateShelf && data.privateShelf.items) || [];
    const shared = (data.publishedShelf && data.publishedShelf.items) || [];
    return shared.map(function (d) { return { doc: d, shelf: "published" }; })
      .concat(own.map(function (d) { return { doc: d, shelf: "private" }; }));
  } catch (error) { return []; }
}

export function documentMatches(entry, query) {
  const d = entry && entry.doc;
  if (!d) return false;
  const haystack = [d.title, d.fileName, d.note, d.docType].filter(Boolean).join(" ").toLowerCase();
  return haystack.includes(query);
}

export async function knowledgeSearch(ctx) {
  ctx.setTopbar({ title: "Search", subtitle: "Knowledge, procedures, definitions, sources", back: "#/knowledge/home" });
  let units = [], procedures = [], glossary = [], documents = [];
  try { units = await knowledgePool(); procedures = await allProcedures(); glossary = (await Content.pack("glossary")).entries || []; } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; }
  documents = await libraryDocuments();
  const root = h("div", { class: "stack-12" });
  function render() {
    const q = searchState.query.trim().toLowerCase();
    const results = [];
    if (q.length >= 2) {
      glossary.filter(function (g) { return (g.acronym + " " + g.definition + " " + g.note).toLowerCase().includes(q); }).slice(0, 10).forEach(function (g) { results.push({ kind: "Definition", title: g.acronym + " — " + g.definition, body: g.note, href: "#/knowledge/definitions" }); });
      procedures.filter(function (p) { return (p.displayTitle + " " + p.memory.concat(p.flow).map(function (s) { return s.action; }).join(" ")).toLowerCase().includes(q); }).slice(0, 15).forEach(function (p) { results.push({ kind: p.category + " procedure", title: p.displayTitle, body: p.memory.concat(p.flow).map(function (s) { return s.action; }).find(function (a) { return a.toLowerCase().includes(q); }) || "", href: "#/procedures/detail/" + encodeURIComponent(p.compiledId) + "?variant=" + p.aircraftVariant }); });
      /* Documents rank above raw knowledge units: a manual you added yourself is
         usually what you meant when its title matches. */
      documents.filter(function (entry) { return documentMatches(entry, q); }).slice(0, 10).forEach(function (entry) {
        results.push({
          kind: "Source · " + entry.doc.docType + (entry.shelf === "published" ? " · shared" : ""),
          title: decodeHeaderText(entry.doc.title),
          body: decodeHeaderText(entry.doc.note) || decodeHeaderText(entry.doc.fileName),
          href: docHref(entry.shelf, entry.doc.docId),
          external: true
        });
      });
      units.filter(function (u) { return (u.title + " " + u.content).toLowerCase().includes(q); }).slice(0, 25).forEach(function (u) { results.push({ kind: String(u.system).replace(/_/g, " ") + " · " + u.aircraftVariant, title: u.title, body: u.content, href: null }); });
    }
    withSearchFocus(root, function () {
      root.replaceChildren(
        searchField("Search study items", searchState.query, function (v) { searchState.query = v; render(); }),
        q.length < 2
          ? h("p", { class: "t-body-s c-sec", text: "Type at least two characters. Searches the bundled knowledge units, all procedure steps, the Definitions list and your Library sources." })
          : h("p", { class: "t-body-s c-sec", text: results.length + " results" }),
        h("div", { class: "stack-10" }, results.map(function (r) {
          const opts = r.href ? (r.external ? { href: r.href, target: "_blank" } : { href: r.href }) : null;
          return blueCard([
            h("div", { class: "t-label-s c-accent", text: r.kind }),
            h("div", { class: "t-title-s w-semi mt-4", text: r.title }),
            r.body ? h("div", { class: "t-body-s c-sec clamp-3 mt-4", text: r.body }) : null
          ], opts);
        }))
      );
    });
  }
  render();
  return screen({ title: "Search", library: true, header: [backBubble("#/knowledge/home")] }, [root]);
}

export { formatProcedureDisplayTitle };
