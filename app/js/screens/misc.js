/*
  Generic "coming later" screens and SETTINGS (SettingsScreen).
  The Library moved to screens/library.js when it became a real document store;
  the AIRCRAFT tab lives in screens/aircraftstate.js.
*/
import { h, Store, Content, APP_VERSION, currentVariant, variantLabel, variantSubtitle, VARIANTS, feature, clearContentCache } from "../core.js";
import { screen, blueCard, libraryDivider, backBubble, bubble, statusPill, settingsSection, navCard, toggleCard, ICONS, outlinedButton } from "../ui.js";

/* ------------------------------------------------- Generic later screens */
export function laterScreen(id, extra) {
  return async function (ctx) {
    const f = feature(id);
    ctx.setTopbar({ title: f.title, subtitle: "Coming later", back: "#/dashboard" });
    /* One explanation, never two. The registry `desc` is the short line tiles
       show; `extra` is the full one for this screen. Rendering both put the
       same sentence on the Import screen twice, which reads as a bug. */
    return screen({ title: f.title, library: true, header: [backBubble("#/dashboard")] }, [
      h("div", { class: "row wrap gap-8" }, [statusPill(f.status)]),
      blueCard([h("div", { class: "t-body-m", text: extra || f.desc })])
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
      /*
        This used to read "Offline-ready core training ... load locally", which
        was not true and was measured not to be: with the network off, a cold
        load of /app/ fails with ERR_INTERNET_DISCONNECTED. The content packs
        really are cached (IndexedDB, below), but the app shell itself is not -
        /app/ is served `private, no-store` and the service worker deliberately
        bypasses it, so there is nothing to boot from. What actually works is a
        connection dropping mid-session, which is worth saying plainly instead.
      */
      navCard("Works through a dropped connection", "Procedures, QRH, flashcards, systems notes and diagrams are kept on this device after they first load, so a session keeps working if you lose signal. Starting the app still needs a connection.", { icon: ICONS.info }),
      blueCard([
        h("div", { class: "t-body-s c-sec", text: "Content packs: " + (manifest.published === false ? "not published yet" : (manifest.packs || []).length + " packs · version " + (manifest.version || "—")) }),
        h("div", { class: "t-body-s c-ter mt-4", text: "Packs are cached in this browser (IndexedDB) after the first load, so an open session keeps working without a connection. They are cleared on sign-out." }),
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
