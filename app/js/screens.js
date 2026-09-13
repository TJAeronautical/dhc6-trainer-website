/*
  Screen renderers for the DHC-6 Trainer web app. Every screen renders from
  the protected content packs (transformed 1:1 from the Android app's
  core-res assets) — nothing here hard-codes aviation values.
*/

import { h, esc, frag, titleCase, relativeTime, Store, Content, navigate, FEATURES, feature, STATUS_LABEL, currentVariant, variantBody, groupTone } from "./core.js";

/* ---------------------------------------------------------------- helpers */
function packOrNotice(id, render) {
  return async function (ctx) {
    if (!Content.manifest) await Content.loadManifest();
    if (!Content.manifest.published) return notPublished(ctx, id);
    if (!Content.hasPack(id)) return notPublished(ctx, id);
    let data;
    try { data = await Content.pack(id); } catch (error) {
      if (error && (error.status === 401 || error.status === 403)) { window.DHC6Session && window.DHC6Session.verify().catch(function () {}); }
      return errorView(ctx, "This content could not be loaded" + (Content.offline ? " while offline." : ".") + " Try again when you are back online.");
    }
    return render(ctx, data);
  };
}

function notPublished(ctx, packId) {
  return h("div", { class: "empty-state" }, [
    h("p", { html: "<strong>Content pack not published yet.</strong>" }),
    h("p", { text: "The pack “" + packId + "” has not been published to the protected content store for this site. The owner publishes it with tools/build-content.mjs + wrangler (see WEB_APP_SECURITY.md)." })
  ]);
}

function errorView(ctx, message) {
  return h("div", { class: "empty-state" }, [h("p", { text: message }), h("button", { class: "btn btn-sm", style: "margin-top:10px", onclick: function () { window.location.reload(); } }, "Retry")]);
}

function statusPill(status) {
  return h("span", { class: "status-pill", dataset: { status: status } }, STATUS_LABEL[status] || status);
}

function setTitle(ctx, title, subtitle, back) {
  ctx.setTopbar({ title: title, subtitle: subtitle || "", back: back || null });
}

function splitAction(action) {
  const text = String(action || "");
  const m = text.match(/^(.*?)\s+[-–—]\s+(.+)$/);
  if (m && m[1].length > 2 && m[2].length <= 48) return { label: m[1], value: m[2] };
  const m2 = text.match(/^(.*?)\s*\.{3,}\s*(.+)$/);
  if (m2) return { label: m2[1], value: m2[2] };
  return { label: text, value: null };
}

function categoryFrom(id) { return String(id.split("/")[0] || "").toUpperCase(); }

async function loadProcedure(category, slug) {
  const pack = await Content.pack("procedures-" + category.toLowerCase());
  return (pack.procedures || []).find(function (p) { return p.slug === slug; }) || null;
}

/* ------------------------------------------------------------------- HOME */
export async function home(ctx) {
  setTitle(ctx, "DHC-6 Trainer", "Twin Otter study");
  const manifest = Content.manifest || await Content.loadManifest();
  const session = window.DHC6Session && window.DHC6Session.get();
  const hero = h("section", { class: "home-hero" }, [
    h("span", { class: "eyebrow", text: "Subscriber web app · " + (session && session.role === "owner" ? "Owner access" : "Active subscription") }),
    h("h2", { text: "Welcome, Pilot" }),
    h("p", { text: "DHC-6 Series 300 Twin Otter · " + currentVariant() + " cockpit" })
  ]);

  const quick = ["qrh", "drill", "checklists", "performance"].map(function (id) {
    const f = feature(id);
    return h("a", { class: "quick-tile", href: f.route, dataset: { status: f.status } }, [
      statusPill(f.status),
      h("span", { class: "tile-icon", text: f.icon }),
      h("strong", { text: f.title }),
      h("span", { text: id === "qrh" ? "Quick Reference Handbook" : id === "drill" ? "Practice questions" : id === "checklists" ? "Normal / Abnormal / Emergency" : "Take-off, landing & VREF tables" })
    ]);
  });

  const recent = (Store.get("recent") || []).slice(0, 5);
  const recentList = recent.length ? h("div", { class: "recent-list" }, recent.map(function (item) {
    return h("a", { class: "recent-item", href: item.route }, [
      h("span", { class: "ri-icon", text: item.icon || "▦" }),
      h("span", {}, [h("strong", { text: item.title }), h("small", { text: item.subtitle || "" })]),
      h("time", { text: relativeTime(item.ts) })
    ]);
  })) : h("div", { class: "empty-state", text: "Your recent QRH items, checklists, drills and flashcard sessions will appear here." });

  const contentStatus = manifest.published
    ? h("p", { class: "muted", text: "Content version " + manifest.version + " · " + (manifest.packs || []).length + " packs from the Android app assets" + (Content.offline ? " · offline copy" : "") })
    : h("div", { class: "callout warn", html: "<strong>Training content is not published yet.</strong> Screens will show the exact procedure, checklist, flashcard, limitation, MEL and performance data from the Android app once the owner publishes the content packs (see WEB_APP_SECURITY.md)." });

  return frag([
    hero,
    h("div", { class: "quick-grid" }, quick),
    h("div", { class: "section-head" }, [h("h3", { text: "Recent activity" }), h("a", { href: "#/logbook", text: "View all" })]),
    recentList,
    h("div", { class: "section-head" }, [h("h3", { text: "All modules" }), h("a", { href: "#/more", text: "Open list" })]),
    h("div", { class: "feature-list" }, FEATURES.filter(function (f) { return f.nav !== "primary" && f.id !== "settings"; }).slice(0, 6).map(featureRow)),
    h("div", { style: "margin-top:14px" }, contentStatus)
  ]);
}

function featureRow(f) {
  const tag = f.status === "later" ? "div" : "a";
  return h(tag, { class: "feature-row", href: f.status === "later" ? null : f.route, dataset: { status: f.status } }, [
    h("span", { class: "fr-icon", text: f.icon }),
    h("span", {}, [h("strong", { text: f.title }), h("small", { text: f.desc })]),
    statusPill(f.status)
  ]);
}

/* ------------------------------------------------------------------- MORE */
export async function more(ctx) {
  setTitle(ctx, "More", "All modules and their status");
  return frag([
    h("p", { class: "muted", style: "margin-bottom:12px", text: "Available = fully usable from Android data · Partial = usable, port in progress · Coming later = not yet available in the browser." }),
    h("div", { class: "feature-list" }, FEATURES.filter(function (f) { return f.id !== "home"; }).map(featureRow))
  ]);
}

export function laterScreen(id) {
  return async function (ctx) {
    const f = feature(id) || { title: titleCase(id), desc: "", status: "later", icon: "▦" };
    setTitle(ctx, f.title, STATUS_LABEL[f.status], "#/more");
    return h("div", { class: "card" }, [
      h("h3", { text: f.icon + "  " + f.title }),
      statusPill(f.status),
      h("p", { style: "margin-top:10px", text: f.desc }),
      h("p", { class: "muted", style: "margin-top:10px", text: "This module exists in the Android app. It has not been ported to the browser yet; it will only be marked Available once it works end-to-end with the authoritative Android data." })
    ]);
  };
}

/* -------------------------------------------------------------------- QRH */
function qrhItems(index) {
  return index.items.filter(function (i) { return i.category === "ABNORMAL" || i.category === "EMERGENCY"; });
}

