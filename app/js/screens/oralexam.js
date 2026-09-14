/*
  ORAL EXAM — the Premium AI examiner.

  The last registry row that still said "Coming later". Its reason had been
  true and stopped being true: the explanation named a session-gated proxy, a
  confirmed upstream and a configured API key as the three things missing, and
  phase 36 delivered all three. The endpoint has been sitting there, secured
  and AI_TRAINER-gated, with nothing calling it.

  The examiner's material and its brief live in ../logic/oralexam.js — read the
  header there first, because the safety decision is in it: this screen never
  asks a model to recall DHC-6 figures. Every session carries the app's own
  authored knowledge-pool units and the examiner is confined to them.

  Three things this screen is careful about:

  - The transcript is never stored. Not in localStorage, not in the logbook, not
    on the server. It is a practice conversation, and one that would otherwise
    accumulate an answer key in browser storage that sign-out has to remember to
    clear. It lives as long as the tab does.
  - A 503 is not a refusal. `entitlement_check_unavailable` means a binding is
    missing or Google is having a bad morning; rendering that as "you do not
    have this feature" would send a paying subscriber to the billing page over
    an outage at our end.
  - The question count is visible before the first question. Each one is a paid
    upstream call, and a cap the user discovers by hitting it feels like a
    fault.
*/

import { h, Content, feature, Entitlements, currentVariant, variantLabel, tierLabel } from "../core.js";
import { screen, blueCard, backBubble, matButton, outlinedButton, statusPill, notice, contentUnavailable, selectableChip, paint } from "../ui.js";
import {
  MAX_QUESTIONS, OPENING_TURN, systemsIn, systemLabel, pickUnits, toRequest,
  replyText, refusalFor, appendTurn, questionsAsked, atLimit, questionCap, questionCapForCount
} from "../logic/oralexam.js";

const DISCLAIMER = "Training support only. This is not a check ride and does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or an authorised examiner.";

export async function askExaminer(units, turns) {
  const response = await fetch("/api/ai/oral-exam", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toRequest(units, turns))
  });
  let body = null;
  try { body = await response.json(); } catch (error) { body = null; }
  if (!response.ok) {
    return { ok: false, refusal: refusalFor(response.status, body && body.error) };
  }
  const text = replyText(body);
  if (!text) return { ok: false, refusal: refusalFor(502, "empty_reply") };
  return { ok: true, text: text };
}

