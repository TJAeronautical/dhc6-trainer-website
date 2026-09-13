/*
  PROCS tab and procedure detail — ports of
    feature-procedures/ui/screens/ProcedureLibraryScreen.kt
    feature-procedures/ui/screens/QrhDetailScreen.kt (+ QrhProcedureMapper.toDetail)
    feature-procedures/ui/screens/ProcedureDrillPane.kt
*/
import { h, Store, currentVariant } from "../core.js";
import { screen, smallBadge, categoryBadge, tile, searchField, backText, qrhStatusBadge, contentUnavailable, emptyState, notice, withSearchFocus } from "../ui.js";
import { allProcedures, procedureById } from "../data.js";
import * as P from "../logic/procedures.js";
import { createDrill, drillResultToLogbookEntry } from "../logic/drill.js";
import { applyDraftToDetail } from "../logic/qrhedit.js";
import { loadEdit, canEdit as canEditQrh } from "../qrhedits.js";

/* --------------------------------------------------- Procedure Library */
const libraryState = { query: "", categoryFilter: "ALL", bucket: "ALL", priorityOnly: false };

export async function procedureLibrary(ctx) {
  ctx.setTopbar({ title: "Procedures", subtitle: "PROCS · Procedure Library" });
  let procedures;
  try { procedures = await allProcedures(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ variant: "procs" }, [contentUnavailable("procedures-*", error)]); }

  const root = h("section", { class: "screen procs", "aria-label": "Procedures" });
  function render() {
    const pinned = Store.pinned();
    const result = P.libraryVisible(procedures, Object.assign({ priorityIds: pinned }, libraryState));
    const counts = P.normalBucketCounts(procedures);
    const priorityCount = procedures.filter(function (p) { return pinned.includes(p.compiledId); }).length;

    const header = h("div", { class: "blue-card" }, [
      h("div", { class: "row between" }, [h("h2", { class: "t-display-s c-white", text: "Procedures" }), smallBadge(result.visible.length + " procedures")]),
      h("p", { class: "t-body-s mt-6", style: "color:var(--white-secondary)", text: "Tap a card to open the interactive memory+flow drill. Press -> to launch the cockpit drill runner directly." })
    ]);

    const search = searchField("Search procedure name or step text", libraryState.query, function (v) { libraryState.query = v; render(); }, "Search procedure name or step text");
    const priority = h("button", { class: "priority-pill" + (libraryState.priorityOnly ? " selected" : ""), type: "button", "aria-pressed": libraryState.priorityOnly ? "true" : "false", onclick: function () { libraryState.priorityOnly = !libraryState.priorityOnly; render(); } }, [
      h("span", { text: libraryState.priorityOnly ? "Pinned procedures only" : "Pinned procedures" }),
      h("span", { class: "w-xbold", style: "color:rgba(255,255,255,.9)", text: String(priorityCount) })
    ]);
    const filters = h("div", { class: "equal-row gap-6", role: "group", "aria-label": "Category filter" }, P.CATEGORY_FILTERS.map(function (f) {
      return h("button", { class: "cat-filter " + f.toLowerCase() + (libraryState.categoryFilter === f ? " selected" : ""), type: "button", "aria-pressed": libraryState.categoryFilter === f ? "true" : "false", text: f, onclick: function () { libraryState.categoryFilter = f; render(); } });
    }));
    const buckets = libraryState.categoryFilter === "NORMAL" ? h("div", { class: "stack-8" }, [
      h("div", { class: "t-title-m w-bold c-white", text: "Normal subsections" }),
      h("div", { class: "equal-row gap-6", role: "group", "aria-label": "Normal subsections" }, P.NORMAL_BUCKET_FILTERS.map(function (b) {
        return h("button", { class: "bucket-pill" + (libraryState.bucket === b ? " selected" : ""), type: "button", "aria-pressed": libraryState.bucket === b ? "true" : "false", onclick: function () { libraryState.bucket = b; render(); } }, [
          h("span", { text: P.NORMAL_BUCKETS[b].shortLabel }), h("small", { text: String(counts[b] || 0) })
        ]);
      }))
    ]) : null;
    const panel = h("div", { class: "blue-card", style: "padding:10px 12px;border-radius:var(--r-lg)" }, [h("div", { class: "stack-8" }, [search, priority, filters, buckets])]);

    const list = h("div", { class: "stack-10" });
    if (result.sections.length) {
      result.sections.forEach(function (section) {
        const meta = P.NORMAL_BUCKETS[section.bucket];
        list.appendChild(h("div", { class: "section-header " + section.bucket }, [
          h("div", { class: "bar", "aria-hidden": "true" }),
          h("div", { class: "grow stack-4" }, [h("div", { class: "t-title-m w-xbold c-white", text: meta.shortLabel }), h("div", { class: "t-body-m clamp-2", style: "color:var(--white-secondary)", text: meta.description })]),
          smallBadge(String(section.items.length))
        ]));
        section.items.forEach(function (p) { list.appendChild(libraryRow(p, pinned, render)); });
      });
    } else if (result.visible.length) {
      result.visible.forEach(function (p) { list.appendChild(libraryRow(p, pinned, render)); });
    } else {
      list.appendChild(emptyState("No procedures match this filter."));
    }
    withSearchFocus(root, function () { root.replaceChildren(header, panel, list); });
  }
  render();
  return root;
}

