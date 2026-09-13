/*
  Edit State — the ScenarioStateEditSheetV2 / ScenarioStateToggleEditorDialog /
  ScenarioStateNotesEditorDialog flow from feature-cockpit, ported to the browser.

  Available on the Scenario State and Focus Snapshot screens for any signed-in
  subscriber or the owner (Android: `subscriptionActive || allowPrivilegedEdits`).
  Edits are per-browser, exactly like the Android overrides in `filesDir`: they
  never touch the published Android snapshots.
*/
import { h } from "../core.js";
import { sheet, primaryButton, outlinedButton, notice } from "../ui.js";
import { savePhaseOverride, clearPhaseOverride, hasOverride } from "./cockpitcommon.js";
import { EDITOR_COPY, STYLE, buildToggleOptions, initialEnabledKeys, initialValues, coerceValue, stepOrdered, stepNumeric, withToggleSelection, phaseOverridePayload } from "../logic/cockpit/stateeditor.js";

/* Android gates on an active subscription; a web session only exists for one. */
export function canEditScenarioState() {
  try {
    const session = window.DHC6Session && window.DHC6Session.get();
    return Boolean(session && session.ok);
  } catch (error) { return false; }
}

function categoriesOf(options) {
  const order = [];
  const byCategory = new Map();
  options.forEach(function (o) {
    if (!byCategory.has(o.category)) { byCategory.set(o.category, []); order.push(o.category); }
    byCategory.get(o.category).push(o);
  });
  return order.map(function (name) { return { name: name, options: byCategory.get(name) }; });
}

function choiceButton(label, selected, onClick, opts) {
  const o = opts || {};
  return h("button", {
    type: "button",
    class: "choice-btn" + (selected ? " on" : "") + (o.grow ? " grow" : ""),
    disabled: o.disabled ? "" : null,
    onclick: onClick,
    text: label
  });
}

/* ------------------------------------------------- one editable option row */
function optionRow(option, state, onChange) {
  const enabled = state.enabled.has(option.key);
  const value = state.values[option.key];
  const controls = [];

  if (option.style === STYLE.STATE_ON_OFF) {
    controls.push(h("div", { class: "row gap-6 equal-row" }, [
      choiceButton("ON", enabled, function () { state.enabled.add(option.key); onChange(); }, { grow: true }),
      choiceButton("OFF", !enabled, function () { state.enabled.delete(option.key); onChange(); }, { grow: true })
    ]));
  } else if (option.style === STYLE.VALUE_ON_OFF) {
    controls.push(h("div", { class: "row gap-6 equal-row" }, ["ON", "OFF"].map(function (choice) {
      return choiceButton(choice, String(value).toUpperCase() === choice, function () { state.values[option.key] = choice; onChange(); }, { grow: true });
    })));
  } else if (option.style === STYLE.SEGMENTED_CHOICE) {
    controls.push(h("div", { class: "row gap-6 wrap" }, option.choices.map(function (choice) {
      return choiceButton(choice, String(value).toUpperCase() === choice.toUpperCase(), function () { state.values[option.key] = choice; onChange(); });
    })));
  } else if (option.style === STYLE.ORDERED_STEPPER) {
    controls.push(h("div", { class: "row gap-6 stepper-row" }, [
      choiceButton("DOWN", false, function () { state.values[option.key] = stepOrdered(option, value, -1); onChange(); }, { grow: true }),
      h("span", { class: "stepper-value", text: String(value) }),
      choiceButton("UP", false, function () { state.values[option.key] = stepOrdered(option, value, 1); onChange(); }, { grow: true })
    ]));
  } else {
    const input = h("input", {
      class: "stepper-input", type: "text", inputmode: "decimal", value: String(value), "aria-label": option.label,
      onchange: function (e) { state.values[option.key] = coerceValue(option, e.target.value); onChange(); }
    });
    controls.push(h("div", { class: "row gap-6 stepper-row" }, [
      choiceButton("−", false, function () { state.values[option.key] = stepNumeric(option, state.values[option.key], -1); onChange(); }, { grow: true }),
      input,
      choiceButton("+", false, function () { state.values[option.key] = stepNumeric(option, state.values[option.key], 1); onChange(); }, { grow: true })
    ]));
    const range = [option.minimum == null ? null : "min " + option.minimum, option.maximum == null ? null : "max " + option.maximum].filter(Boolean).join(" · ");
    if (range) controls.push(h("div", { class: "t-label-s c-ter mt-4", text: range + " · step " + option.step }));
  }

  return h("div", { class: "edit-row" }, [
    h("div", { class: "t-title-s c-white", text: option.label }),
    h("div", { class: "mt-6" }, controls)
  ]);
}