export async function oralExam(ctx) {
  ctx.setTopbar({ title: "Oral Exam", subtitle: "Premium AI examiner", back: "#/dashboard" });

  const f = feature("oral-exam");

  /* A courtesy, not a control: the endpoint re-checks the entitlement on every
     call. Unknown (the first verify still in flight) is not treated as absent. */
  if (Entitlements.known() && !Entitlements.has("AI_TRAINER")) {
    return screen({ title: "Oral Exam", library: true, header: [backBubble("#/dashboard")] }, [
      h("div", { class: "row wrap gap-8" }, [statusPill("locked")]),
      blueCard([
        h("div", { class: "t-title-m w-bold c-white", text: "Premium feature" }),
        h("p", { class: "t-body-m mt-8", text: "The AI oral exam is part of the " + tierLabel("PRO") + " plan." }),
        h("div", { class: "mt-10" }, [outlinedButton("See your plan", function () { window.location.hash = "#/settings"; }, { small: true })])
      ]),
      h("p", { class: "t-body-s c-ter mt-10", text: DISCLAIMER })
    ]);
  }

  let pool;
  try {
    pool = await Content.pack("knowledge-pool");
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    return screen({ title: "Oral Exam", library: true, header: [backBubble("#/dashboard")] }, [contentUnavailable("knowledge-pool", error)]);
  }

  const variant = currentVariant();
  const systems = systemsIn(pool);
  const root = h("div", { class: "stack-12" });

  let chosen = null;      /* null = every system */
  let units = [];
  let turns = [];
  let busy = false;
  let refusal = null;
  let started = false;

  function answerValue() {
    const box = root.querySelector("[data-answer]");
    return box ? String(box.value || "").trim() : "";
  }

  async function send(text) {
    if (busy) return;
    busy = true;
    refusal = null;
    turns = appendTurn(turns, "candidate", text);
    render();
    const result = await askExaminer(units, turns);
    busy = false;
    if (result.ok) turns = appendTurn(turns, "examiner", result.text);
    else refusal = result.refusal;
    render();
    focusLatest();
  }

  function focusLatest() {
    const latest = root.querySelector("[data-latest]");
    if (latest && latest.focus) { try { latest.focus(); } catch (error) { /* ignore */ } }
  }

  function start() {
    units = pickUnits(pool, { system: chosen, variant: variant });
    if (!units.length) { refusal = { title: "No material for that topic", body: "There is nothing in the bundled decks for that system on this airframe variant.", retry: false }; render(); return; }
    started = true;
    turns = [];
    send(OPENING_TURN.text);
  }

  function reset() {
    started = false;
    turns = [];
    units = [];
    refusal = null;
    render();
  }

  /* ------------------------------------------------------------- render */

  function topicPicker() {
    const chips = [selectableChip("Every system", chosen === null, function () { chosen = null; render(); })].concat(
      systems.map(function (entry) {
        /* The count is the material; the cap is what it can honestly ask. */
        const cap = questionCapForCount(entry.count);
        const label = systemLabel(entry.system) + " (" + (cap < MAX_QUESTIONS ? cap + (cap === 1 ? " question" : " questions") : entry.count) + ")";
        return selectableChip(label, chosen === entry.system, function () { chosen = entry.system; render(); });
      })
    );
    return blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "Choose a topic" }),
      h("p", { class: "t-body-s c-ter mt-4", text: "The examiner asks only about the training content bundled in this app, for the " + variantLabel(variant) + " airframe. Up to " + MAX_QUESTIONS + " questions, or fewer where a topic has less material." }),
      h("div", { class: "row gap-8 wrap mt-10" }, chips),
      h("div", { class: "mt-10" }, [matButton("Begin", start)])
    ]);
  }

  function turnCard(turn, isLatest) {
    const examiner = turn.role === "examiner";
    return h("div", { class: "blue-card", style: examiner ? "" : "background:rgba(255,255,255,.04)" }, [
      h("div", { class: "t-label-s c-ter", text: examiner ? "Examiner" : "You" }),
      h("p", {
        class: "t-body-m mt-4",
        style: "white-space:pre-wrap",
        tabindex: isLatest ? "-1" : null,
        "data-latest": isLatest ? "true" : null,
        text: turn.text
      })
    ]);
  }

  function refusalCard() {
    return h("div", { class: "blue-card", style: "border-color:var(--sem-caution)" }, [
      h("div", { class: "t-title-m w-bold c-white", text: refusal.title }),
      h("p", { class: "t-body-m mt-8", text: refusal.body }),
      h("div", { class: "row gap-8 wrap mt-10" }, [
        refusal.retry ? outlinedButton("Try again", function () {
          /* Drop the unanswered candidate turn so the retry does not stack a
             second copy of the same answer into the transcript. */
          if (turns.length && turns[turns.length - 1].role === "candidate") {
            const last = turns[turns.length - 1].text;
            turns = turns.slice(0, -1);
            send(last);
          } else { render(); }
        }, { small: true }) : null,
        refusal.action ? outlinedButton(refusal.action.label, function () {
          if (refusal.action.href.charAt(0) === "#") window.location.hash = refusal.action.href;
          else window.location.href = refusal.action.href;
        }, { small: true }) : null
      ])
    ]);
  }

  function answerBox() {
    const box = h("textarea", {
      class: "field-input",
      rows: "3",
      "data-answer": "true",
      "aria-label": "Your answer",
      placeholder: "Your answer",
      style: "width:100%;resize:vertical"
    });
    const submit = function () {
      const value = answerValue();
      if (!value) return;
      box.value = "";
      send(value);
    };
    box.addEventListener("keydown", function (event) {
      /* Enter sends, Shift+Enter is a newline — the convention anybody typing
         into a conversation already expects. */
      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
    });
    return h("div", { class: "stack-8" }, [
      box,
      h("div", { class: "row gap-8 wrap" }, [
        matButton(busy ? "Sending…" : "Send answer", submit, { disabled: busy }),
        outlinedButton("End session", reset, { small: true })
      ])
    ]);
  }

  function render() {
    if (!started) {
      paint(root, [
        h("div", { class: "row wrap gap-8" }, [statusPill(f.status)]),
        refusal ? refusalCard() : null,
        topicPicker(),
        h("p", { class: "t-body-s c-ter mt-10", text: DISCLAIMER })
      ]);
      return;
    }

    const asked = questionsAsked(turns);
    const cap = questionCap(units);
    const finished = atLimit(turns, units);
    const visible = turns.filter(function (turn, index) {
      /* The opening "I am ready to begin" is scaffolding for the endpoint, not
         something the candidate said. */
      return !(index === 0 && turn.role === "candidate");
    });

    paint(root, [
      h("div", { class: "row between gap-8 wrap" }, [
        h("span", { class: "t-label-m c-sec", text: (chosen ? systemLabel(chosen) : "Every system") + " · " + variantLabel(variant) }),
        h("span", { class: "t-label-m c-sec", text: "Question " + Math.min(asked, cap) + " of " + cap })
      ]),
      h("div", { class: "stack-12 mt-10" }, visible.map(function (turn, index) {
        return turnCard(turn, index === visible.length - 1);
      })),
      busy && !refusal ? notice("The examiner is thinking…") : null,
      refusal ? refusalCard() : null,
      finished
        ? blueCard([
          h("div", { class: "t-title-m w-bold c-white", text: "That is the end of this session" }),
          h("p", { class: "t-body-s c-ter mt-4", text: "Nothing from this conversation is saved. Start another to keep practising." }),
          h("div", { class: "mt-10" }, [matButton("New session", reset)])
        ])
        : (refusal ? null : answerBox()),
      h("p", { class: "t-body-s c-ter mt-10", text: DISCLAIMER })
    ]);
  }

  render();
  return screen({ title: "Oral Exam", library: true, header: [backBubble("#/dashboard")] }, [root]);
}