function detailHref(p) { return "#/procedures/detail/" + encodeURIComponent(p.compiledId) + "?variant=" + p.aircraftVariant; }

function libraryRow(p, pinned, rerender) {
  const isPriority = pinned.includes(p.compiledId);
  const accent = p.category === "NORMAL" ? "var(--normal-green)" : p.category === "ABNORMAL" ? "var(--caution-amber)" : "var(--emergency-red-strong)";
  const criticalCount = p.flow.filter(function (s) { return s.requiresConfirmation; }).length + p.memory.filter(function (s) { return s.requiresConfirmation; }).length;
  const badges = [categoryBadge(p.category)];
  if (isPriority) badges.push(smallBadge("PINNED", "pinned"));
  if (p.category === "NORMAL") badges.push(smallBadge(P.NORMAL_BUCKETS[P.normalBucketFor(p)].shortLabel));
  if (p.memory.length) badges.push(smallBadge(p.memory.length + " MEMORY"));
  if (p.flow.length) badges.push(smallBadge(p.flow.length + " MCC STEPS"));
  if (criticalCount > 0) badges.push(smallBadge(criticalCount + " !"));
  badges.push(smallBadge(P.readinessBadge(p)));
  if (p.aircraftVariant !== "BOTH" && currentVariant() === "BOTH") badges.push(smallBadge(p.aircraftVariant));

  const card = tile({ class: "lib-row hero", art: P.procedureTileImage(p.procedureName, p.category), accent: accent, thinAccent: true, href: detailHref(p) }, [
    h("div", { class: "t-title-l w-xbold c-white clamp-2", text: p.displayTitle }),
    h("div", { class: "t-body-m w-semi clamp-1", style: "color:rgba(255,255,255,.86)", text: P.sourceBasisFor(p) }),
    h("div", { class: "badge-row" }, badges)
  ]);
  const pin = h("button", { class: "pin-btn" + (isPriority ? " on" : ""), type: "button", "aria-pressed": isPriority ? "true" : "false", "aria-label": (isPriority ? "Unpin " : "Pin ") + p.displayTitle, text: isPriority ? "PINNED" : "PIN", onclick: function (e) { e.preventDefault(); Store.togglePinned(p.compiledId); rerender(); } });
  /* ProcedureLibraryRow.onQuickStartDrill -> Screen.DrillRun (ScenarioDrillRunScreen),
     not the detail page's inline pane. Tapping the row body still opens the QRH detail. */
  const drill = h("a", { class: "drill-btn", href: "#/drill/run/" + encodeURIComponent(p.compiledId) + "?from=procs", title: "Start drill", "aria-label": "Start drill: " + p.displayTitle, html: "›",
    onclick: function () { Store.set("lastDrillProcedureId", p.compiledId); } });
  return h("div", { class: "lib-row-wrap" }, [card, pin, drill]);
}

