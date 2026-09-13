/*
  HOME tab — port of feature-training/ui/dashboard/DashboardScreen.kt.
  Structure: header (Change variant + "Variant: X") → Dashboard card (copy, recommended
  procedure, Procedures / Aircraft State / Library buttons) → Quick Launch (13 image
  tiles, 2 per row) → Training Signals → Reference Color Guide.
*/
import { h, Store, currentVariant, variantLabel, nextVariant, feature } from "../core.js";
import { screen, blueCard, libraryDivider, tile, featureTile, severityPill, bubble } from "../ui.js";
import { computeInsights } from "../logic/insights.js";

const PRIMARY_FAMILIES = [
  { title: "Procedures", color: "var(--tile-procedures)", href: "#/systems" },
  { title: "Aircraft State", color: "var(--tile-knowledge)", href: "#/live" },
  { title: "Library", color: "var(--tile-library)", href: "#/library/home" }
];

function quickActions(recommendedProcedureName, hasCockpitResume) {
  return [
    { title: "Debrief Logbook", subtitle: "Review local attempts, drill scores, weak areas, and recent training history.", color: "var(--cockpit-info-blue-dark)", art: "dhc6_tile_cockpit_panel", href: "#/training/logbook", status: feature("logbook").status },
    { title: recommendedProcedureName ? "Continue Procedure" : "Procedure Library", subtitle: recommendedProcedureName || "Fastest path into normal, abnormal, and emergency content.", color: "var(--tile-procedures)", art: "dhc6_tile_ground_crew", href: "#/systems", status: "available" },
    { title: "Performance", subtitle: "Calculate seaplane TOD, landing distance, VREF, and key check-ride speeds.", color: "var(--caution-amber-dark)", art: "dhc6_tile_safety", href: "#/training/performance", status: feature("performance").status },
    { title: "Check Ride Readiness", subtitle: "Review drill currency, score trend, and overdue normal, abnormal, and emergency procedures.", color: "var(--cockpit-info-blue-dark)", art: "dhc6_tile_cockpit_panel", href: "#/training/competency-dashboard", status: feature("readiness").status },
    { title: "Oral Exam - Premium", subtitle: "Premium AI examiner for POH, systems, limitations, and QRH check-ride preparation.", color: "var(--caution-amber-dark)", art: "dhc6_tile_engine_cutaway", href: "#/training/oral-exam", status: feature("oral-exam").status },
    { title: "CRM Drill", subtitle: "Practice PM/PF coordination, callouts, challenge-response flow, and crew decision-making.", color: "var(--cockpit-info-blue-dark)", art: "dhc6_tile_cockpit_panel", href: "#/training/crm-drill", status: feature("crm").status },
    { title: "Aircraft State", subtitle: hasCockpitResume ? "Open the aircraft-state hub; resume is available there." : "Choose scenario states or free-play cockpit.", color: "var(--tile-knowledge)", art: "dhc6_tile_cockpit_panel", href: "#/live", status: feature("aircraft-state").status },
    { title: "Technical Lab", subtitle: "Open the independent 3D-only model lab: PT6, propeller, hydraulic pack and aircraft variant objects.", color: "var(--tile-library)", art: "system_lab_tile", href: "#/systems/lab", status: feature("technical-lab").status },
    { title: "Definitions", subtitle: "Acronyms and plain-language meanings for MCC, CRM, QRH, AFM, POH, MEL, CAS, SRS and more.", color: "var(--cockpit-info-blue-dark)", art: "dhc6_tile_safety", href: "#/knowledge/definitions", status: "available" },
    { title: "Knowledge", subtitle: "Open 2D system diagrams, PNG references, system notes, flashcards and study lanes.", color: "var(--tile-library)", art: "dhc6_tile_engine_cutaway", href: "#/knowledge/home", status: feature("study").status },
    { title: "Import", subtitle: "Import manuals, PDFs, images, and training documents into Drill, Knowledge, or Cards.", color: "var(--tile-library)", art: "dhc6_tile_apron_departure", href: "#/library/import", status: feature("import").status },
    { title: "Fuel Planning", subtitle: "45-min reserve check, trip fuel, alternate, contingency, and tank split.", color: "var(--cockpit-info-blue-dark)", art: "dhc6_tile_safety", href: "#/training/fuel-plan", status: feature("fuel").status },
    { title: "Weight and Balance", subtitle: "Load, CG arm, MAC percent, and envelope check against QRH OM-B 11.1 limits.", color: "var(--cockpit-button-secondary)", art: "dhc6_tile_ground_crew", href: "#/training/weight-balance", status: feature("wb").status }
  ];
}

