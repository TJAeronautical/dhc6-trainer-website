/*
  CRM / MCC Callout Drill — port of CrmDrillScreen.kt.

  Android drives the other seat's callouts through android.speech.tts. The
  browser equivalent is window.speechSynthesis, which needs no key, no server
  and no network. Everything else is the same state machine.

  Speech is a nicety, not the feature: if the browser has no speechSynthesis, or
  the user has no voices installed, the drill still runs and the screen says so
  rather than silently appearing broken.
*/
import { h, currentVariant } from "../core.js";
import { screen, blueCard, libraryDivider, backBubble, notice, contentUnavailable } from "../ui.js";
import { allProcedures } from "../data.js";
import * as CRM from "../logic/crm.js";

/* ------------------------------------------------------------------ speech */
/*
  One utterance at a time, cancelled whenever the screen changes. Rate 0.9 and
  en-US match TextToSpeech.setSpeechRate(0.9f) / Locale.US in the Kotlin.

  iOS Safari only starts speech from inside a user gesture; every speak() here
  is reached from a tap (start, Confirm, Continue), so that holds.
*/
const Speech = {
  supported: function () {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
  },
  speak: function (text) {
    if (!text || !Speech.supported()) return false;
    try {
      window.speechSynthesis.cancel();
      const utterance = new window.SpeechSynthesisUtterance(text);
      utterance.lang = "en-US";
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
      return true;
    } catch (error) {
      return false;
    }
  },
  stop: function () {
    if (!Speech.supported()) return;
    try { window.speechSynthesis.cancel(); } catch (error) { /* nothing to stop */ }
  }
};