/* ------------------------------------------------- Procedure / QRH detail */
export async function procedureDetail(ctx) {
  const compiledId = ctx.params.id;
  const backHref = ctx.query.get("from") === "qrh" ? "#/qrh" : "#/systems";
  let procedure;
  try { procedure = await procedureById(compiledId, null, ctx.query.get("variant")); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ variant: "qrh", header: [backText(backHref)], title: "QRH" }, [contentUnavailable("procedures-*", error)]); }
  if (!procedure) {
    ctx.setTopbar({ title: "QRH", subtitle: "Procedure not found", back: backHref });
    return screen({ variant: "qrh", header: [backText(backHref)], title: "QRH" }, [h("p", { class: "t-body-l c-white", text: "Procedure not found." })]);
  }
  ctx.setTopbar({ title: procedure.displayTitle, subtitle: procedure.category + " · " + procedure.aircraftVariant, back: backHref });
  Store.recordRecent({ id: procedure.compiledId, kind: "procedure", title: procedure.displayTitle, category: procedure.category, route: "#/procedures/detail/" + encodeURIComponent(procedure.compiledId) });

  /* A saved manual edit belonging to this account replaces the displayed procedure
     (QrhRouteHost: `savedEdit?.let { sourceDetail.copy(...) } ?: sourceDetail`). */
  const sourceDetail = P.toQrhDetail(procedure);
  let savedEdit = null;
  let mayEdit = false;
  try { savedEdit = await loadEdit(compiledId); } catch (error) { savedEdit = null; }
  try { mayEdit = await canEditQrh(); } catch (error) { mayEdit = false; }
  const detail = applyDraftToDetail(sourceDetail, savedEdit);
  const lines = P.qrhDrillSteps(detail);
  const memoryAccent = "var(--sem-normal)";
  const checklistAccent = "var(--accent-sky)";

  const nodes = [
    h("div", { class: "row" }, [backText(backHref)]),
    h("h2", { class: "t-display-s c-white clamp-2", text: detail.title }),
    h("p", { class: "t-body-l w-semi", style: "color:rgba(255,255,255,.86)", text: "QRH checklist  -  memorised items separated from complete actions" }),
    h("div", { class: "row" }, [mayEdit
      ? h("a", { class: "btn outlined small", href: "#/qrh/edit/" + encodeURIComponent(compiledId), style: "flex:1", text: "Edit QRH" })
      : h("button", { class: "btn outlined small", type: "button", disabled: true, style: "flex:1;color:rgba(255,255,255,.56)", text: "Edit QRH" })]),
    mayEdit
      ? h("p", { class: "t-body-s", style: "color:rgba(255,255,255,.74)", text: "Your edits are saved to your account and stay available on every device while your subscription is active. They never change the published procedure for anyone else." })
      : h("p", { class: "t-body-s", style: "color:rgba(255,255,255,.74)", text: "QRH editing requires Instructor, Admin, or Owner access. Pro users can view and complete QRH checklists, but cannot edit source procedures." })
  ];
  if (savedEdit) nodes.push(notice("You are viewing your edited version of this procedure.", "ok"));
  if (detail.trigger) nodes.push(panelCard("Condition / Trigger", checklistAccent, [P.cleanQrhLine(detail.trigger)], false));
  nodes.push(panelCard("Memory Items", memoryAccent, lines.memoryItems.length ? lines.memoryItems : ["No memorised items are mapped for this checklist yet."], true, "Recall before opening the complete QRH."));
  nodes.push(panelCard("Complete QRH Checklist", checklistAccent, lines.checklistItems.length ? lines.checklistItems : ["No complete QRH checklist items are mapped yet."], true, "Use after memory items are complete. This includes non-memory checklist actions, confirmations, notes, and follow-up items."));
  if (lines.memoryItems.length || lines.checklistItems.length) {
    nodes.push(drillPane({
      procedureId: detail.title,
      procedureName: detail.title,
      category: procedure.category,
      memorySteps: lines.memorySteps,
      flowSteps: lines.flowSteps,
      onComplete: function (result) {
        Store.addLogbookEntry(drillResultToLogbookEntry(result, procedure.category, procedure.aircraftVariant));
        Store.recordAttempt({ id: procedure.compiledId, kind: "procedure-drill", title: procedure.displayTitle, score: result.scorePercent });
      },
      autoStart: ctx.query.get("drill") === "1"
    }));
  }
  if (detail.notes.length) nodes.push(panelCard("Notes", "var(--sem-caution)", detail.notes.map(P.cleanQrhLine).filter(Boolean), false));
  if (procedure.sourceNote) nodes.push(h("p", { class: "t-body-s c-ter", text: "Source: " + procedure.sourceNote }));
  nodes.push(h("div", { class: "spacer-24" }));
  const s = screen({ variant: "qrh", ariaLabel: detail.title }, nodes);
  if (ctx.query.get("drill") === "1") setTimeout(function () { const d = s.querySelector(".drill"); if (d) d.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50);
  return s;
}