function procedureRow(item) {
  const tone = groupTone(item.procedureGroup);
  const body = item.counts && (item.counts[currentVariant()] || item.counts.LEGACY || item.counts.G950 || {});
  return h("a", { class: "lib-row", href: "#/procedure/" + encodeURIComponent(item.id), dataset: { category: item.category } }, [
    h("span", { class: "row-icon", text: item.category === "EMERGENCY" ? "!" : item.category === "ABNORMAL" ? "▲" : "☑" }),
    h("span", {}, [h("strong", { text: item.title }), h("small", { text: (item.procedureGroup || item.category) + (body && body.memory ? " · " + body.memory + " items" : "") + (item.sourceSection ? " · §" + item.sourceSection : "") })]),
    h("span", { class: "chev", text: "›" })
  ]);
}

export const qrh = packOrNotice("procedures-index", async function (ctx, index) {
  setTitle(ctx, "QRH", "Quick Reference Handbook");
  const tab = ctx.query.get("tab") || "categories";
  const items = qrhItems(index);
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["categories", "Categories"], ["all", "All items"], ["favorites", "Favorites"]].map(function (t) {
    return h("button", { class: "tab", role: "tab", "aria-selected": String(tab === t[0]), onclick: function () { navigate("/qrh?tab=" + t[0]); } }, t[1]);
  }));
  let body;
  if (tab === "categories") {
    const groups = {};
    items.forEach(function (i) { const g = i.procedureGroup || "Other"; (groups[g] = groups[g] || []).push(i); });
    const order = Object.keys(groups).sort(function (a, b) {
      const ea = groups[a].some(function (i) { return i.category === "EMERGENCY"; }) ? 0 : 1;
      const eb = groups[b].some(function (i) { return i.category === "EMERGENCY"; }) ? 0 : 1;
      return ea - eb || a.localeCompare(b);
    });
    body = h("div", { class: "lib-list" }, order.map(function (g) {
      const tone = groupTone(g);
      const emergency = groups[g].some(function (i) { return i.category === "EMERGENCY"; });
      return h("a", { class: "lib-row", href: "#/qrh/group/" + encodeURIComponent(g) }, [
        h("span", { class: "row-icon", dataset: { tone: tone.tone }, text: tone.icon }),
        h("span", {}, [h("strong", { text: g }), h("small", { text: groups[g].length + " items" + (emergency ? " · includes emergency" : "") })]),
        h("span", { class: "chev", text: "›" })
      ]);
    }));
  } else if (tab === "favorites") {
    const favs = items.filter(function (i) { return Store.isFavorite(i.id); });
    body = favs.length ? h("div", { class: "lib-list" }, favs.map(procedureRow)) : h("div", { class: "empty-state", text: "Star a procedure to keep it here." });
  } else {
    const input = h("input", { class: "search-field", type: "search", placeholder: "Search procedures…", "aria-label": "Search procedures" });
    const list = h("div", { class: "lib-list" });
    const render = function () {
      const q = input.value.trim().toLowerCase();
      list.replaceChildren.apply(list, items.filter(function (i) { return !q || (i.title + " " + (i.procedureGroup || "")).toLowerCase().indexOf(q) > -1; }).map(procedureRow));
    };
    input.addEventListener("input", render); render();
    body = frag([input, list]);
  }
  return h("div", { class: "lib" }, [tabs, body]);
});

export const qrhGroup = packOrNotice("procedures-index", async function (ctx, index) {
  const group = ctx.params.group;
  setTitle(ctx, group, "QRH category", "#/qrh");
  const items = qrhItems(index).filter(function (i) { return (i.procedureGroup || "Other") === group; });
  return h("div", { class: "lib" }, [
    h("p", { class: "lib-label", text: items.length + " procedures" }),
    h("div", { class: "lib-list" }, items.map(procedureRow))
  ]);
});

/* -------------------------------------------------------------- PROCEDURE */
export async function procedure(ctx) {
  if (!Content.manifest) await Content.loadManifest();
  const id = ctx.params.id;
  const category = categoryFrom(id).toLowerCase();
  const slug = id.split("/").slice(1).join("/");
  if (!Content.hasPack("procedures-" + category)) return notPublished(ctx, "procedures-" + category);
  let proc;
  try { proc = await loadProcedure(category, slug); } catch (error) { return errorView(ctx, "Procedure could not be loaded."); }
  if (!proc) return errorView(ctx, "Procedure not found in the published content.");

  const variant = currentVariant();
  const body = variantBody(proc, variant);
  const backTo = proc.category === "NORMAL" ? "#/checklists" : "#/qrh";
  setTitle(ctx, proc.title, proc.category + (proc.procedureGroup ? " · " + proc.procedureGroup : ""), backTo);
  Store.recordRecent({ id: proc.id, title: proc.title, subtitle: (proc.category === "NORMAL" ? "Checklist" : "QRH") + " · " + proc.category, route: "#/procedure/" + encodeURIComponent(proc.id), icon: proc.category === "EMERGENCY" ? "!" : proc.category === "ABNORMAL" ? "▲" : "☑" });

  const progressKey = proc.id + ":" + variant;
  const progress = Store.get("checklistProgress") || {};
  let done = new Set(progress[progressKey] || []);
  let mode = ctx.query.get("mode") || "checklist";
  let hideValues = false;

  const favBtn = h("button", { class: "btn btn-sm btn-ghost", "aria-pressed": String(Store.isFavorite(proc.id)), onclick: function () { const on = Store.toggleFavorite(proc.id); favBtn.setAttribute("aria-pressed", String(on)); favBtn.textContent = on ? "★ Favourite" : "☆ Favourite"; } }, Store.isFavorite(proc.id) ? "★ Favourite" : "☆ Favourite");

  const stepsEl = h("div", { class: "steps" });
  const progressBar = h("div", { class: "progress" }, h("span"));
  const progressText = h("p", { class: "muted" });

  function saveProgress() {
    const all = Store.get("checklistProgress") || {};
    all[progressKey] = Array.from(done);
    Store.set("checklistProgress", all);
  }

  function renderSteps() {
    const steps = mode === "flow" ? body.flow : body.memory;
    stepsEl.replaceChildren();
    if (!steps.length) {
      stepsEl.appendChild(h("div", { class: "empty-state", text: "No " + (mode === "flow" ? "PF/PM flow" : "checklist") + " steps are published for the " + variant + " variant of this procedure." }));
    }
    steps.forEach(function (step, i) {
      const parts = splitAction(step.action);
      const key = mode + ":" + i;
      const isDone = done.has(key);
      const row = h("button", { class: "step" + (isDone ? " done" : "") + (step.requiresConfirmation ? " memory" : ""), type: "button", "aria-pressed": String(isDone), onclick: function () {
        if (isDone) done.delete(key); else done.add(key);
        saveProgress(); renderSteps();
      } }, [
        h("span", { class: "step-num", text: String(step.n) }),
        h("span", { class: "step-text" }, [
          parts.value ? h("span", { class: "leader" }, [h("span", { text: parts.label }), h("span", { class: "dots" }), h("span", { class: "value", text: hideValues && !isDone ? "•••" : parts.value })]) : h("span", { text: parts.label }),
          (step.intent || step.requiresConfirmation) ? h("span", { class: "step-sub", text: [step.intent ? titleCase(step.intent) : null, step.requiresConfirmation ? "Requires confirmation" : null].filter(Boolean).join(" · ") }) : null,
          step.note ? h("span", { class: "step-sub", text: step.note }) : null
        ]),
        h("span", { class: "role-tag", dataset: { role: step.crewRole }, text: step.crewRole })
      ]);
      stepsEl.appendChild(row);
    });
    const total = steps.length;
    const count = steps.filter(function (s, i) { return done.has(mode + ":" + i); }).length;
    progressBar.firstChild.style.width = (total ? Math.round(count * 100 / total) : 0) + "%";
    progressText.textContent = count + " of " + total + " complete";
    if (total && count === total) {
      Store.recordAttempt({ type: proc.category === "NORMAL" ? "checklist" : "qrh", title: proc.title, correct: total, total: total, variant: variant, mode: mode });
    }
  }

  const modeSeg = h("div", { class: "seg", role: "group", "aria-label": "View" }, [["checklist", "Checklist"], ["flow", "PF / PM flow"]].map(function (m) {
    return h("button", { type: "button", "aria-pressed": String(mode === m[0]), onclick: function () { mode = m[0]; Array.from(modeSeg.children).forEach(function (b, i) { b.setAttribute("aria-pressed", String([["checklist"], ["flow"]][i][0] === mode)); }); renderSteps(); } }, m[1]);
  }));

  const tools = h("div", { class: "proc-tools" }, [
    modeSeg,
    h("button", { class: "btn btn-sm", type: "button", onclick: function () { hideValues = !hideValues; this.textContent = hideValues ? "Show responses" : "Drill: hide responses"; renderSteps(); } }, "Drill: hide responses"),
    h("button", { class: "btn btn-sm btn-ghost", type: "button", onclick: function () { done = new Set(); saveProgress(); renderSteps(); } }, "Reset"),
    favBtn
  ]);

  renderSteps();

  const references = Array.from(new Set((body.memory.concat(body.flow)).map(function (s) { return s.reference; }).filter(Boolean)));
  return h("div", { class: "lib" }, [
    h("div", { class: "proc-head" }, [
      h("span", { class: "cat-badge", dataset: { category: proc.category }, text: proc.category }),
      h("span", { class: "proc-meta", text: [proc.phaseTag || proc.context, proc.manualSection, proc.sourceSection ? "§" + proc.sourceSection : null, variant + " variant"].filter(Boolean).join(" · ") })
    ]),
    h("h2", { class: "proc-title", text: proc.title }),
    proc.variantsAvailable.indexOf(variant) === -1 ? h("div", { class: "callout warn", text: "This procedure is published for " + proc.variantsAvailable.join(" / ") + " only; showing the closest available variant." }) : null,
    tools,
    progressBar, progressText,
    h("p", { class: "lib-label", text: mode === "flow" ? "PF / PM callout flow" : "Procedure" }),
    stepsEl,
    proc.sourceNote ? h("div", { class: "note-box" }, [h("strong", { text: "Source note" }), h("span", { text: proc.sourceNote })]) : null,
    references.length ? h("div", { class: "note-box" }, [h("strong", { text: "References" }), h("span", { text: references.join(" · ") })]) : null,
    h("div", { class: "callout danger", text: "Training reference only — perform procedures from the approved QRH / AFM / company checklist." })
  ]);
}