/* Leaving the screen must not leave a voice talking over the next one. */
function stopSpeechOnExit(root) {
  if (typeof window === "undefined" || !window.MutationObserver) return;
  const observer = new window.MutationObserver(function () {
    if (!root.isConnected) { Speech.stop(); observer.disconnect(); }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ------------------------------------------------------------------ screen */
export async function crmDrill(ctx) {
  ctx.setTopbar({ title: "CRM / MCC Callout Drill", subtitle: "PF / PM callout pacing", back: "#/dashboard" });

  const variant = CRM.resolveVariantForContent(currentVariant());
  let procedures;
  try {
    procedures = await allProcedures(variant);
  } catch (error) {
    if (error && (error.status === 401 || error.status === 403)) throw error;
    return screen({ title: "CRM / MCC Callout Drill", library: true, header: [backBubble("#/dashboard")] },
      [contentUnavailable("procedures-*", error)]);
  }

  const drills = CRM.buildCrmDrills(procedures, variant);
  const missing = CRM.missingSources(procedures);

  let state = CRM.selectState();
  const body = h("div", { class: "stack-10" });
  const root = screen({
    title: "CRM / MCC Callout Drill",
    library: true,
    header: [backBubble("#/dashboard"), h("span", { class: "bubble light" }, [document.createTextNode("Variant"), h("small", { text: variant })])]
  }, [body]);
  stopSpeechOnExit(root);

  function setState(next, speakStep) {
    state = next;
    render();
    if (speakStep) {
      const step = CRM.currentStepOf(state);
      const line = CRM.speechFor(step);
      if (line) Speech.speak(line);
    }
  }

  function render() {
    body.textContent = "";
    if (state.mode === "select") selectView(); else runningView();
  }

  /* ------------------------------------------------------------- select */
  function selectView() {
    body.appendChild(blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "CRM / MCC Callout Drill" }),
      h("p", { class: "t-body-s c-sec mt-4", text: "The app reads the opposite crew role's callouts aloud. You say your role's callouts and tap Confirm." }),
      h("div", { class: "t-label-s tap-to-drill", text: "Loaded from the bundled, variant-specific procedure flow assets." })
    ]));

    if (!Speech.supported()) {
      body.appendChild(notice("This browser has no speech synthesis, so the other seat's callouts are shown but not spoken. The drill still runs — read them yourself, or switch to a browser that supports speech."));
    }

    if (missing.length) {
      body.appendChild(notice("Not published to this site yet: " + missing.join(", ") + ". Those drills are hidden rather than shown with substituted content.", "warn"));
    }

    if (!drills.length) {
      body.appendChild(notice("No source-grounded CRM drills are available for the selected aircraft variant."));
      return;
    }

    body.appendChild(h("div", { class: "stack-8" }, drills.map(function (drill) {
      return h("button", {
        class: "crm-drill-row band-" + CRM.categoryBand(drill.category),
        type: "button",
        onclick: function () { setState(CRM.startDrill(drill), true); }
      }, [
        h("span", { class: "grow" }, [
          h("span", { class: "t-title-s w-bold c-white block", text: drill.title }),
          h("span", { class: "t-label-s c-ter block", text: CRM.drillSubtitle(drill) })
        ]),
        h("span", { class: "crm-cat", text: CRM.categoryBadge(drill.category) })
      ]);
    })));
  }

  /* ------------------------------------------------------------ running */
  function runningView() {
    const drill = state.drill;
    const frame = h("div", { class: "crm-running" });
    body.appendChild(frame);
    const push = function (node) { frame.appendChild(node); };

    push(h("div", { class: "row between gap-12" }, [
      h("span", { class: "t-label-m w-bold tap-to-drill grow clamp-2", text: drill.title }),
      h("span", { class: "t-label-m c-ter", text: CRM.progressLabel(state) })
    ]));
    push(h("div", { class: "t-label-s c-ter", text: "Your role: " + drill.traineeRole }));

    const fraction = CRM.progressFraction(state);
    push(h("div", {
      class: "crm-progress", role: "progressbar",
      "aria-valuemin": "0", "aria-valuemax": String(drill.steps.length),
      "aria-valuenow": String(state.isComplete ? drill.steps.length : state.currentStep)
    }, [h("span", { style: "width:" + (fraction * 100).toFixed(2) + "%" })]));

    const list = h("ol", { class: "crm-steps" }, drill.steps.map(function (step, index) {
      const tone = CRM.stepTone(state, index);
      const isCurrent = tone === "current" || tone === "current-you";
      return h("li", {
        class: "crm-step tone-" + tone,
        "aria-current": isCurrent ? "step" : null
      }, [
        h("div", { class: "row gap-6" }, [
          h("span", { class: "crm-crew" + (step.isTrainee ? " you" : ""), text: step.crew }),
          step.isTrainee ? h("span", { class: "t-label-s crm-you-say", text: "YOU SAY" })
            : (step.isTts && isCurrent ? h("span", { class: "t-label-s tap-to-drill", text: "SPOKEN" }) : null)
        ]),
        h("div", { class: "crm-callout t-body-m", text: step.callout })
      ]);
    }));
    push(list);
    push(libraryDivider());

    if (state.isComplete) {
      push(blueCard([h("div", { class: "t-title-m w-bold band-ready center", text: "Drill Complete" })]));
      push(h("button", {
        class: "btn primary wide-btn", type: "button",
        onclick: function () { Speech.stop(); setState(CRM.reset(), false); }
      }, [document.createTextNode("New Drill")]));
    } else {
      push(h("div", { class: "t-label-m c-ter center", text: CRM.promptFor(state) }));
      push(h("button", {
        class: "btn " + (CRM.currentStepOf(state).isTrainee ? "primary" : "tonal") + " wide-btn",
        type: "button",
        onclick: function () {
          const next = CRM.confirmStep(state);
          if (next.isComplete) { setState(next, false); Speech.speak(CRM.COMPLETE_SPEECH); }
          else setState(next, true);
        }
      }, [document.createTextNode(CRM.confirmLabel(state))]));
    }

    /* Keep the current callout in view without yanking the whole page. */
    window.requestAnimationFrame(function () {
      const active = list.querySelector('[aria-current="step"]');
      if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
    });
  }

  render();
  return root;
}