/* QrhPanelCard */
function panelCard(title, accent, lines, numbered, subtitle) {
  return h("div", { class: "qrh-panel" }, [
    h("div", { class: "panel-accent", style: "background:" + accent, "aria-hidden": "true" }),
    h("div", { class: "panel-body" }, [
      h("div", { class: "t-title-l w-xbold c-white", text: title }),
      subtitle ? h("div", { class: "t-body-m w-semi", style: "color:rgba(255,255,255,.76)", text: subtitle }) : null,
      h("ol", { class: "plain stack-10", style: "list-style:none;margin:0;padding:0" }, lines.map(function (line, index) {
        return h("li", { class: "qrh-line" }, [numbered ? h("span", { class: "n", text: (index + 1) + "." }) : null, h("span", { class: "grow", text: line })]);
      }))
    ])
  ]);
}

/* ------------------------------------------------------ Drill pane */
export function drillPane(opts) {
  const drill = createDrill(opts);
  const root = h("div", { class: "drill cat-" + opts.category, "aria-label": "Procedure drill" });

  function header() {
    const c = drill.counts();
    const phase = drill.state.phase;
    return h("div", { class: "stack-8" }, [
      h("div", { class: "row between" }, [
        h("span", { class: "t-label-l w-xbold", style: "color:var(--drill-accent)", text: "PROCEDURE DRILL" }),
        h("span", { class: "phase-pill", text: phase })
      ]),
      h("div", { class: "t-title-m w-semi c-white clamp-2", text: opts.procedureName }),
      h("div", { class: "t-label-s w-bold c-72", text: opts.category + " PROCEDURE" }),
      h("div", { class: "row gap-12" }, [
        c.memoryTotal > 0 ? h("span", { class: "mini-chip" + (phase === "MEMORY" ? " active" : ""), text: "MEMORY " + c.memoryDone + "/" + c.memoryTotal }) : null,
        c.flowTotal > 0 ? h("span", { class: "mini-chip" + (phase === "FLOW" ? " active" : ""), text: "FLOW " + c.flowDone + "/" + c.flowTotal }) : null
      ])
    ]);
  }

  function memoryPhase() {
    const card = drill.current();
    if (!card) return h("div");
    const total = drill.state.cards.length;
    const idx = drill.state.memoryIndex;
    const progress = h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(idx) }, h("span", { style: "width:" + ((idx / total) * 100).toFixed(1) + "%" }));
    const anyScored = drill.state.cards.some(function (c) { return c.result !== "PENDING"; });
    const flash = h("button", { class: "flash-card" + (card.revealed ? " revealed " + card.result : ""), type: "button", disabled: card.revealed ? true : null, onclick: function () { drill.reveal(); render(); } },
      card.revealed ? [
        card.step.requiresConfirmation ? h("span", { class: "critical-tag", text: "▲ CRITICAL ACTION — CONFIRM" }) : null,
        h("div", { class: "t-title-l w-xbold c-white", text: card.step.action }),
        card.step.reference ? h("div", { class: "t-body-s c-72", text: card.step.reference }) : null
      ] : [
        h("div", { class: "t-title-s w-xbold", style: "color:var(--drill-accent)", text: "TAP TO REVEAL" }),
        h("div", { class: "t-body-s c-72", html: "Say the memory item aloud first,<br>then reveal to check." })
      ]);
    return h("div", { class: "stack-12" }, [
      h("div", { class: "row between" }, [h("span", { class: "t-body-s c-72", text: "Item " + (idx + 1) + " of " + total }), h("span", { class: "t-label-m w-bold", style: "color:var(--drill-accent)", text: card.step.crewRole })]),
      progress,
      anyScored ? h("div", { class: "scored-strip", "aria-hidden": "true" }, drill.state.cards.map(function (c) { return h("span", { class: c.result }); })) : null,
      flash,
      card.revealed ? h("div", { class: "row gap-12" }, [
        h("button", { class: "btn-missed", type: "button", text: "✕ MISSED", onclick: function () { drill.score(false); render(); } }),
        h("button", { class: "btn-gotit", type: "button", text: "✓ GOT IT", onclick: function () { drill.score(true); render(); } })
      ]) : null
    ]);
  }

  function flowPhase() {
    const steps = drill.state.flowSteps;
    const checked = drill.state.flowChecked;
    const done = checked.filter(Boolean).length;
    const total = steps.length;
    const allDone = done === total;
    return h("div", { class: "stack-10" }, [
      h("div", { class: "row between" }, [
        h("span", { class: "t-body-s c-72", text: "Checklist — " + done + " / " + total }),
        h("span", { class: "t-label-s" + (allDone ? " w-xbold" : ""), style: "color:" + (allDone ? "var(--success-green)" : "var(--text-72)"), text: allDone ? "COMPLETE ✓" : "Tap to check off" })
      ]),
      h("div", { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(done) }, h("span", { style: "width:" + (total ? (done / total) * 100 : 0).toFixed(1) + "%" })),
      h("div", { class: "stack-10" }, steps.map(function (step, index) {
        const isChecked = checked[index];
        const isCritical = step.requiresConfirmation;
        const isAnnounce = step.intent === "ANNOUNCE";
        return h("button", { class: "flow-row" + (isChecked ? " checked" : isCritical ? " critical" : ""), type: "button", "aria-pressed": isChecked ? "true" : "false", onclick: function () { drill.toggleFlow(index); render(); } }, [
          h("span", { class: "check", "aria-hidden": "true", text: isChecked ? "✓" : String(index + 1) }),
          h("span", { class: "grow stack-4" }, [
            h("span", { class: "action t-body-l " + (isCritical ? "w-xbold" : "w-semi"), text: step.action }),
            h("span", { class: "row gap-6 wrap" }, [
              h("span", { class: "tag role", text: step.crewRole }),
              isCritical ? h("span", { class: "tag critical", text: "▲ CRITICAL" }) : null,
              isAnnounce ? h("span", { class: "tag callout", text: "CALLOUT" }) : null
            ])
          ])
        ]);
      })),
      h("button", { class: "btn-finish", type: "button", text: allDone ? "COMPLETE — VIEW SUMMARY" : "FINISH REVIEW", onclick: function () { drill.finishFlow(); render(); } })
    ]);
  }

  function summaryPhase() {
    const c = drill.counts();
    const hasMemory = drill.state.memorySteps.length > 0;
    const hasFlow = drill.state.flowSteps.length > 0;
    const allMemOk = hasMemory && c.memoryCorrect === c.memoryTotal;
    const allFlowOk = !hasFlow || c.flowDone === c.flowTotal;
    const missed = drill.state.cards.filter(function (card) { return card.result === "MISSED"; });
    const headline = allMemOk && allFlowOk ? "DRILL COMPLETE ✓" : !allMemOk ? "MEMORY: " + c.memoryCorrect + " / " + c.memoryTotal + " correct" : "FLOW: " + c.flowDone + " / " + c.flowTotal + " completed";
    return h("div", { class: "stack-12" }, [
      h("div", { class: "t-headline-s w-xbold", style: "color:" + (allMemOk && allFlowOk ? "var(--success-green)" : "var(--caution-yellow)"), text: headline }),
      h("div", { class: "equal-row gap-10" }, [
        hasMemory ? scoreCard("MEMORY", c.memoryCorrect + " / " + c.memoryTotal, c.memoryMissed + " missed", c.memoryCorrect === c.memoryTotal ? "ok" : "bad") : null,
        hasFlow ? scoreCard("FLOW", c.flowDone + " / " + c.flowTotal, c.flowDone === c.flowTotal ? "all done" : (c.flowTotal - c.flowDone) + " remaining", c.flowDone === c.flowTotal ? "ok" : "warn") : null
      ]),
      missed.length ? h("div", { class: "missed-box" }, [h("div", { class: "t-label-m w-xbold", style: "color:var(--emergency-red)", text: "MISSED — REVIEW THESE" })].concat(missed.map(function (card) {
        return h("div", { class: "missed-item" }, [h("div", { class: "t-body-l w-semi c-white", text: card.step.action }), h("div", { class: "t-label-s w-bold", style: "color:rgba(231,76,60,.8)", text: card.step.crewRole })]);
      }))) : null,
      drill.state.completionReported && opts.onComplete ? h("div", { class: "saved-box", text: "Saved to logbook" }) : null,
      h("button", { class: "btn-restart", type: "button", text: "↻ RESTART DRILL", onclick: function () { drill.restart(); render(); } })
    ]);
  }

  function scoreCard(label, value, sublabel, tone) {
    return h("div", { class: "score-card " + tone }, [h("div", { class: "t-label-m w-xbold", text: label }), h("div", { class: "t-headline-m w-xbold c-white", text: value }), h("div", { class: "t-body-s c-72", text: sublabel })]);
  }

  function render() {
    const phase = drill.state.phase;
    root.replaceChildren(header(), phase === "MEMORY" ? memoryPhase() : phase === "FLOW" ? flowPhase() : summaryPhase());
  }
  render();
  return root;
}