/* ------------------------------------------------------------- CHECKLISTS */
export const checklists = packOrNotice("procedures-index", async function (ctx, index) {
  setTitle(ctx, "Checklists", "Normal · Abnormal · Emergency");
  const tab = (ctx.query.get("tab") || "normal").toUpperCase();
  const tabs = h("div", { class: "tabs", role: "tablist" }, ["NORMAL", "ABNORMAL", "EMERGENCY"].map(function (t) {
    return h("button", { class: "tab", role: "tab", "aria-selected": String(tab === t), onclick: function () { navigate("/checklists?tab=" + t.toLowerCase()); } }, t);
  }));
  const items = index.items.filter(function (i) { return i.category === tab; }).sort(function (a, b) { return a.sortOrder - b.sortOrder; });
  const sections = [];
  if (tab === "NORMAL") {
    const bySplit = {};
    items.forEach(function (i) { const s = i.normalSplit || "Procedures"; (bySplit[s] = bySplit[s] || []).push(i); });
    ["Everyday Actions", "System Tests", "Weather / Special Conditions"].concat(Object.keys(bySplit)).forEach(function (s) {
      if (!bySplit[s] || sections.some(function (x) { return x.title === s; })) return;
      sections.push({ title: s, items: bySplit[s] });
    });
  } else {
    const byGroup = {};
    items.forEach(function (i) { const g = i.procedureGroup || "Other"; (byGroup[g] = byGroup[g] || []).push(i); });
    Object.keys(byGroup).sort().forEach(function (g) { sections.push({ title: g, items: byGroup[g] }); });
  }
  return h("div", { class: "lib" }, [tabs].concat(sections.map(function (s) {
    return frag([h("p", { class: "lib-label", text: s.title + " · " + s.items.length }), h("div", { class: "lib-list" }, s.items.map(procedureRow))]);
  })));
});

/* ------------------------------------------------------------------ DRILL */
function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = out[i]; out[i] = out[j]; out[j] = t; }
  return out;
}

export const drill = packOrNotice("quiz-bank", async function (ctx, quiz) {
  setTitle(ctx, "Drill", "Practice questions");
  const questions = quiz.data.questions || [];
  const systems = Array.from(new Set(questions.map(function (q) { return q.system; }))).sort();
  const mode = ctx.query.get("mode");
  if (mode === "run") return runQuizDrill(ctx, questions);
  if (mode === "memory") return memoryDrillSetup(ctx);

  const chips = h("div", { class: "chips" });
  const selected = new Set(systems);
  systems.forEach(function (s) {
    const chip = h("button", { class: "chip", type: "button", "aria-pressed": "true", onclick: function () { if (selected.has(s)) selected.delete(s); else selected.add(s); chip.setAttribute("aria-pressed", String(selected.has(s))); } }, titleCase(s.replace(/_/g, " ")));
    chips.appendChild(chip);
  });
  const countSel = h("select", { class: "search-field", style: "margin:0", "aria-label": "Number of questions" }, [10, 20, 30].map(function (n) { return h("option", { value: String(n), text: n + " questions" }); }));
  return frag([
    h("div", { class: "card" }, [
      h("h3", { text: "Knowledge drill" }), statusPill("partial"),
      h("p", { class: "muted", style: "margin:8px 0 12px", text: questions.length + " questions from the bundled question bank (" + esc(quiz.data.source || "") + "). Reveal-and-grade format; the Android multiple-choice generator is being ported." }),
      h("p", { class: "lib-label", text: "Systems" }), chips,
      h("div", { class: "form-grid", style: "margin-top:12px" }, [countSel]),
      h("div", { class: "fc-actions", style: "margin-top:12px" }, [h("button", { class: "btn btn-primary", type: "button", onclick: function () {
        const ids = questions.filter(function (q) { return selected.has(q.system); }).map(function (q) { return q.id; });
        if (!ids.length) return;
        sessionStorage.setItem("dhc6.drill.session", JSON.stringify({ ids: shuffle(ids).slice(0, Number(countSel.value)), started: Date.now() }));
        navigate("/drill?mode=run");
      } }, "Start drill")])
    ]),
    h("div", { class: "card", style: "margin-top:12px" }, [
      h("h3", { text: "Memory-item drill" }), statusPill("available"),
      h("p", { class: "muted", style: "margin:8px 0 12px", text: "Recall the next action of an emergency or abnormal procedure, step by step, from the Android procedure data." }),
      h("a", { class: "btn", href: "#/drill?mode=memory" }, "Choose procedure")
    ]),
    recentAttempts("drill")
  ]);
});

function recentAttempts(type) {
  const attempts = (Store.get("attempts") || []).filter(function (a) { return !type || a.type === type; }).slice(0, 5);
  if (!attempts.length) return null;
  return frag([
    h("div", { class: "section-head" }, [h("h3", { text: "Recent sessions" }), h("a", { href: "#/logbook", text: "Logbook" })]),
    h("div", { class: "recent-list" }, attempts.map(function (a) {
      return h("div", { class: "recent-item" }, [h("span", { class: "ri-icon", text: "◎" }), h("span", {}, [h("strong", { text: a.title }), h("small", { text: a.correct + " / " + a.total + " correct" })]), h("time", { text: relativeTime(a.ts) })]);
    }))
  ]);
}

