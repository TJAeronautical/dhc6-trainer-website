/*
  Debrief Logbook — ports of
    feature-training/ui/dashboard/LogbookScreen.kt       (list, filters, sort)
    feature-training/ui/dashboard/LogbookDetailScreen.kt (Scenario Debrief)
    feature-training/ui/dashboard/LogbookPdfExporter.kt  (the export document)

  The export is the browser's own print-to-PDF rather than a bundled PDF
  library: the app shell is session-gated and vendors as little as possible, and
  the print dialogue produces a real PDF with the user's own page setup. The
  document is rendered as a normal screen first so it can be read before it is
  saved.
*/
import { h, Store, relativeTime } from "../core.js";
import { screen, blueCard, libraryDivider, backBubble, notice, statusPill, searchField, selectableChip } from "../ui.js";
import { compiledProcedureId } from "../logic/procedures.js";
import * as LB from "../logic/logbook.js";

/* Module-level so the export screen sees the same filters the list is showing —
   the Kotlin exports filteredEntries, not everything. */
const filters = LB.defaultFilters();

function entriesNow() {
  return Store.logbook();
}

/* LogbookRow shows one formatted date. relativeTime() only adds information
   while an entry is recent; past that it repeats the same date. */
function rowTimestamp(ms) {
  const relative = relativeTime(ms);
  const useful = /^(Just now|\d+ min ago|Today,)/.test(relative);
  return useful ? timestampText(ms) + "  ·  " + relative : timestampText(ms);
}