/* ------------------------------------------------------------ QRH hub */
const QRH_MODE_COPY = "Select a QRH category, then open a checklist. Each checklist separates memorised items from the complete QRH actions used after the memory items are complete.";
const QRH_HERO = [
  { category: "NORMAL", title: "Normal", subtitle: "Normal procedures and checks. Use this for checklist review and normal QRH-style reference." },
  { category: "ABNORMAL", title: "Abnormal", subtitle: "Abnormal faults, failures, and other non-normal checklists." },
  { category: "EMERGENCY", title: "Emergency", subtitle: "Immediate-action emergency procedures with memorised items separated from the full QRH." }
];
function categoryAccent(category) { return category === "NORMAL" ? "var(--sem-normal)" : category === "ABNORMAL" ? "var(--sem-caution)" : "var(--sem-emergency)"; }

function qrhTabRow(selected) {
  return h("div", { class: "equal-row gap-6", role: "tablist", "aria-label": "QRH category" }, P.CATEGORIES.map(function (c) {
    return h("a", { class: "qrh-chip " + c.toLowerCase() + (selected === c ? " selected" : ""), href: "#/qrh/category/" + c, role: "tab", "aria-selected": selected === c ? "true" : "false", text: c });
  }));
}

export async function qrhHub(ctx) {
  ctx.setTopbar({ title: "QRH Checklist", subtitle: "Quick Reference Handbook" });
  return screen({ variant: "qrh", ariaLabel: "QRH Checklist" }, [
    h("h2", { class: "t-display-s c-white clamp-1", text: "QRH Checklist" }),
    h("p", { class: "t-body-l c-sec", text: QRH_MODE_COPY }),
    qrhTabRow(null),
    h("div", { class: "grid-2 wide-3", style: "grid-template-columns:1fr" }, QRH_HERO.map(function (item) {
      return tile({ class: "hero card-row h-150", art: P.qrhCategoryTile(item.category), accent: categoryAccent(item.category), href: "#/qrh/category/" + item.category }, [
        h("div", { class: "grow stack-8" }, [
          h("div", { class: "t-title-l w-xbold c-white clamp-1", text: item.title }),
          h("div", { class: "t-body-m clamp-2", style: "color:rgba(255,255,255,.84)", text: item.subtitle }),
          h("div", {}, qrhStatusBadge(item.category))
        ]),
        h("span", { class: "chevron pill", "aria-hidden": "true", text: ">" })
      ]);
    })),
    h("div", { class: "spacer-24" })
  ]);
}