function runQuizDrill(ctx, questions) {
  let session = null;
  try { session = JSON.parse(sessionStorage.getItem("dhc6.drill.session") || "null"); } catch (error) { session = null; }
  if (!session || !session.ids || !session.ids.length) { navigate("/drill", true); return h("div"); }
  setTitle(ctx, "Drill", "Knowledge questions", "#/drill");
  const byId = {}; questions.forEach(function (q) { byId[q.id] = q; });
  const list = session.ids.map(function (id) { return byId[id]; }).filter(Boolean);
  let i = 0, correct = 0, revealed = false;
  const started = Date.now();
  const wrap = h("div");
  const timer = h("span", { class: "mono-num", text: "00:00" });
  const tick = setInterval(function () {
    const s = Math.floor((Date.now() - started) / 1000);
    timer.textContent = String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    if (!document.body.contains(timer)) clearInterval(tick);
  }, 1000);

  function render() {
    if (i >= list.length) {
      clearInterval(tick);
      Store.recordAttempt({ type: "drill", title: "Knowledge drill", correct: correct, total: list.length, seconds: Math.round((Date.now() - started) / 1000) });
      Store.recordRecent({ id: "drill:" + Date.now(), title: "Knowledge drill", subtitle: correct + " / " + list.length + " correct", route: "#/drill", icon: "◎" });
      wrap.replaceChildren(h("div", { class: "card" }, [
        h("h3", { text: "Session complete" }),
        h("div", { class: "score-grid" }, [
          h("div", { class: "score-tile" }, [h("strong", { text: String(correct) }), h("span", { text: "Correct" })]),
          h("div", { class: "score-tile" }, [h("strong", { text: String(list.length - correct) }), h("span", { text: "Missed" })]),
          h("div", { class: "score-tile" }, [h("strong", { text: Math.round(correct * 100 / list.length) + "%" }), h("span", { text: "Score" })])
        ]),
        h("div", { class: "fc-actions" }, [h("a", { class: "btn btn-primary", href: "#/drill" }, "New drill"), h("a", { class: "btn", href: "#/logbook" }, "Open logbook")])
      ]));
      return;
    }
    const q = list[i];
    const answer = h("div", { class: "explain", hidden: !revealed }, [h("strong", { text: "Answer" }), h("p", { style: "margin-top:6px", text: q.content })]);
    const buttons = h("div", { class: "fc-actions", style: "margin-top:14px" }, revealed ? [
      h("button", { class: "btn", type: "button", style: "color:var(--emergency)", onclick: function () { i++; revealed = false; render(); } }, "Missed"),
      h("button", { class: "btn btn-primary", type: "button", onclick: function () { correct++; i++; revealed = false; render(); } }, "Correct — next")
    ] : [h("button", { class: "btn btn-primary", type: "button", onclick: function () { revealed = true; render(); } }, "Reveal answer")]);
    wrap.replaceChildren(
      h("div", { class: "drill-status" }, [h("span", { text: "Question " + (i + 1) + " of " + list.length }), timer]),
      h("div", { class: "progress" }, h("span", { style: "width:" + Math.round(i * 100 / list.length) + "%" })),
      h("p", { class: "muted", text: titleCase(String(q.system).replace(/_/g, " ")) + (q.importanceLevel ? " · " + titleCase(q.importanceLevel) : "") + (q.aircraftVariant && q.aircraftVariant !== "BOTH" ? " · " + q.aircraftVariant : "") }),
      h("p", { class: "drill-question", text: q.title }),
      answer, buttons
    );
  }
  render();
  return wrap;
}

async function memoryDrillSetup(ctx) {
  setTitle(ctx, "Memory-item drill", "Choose a procedure", "#/drill");
  if (!Content.hasPack("procedures-index")) return notPublished(ctx, "procedures-index");
  const index = await Content.pack("procedures-index");
  const items = index.items.filter(function (i) { return i.category !== "NORMAL"; });
  return h("div", { class: "lib" }, [h("div", { class: "lib-list" }, items.map(function (item) {
    return h("a", { class: "lib-row", href: "#/drill/memory/" + encodeURIComponent(item.id), dataset: { category: item.category } }, [
      h("span", { class: "row-icon", text: item.category === "EMERGENCY" ? "!" : "▲" }),
      h("span", {}, [h("strong", { text: item.title }), h("small", { text: (item.procedureGroup || item.category) })]),
      h("span", { class: "chev", text: "›" })
    ]);
  }))]);
}

export async function memoryDrill(ctx) {
  if (!Content.manifest) await Content.loadManifest();
  const id = ctx.params.id;
  const category = categoryFrom(id).toLowerCase();
  const proc = Content.hasPack("procedures-" + category) ? await loadProcedure(category, id.split("/").slice(1).join("/")) : null;
  if (!proc) return errorView(ctx, "Procedure not available.");
  setTitle(ctx, proc.title, "Memory-item drill · " + currentVariant(), "#/drill?mode=memory");
  const steps = variantBody(proc).memory;
  let i = 0, correct = 0, revealed = false;
  const wrap = h("div");
  function render() {
    if (i >= steps.length) {
      Store.recordAttempt({ type: "drill", title: proc.title + " (memory items)", correct: correct, total: steps.length });
      wrap.replaceChildren(h("div", { class: "card" }, [h("h3", { text: "Drill complete" }), h("div", { class: "score-grid" }, [
        h("div", { class: "score-tile" }, [h("strong", { text: String(correct) }), h("span", { text: "Recalled" })]),
        h("div", { class: "score-tile" }, [h("strong", { text: String(steps.length - correct) }), h("span", { text: "Missed" })]),
        h("div", { class: "score-tile" }, [h("strong", { text: (steps.length ? Math.round(correct * 100 / steps.length) : 0) + "%" }), h("span", { text: "Score" })])
      ]), h("div", { class: "fc-actions" }, [h("a", { class: "btn btn-primary", href: "#/procedure/" + encodeURIComponent(proc.id) }, "Open procedure"), h("a", { class: "btn", href: "#/drill?mode=memory" }, "Another procedure")])]));
      return;
    }
    const step = steps[i];
    const parts = splitAction(step.action);
    const prev = i > 0 ? steps[i - 1] : null;
    wrap.replaceChildren(
      h("div", { class: "drill-status" }, [h("span", { text: "Step " + (i + 1) + " of " + steps.length }), h("span", { text: step.crewRole })]),
      h("div", { class: "progress" }, h("span", { style: "width:" + Math.round(i * 100 / steps.length) + "%" })),
      prev ? h("p", { class: "muted", text: "Previous: " + prev.action }) : h("p", { class: "muted", text: "First step — what happens first?" }),
      h("p", { class: "drill-question", text: revealed ? step.action : (parts.value ? parts.label + " — ?" : "Next action?") }),
      h("div", { class: "fc-actions" }, revealed ? [
        h("button", { class: "btn", type: "button", style: "color:var(--emergency)", onclick: function () { i++; revealed = false; render(); } }, "Missed"),
        h("button", { class: "btn btn-primary", type: "button", onclick: function () { correct++; i++; revealed = false; render(); } }, "Correct — next")
      ] : [h("button", { class: "btn btn-primary", type: "button", onclick: function () { revealed = true; render(); } }, "Reveal")])
    );
  }
  render();
  return wrap;
}