function timestampText(ms) {
  const date = new Date(ms);
  return date.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ------------------------------------------------------------------- list */
export async function logbook(ctx) {
  ctx.setTopbar({ title: "Debrief Logbook", subtitle: "Local attempts in this browser", back: "#/dashboard" });

  const root = screen({
    title: "Debrief Logbook",
    library: true,
    header: [backBubble("#/dashboard"), h("a", { class: "bubble light", href: "#/training/logbook/export" }, [document.createTextNode("Export PDF")])]
  }, []);
  const body = h("div", { class: "stack-10" });
  root.appendChild(body);

  function render() {
    body.textContent = "";
    const all = entriesNow();
    const visible = LB.visibleEntries(all, filters);

    body.appendChild(h("div", { class: "row wrap gap-8" }, [
      statusPill("partial"),
      h("span", { class: "t-body-s c-sec", text: "Drills and quizzes you complete here are stored in this browser only. Cloud sync with the Android logbook is a later phase." })
    ]));

    body.appendChild(filterBar(render, all, visible));

    if (!all.length) {
      body.appendChild(notice("No attempts yet. Complete a procedure drill (PROCS → open a procedure) or a quiz to add debrief entries."));
      return;
    }
    if (!visible.length) {
      body.appendChild(notice("No entries match these filters."));
      return;
    }
    body.appendChild(h("div", { class: "stack-8" }, visible.map(entryRow)));
  }

  function filterBar(rerender, all, visible) {
    const box = h("div", { class: "stack-8 logbook-filters" });

    box.appendChild(searchField("Search procedure", filters.query, function (v) {
      filters.query = v; rerender();
    }, "Search procedure"));

    box.appendChild(h("div", { class: "row wrap gap-6", role: "group", "aria-label": "Sort" },
      LB.SORT_MODES.map(function (mode) {
        return selectableChip(mode.label, filters.sort === mode.id, function () { filters.sort = mode.id; rerender(); });
      })));

    box.appendChild(h("div", { class: "logbook-selects" }, [
      enumSelect("Variant", "aircraftVariant", LB.VARIANTS, rerender),
      enumSelect("Score", "scoreBand", LB.SCORE_BANDS, rerender),
      enumSelect("Examiner", "examinerMode", LB.EXAMINER_MODES, rerender)
    ]));

    const toggleId = "logbook-overrides-only";
    box.appendChild(h("div", { class: "row between gap-12" }, [
      h("label", { class: "row gap-8", for: toggleId }, [
        h("input", {
          id: toggleId, type: "checkbox", class: "switch-input",
          checked: filters.overridesOnly || null,
          onchange: function (e) { filters.overridesOnly = e.target.checked; rerender(); }
        }),
        h("span", { class: "t-body-s c-white", text: "Overrides only" })
      ]),
      h("span", { class: "t-label-s c-ter", text: visible.length + " of " + all.length })
    ]));

    if (!LB.filtersAreDefault(filters)) {
      box.appendChild(h("button", {
        class: "btn text", type: "button",
        onclick: function () { Object.assign(filters, LB.defaultFilters()); rerender(); }
      }, [document.createTextNode("Clear filters")]));
    }
    return box;
  }

  function enumSelect(label, key, values, rerender) {
    const select = h("select", {
      "aria-label": label,
      onchange: function (e) { filters[key] = e.target.value || null; rerender(); }
    }, [h("option", { value: "", text: "ALL", selected: filters[key] ? null : true })]
      .concat(values.map(function (v) {
        return h("option", { value: v, text: v, selected: filters[key] === v ? true : null });
      })));
    return h("label", { class: "field" }, [h("span", { text: label }), select]);
  }

  function entryRow(entry) {
    const misses = LB.missesCount(entry);
    return h("a", {
      class: "log-entry log-entry-link",
      href: "#/training/logbook/entry/" + encodeURIComponent(LB.stableKey(entry))
    }, [
      h("div", { class: "row between gap-12" }, [
        h("div", { class: "t-title-s w-semi grow clamp-2", text: entry.procedureName }),
        h("span", { class: "score " + entry.scoreBand, text: entry.scorePercent != null ? entry.scorePercent + "%" : "" })
      ]),
      h("div", { class: "row wrap gap-6" }, [
        h("span", { class: "pill " + String(entry.category || "").toLowerCase(), text: entry.category }),
        h("span", { class: "pill info", text: entry.aircraftVariant }),
        h("span", { class: "pill info", text: "ATT " + LB.attemptShortId(entry.attemptId) }),
        misses > 0 ? h("span", { class: "pill info", text: "MISS " + misses }) : null,
        entry.examinerOverride ? h("span", { class: "pill warn", text: "OVERRIDE" }) : null
      ]),
      h("div", { class: "t-body-s c-sec", text: "Score: " + entry.scoreBand + "  ·  " + LB.formatDuration(entry.totalTimeMs) }),
      h("div", { class: "t-label-s c-ter", text: rowTimestamp(entry.timestampUtc) })
    ]);
  }

  render();
  return root;
}

/* ----------------------------------------------------------------- detail */
export async function logbookDetail(ctx) {
  const entry = LB.findByKey(entriesNow(), ctx.params.key);
  ctx.setTopbar({ title: "Scenario Debrief", subtitle: entry ? entry.procedureName : "Entry not found", back: "#/training/logbook" });

  if (!entry) {
    return screen({ title: "Scenario Debrief", library: true, header: [backBubble("#/training/logbook")] }, [
      notice("That logbook entry is no longer in this browser. Entries are kept locally and the most recent 300 are retained.")
    ]);
  }

  /* Android routes these by procedure NAME (TrainingNavGraph.kt:170,177); on the
     web the equivalent address is the compiled id, which is built from exactly
     the category and name the entry already carries. */
  const compiled = compiledProcedureId(entry.category, entry.procedureName);
  const timing = LB.timingSummary(entry);
  const examiner = LB.examinerLine(entry);

  return screen({ title: "Scenario Debrief", library: true, header: [backBubble("#/training/logbook")] }, [
    /* Hero */
    blueCard([
      h("div", { class: "t-title-l w-bold c-white", text: entry.procedureName }),
      h("div", { class: "row wrap gap-8 mt-6" }, [
        h("span", { class: "score-pill-lg band-" + LB.bandTone(entry.scoreBand), text: LB.scorePillText(entry) }),
        h("span", { class: "pill info", text: entry.aircraftVariant + "  -  " + entry.category })
      ]),
      h("div", { class: "t-body-s c-sec mt-6", text: timestampText(entry.timestampUtc) + "  -  Attempt " + (entry.attemptId ? LB.attemptShortId(entry.attemptId) : "N/A") }),
      h("div", { class: "row wrap gap-8 mt-8" }, [
        h("a", { class: "btn primary", href: "#/drill/run/" + encodeURIComponent(compiled) + "?from=procs" }, [document.createTextNode("Repeat Drill")])
      ])
    ]),

    /* Review actions */
    debriefCard("Review", [
      h("p", { class: "t-body-s c-sec", text: "Use the frozen snapshot first for a static review, then open the cockpit state only when you need live interaction." }),
      h("div", { class: "row wrap gap-8" }, [
        h("a", { class: "btn tonal", href: "#/scenario/focus/" + encodeURIComponent(compiled) + "/BEFORE" }, [document.createTextNode("Review Snapshot")]),
        h("a", { class: "btn tonal", href: "#/live/cockpit" }, [document.createTextNode("Open Cockpit State")])
      ])
    ]),

    debriefCard("Outcome Summary", LB.outcomeRows(entry).map(function (row) {
      return metricRow(row[0], row[1]);
    }).concat(examiner ? [h("div", { class: "t-body-s c-sec mt-6", text: examiner })] : [])),

    debriefCard("Instructor Debrief", [
      h("p", { class: "t-body-m c-white", text: LB.instructorDebrief(entry) }),
      h("p", { class: "t-body-s c-sec", style: "white-space:pre-line", text: LB.remarksText(entry) })
    ]),

    debriefCard("Timing", [
      metricRow("Total", LB.formatDuration(timing.total)),
      metricRow("Average", LB.formatDuration(timing.average)),
      metricRow("Slowest", LB.formatDuration(timing.slowest)),
      metricRow("Fastest", LB.formatDuration(timing.fastest))
    ].concat(timing.latencies.length ? [
      h("div", { class: "t-title-s w-bold c-white mt-8", text: "Step latencies" })
    ].concat(timing.shown.map(function (ms, i) {
      return metricRow("Step " + (i + 1), LB.formatDuration(ms));
    })).concat(timing.moreCount ? [
      h("div", { class: "t-body-s c-sec", text: "+" + timing.moreCount + " more steps recorded" })
    ] : []) : [])),

    debriefCard("Repeat Recommendation", [
      h("p", { class: "t-body-m c-white", text: LB.repeatRecommendation(entry) })
    ])
  ]);
}

function debriefCard(title, children) {
  return h("section", { class: "debrief-card" }, [
    h("h3", { class: "t-title-m w-bold c-white", text: title })
  ].concat(children));
}

function metricRow(label, value) {
  return h("div", { class: "row between gap-12 metric-row" }, [
    h("span", { class: "t-body-s c-sec", text: label }),
    h("span", { class: "t-body-s w-semi c-white", text: value })
  ]);
}

/* ----------------------------------------------------------------- export */
/*
  LogbookPdfExporter's document, rendered as a page the browser can print to
  PDF. The exporter's training note is carried verbatim: it is what keeps the
  export honest about being a study record and not a certified one.
*/
export async function logbookExport(ctx) {
  ctx.setTopbar({ title: "Logbook Export", subtitle: "Print or save as PDF", back: "#/training/logbook" });

  const entries = LB.visibleEntries(entriesNow(), filters);
  const summary = LB.exportSummary(entries);

  const doc = h("article", { class: "logbook-export" }, [
    h("h1", { class: "export-title", text: "DHC-6 Trainer Logbook Export" }),

    h("h2", { class: "export-heading", text: "Pilot / User" }),
    h("p", { class: "export-body", text: "DHC-6 Trainer" }),

    h("h2", { class: "export-heading", text: "Summary" }),
    h("p", { class: "export-body", text: "Export date: " + summary.exportDate.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) }),
    h("p", { class: "export-body", text: "Total entries: " + summary.totalEntries }),
    h("p", { class: "export-body", text: "Total drill time: " + summary.totalDrillTime }),
    h("p", { class: "export-body", text: "Average score: " + summary.averageScore }),

    h("h2", { class: "export-heading", text: "Training note" }),
    h("p", { class: "export-body export-note", text: summary.note }),

    h("h2", { class: "export-heading", text: "Logbook Entries" }),
    entries.length ? h("table", { class: "export-table" }, [
      h("thead", null, h("tr", null, ["Date", "Procedure", "Category", "Score", "Time"].map(function (c) {
        return h("th", { text: c });
      }))),
      /* One flat tbody: a remarks line is its own row under its entry, not a
         nested tbody (which is invalid and breaks print pagination). */
      h("tbody", null, entries.reduce(function (rows, entry) {
        const row = LB.exportRow(entry);
        rows.push(h("tr", { class: "export-entry" }, [
          h("td", { text: row.date.toLocaleDateString([], { day: "2-digit", month: "short", year: "numeric" }) }),
          h("td", { text: row.procedure }),
          h("td", { text: row.category }),
          h("td", { text: row.score }),
          h("td", { text: row.time })
        ]));
        if (row.remarks) {
          rows.push(h("tr", { class: "export-remarks" }, [
            h("td", { text: "" }),
            h("td", { colspan: "4", text: row.remarks })
          ]));
        }
        return rows;
      }, []))
    ]) : h("p", { class: "export-body", text: "No logbook entries available." })
  ]);

  return screen({ title: "Logbook Export", library: true, header: [backBubble("#/training/logbook")] }, [
    h("div", { class: "row wrap gap-8 no-print" }, [
      h("button", {
        class: "btn primary", type: "button",
        onclick: function () { window.print(); }
      }, [document.createTextNode("Print / Save as PDF")]),
      h("span", { class: "t-body-s c-sec", text: "Choose “Save as PDF” in the print dialogue. Suggested name: " + LB.exportFileName() })
    ]),
    LB.filtersAreDefault(filters)
      ? null
      : notice("This export covers the " + entries.length + " entries matching your current logbook filters, not the whole logbook.", "warn"),
    libraryDivider(),
    doc
  ]);
}
