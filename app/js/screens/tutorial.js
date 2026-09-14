/*
  APP TUTORIAL — the quick guide Android replays from Settings › Help.

  Five areas, which are the five Android names: procedures, QRH, drill, cockpit
  and settings. A welcome and a finish bracket them.

  Every step carries the ROUTE it describes and the feature registry id it is
  about, and a test walks both: a step that points at a route the router does
  not have, or describes a feature the registry says is not available, fails the
  build. A tutorial that teaches a screen somebody cannot open is worse than no
  tutorial, and it is exactly what drifts first.

  Nothing here states an aviation fact. It describes the app.
*/

import { h, Store, feature } from "../core.js";
import { screen, blueCard, backBubble, matButton, outlinedButton } from "../ui.js";

const SEEN_KEY = "tutorialSeenVersion";
/* Bumped when the steps change enough that a returning user should be offered
   it again. Not on every edit - that would nag. */
export const TUTORIAL_VERSION = 1;

export const STEPS = [
  {
    id: "welcome",
    title: "Welcome to the DHC-6 Trainer",
    body: "This is the same training app as the Android edition, running in your browser. Five tabs across the bottom on a phone, down the side on a larger screen: Home, Procs, Aircraft, QRH and Settings.",
    hint: "Everything works offline once it has loaded, so it keeps going on a strip with no signal."
  },
  {
    id: "procedures",
    feature: "procedures",
    title: "Procedures",
    body: "The full procedure library — normal, abnormal and emergency — with search, category filters and the normal-checklist subsections. Pin the ones you are working on and they stay at the top.",
    hint: "Green, yellow and red keep their meaning throughout the app.",
    route: "#/systems",
    action: "Open Procedures"
  },
  {
    id: "qrh",
    feature: "qrh",
    title: "QRH",
    body: "The QRH tab stays focused on memory items for rapid recall, ordered exactly as the aircraft's own QRH orders them. The complete checklist is on each procedure's own screen.",
    route: "#/qrh",
    action: "Open QRH"
  },
  {
    id: "drill",
    feature: "procedure-detail",
    title: "Drill",
    body: "Open any procedure and start a drill: MEMORY, then FLOW, then SUMMARY. It scores your recall and how long each step took, and writes the result to your logbook.",
    hint: "A drill that needs a cockpit action will not advance until you make it.",
    route: "#/systems",
    action: "Pick a procedure to drill"
  },
  {
    id: "cockpit",
    feature: "aircraft-state",
    title: "Aircraft State",
    body: "Scenario states, frozen cockpit snapshots and a free-play cockpit, in the Legacy or G950 variant. Choose a scenario and the panel is set the way that situation leaves it.",
    route: "#/live",
    action: "Open Aircraft State"
  },
  {
    id: "settings",
    feature: "settings",
    title: "Settings",
    body: "Your plan and what it includes, which browsers are signed in, offline downloads, the cockpit variant, and dark mode. This tutorial lives here too, under Help.",
    route: "#/settings",
    action: "Open Settings"
  },
  {
    id: "finish",
    title: "That is the tour",
    body: "Home has Quick Launch for the things you reach for most: the logbook, Check Ride Readiness, the performance, fuel and weight-and-balance calculators, and Import for your own manuals.",
    /* The same sentence the Systems, cockpit and Library screens carry, word
       for word. A disclaimer that is phrased differently in each place reads
       as boilerplate; one that is identical everywhere reads as the rule. */
    hint: "Training support only. This app does not replace the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation."
  }
];

export function tutorialSeen() {
  return Number(Store.get(SEEN_KEY) || 0) >= TUTORIAL_VERSION;
}

export function markTutorialSeen() {
  return Store.set(SEEN_KEY, TUTORIAL_VERSION);
}

