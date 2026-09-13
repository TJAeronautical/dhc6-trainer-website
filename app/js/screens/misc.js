/*
  AIRCRAFT tab (CockpitHomeScreen — later), Library hub (LibraryHubScreen — read-only),
  Systems / Technical Lab / Import placeholders, and SETTINGS (SettingsScreen).
*/
import { h, Store, Content, APP_VERSION, currentVariant, variantLabel, variantSubtitle, VARIANTS, feature, clearContentCache } from "../core.js";
import { screen, blueCard, tile, libraryDivider, backBubble, bubble, statusPill, settingsSection, navCard, toggleCard, notice, ICONS, outlinedButton } from "../ui.js";

/* ---------------------------------------------------------- Aircraft State */
export async function aircraftState(ctx) {
  ctx.setTopbar({ title: "Aircraft State", subtitle: "AIRCRAFT · scenario states and cockpit" });
  const resume = Store.get("cockpitResume");
  const f = feature("aircraft-state");
  function entryCard(title, subtitle, art, status) {
    return tile({ class: "hero card-row h-124", art: art, status: status }, [
      h("div", { class: "grow stack-4" }, [h("div", { class: "t-title-m w-bold c-white", text: title }), h("div", { class: "t-body-s clamp-2", style: "color:rgba(255,255,255,.86)", text: subtitle })]),
      h("span", { class: "btn small", style: "opacity:.6", text: "Open" })
    ]);
  }
  return screen({ ariaLabel: "Aircraft State" }, [
    blueCard([
      h("div", { class: "row between" }, [h("div", { class: "t-title-l w-bold c-white", text: "Aircraft State" }), statusPill(f.status)]),
      h("div", { class: "t-body-m mt-6", style: "color:rgba(255,255,255,.86)", text: "State-first workflows for free play, resumed preview, cockpit entry, and associated procedure state." }),
      h("div", { class: "t-body-s c-sec mt-8", text: "Last state: " + (resume ? resume.label : "none saved") }),
      h("div", { class: "equal-row gap-10 mt-10" }, [h("button", { class: "btn mat", type: "button", disabled: true, text: "Open Free Play" }), h("button", { class: "btn outlined small", type: "button", disabled: true, text: resume ? "Resume Last State" : "No Saved State" })])
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "State Entry" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Choose a scenario-linked MCC drill path. Use PROCS on the bottom bar for procedure drills." }),
      h("div", { class: "mt-10" }, entryCard("Scenario-linked Drills", "Pick a scenario phase, then continue into the MCC drill.", "procedure_tile_scenarios", "later"))
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "Related Paths" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Use Debrief only for review and repeat actions after a run." }),
      h("div", { class: "mt-10" }, tile({ class: "hero card-row h-124", art: "dhc6_tile_cockpit_panel", href: "#/training/logbook", status: feature("logbook").status }, [
        h("div", { class: "grow stack-4" }, [h("div", { class: "t-title-m w-bold c-white", text: "Debrief Logbook" }), h("div", { class: "t-body-s clamp-2", style: "color:rgba(255,255,255,.86)", text: "Review completed attempts, recent outcomes, and repeat paths." })]),
        h("span", { class: "btn small", text: "Open" })
      ]))
    ]),
    blueCard([
      h("div", { class: "t-title-m w-bold c-white", text: "Linked drill flow" }),
      h("div", { class: "t-body-s c-sec mt-4", text: "Use this tab for free play, resume, and scenario-linked MCC drill entry. Procedure drills stay in PROCS on the bottom bar." })
    ]),
    notice("Why this is not live yet: the cockpit views need the 200 Legacy/G950 cockpit images (22 MB) and hit-box bindings served from R2 behind the subscriber session. The scenario-snapshot, cockpit-binding and canonical-item packs are already published; the imagery upload and the cockpit renderer are phase 5.", "warn")
  ]);
}

/* -------------------------------------------------------------- Library hub */
export async function libraryHub(ctx) {
  ctx.setTopbar({ title: "Library", subtitle: "Sources · Import · Published", back: "#/dashboard" });
  function card(title, body, buttonLabel, href, status) {
    return blueCard([
      h("div", { class: "row between" }, [h("div", { class: "t-title-m c-white", text: title }), statusPill(status)]),
      h("div", { class: "t-body-s c-white mt-10", text: body }),
      h("div", { class: "mt-10" }, h("a", { class: "bubble light", href: href, text: buttonLabel }))
    ]);
  }
  return screen({ title: "Library", library: true, header: [bubble("light", "Back", { href: "#/dashboard" })] }, [
    h("p", { class: "t-body-m c-white", text: "Read-only source index and published training content. Knowledge import is visible here, but opens only for authorised accounts." }),
    h("div", { class: "mt-4" }), libraryDivider(), h("div", { class: "mt-4" }),
    card("Import", "Protected import entry for owner or content-authoring accounts. Free and guest accounts remain read-only here.", "Unlock Import", "#/library/import", "later"),
    h("div", { class: "mt-4" }),
    card("Sources", "Imported PDFs, source documents, and promoted content in the shared source index.", "Open Sources", "#/library/sources", "later"),
    h("div", { class: "mt-4" }),
    card("Published", "Trusted runtime-ready content only.", "Open Published", "#/library/published", "later")
  ]);
}

