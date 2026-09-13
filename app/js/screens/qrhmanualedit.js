/*
  QrhManualEditScreen — the manual QRH editor (#/qrh/edit/:id).

  Ported from feature-procedures ui/screens/QrhManualEditScreen.kt: title, trigger,
  memory items, checklist flow and notes; per-step role tag, item kind, cockpit
  control + position pickers, spoken wording, MCC/CRM note and expected control ids;
  the callout starter palettes; auto-formatting of "CONTROL — POSITION" so the drill
  runner matches the step; and the authoring warnings.

  Unlike Android — where QrhManualEditStore is in-memory and edits vanish on restart —
  saving here PUTs to /api/qrh-edits, which keeps the draft against the account for as
  long as the subscription is active.
*/
import { h, Content, navigate, Store } from "../core.js";
import { screen, blueCard, bubble, backBubble, notice, primaryButton, outlinedButton, contentUnavailable, selectableChip } from "../ui.js";
import * as P from "../logic/procedures.js";
import { procedureById } from "../data.js";
import { ITEM_KINDS, ITEM_KIND_LABEL, ROLE_TAGS, emptyStep, draftFromDetail, cleanDraft, validateDraft, applyStructure, autoStructure, controlById, defaultFlowRole, normalizedMemorySteps, normalizedFlowSteps } from "../logic/qrhedit.js";
import { loadEdit, saveEdit, clearEdit, canEdit } from "../qrhedits.js";