/* ------------------------------------------------------------- FLASHCARDS */
export const flashcards = packOrNotice("flashcards", async function (ctx, pack) {
  const deckId = ctx.params.deck;
  if (deckId) return studyDeck(ctx, pack, deckId);
  setTitle(ctx, "Flashcards", pack.deckCount + " decks · " + pack.cardCount + " cards");
  const stats = Store.get("flashcardStats") || {};
  return h("div", { class: "lib" }, [h("div", { class: "lib-list" }, pack.decks.map(function (deck) {
    const s = stats[deck.deckId] || {};
    return h("a", { class: "lib-row", href: "#/flashcards/" + encodeURIComponent(deck.deckId) }, [
      h("span", { class: "row-icon", dataset: { tone: groupTone(deck.systemId).tone }, text: "❐" }),
      h("span", {}, [h("strong", { text: deck.deckName }), h("small", { text: deck.cards.length + " cards · " + titleCase(deck.difficulty || "") + (s.best != null ? " · best " + s.best + "%" : "") })]),
      h("span", { class: "chev", text: "›" })
    ]);
  }))]);
});

function studyDeck(ctx, pack, deckId) {
  const deck = pack.decks.find(function (d) { return d.deckId === deckId; });
  if (!deck) return errorView(ctx, "Deck not found.");
  setTitle(ctx, deck.deckName, deck.cards.length + " cards", "#/flashcards");
  Store.recordRecent({ id: "deck:" + deck.deckId, title: deck.deckName, subtitle: "Flashcards", route: "#/flashcards/" + encodeURIComponent(deck.deckId), icon: "❐" });
  let order = shuffle(deck.cards), i = 0, got = 0, again = [];
  const wrap = h("div");
  function render() {
    if (i >= order.length) {
      if (again.length) { order = shuffle(again); again = []; i = 0; render(); return; }
      const pct = Math.round(got * 100 / deck.cards.length);
      Store.update("flashcardStats", function (s) { s = s || {}; s[deck.deckId] = { best: Math.max(pct, (s[deck.deckId] || {}).best || 0), last: Date.now() }; return s; });
      Store.recordAttempt({ type: "flashcards", title: deck.deckName, correct: got, total: deck.cards.length });
      wrap.replaceChildren(h("div", { class: "card" }, [h("h3", { text: "Deck complete" }), h("p", { text: got + " of " + deck.cards.length + " known on first pass." }), h("div", { class: "fc-actions", style: "margin-top:12px" }, [h("button", { class: "btn btn-primary", type: "button", onclick: function () { order = shuffle(deck.cards); i = 0; got = 0; render(); } }, "Study again"), h("a", { class: "btn", href: "#/flashcards" }, "All decks")])]));
      return;
    }
    const card = order[i];
    const cardEl = h("div", { class: "fc-card", role: "button", tabindex: "0", "aria-label": "Flip card" }, h("div", { class: "fc-inner" }, [
      h("div", { class: "fc-face" }, [h("p", { class: "fc-q", text: card.front }), h("p", { class: "fc-hint", text: "Tap to reveal" })]),
      h("div", { class: "fc-face fc-back" }, [h("p", { class: "fc-a", text: card.back }), card.references && card.references.length ? h("p", { class: "fc-ref", text: card.references.map(function (r) { return r.source + (r.locator ? " " + r.locator : ""); }).join(" · ") }) : null])
    ]));
    const flip = function () { cardEl.classList.toggle("flipped"); };
    cardEl.addEventListener("click", flip);
    cardEl.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    wrap.replaceChildren(
      h("div", { class: "drill-status" }, [h("span", { text: "Card " + (i + 1) + " of " + order.length }), h("span", { text: deck.systemId })]),
      h("div", { class: "progress" }, h("span", { style: "width:" + Math.round(i * 100 / order.length) + "%" })),
      cardEl,
      h("div", { class: "fc-actions" }, [
        h("button", { class: "btn", type: "button", style: "color:var(--emergency)", onclick: function () { again.push(card); i++; render(); } }, "Review again"),
        h("button", { class: "btn btn-primary", type: "button", onclick: function () { got++; i++; render(); } }, "Got it"),
        h("span", { class: "muted", style: "margin-left:auto", text: "Known " + got })
      ])
    );
  }
  render();
  return wrap;
}

/* ------------------------------------------------------------ LIMITATIONS */
export const limitations = packOrNotice("limitations", async function (ctx, pack) {
  const data = pack.data;
  setTitle(ctx, "Limitations", data.source || "");
  return frag([
    h("p", { class: "muted", style: "margin-bottom:12px", text: "Source: " + (data.source || "bundled Android asset") + ". Verify against the current approved AFM/POH before use." })
  ].concat(data.sections.map(function (section) {
    return h("div", { class: "card", style: "margin-bottom:12px" }, [
      h("h3", { text: section.title }),
      section.reference ? h("p", { class: "muted", style: "margin-bottom:8px", text: section.reference }) : null,
      h("div", { class: "lib-list" }, section.items.map(function (item) {
        return h("dl", { class: "kv" }, [
          h("dt", {}, [h("span", { text: item.label }), item.condition ? h("small", { class: "muted", style: "display:block", text: item.condition }) : null, item.note ? h("small", { class: "muted", style: "display:block", text: item.note }) : null]),
          h("dd", { dataset: { band: item.band || "" } }, [h("span", { text: item.value }), item.valueSub ? h("small", { class: "muted", style: "display:block;font-weight:600", text: item.valueSub }) : null])
        ]);
      }))
    ]);
  })));
});

/* -------------------------------------------------------------------- MEL */
export const mel = packOrNotice("mel", async function (ctx, pack) {
  const data = pack.data;
  setTitle(ctx, "MEL", "Training reference");
  const goLabel = { GO: "GO", GO_WITH_RESTRICTION: "GO with restriction", NO_GO: "NO GO" };
  const goBand = { GO: "green", GO_WITH_RESTRICTION: "amber", NO_GO: "red" };
  return frag([
    h("div", { class: "callout danger", text: data.disclaimer || "Consult the operator-approved MEL before dispatch." }),
    h("p", { class: "muted", style: "margin-bottom:12px", text: "Source: " + (data.source || "") })
  ].concat(data.categories.map(function (cat) {
    return h("div", { class: "card", style: "margin-bottom:12px" }, [h("h3", { text: cat.title }), h("div", { class: "lib-list" }, cat.items.map(function (item) {
      return h("details", { class: "kv", style: "display:block" }, [
        h("summary", { style: "cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-weight:800" }, [h("span", { text: item.item }), h("span", { dataset: { band: goBand[item.go_status] || "" }, style: "color:var(--" + ({ green: "normal", amber: "caution", red: "emergency" })[goBand[item.go_status]] + ")", text: goLabel[item.go_status] || item.go_status })]),
        h("div", { class: "muted", style: "margin-top:8px;display:grid;gap:4px" }, [
          h("span", { text: "Installed " + item.qty_installed + " · required " + item.qty_required + " · category " + item.category + (item.rect_interval_days ? " · " + item.rect_interval_days + " days" : "") }),
          item.placard ? h("span", { html: "<strong>Placard:</strong> " + esc(item.placard) }) : null,
          item.crew_procedure ? h("span", { html: "<strong>Crew:</strong> " + esc(item.crew_procedure) }) : null,
          item.maintenance_action ? h("span", { html: "<strong>Maintenance:</strong> " + esc(item.maintenance_action) }) : null,
          item.reference ? h("span", { text: item.reference }) : null
        ])
      ]);
    }))]);
  })));
});

