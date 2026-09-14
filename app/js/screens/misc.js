/*
  Generic "coming later" screens and SETTINGS (SettingsScreen).
  The Library moved to screens/library.js when it became a real document store;
  the AIRCRAFT tab lives in screens/aircraftstate.js.
*/
import { h, Store, Content, APP_VERSION, currentVariant, variantLabel, variantSubtitle, VARIANTS, feature, clearContentCache } from "../core.js";
import { screen, blueCard, libraryDivider, backBubble, bubble, statusPill, settingsSection, navCard, toggleCard, ICONS, outlinedButton } from "../ui.js";
import { readIndex, partitionIndex, totalBytes, formatBytes, storedCount, downloadAll, removeAll } from "../offlinemedia.js";

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

/* ------------------------------------------------ Offline imagery download */
/*
  Diagrams and cockpit plates for a trip with no coverage.

  Opt-in, and it states the real size BEFORE downloading rather than after,
  because the number comes from /api/media/index at the moment you look - this
  code has no business guessing how many megabytes are on a pilot's plan.

  3D models are excluded: the Technical Lab set is around 172 MB against a few
  MB of imagery, and nobody should pull that down by pressing a button about
  diagrams.
*/
function offlineImageryCard(ctx, rerender) {
  const card = blueCard([h("div", { class: "t-body-s c-sec", text: "Diagrams and cockpit imagery: checking…" })]);
  let cancelled = false;

  const paint = function (nodes) { card.replaceChildren.apply(card, [nodes].flat()); };

  const show = async function () {
    let index;
    try {
      index = await readIndex();
    } catch (error) {
      /* A trial is refused the manifest, not the app: everything here still
         works online, including these same diagrams. Say that, rather than
         "sign in again", which would send someone round a loop they cannot
         win. */
      const trial = error && error.reason === "trial_offline_unavailable";
      paint([h("div", { class: "t-body-s c-sec", text: "Diagrams and cockpit imagery" }),
        h("div", { class: "t-body-s c-ter mt-4", text: trial
          ? "Offline download starts once your first payment goes through. Diagrams and the cockpit work normally online during the trial."
          : error && (error.status === 401 || error.status === 403)
            ? "Sign in again to manage the offline download."
            : "Cannot reach the media library right now. Try again when you have a connection." })]);
      return;
    }
    if (!index.published) {
      paint([h("div", { class: "t-body-s c-sec", text: "Diagrams and cockpit imagery" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "No imagery is published yet, so there is nothing to download." })]);
      return;
    }

    const imagery = partitionIndex(index.items).imagery;
    if (!imagery.length) {
      paint([h("div", { class: "t-body-s c-sec", text: "Diagrams and cockpit imagery" }),
        h("div", { class: "t-body-s c-ter mt-4", text: "No imagery is published yet, so there is nothing to download." })]);
      return;
    }

    const all = totalBytes(imagery);
    const held = await storedCount(imagery);
    const complete = held.count >= imagery.length;

    const line = h("div", { class: "t-body-s c-ter mt-4", text: complete
      ? "All " + imagery.length + " files are on this device (" + formatBytes(all) + "). Diagrams and the cockpit work offline."
      : held.count > 0
        ? held.count + " of " + imagery.length + " files are here. Downloading the rest adds about " + formatBytes(all - held.bytes) + "."
        : imagery.length + " files, about " + formatBytes(all) + ". Download before you leave coverage to use diagrams and the cockpit offline." });

    const progress = h("div", { class: "t-body-s c-ter mt-4", hidden: true });

    const start = outlinedButton(complete ? "Re-check download" : "Download for offline", async function () {
      cancelled = false;
      progress.hidden = false;
      progress.textContent = "Downloading 0 of " + imagery.length + "…";
      start.disabled = true;
      stop.hidden = false;
      try {
        const result = await downloadAll(imagery, {
          onProgress: function (p) { progress.textContent = "Downloading " + p.done + " of " + p.total + (p.failed ? " (" + p.failed + " unavailable)" : "") + "…"; },
          shouldStop: function () { return cancelled; }
        });
        if (result.unavailable) ctx.toast("This browser will not store offline files");
        else if (result.cancelled) ctx.toast("Download stopped");
        else if (result.failed) ctx.toast(result.done + " downloaded, " + result.failed + " unavailable");
        else ctx.toast("Diagrams and cockpit imagery are available offline");
      } catch (error) {
        ctx.toast("Signed out — sign in again to download");
      }
      rerender();
    }, { small: true });

    const stop = outlinedButton("Stop", function () { cancelled = true; }, { small: true });
    stop.hidden = true;

    const remove = outlinedButton("Remove download", async function () {
      await removeAll(imagery);
      ctx.toast("Downloaded imagery removed");
      rerender();
    }, { small: true });
    if (!held.count) remove.hidden = true;

    paint([
      h("div", { class: "t-body-s c-sec", text: "Diagrams and cockpit imagery" }),
      line,
      progress,
      h("div", { class: "row gap-8 wrap mt-8" }, [start, stop, remove]),
      h("div", { class: "t-body-s c-ter mt-6", text: "3D models are not included — they are far larger and stay online-only. Downloaded imagery is removed when you sign out." })
    ]);
  };

  show();
  return card;
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
        Kept honest against measured behaviour, twice. It first claimed
        "Offline-ready core training ... load locally" when a cold offline load
        failed outright; that was corrected to say the app still needed a
        connection to start. The service worker now caches the shell, so a cold
        start offline works and this says so again - with the 30-day limit
        stated, because a limit nobody is told about is just a surprise.
      */
      navCard("Works without a connection", "The app opens and runs with no signal: procedures, QRH, checklists, drills, flashcards, limitations, MEL and the calculators are all kept on this device. Diagrams and cockpit imagery are an optional download below; 3D models always need a connection. Offline access runs until the end of your paid period, or 30 days from your last sign-in, whichever comes first.", { icon: ICONS.info }),
      offlineImageryCard(ctx, render),
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