/* ------------------------------------------------- Generic later screens */
export function laterScreen(id, extra) {
  return async function (ctx) {
    const f = feature(id);
    ctx.setTopbar({ title: f.title, subtitle: "Coming later", back: "#/dashboard" });
    return screen({ title: f.title, library: true, header: [backBubble("#/dashboard")] }, [
      h("div", { class: "row wrap gap-8" }, [statusPill(f.status), h("span", { class: "t-body-s c-sec", text: f.desc })]),
      extra ? blueCard([h("div", { class: "t-body-m", text: extra })]) : null
    ]);
  };
}

/* ---------------------------------------------------------------- Settings */
export async function settings(ctx) {
  ctx.setTopbar({ title: "Settings", subtitle: "Account · Plan · Display · Cockpit" });
  const session = (window.DHC6Session && window.DHC6Session.get()) || {};
  const role = session.role === "owner" ? "Owner" : session.ok ? "Subscriber" : "Signed out";
  const plan = session.role === "owner" ? "Owner access (Firebase)" : session.plan ? String(session.plan).replace(/_/g, " ") : "—";
  const manifest = Content.manifest || {};
  const root = h("div", { class: "stack-12" });

  function variantSelector() {
    return h("div", { class: "stack-8" }, VARIANTS.map(function (v) {
      const selected = currentVariant() === v;
      return h("button", { class: "variant-option" + (selected ? " selected" : ""), type: "button", role: "radio", "aria-checked": selected ? "true" : "false", onclick: function () { Store.set("variant", v); ctx.applyPrefs(); render(); } }, [
        h("span", { class: "radio", "aria-hidden": "true" }),
        h("span", { class: "grow" }, [h("div", { class: "t-title-m", text: variantLabel(v) }), h("div", { class: "t-body-s", style: "color:var(--white-secondary)", text: variantSubtitle(v) })])
      ]);
    }));
  }

  function render() {
    root.replaceChildren(
      settingsSection("Account"),
      navCard("Account", "Status: " + role + " - manage your licence or sign out", { icon: ICONS.account, href: "/access.html" }),
      h("div", { class: "row gap-8 wrap" }, [
        outlinedButton("Sign out", function () { if (window.DHC6Session) window.DHC6Session.signOut(); else window.location.href = "/web-app.html"; }, { small: true }),
        h("a", { class: "btn text", href: "/web-app.html", text: "Sign-in page" })
      ]),
      settingsSection("Plan"),
      blueCard([h("div", { class: "t-title-m c-white", text: "Current Plan" }), h("div", { class: "t-body-m mt-4", style: "color:var(--white-secondary)", text: plan + (session.email ? " · " + session.email : "") }), h("div", { class: "t-body-s c-ter mt-6", text: "Web sessions last about 12 hours and are re-validated against your licence every few minutes." })]),
      settingsSection("Offline Access"),
      navCard("Offline-ready core training", "Bundled procedures, QRH, flashcards, systems notes, diagrams and Technical Lab assets load locally; cloud sync resumes when online.", { icon: ICONS.info }),
      blueCard([
        h("div", { class: "t-body-s c-sec", text: "Content packs: " + (manifest.published === false ? "not published yet" : (manifest.packs || []).length + " packs · version " + (manifest.version || "—")) }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Packs are cached in this browser (IndexedDB) after the first load so procedures and study data stay usable offline; they are cleared on sign-out." }),
        h("div", { class: "row gap-8 wrap mt-8" }, [
          outlinedButton("Refresh content", function () { clearContentCache().then(function () { return Content.loadManifest(); }).then(function () { ctx.toast("Content refreshed"); render(); }).catch(function () { ctx.toast("Unable to refresh right now"); }); }, { small: true }),
          outlinedButton("Clear local progress", function () { if (window.confirm("Clear local logbook, SRS progress, pins and recent items on this device?")) { Store.clearProgress(); ctx.toast("Local progress cleared"); render(); } }, { small: true })
        ])
      ]),
      settingsSection("Procedure Packs"),
      navCard("Procedure Packs", "Browse subscriptions, import ZIP packs, and activate installed operator packs", { icon: ICONS.folder, trailing: statusPill("later") }),
      settingsSection("Display"),
      toggleCard("Dark Mode", Store.get("theme") === "night" ? "Enabled" : "Disabled", Store.get("theme") === "night", function (on) { Store.set("theme", on ? "night" : "day"); ctx.applyPrefs(); render(); }),
      settingsSection("Audio"),
      toggleCard("Sound", Store.get("soundEnabled") !== false ? "Audio cues enabled" : "Audio cues muted", Store.get("soundEnabled") !== false, function (on) { Store.set("soundEnabled", on); render(); }),
      settingsSection("Help"),
      navCard("App Tutorial", "Replay the quick guide for procedures, QRH, drill, cockpit and settings.", { icon: ICONS.help, trailing: statusPill("later") }),
      settingsSection("Privacy"),
      navCard("Share diagnostics", "The web app sends no analytics or crash reports. Only the licence check and content requests reach the server.", { icon: ICONS.lock }),
      settingsSection("Cockpit Mode"),
      h("div", { class: "t-body-s", style: "color:var(--white-secondary)", text: "Aircraft variant (used for canonical cockpit art + bindings)" }),
      variantSelector(),
      h("div", { class: "t-label-s c-ter", text: "DHC-6 Trainer web " + APP_VERSION })
    );
  }
  render();
  return screen({ ariaLabel: "Settings" }, [h("h2", { class: "t-headline-s c-white", text: "Settings" }), root]);
}