/* ------------------------------------------------------------ PERFORMANCE */
export const performance = packOrNotice("performance", async function (ctx, pack) {
  const tables = pack.tables;
  const tab = ctx.query.get("tab") || "takeoff";
  setTitle(ctx, "Performance", "Bundled QRH tables");
  const tabs = h("div", { class: "tabs", role: "tablist" }, [["takeoff", "Takeoff"], ["landing", "Landing"], ["vref", "VREF"], ["speeds", "Speeds"]].map(function (t) {
    return h("button", { class: "tab", role: "tab", "aria-selected": String(tab === t[0]), onclick: function () { navigate("/performance?tab=" + t[0]); } }, t[1]);
  }));
  let body;
  if (tab === "takeoff" || tab === "landing") body = distanceTable(tables, tab);
  else if (tab === "vref") body = vrefTable(tables);
  else body = referenceSpeeds(tables);
  return h("div", { class: "lib" }, [tabs, body, h("div", { class: "note-box" }, [h("strong", { text: "Notes from the bundled table" }), h("ul", { style: "margin:6px 0 0 16px;padding:0" }, (tables.notes || []).map(function (n) { return h("li", { text: n }); }))])]);
});

function distanceTable(tables, which) {
  const t = tables[which];
  const source = which === "takeoff" ? tables.source_takeoff : tables.source_landing;
  const weightSel = h("select", {}, t.weights_lb.map(function (w) { return h("option", { value: String(w), text: w.toLocaleString() + " lb" }); }));
  const tempSel = h("select", {}, t.temps_c.map(function (c) { return h("option", { value: String(c), text: c + " °C" }); }));
  const out = h("div", { class: "result-grid" });
  function calc() {
    const wi = t.weights_lb.indexOf(Number(weightSel.value));
    const ti = t.temps_c.indexOf(Number(tempSel.value));
    const run = t.water_run_ft[wi][ti];
    const d50 = t.dist_to_50ft[wi][ti];
    out.replaceChildren(
      h("div", { class: "result-tile" }, [h("span", { text: which === "takeoff" ? "Water run" : "Water run (from touchdown)" }), h("strong", { text: run.toLocaleString() + " ft" }), h("small", { text: "Authored table value" })]),
      h("div", { class: "result-tile" }, [h("span", { text: which === "takeoff" ? "Distance to 50 ft" : "Distance from 50 ft" }), h("strong", { text: d50.toLocaleString() + " ft" }), h("small", { text: "Calm water · no wind correction" })])
    );
  }
  weightSel.addEventListener("change", calc); tempSel.addEventListener("change", calc); calc();
  return frag([
    h("p", { class: "lib-label", text: (which === "takeoff" ? "Take-off distance" : "Landing distance") + " · " + (which === "takeoff" ? "Flaps 20°" : "Flaps 37.5°") + " · seaplane · PA 0 ft" }),
    h("div", { class: "callout warn", text: "Exact values from the bundled QRH table only. Weights and temperatures are restricted to the authored columns; no interpolation or extrapolation is applied. " + source }),
    h("div", { class: "form-grid two" }, [
      h("div", { class: "field" }, [h("label", { text: "Weight" }), weightSel]),
      h("div", { class: "field" }, [h("label", { text: "OAT" }), tempSel])
    ]),
    out,
    h("div", { class: "table-wrap", style: "margin-top:14px" }, h("table", { class: "data" }, [
      h("thead", {}, h("tr", {}, [h("th", { text: "Weight (lb)" })].concat(t.temps_c.map(function (c) { return h("th", { text: c + " °C run" }); })).concat(t.temps_c.map(function (c) { return h("th", { text: c + " °C to 50 ft" }); })))),
      h("tbody", {}, t.weights_lb.map(function (w, wi) {
        return h("tr", {}, [h("td", { text: w.toLocaleString() })].concat(t.temps_c.map(function (c, ti) { return h("td", { class: "num", text: String(t.water_run_ft[wi][ti]) }); })).concat(t.temps_c.map(function (c, ti) { return h("td", { class: "num", text: String(t.dist_to_50ft[wi][ti]) }); })));
      }))
    ]))
  ]);
}

function vrefTable(tables) {
  const v = tables.vref;
  const weightSel = h("select", {}, v.weights_lb.map(function (w) { return h("option", { value: String(w), text: w.toLocaleString() + " lb" }); }));
  const flapSel = h("select", {}, v.rows.map(function (r) { return h("option", { value: r.flaps, text: "Flaps " + r.flaps + "°" }); }));
  const out = h("div", { class: "result-grid" });
  function calc() {
    const wi = v.weights_lb.indexOf(Number(weightSel.value));
    const row = v.rows.find(function (r) { return r.flaps === flapSel.value; });
    out.replaceChildren(h("div", { class: "result-tile" }, [h("span", { text: "VREF" }), h("strong", { text: row.kias[wi] + " KIAS" }), h("small", { text: "Flaps " + row.flaps + "° · " + Number(weightSel.value).toLocaleString() + " lb" })]));
  }
  weightSel.addEventListener("change", calc); flapSel.addEventListener("change", calc); calc();
  return frag([
    h("p", { class: "lib-label", text: "VREF landing speeds" }),
    h("p", { class: "muted", style: "margin-bottom:10px", text: tables.source_vref || "" }),
    h("div", { class: "form-grid two" }, [h("div", { class: "field" }, [h("label", { text: "Weight" }), weightSel]), h("div", { class: "field" }, [h("label", { text: "Flaps" }), flapSel])]),
    out,
    h("div", { class: "table-wrap", style: "margin-top:14px" }, h("table", { class: "data" }, [
      h("thead", {}, h("tr", {}, [h("th", { text: "Flaps" })].concat(v.weights_lb.map(function (w) { return h("th", { text: w.toLocaleString() + " lb" }); })))),
      h("tbody", {}, v.rows.map(function (r) { return h("tr", {}, [h("td", { text: r.flaps + "°" })].concat(r.kias.map(function (k) { return h("td", { class: "num", text: String(k) }); }))); }))
    ]))
  ]);
}

function referenceSpeeds(tables) {
  const s = tables.reference_speeds || {};
  const p = tables.performance_summary || {};
  const rows = [
    ["V1", s.v1_kias != null ? s.v1_kias + " KIAS" : null, s.v1_note],
    ["VMC", s.vmc_kias != null ? s.vmc_kcas + " KCAS / " + s.vmc_kias + " KIAS" : null, s.vmc_note],
    ["VX", s.vx_kias != null ? s.vx_kcas + " KCAS / " + s.vx_kias + " KIAS" : null, s.vx_note],
    ["VY", s.vy_kias != null ? s.vy_kcas + " KCAS / " + s.vy_kias + " KIAS" : null, s.vy_note],
    ["VYSE", s.vyse_kias != null ? s.vyse_kcas + " KCAS / " + s.vyse_kias + " KIAS" : null, s.vyse_note]
  ].filter(function (r) { return r[1]; });
  const perf = [
    ["OEI rate of climb", p.oei_rate_of_climb_fpm != null ? p.oei_rate_of_climb_fpm + " ft/min" : null, p.oei_roc_note],
    ["OEI service ceiling", p.oei_service_ceiling_ft != null ? p.oei_service_ceiling_ft.toLocaleString() + " ft" : null, null],
    ["Both-engine rate of climb", p.both_eng_roc_fpm != null ? p.both_eng_roc_fpm + " ft/min" : null, p.both_eng_roc_note],
    ["Service ceiling", p.service_ceiling_ft != null ? p.service_ceiling_ft.toLocaleString() + " ft" : null, null],
    ["Maximum operating altitude", p.max_alt_ft != null ? p.max_alt_ft.toLocaleString() + " ft" : null, null]
  ].filter(function (r) { return r[1]; });
  const kv = function (r) { return h("dl", { class: "kv" }, [h("dt", {}, [h("span", { text: r[0] }), r[2] ? h("small", { class: "muted", style: "display:block", text: r[2] }) : null]), h("dd", { text: r[1] })]); };
  return frag([h("p", { class: "lib-label", text: "Reference speeds" }), h("div", { class: "lib-list" }, rows.map(kv)), h("p", { class: "lib-label", text: "Performance summary" }), h("div", { class: "lib-list" }, perf.map(kv))]);
}