/*
  A step is shown only when the feature it describes is actually available to
  this account. The registry already knows - reading it here means a tile that
  goes back to "coming later", or a feature this plan does not include, drops
  out of the tour rather than sending somebody at a door that will not open.
*/
export function visibleSteps(statusOf) {
  const status = statusOf || function (id) { const f = feature(id); return f ? f.status : "later"; };
  return STEPS.filter(function (step) {
    if (!step.feature) return true;
    const value = status(step.feature);
    return value === "available" || value === "partial";
  });
}

export async function tutorial(ctx) {
  ctx.setTopbar({ title: "App Tutorial", subtitle: "Quick guide", back: "#/settings" });

  const steps = visibleSteps();
  let index = 0;
  const root = h("div", { class: "stack-12" });

  function finish() {
    markTutorialSeen();
    ctx.navigate("/dashboard");
  }

  function go(next) {
    index = Math.max(0, Math.min(steps.length - 1, next));
    render();
    /* Move focus to the heading so a keyboard or screen-reader user is taken to
       the new step rather than left on a button that has just been replaced. */
    const heading = root.querySelector("[data-tutorial-heading]");
    if (heading && heading.focus) { try { heading.focus(); } catch (error) { /* ignore */ } }
  }

  function render() {
    const step = steps[index];
    const last = index === steps.length - 1;

    const dots = h("div", { class: "row gap-6 wrap mt-10", role: "tablist", "aria-label": "Tutorial steps" },
      steps.map(function (s, i) {
        return h("button", {
          type: "button",
          role: "tab",
          "aria-selected": i === index ? "true" : "false",
          "aria-label": "Step " + (i + 1) + ": " + s.title,
          class: "tutorial-dot" + (i === index ? " current" : ""),
          style: "width:10px;height:10px;padding:0;border-radius:999px;border:0;cursor:pointer;background:" +
            (i === index ? "var(--accent-sky,#4ea8ff)" : "var(--hairline,rgba(255,255,255,.25))"),
          onclick: function () { go(i); }
        });
      }));

    root.replaceChildren(
      h("div", { class: "t-label-m c-sec", text: "Step " + (index + 1) + " of " + steps.length }),
      blueCard([
        h("h2", {
          class: "t-headline-s w-bold c-white",
          tabindex: "-1",
          "data-tutorial-heading": "true",
          text: step.title
        }),
        h("p", { class: "t-body-m mt-10", style: "color:var(--white-secondary)", text: step.body }),
        step.hint ? h("p", { class: "t-body-s c-ter mt-8", text: step.hint }) : null,
        step.route ? h("div", { class: "mt-10" }, [
          outlinedButton(step.action || "Open", function () {
            markTutorialSeen();
            window.location.hash = step.route;
          }, { small: true })
        ]) : null,
        dots
      ]),
      h("div", { class: "row gap-8 wrap" }, [
        index > 0 ? outlinedButton("Back", function () { go(index - 1); }, { small: true }) : null,
        last
          ? matButton("Done", finish)
          : matButton("Next", function () { go(index + 1); }),
        !last ? outlinedButton("Skip", finish, { small: true }) : null
      ])
    );
  }

  render();
  return screen({ title: "App Tutorial", library: true, header: [backBubble("#/settings")] }, [root]);
}

/*
  The first-run offer on the dashboard.

  Deliberately a dismissible card rather than a modal over the app. Someone who
  opens a training app already knows what they came for, and a forced tour is
  the thing people close without reading - which is also how they never find it
  again.
*/
export function firstRunCard(ctx) {
  if (tutorialSeen()) return null;
  return blueCard([
    h("div", { class: "t-title-m c-white", text: "New here?" }),
    h("div", { class: "t-body-s c-ter mt-4", text: "A two-minute tour of procedures, QRH, drills and the cockpit. It is always in Settings › Help." }),
    h("div", { class: "row gap-8 wrap mt-10" }, [
      outlinedButton("Take the tour", function () { ctx.navigate("/tutorial"); }, { small: true }),
      outlinedButton("Not now", function () { markTutorialSeen(); ctx.rerender(); }, { small: true })
    ])
  ]);
}