export async function qrhManualEdit(ctx) {
  const compiledId = ctx.params.id;
  const backHref = "#/procedures/detail/" + encodeURIComponent(compiledId) + "?from=qrh";
  ctx.setTopbar({ title: "Manual QRH Edit", subtitle: "QRH · authoring", back: backHref });

  let procedure = null, catalog = null, saved = null, permitted = false;
  try {
    procedure = await procedureById(compiledId, null, ctx.query.get("variant"));
    catalog = await Content.pack("qrh-editor");
    permitted = await canEdit();
    saved = await loadEdit(compiledId);
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    return screen({ variant: "qrh", header: [backBubble(backHref)], title: "Manual QRH Edit" }, [contentUnavailable("qrh-editor", error)]);
  }
  if (!procedure) {
    return screen({ variant: "qrh", header: [backBubble(backHref)], title: "Manual QRH Edit" }, [notice("Procedure not found.", "warn")]);
  }
  if (!permitted) {
    return screen({ variant: "qrh", header: [backBubble(backHref)], title: "Manual QRH Edit" }, [
      notice("QRH editing requires Instructor, Admin, or Owner access. Pro users can view and complete QRH checklists, but cannot edit source procedures.", "warn")
    ]);
  }

  const sourceDetail = P.toQrhDetail(procedure);
  const draft = saved ? JSON.parse(JSON.stringify(saved)) : draftFromDetail(sourceDetail);
  draft.memoryStepDrafts = normalizedMemorySteps(draft);
  draft.flowStepDrafts = normalizedFlowSteps(draft);

  const root = h("div", { class: "stack-12" });
  const state = { status: null, statusKind: null, busy: false, open: { memory: 0, flow: 0 } };

  function field(label, value, onInput, opts) {
    const o = opts || {};
    const input = o.multiline
      ? h("textarea", { class: "notes-input", rows: String(o.rows || 3), "aria-label": label })
      : h("input", { class: "edit-input", type: "text", "aria-label": label, value: value == null ? "" : String(value) });
    if (o.multiline) input.value = value == null ? "" : String(value);
    input.addEventListener("input", function () { onInput(input.value); });
    return h("label", { class: "edit-field" }, [h("span", { class: "t-label-m c-sec", text: label }), input]);
  }

  function chipRow(label, values, current, onPick) {
    return h("div", { class: "mt-6" }, [
      h("div", { class: "t-label-m c-sec", text: label }),
      h("div", { class: "row gap-6 wrap mt-4" }, values.map(function (v) {
        return selectableChip(typeof v === "string" ? v : v.label, (typeof v === "string" ? v : v.value) === current, function () { onPick(typeof v === "string" ? v : v.value); });
      }))
    ]);
  }

  function stepEditor(lane, index) {
    const list = lane === "memory" ? draft.memoryStepDrafts : draft.flowStepDrafts;
    const step = list[index];
    const expanded = state.open[lane] === index;
    const entry = controlById(catalog, step.targetControlId);

    function update(changes) {
      list[index] = applyStructure(catalog, list[index], changes);
      render();
    }

    const head = h("button", { type: "button", class: "step-head" + (expanded ? " open" : ""), onclick: function () { state.open[lane] = expanded ? -1 : index; render(); } }, [
      h("span", { class: "step-n", text: String(index + 1) }),
      h("span", { class: "grow stack-4" }, [
        h("span", { class: "t-body-m w-semi c-white", text: step.writtenStep || step.spokenWording || "(empty step)" }),
        h("span", { class: "t-label-s c-ter", text: step.roleTag + " · " + (ITEM_KIND_LABEL[step.itemKind] || step.itemKind) })
      ]),
      h("span", { class: "t-label-m c-accent", text: expanded ? "Close" : "Edit" })
    ]);
    if (!expanded) return h("div", { class: "step-card" }, [head]);

    const body = [
      field("Written step (what the checklist shows)", step.writtenStep, function (v) {
        list[index] = autoStructure(catalog, list[index], v);
        render();
      }),
      chipRow("Role", ROLE_TAGS, step.roleTag, function (v) { update({ roleTag: v }); }),
      chipRow("Item kind", ITEM_KINDS.map(function (k) { return { label: ITEM_KIND_LABEL[k], value: k }; }), step.itemKind, function (v) { update({ itemKind: v }); })
    ];

    if (step.itemKind === "ITEM_POSITION") {
      body.push(chipRow("Cockpit control", (catalog.controls || []).map(function (c) { return { label: c.displayName, value: c.controlId }; }), step.targetControlId, function (v) { update({ targetControlId: v, targetPosition: "" }); }));
      if (entry) body.push(chipRow("Position", entry.positions || [], step.targetPosition, function (v) { update({ targetPosition: v }); }));
    }

    body.push(field("Spoken wording (optional)", step.spokenWording, function (v) { list[index].spokenWording = v; }));
    body.push(field("MCC / CRM note (optional)", step.mccCrmNote, function (v) { list[index].mccCrmNote = v; }));
    body.push(field("Expected control ids (comma separated)", step.expectedControlIds, function (v) { list[index].expectedControlIds = v; }));
    body.push(h("label", { class: "row gap-8 mt-8" }, [
      (function () {
        const box = h("input", { type: "checkbox", "aria-label": "Requires confirmation" });
        box.checked = step.requiresConfirmation !== false;
        box.addEventListener("change", function () { list[index].requiresConfirmation = box.checked; });
        return box;
      })(),
      h("span", { class: "t-body-s c-sec", text: "Requires confirmation" })
    ]));
    body.push(h("div", { class: "row gap-8 mt-10 wrap" }, [
      outlinedButton("Move up", function () { if (index > 0) { const t = list[index - 1]; list[index - 1] = list[index]; list[index] = t; state.open[lane] = index - 1; render(); } }, { small: true, disabled: index === 0 }),
      outlinedButton("Move down", function () { if (index < list.length - 1) { const t = list[index + 1]; list[index + 1] = list[index]; list[index] = t; state.open[lane] = index + 1; render(); } }, { small: true, disabled: index === list.length - 1 }),
      outlinedButton("Delete step", function () { list.splice(index, 1); state.open[lane] = -1; render(); }, { small: true })
    ]));

    return h("div", { class: "step-card open" }, [head, h("div", { class: "step-body" }, body)]);
  }

  function lane(title, key, templates, subtitle) {
    const list = key === "memory" ? draft.memoryStepDrafts : draft.flowStepDrafts;
    return blueCard([
      h("div", { class: "row between wrap gap-8" }, [
        h("div", { class: "stack-4 grow" }, [
          h("div", { class: "t-title-m w-bold c-white", text: title }),
          h("div", { class: "t-body-s c-sec", text: subtitle })
        ]),
        h("span", { class: "pill info", text: list.length + " steps" })
      ]),
      h("div", { class: "stack-8 mt-10" }, list.map(function (_, index) { return stepEditor(key, index); })),
      h("div", { class: "mt-10" }, [
        h("div", { class: "t-label-m c-sec", text: "Add a step" }),
        h("div", { class: "row gap-6 wrap mt-4" }, (templates || []).map(function (t) {
          return h("button", { type: "button", class: "choice-btn", text: t.label, onclick: function () {
            list.push(emptyStep({ writtenStep: t.writtenStep, roleTag: t.roleTag, itemKind: t.itemKind }));
            state.open[key] = list.length - 1;
            render();
          } });
        }).concat([
          h("button", { type: "button", class: "choice-btn on", text: "+ Blank step", onclick: function () {
            list.push(emptyStep({ roleTag: key === "memory" ? "PF" : defaultFlowRole(list.length) }));
            state.open[key] = list.length - 1;
            render();
          } })
        ]))
      ])
    ]);
  }

  async function persist() {
    if (state.busy) return;
    state.busy = true;
    state.status = "Saving…"; state.statusKind = null; render();
    try {
      await saveEdit(compiledId, cleanDraft(draft));
      state.status = "Saved to your account. This edit follows you to any device while your subscription is active.";
      state.statusKind = "ok";
    } catch (error) {
      state.status = error && error.status === 403
        ? "Your account is not permitted to edit QRH procedures, or the subscription is no longer active."
        : "Could not save (" + ((error && error.message) || "unknown error") + ").";
      state.statusKind = "error";
    }
    state.busy = false;
    render();
  }

  async function revert() {
    if (state.busy) return;
    state.busy = true; render();
    try {
      await clearEdit(compiledId);
      navigate("/procedures/detail/" + encodeURIComponent(compiledId) + "?from=qrh");
      return;
    } catch (error) {
      state.status = "Could not reset (" + ((error && error.message) || "unknown error") + ").";
      state.statusKind = "error";
    }
    state.busy = false;
    render();
  }

  function render() {
    const warnings = validateDraft(catalog, draft);
    const blocking = warnings.filter(function (w) { return w.level === "error"; });
    root.replaceChildren(
      h("div", { class: "row between wrap gap-8" }, [bubble("light", "Back", { href: backHref }), saved ? h("span", { class: "badge", text: "Edited" }) : null]),
      blueCard([
        h("div", { class: "t-headline-s w-bold c-white", text: "Manual QRH Edit" }),
        h("div", { class: "t-body-s c-sec mt-4", text: "Edits are stored against your account and stay available on every device while your subscription is active. They never change the published procedure for anyone else." }),
        field("Procedure title", draft.title, function (v) { draft.title = v; }),
        field("Condition / trigger", draft.trigger, function (v) { draft.trigger = v; }, { multiline: true, rows: 2 })
      ]),
      lane("Memory Items", "memory", catalog.memoryCallouts, "Recalled before the checklist is opened."),
      lane("Complete QRH Checklist", "flow", catalog.flowCallouts, "Read-and-do actions, confirmations and follow-up items."),
      blueCard([
        h("div", { class: "t-title-m w-bold c-white", text: "Notes" }),
        field("One note per line", (draft.notes || []).join("\n"), function (v) { draft.notes = v.split("\n"); }, { multiline: true, rows: 3 })
      ]),
      warnings.length
        ? blueCard([
          h("div", { class: "t-title-m w-bold c-white", text: "Authoring checks" }),
          h("div", { class: "stack-6 mt-8" }, warnings.map(function (w) { return notice(w.text, w.level === "error" ? "error" : "warn"); }))
        ])
        : null,
      state.status ? notice(state.status, state.statusKind) : null,
      h("div", { class: "row gap-8 equal-row" }, [
        primaryButton(state.busy ? "Working…" : "Save edit", persist, { block: true, disabled: state.busy || blocking.length > 0 }),
        outlinedButton("Cancel", function () { navigate("/procedures/detail/" + encodeURIComponent(compiledId) + "?from=qrh"); }, { block: true })
      ]),
      saved ? h("div", { class: "mt-8" }, outlinedButton("Reset to the published procedure", revert, { block: true, disabled: state.busy })) : null,
      h("p", { class: "t-body-s c-ter mt-10", text: "Training support only. Anything you author here is your own material and does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation." }),
      h("div", { class: "spacer-24" })
    );
  }

  render();
  Store.recordRecent({ id: compiledId, kind: "qrh-edit", title: draft.title });
  return screen({ variant: "qrh", ariaLabel: "Manual QRH Edit" }, [root]);
}