export async function dashboard(ctx) {
  const variant = currentVariant();
  const logbook = Store.logbook();
  const insights = computeInsights(logbook);
  const recent = (Store.get("recent") || []).find(function (r) { return r.kind === "procedure"; });
  const recommendedProcedureName = recent ? recent.title : null;
  const hasCockpitResume = Boolean(Store.get("cockpitResume"));
  const hasRecentDebrief = logbook.length > 0;
  ctx.setTopbar({ title: "DHC-6 Trainer", subtitle: "Home" });

  const header = [
    h("button", { class: "btn outlined small", type: "button", text: "Change variant", onclick: function () {
      Store.set("variant", nextVariant(variant));
      ctx.applyPrefs();
      ctx.toast("Variant set to " + variantLabel(currentVariant()));
      ctx.rerender();
    } }),
    h("span", { class: "t-title-m w-semi", style: "color:rgba(255,255,255,.92);padding-left:10px", text: "Variant: " + variantLabel(variant) })
  ];

  const dashboardCard = blueCard([
    h("div", { class: "t-title-l w-bold c-white", text: "Dashboard" }),
    h("p", { class: "t-body-m c-white mt-10", text: "Start from the main training workflows: Procedures, Performance, Cockpit, Knowledge, and Import. QRH remains focused on memory items for rapid recall." }),
    recommendedProcedureName ? h("div", { class: "mt-10" }, [
      h("div", { class: "t-label-l w-bold", style: "color:rgba(255,255,255,.9)", text: "Recommended next procedure" }),
      h("div", { class: "t-body-l c-white clamp-2", text: recommendedProcedureName })
    ]) : null,
    h("div", { class: "equal-row gap-10 mt-10" }, PRIMARY_FAMILIES.map(function (f) {
      return h("a", { class: "dash-primary", href: f.href, style: "background:" + f.color, text: f.title });
    }))
  ]);

  const actions = quickActions(recommendedProcedureName, hasCockpitResume);
  const quickLaunch = blueCard([
    h("div", { class: "t-title-m w-bold c-white", text: "Quick Launch" }),
    h("div", { class: "grid-2 wide-4 mt-10" }, actions.map(function (f) { return featureTile(f); })),
    h("p", { class: "t-body-s c-white mt-10", text: "Normal, abnormal, and emergency procedures keep their green / yellow / red identity inside Procedures and QRH. Performance is kept visible as a check-ride tool, while Aircraft State opens scenario states and free-play cockpit study." })
  ]);

  const signalNote = hasCockpitResume && hasRecentDebrief ? "Recent cockpit state and debrief history are available from Cockpit and the bottom navigation surfaces."
    : hasCockpitResume ? "A saved cockpit-state path is available from Cockpit."
    : hasRecentDebrief ? "Recent debrief history is available through the bottom navigation surfaces."
    : "Use the bottom bar for QRH, settings, and return paths once you are inside the training surfaces.";
  const signals = blueCard([
    h("div", { class: "t-title-m w-bold c-white", text: "Training Signals" }),
    insights.length ? h("div", { class: "stack-8 mt-10" }, insights.map(function (i) {
      const accent = i.severity === "HIGH" ? "var(--sem-emergency)" : i.severity === "MEDIUM" ? "var(--sem-caution)" : "var(--sem-normal)";
      return h("div", {}, [
        h("div", { class: "t-body-m w-bold c-white clamp-2", text: i.procedureName }),
        h("div", { class: "t-body-s clamp-2", style: "color:" + accent, text: i.statusLabel + " - " + i.trendLabel })
      ]);
    })) : h("p", { class: "t-body-m c-white clamp-4 mt-10", text: "No recent drill intelligence yet. Complete a drill to start surfacing weak spots and repeat recommendations." }),
    h("p", { class: "t-body-s c-white mt-10", text: signalNote })
  ]);

  const guide = blueCard([
    h("div", { class: "t-title-m w-bold c-white", text: "Reference Color Guide" }),
    h("div", { class: "row gap-8 wrap mt-10" }, [
      severityPill("Normal", "#34C77B", "#123A2A"),
      severityPill("Abnormal", "#F5B740", "#3E2E0C"),
      severityPill("Emergency", "#FF5A52", "#3E1512")
    ])
  ]);

  return screen({ title: "DHC-6 Trainer", library: true, header: header }, [
    dashboardCard,
    h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }),
    quickLaunch,
    h("div", { class: "mt-4" }),
    signals,
    h("div", { class: "mt-4" }),
    guide
  ]);
}