/* ------------------------------------------------------------- FUEL / W&B */
export const fuel = packOrNotice("performance", async function (ctx, pack) {
  const f = pack.calculators.fuel;
  setTitle(ctx, "Fuel Planning", "Bundled calculator data", "#/more");
  const fob = h("input", { type: "number", value: String(f.total_usable_lb), min: "0", step: "10", inputmode: "numeric" });
  const phaseSel = h("select", {}, f.burn_rates.map(function (b, i) { return h("option", { value: String(i), text: b.phase }); }));
  const out = h("div", { class: "result-grid" });
  function calc() {
    const rate = f.burn_rates[Number(phaseSel.value)];
    const perHour = rate.lb_per_eng_per_hr * 2;
    const reserveLb = Math.round(perHour * (f.fuel_reserve_rule_min / 60));
    const usable = Math.max(0, Number(fob.value || 0) - reserveLb);
    const minutes = perHour ? Math.floor(usable / perHour * 60) : 0;
    out.replaceChildren(
      h("div", { class: "result-tile" }, [h("span", { text: "Burn (both engines)" }), h("strong", { text: perHour + " lb/hr" }), h("small", { text: rate.note || "" })]),
      h("div", { class: "result-tile" }, [h("span", { text: f.fuel_reserve_rule_min + "-min reserve at this rate" }), h("strong", { text: reserveLb + " lb" }), h("small", { text: f.fuel_reserve_note || "" })]),
      h("div", { class: "result-tile" }, [h("span", { text: "Endurance to reserve" }), h("strong", { text: Math.floor(minutes / 60) + " h " + String(minutes % 60).padStart(2, "0") + " min" }), h("small", { text: "Training estimate at a constant burn" })]),
      h("div", { class: "result-tile" }, [h("span", { text: "Low-level caution" }), h("strong", { text: f.fuel_low_level_trigger_lb + " lb" }), h("small", { text: "Per bundled data" })])
    );
  }
  fob.addEventListener("input", calc); phaseSel.addEventListener("change", calc); calc();
  return frag([
    statusPill("partial"),
    h("div", { class: "callout warn", style: "margin-top:10px", text: "Training estimate using the bundled burn rates (" + (pack.calculators.source || "") + "). Plan fuel with the approved OFP / operator tools." }),
    h("div", { class: "form-grid two" }, [h("div", { class: "field" }, [h("label", { text: "Fuel on board (lb)" }), fob]), h("div", { class: "field" }, [h("label", { text: "Phase" }), phaseSel])]),
    out,
    h("p", { class: "lib-label", text: "Tanks" }),
    h("div", { class: "lib-list" }, f.tanks.map(function (t) { return h("dl", { class: "kv" }, [h("dt", {}, [h("span", { text: t.label }), h("small", { class: "muted", style: "display:block", text: "Feeds " + t.feeds_engine + " · " + t.note })]), h("dd", { text: t.usable_lb + " lb · " + t.usable_usg + " USG" })]); })),
    h("dl", { class: "kv", style: "margin-top:8px" }, [h("dt", { text: "Total usable" }), h("dd", { text: f.total_usable_lb + " lb · " + f.total_usable_usg + " USG · " + f.total_usable_ltrs + " L" }), h("dt", { text: "Unusable / trapped" }), h("dd", { text: f.unusable_lb + " lb / " + f.trapped_lb + " lb" }), h("dt", { text: "Jet A-1 density" }), h("dd", { text: f.jet_a1_density_lbs_per_usg + " lb/USG · " + f.jet_a1_density_kg_per_ltr + " kg/L" })]),
    h("div", { class: "note-box" }, [h("strong", { text: "Crossfeed" }), h("span", { text: f.crossfeed_note })])
  ]);
});

export const wb = packOrNotice("performance", async function (ctx, pack) {
  const w = pack.calculators.weight_and_balance;
  setTitle(ctx, "Weight & Balance", "Bundled reference data", "#/more");
  const kv = function (label, value, note) { return h("dl", { class: "kv" }, [h("dt", {}, [h("span", { text: label }), note ? h("small", { class: "muted", style: "display:block", text: note }) : null]), h("dd", { text: value })]); };
  return frag([
    statusPill("partial"),
    h("div", { class: "callout warn", style: "margin-top:10px", text: "Reference values only (" + (pack.calculators.source || "") + "). The interactive loading sheet is pending the Android calculator port. Use the aircraft-specific W&B forms for dispatch." }),
    h("p", { class: "lib-label", text: "Limits" }),
    h("div", { class: "lib-list" }, [
      kv("Max take-off weight", w.mtow_lb.toLocaleString() + " lb · " + w.mtow_kg.toLocaleString() + " kg"),
      kv("Max landing weight", w.mlw_lb.toLocaleString() + " lb · " + w.mlw_kg.toLocaleString() + " kg"),
      kv("Max ramp weight", w.max_ramp_lb.toLocaleString() + " lb"),
      kv("CG forward limit", w.cg_limits.forward_arm_in + " in · " + w.cg_limits.forward_mac_pct + "% MAC", w.cg_limits.note),
      kv("CG aft limit", w.cg_limits.aft_arm_in + " in · " + w.cg_limits.aft_mac_pct + "% MAC", w.cg_limits.applies_to),
      kv("MAC", w.mac_length_in + " in · LEMAC " + w.lemac_in + " in · TEMAC " + w.temac_in + " in"),
      kv("Datum", w.datum_description, w.qrh_datum_description)
    ]),
    h("p", { class: "lib-label", text: "Standard weights" }),
    h("div", { class: "lib-list" }, Object.keys(w.standard_weights_lb).filter(function (k) { return k !== "note"; }).map(function (k) { return kv(titleCase(k.replace(/_/g, " ")), w.standard_weights_lb[k] + " lb"); })),
    h("p", { class: "muted", text: w.standard_weights_lb.note }),
    h("p", { class: "lib-label", text: "Compartment limits" }),
    h("div", { class: "lib-list" }, Object.keys(w.compartment_limits).map(function (k) { return kv(titleCase(k.replace(/_/g, " ").replace(/ lb.*$/, "")), w.compartment_limits[k] + (k.indexOf("sqft") > -1 ? " lb/sq ft" : " lb")); })),
    h("p", { class: "lib-label", text: "Standard arms" }),
    h("div", { class: "lib-list" }, Object.keys(w.standard_arm_in).filter(function (k) { return k !== "note"; }).map(function (k) { return kv(titleCase(k.replace(/_/g, " ")), w.standard_arm_in[k] + " in"); })),
    h("p", { class: "muted", text: w.standard_arm_in.note })
  ]);
});

/* -------------------------------------------------------------------- CAS */
export const cas = packOrNotice("cas-library", async function (ctx, pack) {
  setTitle(ctx, "CAS Library", "Caution / warning messages", "#/more");
  const variant = currentVariant();
  const libs = pack.libraries.filter(function (l) { return String(l.data.variant || "").toUpperCase() === variant; });
  const levelBand = { WARNING: "red", CAUTION: "amber", ADVISORY: "normal", STATUS: "normal" };
  return frag([
    h("p", { class: "muted", style: "margin-bottom:12px", text: variant + " libraries · switch the variant chip in the top bar to view the other cockpit." })
  ].concat(libs.map(function (lib) {
    return h("div", { class: "card", style: "margin-bottom:12px" }, [h("h3", { text: titleCase(lib.file.replace(/_/g, " ")) }), h("div", { class: "lib-list" }, (lib.data.messages || []).map(function (m) {
      return h("dl", { class: "kv" }, [h("dt", {}, [h("span", { text: m.display }), h("small", { class: "muted", style: "display:block", text: m.canonicalId || "" })]), h("dd", { dataset: { band: levelBand[m.level] || "" }, text: m.level })]);
    }))]);
  })));
});