/* ------------------------------------------------------------ QRH list */
const qrhSearch = {};
export async function qrhList(ctx) {
  const category = String(ctx.params.category || "ABNORMAL").toUpperCase();
  if (!P.CATEGORIES.includes(category)) { ctx.navigate("/qrh", true); return h("div"); }
  const label = category.charAt(0) + category.slice(1).toLowerCase();
  ctx.setTopbar({ title: "QRH", subtitle: label + " checklists", back: "#/qrh" });
  let procedures;
  try { procedures = await allProcedures(); } catch (error) { if (error && (error.status === 401 || error.status === 403)) throw error; return screen({ variant: "qrh-list", header: [backText("#/qrh")], title: "QRH" }, [contentUnavailable("procedures-*", error)]); }

  const root = h("section", { class: "screen qrh-list", "aria-label": "QRH " + label });
  function render() {
    const items = P.qrhListItems(procedures, category, qrhSearch[category] || "");
    const list = items.length ? h("div", { class: "stack-12" }, items.map(function (p) {
      return tile({ class: "r-26 card-row h-150", art: P.procedureTileImage(p.displayTitle, category), accent: categoryAccent(category), href: "#/procedures/detail/" + encodeURIComponent(p.compiledId) + "?from=qrh&variant=" + p.aircraftVariant }, [
        h("div", { class: "grow stack-8" }, [
          h("div", { class: "t-title-l w-xbold c-white clamp-2", text: p.displayTitle }),
          h("div", { class: "t-body-m clamp-1", style: "color:rgba(255,255,255,.82)", text: label + " checklist" + (p.aircraftVariant !== "BOTH" && currentVariant() === "BOTH" ? " · " + p.aircraftVariant : "") }),
          h("div", { class: "row gap-8 wrap" }, [qrhStatusBadge(category), h("span", { class: "pill info", text: "Memory " + p.memory.length }), h("span", { class: "pill info", text: "QRH " + p.flow.length })])
        ]),
        h("span", { class: "chevron", "aria-hidden": "true", text: ">" })
      ]);
    })) : h("div", { class: "empty-qrh" }, [h("div", { class: "t-title-m w-bold c-white", text: "No " + label.toLowerCase() + " QRH checklists found." })]);
    withSearchFocus(root, function () {
      root.replaceChildren(
        h("div", { class: "row top gap-12" }, [
          h("div", { class: "grow" }, [h("h2", { class: "t-headline-m w-xbold c-white clamp-1", text: "QRH" }), h("div", { class: "t-body-l w-semi clamp-1", style: "color:rgba(255,255,255,.84)", text: label })]),
          backText("#/qrh")
        ]),
        qrhTabRow(category),
        searchField("Search QRH checklist", qrhSearch[category] || "", function (v) { qrhSearch[category] = v; render(); }),
        h("p", { class: "t-body-m clamp-2", style: "color:rgba(255,255,255,.78)", text: "Open a checklist to review the memorised block first, then the complete QRH checklist items." }),
        list
      );
    });
  }
  render();
  return root;
}