/* ------------------------------------------------ the three toggle editors */
function openToggleEditor(section, ctxState, onSaved, onCancel) {
  const phaseState = ctxState.phaseState;
  const options = buildToggleOptions(section, phaseState);
  const state = { enabled: initialEnabledKeys(section, phaseState, options), values: initialValues(section, phaseState, options) };
  const copy = EDITOR_COPY[section];
  const body = h("div", { class: "edit-body" });
  /* Android dismisses the edit sheet before showing a dialog; sheet() does the same. */
  const panel = sheet({ title: copy.title, subtitle: copy.subtitle, wide: true, children: [body] });

  function render() {
    const groups = categoriesOf(options);
    body.replaceChildren.apply(body, [].concat(
      options.length ? groups.map(function (group) {
        return h("section", { class: "edit-group" }, [
          h("h3", { class: "t-label-l c-accent", text: group.name }),
          h("div", { class: "stack-10 mt-6" }, group.options.map(function (o) { return optionRow(o, state, render); }))
        ]);
      }) : [notice(copy.empty, "warn")],
      [h("div", { class: "row gap-8 mt-12 sheet-actions" }, [
        outlinedButton("Cancel", function () { panel.close(); onCancel(); }),
        primaryButton("Save phase", function () {
          onSaved(withToggleSelection(phaseState, section, options, state.enabled, state.values));
        })
      ])]
    ));
  }
  render();
  return panel;
}

/* --------------------------------------------------------- notes editor */
function openNotesEditor(ctxState, onSaved, onCancel) {
  const area = h("textarea", { class: "notes-input", rows: "6", "aria-label": "Phase notes" });
  const panel = sheet({
    title: "Edit Notes",
    subtitle: "Instructor notes shown with this phase. Training guidance only — never a substitute for the approved AFM, QRH or company procedure.",
    children: [
      area,
      h("div", { class: "row gap-8 mt-12 sheet-actions" }, [
        outlinedButton("Cancel", function () { panel.close(); onCancel(); }),
        primaryButton("Save notes", function () {
          onSaved(Object.assign({}, ctxState.phaseState, { notes: area.value.trim() || null }));
        })
      ])
    ]
  });
  area.value = ctxState.phaseState.notes || "";
  return panel;
}

/* --------------------------------------------------------- the edit sheet */
function actionCard(title, subtitle, onClick) {
  return h("button", { type: "button", class: "edit-action", onclick: onClick }, [
    h("div", { class: "t-title-m c-white", text: title }),
    h("div", { class: "t-body-s c-sec mt-4", text: subtitle })
  ]);
}

/*
  opts: { procKey, phase, title, variant, phaseState, onSaved }
  `phaseState` is the humanized ScenarioPhaseState (toPhaseState output).
  `onSaved()` is called after a successful write so the screen can re-render.
*/
export function openEditStateSheet(opts) {
  const ctxState = { phaseState: opts.phaseState };
  let lastError = null;

  function persist(updated) {
    ctxState.phaseState = updated;
    const ok = savePhaseOverride(opts.procKey, opts.phase, phaseOverridePayload(updated), { title: opts.title, variant: opts.variant });
    if (!ok) { lastError = "Could not save — this browser is blocking local storage, so the edit was not kept."; open(); return; }
    lastError = null;
    open();
    if (opts.onSaved) opts.onSaved(updated);
  }

  function open() {
    const panel = sheet({
      title: "Edit State",
      subtitle: "Change what the " + opts.phase + " phase shows. Edits are kept in this browser only and never change the published procedure.",
      children: [
        lastError ? notice(lastError, "error") : null,
        h("div", { class: "stack-10" }, [
          actionCard("Annunciators / Caution Lights", "Choose which lights or CAS messages are ON for this phase.", function () { openToggleEditor("ANNUNCIATORS", ctxState, persist, open); }),
          actionCard("Instrument Indications", "Set prepared gauge values — torque, NG, NP, T5, fuel flow, oil, hydraulics.", function () { openToggleEditor("INSTRUMENTS", ctxState, persist, open); }),
          actionCard("Controls / Configuration", "Set lever positions, switches, crossfeed, flaps, trim and lights.", function () { openToggleEditor("CONTROLS", ctxState, persist, open); }),
          actionCard("Notes", "Instructor notes shown with this phase.", function () { openNotesEditor(ctxState, persist, open); })
        ]),
        hasOverride(opts.procKey)
          ? h("div", { class: "mt-12" }, [
            notice("This procedure is using your edited state.", "ok"),
            h("div", { class: "mt-8" }, outlinedButton("Reset to published state", function () {
              clearPhaseOverride(opts.procKey);
              panel.close();
              if (opts.onSaved) opts.onSaved(null);
            }, { block: true }))
          ])
          : null,
        h("div", { class: "row gap-8 mt-12 sheet-actions" }, [outlinedButton("Done", function () { panel.close(); }, { block: true })]),
        h("p", { class: "t-body-s c-ter mt-10", text: "Training support only. Edited states do not replace the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation." })
      ]
    });
    return panel;
  }
  return open();
}