/* ------------------------------------------------------------------ STRIPS */
export const strips = packOrNotice("maldives-strips", async function (ctx, pack) {
  const data = pack.data;
  setTitle(ctx, "Maldives Strips", "Training reference", "#/more");
  const input = h("input", { class: "search-field", type: "search", placeholder: "Search by name, ICAO, region…" });
  const list = h("div", { class: "lib-list" });
  function render() {
    const q = input.value.trim().toLowerCase();
    const entries = (data.entries || []).filter(function (e) { return !q || [e.name, e.icao, e.iata, e.region, e.country].join(" ").toLowerCase().indexOf(q) > -1; });
    list.replaceChildren.apply(list, entries.map(function (e) {
      return h("details", { class: "kv", style: "display:block" }, [
        h("summary", { style: "cursor:pointer;display:flex;justify-content:space-between;gap:10px;font-weight:800" }, [h("span", { text: e.name }), h("span", { class: "muted", text: (e.icao || "") + (e.iata ? " / " + e.iata : "") })]),
        h("div", { class: "muted", style: "margin-top:8px;display:grid;gap:4px" }, [
          h("span", { text: titleCase(e.type || "") + " · " + e.region + ", " + e.country + " · elev " + e.elevation_ft + " ft" }),
          (e.rwy || []).length ? h("span", { text: "Runways: " + e.rwy.map(function (r) { return r.designator + " " + r.length_m + "×" + r.width_m + " m " + r.surface; }).join("; ") }) : null,
          e.fuel ? h("span", { text: "Fuel: " + e.fuel }) : null,
          h("span", { text: "Customs " + (e.customs ? "yes" : "no") + " · ILS " + (e.ils ? "yes" : "no") }),
          e.notes ? h("span", { text: e.notes }) : null
        ])
      ]);
    }));
  }
  input.addEventListener("input", render); render();
  return frag([h("div", { class: "callout danger", text: data.disclaimer || "" }), h("p", { class: "muted", style: "margin-bottom:12px", text: data.note_on_seaplanes || "" }), input, list]);
});

/* ---------------------------------------------------------------- LOGBOOK */
export async function logbook(ctx) {
  setTitle(ctx, "Debrief Logbook", "Stored in this browser", "#/more");
  const attempts = Store.get("attempts") || [];
  const byType = {};
  attempts.forEach(function (a) { byType[a.type] = (byType[a.type] || 0) + 1; });
  const best = attempts.reduce(function (m, a) { const p = a.total ? a.correct / a.total : 0; return p > m ? p : m; }, 0);
  return frag([
    statusPill("partial"),
    h("div", { class: "score-grid", style: "margin-top:10px" }, [
      h("div", { class: "score-tile" }, [h("strong", { text: String(attempts.length) }), h("span", { text: "Sessions" })]),
      h("div", { class: "score-tile" }, [h("strong", { text: Math.round(best * 100) + "%" }), h("span", { text: "Best score" })]),
      h("div", { class: "score-tile" }, [h("strong", { text: String(Object.keys(byType).length) }), h("span", { text: "Activity types" })])
    ]),
    attempts.length ? h("div", { class: "recent-list" }, attempts.map(function (a) {
      return h("div", { class: "recent-item" }, [h("span", { class: "ri-icon", text: a.type === "flashcards" ? "❐" : a.type === "drill" ? "◎" : "☑" }), h("span", {}, [h("strong", { text: a.title }), h("small", { text: a.type + " · " + a.correct + " / " + a.total + (a.variant ? " · " + a.variant : "") })]), h("time", { text: relativeTime(a.ts) })]);
    })) : h("div", { class: "empty-state", text: "No sessions recorded yet." }),
    h("div", { class: "fc-actions", style: "margin-top:14px" }, [h("button", { class: "btn btn-danger btn-sm", type: "button", onclick: function () { if (window.confirm("Clear all locally stored sessions and progress?")) { Store.clearProgress(); navigate("/logbook", true); window.location.reload(); } } }, "Clear history")]),
    h("p", { class: "muted", style: "margin-top:10px", text: "Cloud sync of progress (as in the Android app) is pending." })
  ]);
}

/* --------------------------------------------------------------- SETTINGS */
export async function settings(ctx) {
  setTitle(ctx, "Settings", "Variant, theme and session");
  const session = window.DHC6Session && window.DHC6Session.get();
  const manifest = Content.manifest;
  const row = function (title, sub, control) { return h("div", { class: "settings-row" }, [h("div", {}, [h("strong", { text: title }), sub ? h("small", { text: sub }) : null]), control]); };
  const variantSeg = h("div", { class: "seg" }, ["LEGACY", "G950"].map(function (v) { return h("button", { type: "button", "aria-pressed": String(currentVariant() === v), onclick: function () { Store.set("variant", v); ctx.applyPrefs(); Array.from(variantSeg.children).forEach(function (b) { b.setAttribute("aria-pressed", String(b.textContent === v)); }); } }, v); }));
  const themeSeg = h("div", { class: "seg" }, [["night", "Night"], ["day", "Day"]].map(function (t) { return h("button", { type: "button", "aria-pressed": String((Store.get("theme") || "night") === t[0]), onclick: function () { Store.set("theme", t[0]); ctx.applyPrefs(); Array.from(themeSeg.children).forEach(function (b, i) { b.setAttribute("aria-pressed", String([["night"], ["day"]][i][0] === t[0])); }); } }, t[1]); }));
  return frag([
    h("div", { class: "card" }, [
      h("h3", { text: "Aircraft" }),
      row("Cockpit variant", "Procedures, CAS messages and cockpit references follow this selection.", variantSeg),
      row("Theme", "Night mirrors the Android app; Day uses the light library surfaces.", themeSeg)
    ]),
    h("div", { class: "card", style: "margin-top:12px" }, [
      h("h3", { text: "Session" }),
      row("Access", session ? (session.role === "owner" ? "Owner session" : "Subscriber · " + (session.plan || "")) + (session.expiresAt ? " · expires " + new Date(session.expiresAt).toLocaleString() : "") : "Session details unavailable offline", h("button", { class: "btn btn-sm btn-danger", type: "button", onclick: function () { window.DHC6Session.signOut(); } }, "Sign out")),
      row("Content", manifest && manifest.published ? "Version " + manifest.version + " · " + (manifest.packs || []).length + " packs" + (Content.offline ? " (offline copy)" : "") : "Not published", h("button", { class: "btn btn-sm", type: "button", onclick: async function () { const { clearContentCache } = await import("./core.js"); await clearContentCache(); window.location.reload(); } }, "Refresh"))
    ]),
    h("div", { class: "card", style: "margin-top:12px" }, [
      h("h3", { text: "Local data" }),
      row("Progress and logbook", "Recent activity, checklist ticks, drill scores and flashcard stats stay in this browser only.", h("button", { class: "btn btn-sm btn-danger", type: "button", onclick: function () { if (window.confirm("Clear all locally stored progress?")) { Store.clearProgress(); window.location.reload(); } } }, "Clear")),
      row("Manage subscription", "Licence, devices and Paddle billing.", h("a", { class: "btn btn-sm", href: "/access.html" }, "Open"))
    ]),
    h("p", { class: "muted", style: "margin-top:12px", text: "Web app " + ctx.version + " · Training support only." })
  ]);
}
