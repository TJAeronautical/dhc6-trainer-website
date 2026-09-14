/*
  Shared UI components mirroring the Android core-ui composables:
  ScreenScaffold / LibraryScreenScaffold, BlueCard, DarkBlueBubble / LightBlueBubble,
  AviationTileBackground, SmallBadge, QrhStatusBadge, SelectableChip, Slider rows,
  Dhc6PrimaryButton / Dhc6OutlinedButton, SectionTitle, NavigationCard, VisualToggleCard.
*/
import { h, STATUS_LABEL, tileUrl, navigate } from "./core.js";

export function text(tag, cls, value) { return h(tag, { class: cls, text: value }); }

/*
  Repaint an element's children, dropping the ones that are not there.

  This exists because of a bug that reached production: `replaceChildren()`
  takes `(Node or DOMString)...`, so a JavaScript `null` is not skipped - it is
  converted to the STRING "null" and inserted as a text node. Every screen here
  builds its children with `cond ? node : null`, which is exactly right inside
  h() (it filters them) and exactly wrong as a direct argument.

  It showed up on the Oral Exam because its refusal card is null on first
  paint, so the word appeared under the status pill every single time. It was
  latent on three other screens - Import, QRH manual edit and Aircraft State -
  waiting for a conditional to be false at the wrong moment.

  A test walks every replaceChildren call in the app and fails on a nullable
  argument, because remembering to call this is not a plan.
*/
export function paint(root, nodes) {
  root.replaceChildren.apply(root, (Array.isArray(nodes) ? nodes : [nodes]).filter(function (node) {
    return node != null && node !== false;
  }));
  return root;
}

/* ScreenScaffold: header row (bubbles/back), optional headlineSmall title, then content. */
export function screen(opts, children) {
  const cls = ["screen", opts.library ? "library" : "", opts.variant || ""].filter(Boolean).join(" ");
  const nodes = [];
  if (opts.header && opts.header.length) nodes.push(h("div", { class: "screen-header" }, opts.header));
  if (opts.title) nodes.push(h("h2", { class: "screen-title " + (opts.titleClass || "t-headline-s"), text: opts.title }));
  return h("section", { class: cls, "aria-label": opts.title || opts.ariaLabel || "Screen" }, nodes.concat(children || []));
}

export function libraryDivider() { return h("hr", { class: "library-divider" }); }
export function sectionGap() { return h("div", { class: "mt-4" }); }

export function blueCard(children, opts) {
  const o = opts || {};
  if (o.onClick || o.href) {
    const attrs = { class: "blue-card clickable" + (o.class ? " " + o.class : "") };
    if (o.href) {
      attrs.href = o.href;
      /* A Library document is served by the API, not the router: it opens in a
         tab of its own rather than replacing the app. */
      if (o.target) { attrs.target = o.target; attrs.rel = "noopener"; }
      return h("a", attrs, children);
    }
    attrs.type = "button"; attrs.onclick = o.onClick;
    return h("button", attrs, children);
  }
  return h("div", { class: "blue-card" + (o.class ? " " + o.class : "") }, children);
}

/* DarkBlueBubble (primary, selected glow) / LightBlueBubble (primaryContainer) */
export function bubble(kind, title, opts) {
  const o = opts || {};
  const children = [document.createTextNode(title)];
  if (o.count != null) children.push(h("small", { text: String(o.count) }));
  if (o.href) return h("a", { class: "bubble " + kind, href: o.href }, children);
  return h("button", { class: "bubble " + kind, type: "button", onclick: o.onClick }, children);
}
export function backBubble(href) { return bubble("dark", "Back", { href: href }); }

/* TextButton("Back") used by the QRH / calculator screens. */
export function backText(href) { return h("a", { class: "btn text", href: href, text: "Back" }); }
/* PerformanceBackButton: ActionBlueMuted pill */
export function backTonal(href) { return h("a", { class: "btn tonal", href: href, text: "Back" }); }

export function primaryButton(label, onClick, opts) {
  const o = opts || {};
  return h("button", { class: "btn primary" + (o.block ? " block" : "") + (o.selected ? " selected" : ""), type: "button", onclick: onClick, disabled: o.disabled || null, text: label });
}
export function outlinedButton(label, onClick, opts) {
  const o = opts || {};
  return h("button", { class: "btn outlined" + (o.block ? " block" : "") + (o.selected ? " selected" : "") + (o.small ? " small" : ""), type: "button", onclick: onClick, disabled: o.disabled || null, text: label });
}
export function matButton(label, onClick, opts) {
  const o = opts || {};
  return h("button", { class: "btn mat" + (o.block ? " block" : ""), type: "button", onclick: onClick, disabled: o.disabled || null, text: label });
}

/* AviationTileBackground + content. `art` = drawable basename. */
export function tile(opts, children) {
  const o = opts || {};
  const cls = ["tile", o.class || ""].filter(Boolean).join(" ");
  const inner = [];
  if (o.art) inner.push(h("div", { class: "tile-img", style: "background-image:url('" + tileUrl(o.art) + "')", "aria-hidden": "true" }));
  inner.push(h("div", { class: "tile-overlay", "aria-hidden": "true" }));
  if (o.accent) inner.push(h("div", { class: "tile-accent" + (o.thinAccent ? " thin" : ""), style: "background:" + o.accent, "aria-hidden": "true" }));
  const content = (children || []).slice();
  if (o.status && o.status !== "available") content.push(h("div", { class: "status-inline" }, statusPill(o.status)));
  inner.push(h("div", { class: "tile-content" }, content));
  const attrs = { class: cls, style: o.color ? "background:" + o.color : null };
  if (o.href) { attrs.href = o.href; return h("a", attrs, inner); }
  if (o.onClick) { attrs.type = "button"; attrs.onclick = o.onClick; return h("button", attrs, inner); }
  return h("div", attrs, inner);
}

/* DashboardFeatureTile / StudyImageTile */
export function featureTile(f, cls) {
  const study = Boolean(cls && cls.indexOf("study") > -1);
  const showStatus = f.status && f.status !== "available";
  return tile({ class: cls || "feature h-150", art: f.art, color: f.color, href: f.href, onClick: f.onClick, status: f.status }, [
    h("div", { class: study ? "t-title-m w-bold clamp-1" : "t-title-l w-bold clamp-2", text: f.title }),
    h("div", { class: "t-body-m clamp-" + (showStatus ? "2" : study ? "4" : "3"), style: "color:rgba(255,255,255,.88)", text: f.subtitle })
  ]);
}

export function statusPill(status) {
  return h("span", { class: "status-pill " + status, text: STATUS_LABEL[status] || status });
}

/* ProcedureLibraryScreen.SmallBadge / CategoryBadge / PriorityBadge */
export function smallBadge(label, cls) { return h("span", { class: "badge" + (cls ? " " + cls : ""), text: label }); }
export function categoryBadge(category) { return smallBadge(category.charAt(0) + category.slice(1).toLowerCase(), "cat-" + category.toLowerCase()); }

/* QrhStatusBadge / SmallInfoPill */
export function qrhStatusBadge(category) { return h("span", { class: "pill " + category.toLowerCase(), text: category }); }
export function infoPill(label) { return h("span", { class: "pill info", text: label }); }

/* Reference Color Guide SeverityPill */
export function severityPill(label, color, container) {
  return h("span", { class: "severity-pill", style: "color:" + color + ";background:" + container + ";border-color:" + color + "8c", text: label });
}

/* InputSlider / CalcSlider */
export function sliderRow(opts) {
  const valueEl = h("span", { class: "t-label-l w-bold " + (opts.valueClass || "c-gold") + (opts.mono ? " mono" : ""), text: opts.valueText(opts.value) });
  const input = h("input", { type: "range", class: "slider", min: opts.min, max: opts.max, step: opts.step || 1, value: opts.value, "aria-label": opts.label });
  input.addEventListener("input", function () {
    const v = Number(input.value);
    valueEl.textContent = opts.valueText(v);
    opts.onChange(v);
  });
  return h("div", { class: "stack-4" }, [
    h("div", { class: "slider-row" }, [h("span", { class: "t-label-l w-semi c-87", text: opts.label }), valueEl]),
    input
  ]);
}

export function selectableChip(label, selected, onClick) {
  return h("button", { class: "chip" + (selected ? " selected" : ""), type: "button", onclick: onClick, "aria-pressed": selected ? "true" : "false", text: label });
}

export function searchField(placeholder, value, onInput, label) {
  const input = h("input", { type: "search", placeholder: placeholder, value: value || "", "aria-label": label || placeholder, autocomplete: "off" });
  input.addEventListener("input", function () { onInput(input.value); });
  return h("div", { class: "search-field" }, input);
}

export function field(label, input) { return h("label", { class: "field" }, [h("span", { text: label }), input]); }

/* SettingsScreen.SectionTitle / NavigationCard / VisualToggleCard */
export function settingsSection(label) { return h("div", { class: "settings-section", text: label }); }
export function navCard(title, subtitle, opts) {
  const o = opts || {};
  const body = [
    o.icon ? h("span", { class: "icon", "aria-hidden": "true", html: o.icon }) : null,
    h("div", { class: "grow" }, [h("div", { class: "t-title-m c-white", text: title }), h("div", { class: "t-body-m", style: "color:var(--white-secondary)", text: subtitle })]),
    o.trailing || null
  ];
  if (o.href) return h("a", { class: "nav-card", href: o.href }, body);
  if (o.onClick) return h("button", { class: "nav-card", type: "button", onclick: o.onClick }, body);
  return h("div", { class: "nav-card" }, body);
}
export function toggleCard(title, subtitle, checked, onToggle) {
  const sw = h("button", { class: "switch", type: "button", role: "switch", "aria-checked": checked ? "true" : "false", "aria-label": title });
  sw.addEventListener("click", function () { onToggle(sw.getAttribute("aria-checked") !== "true"); });
  return navCard(title, subtitle, { trailing: sw });
}

export function notice(message, kind) { return h("div", { class: "notice" + (kind ? " " + kind : ""), text: message }); }

export function emptyState(message) { return h("div", { class: "empty-state", text: message }); }

/* Page-load error surface used by every async screen. */
export function contentUnavailable(packId, error) {
  const status = error && error.status;
  if (status === 404) return notice("The \"" + packId + "\" content pack has not been published to this site yet. Owner: run the content build and KV upload described in WEB_APP_SECURITY.md.", "warn");
  return notice("Unable to load protected content (" + (error && error.message ? error.message : "unknown error") + "). Check your connection and sign-in state.", "error");
}

export function go(path) { navigate(path); }

/*
  Modal sheet (ModalBottomSheet / AlertDialog on Android): bottom sheet on phones,
  centred dialog from 900 px. Returns { root, close }; Escape and a backdrop tap close it.
*/
let activeSheet = null;

export function sheet(opts) {
  const o = opts || {};
  if (activeSheet) activeSheet.close();   // Android dismisses the edit sheet before opening a dialog
  const root = document.getElementById("app-sheet");
  if (!root) return { root: null, panel: null, close: function () {} };
  const panel = root.querySelector(".sheet-panel");
  const body = root.querySelector("#sheet-body");
  const titleNode = root.querySelector("#sheet-title");

  panel.className = "sheet-panel" + (o.wide ? " wide" : "");
  titleNode.textContent = o.title || "";
  titleNode.hidden = !o.title;
  body.replaceChildren.apply(body, [].concat(
    o.subtitle ? [h("p", { class: "t-body-s c-sec mb-10", text: o.subtitle })] : [],
    o.children || []
  ));
  root.hidden = false;
  panel.scrollTop = 0;

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    if (activeSheet && activeSheet.close === close) activeSheet = null;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("dhc6:view-unmount", close);
    root.removeEventListener("click", onBackdrop);
    root.hidden = true;
    body.replaceChildren();
    if (o.onClose) o.onClose();
  }
  function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
  function onBackdrop(e) { if (e.target.hasAttribute("data-sheet-close")) close(); }
  root.addEventListener("click", onBackdrop);
  document.addEventListener("keydown", onKey);
  document.addEventListener("dhc6:view-unmount", close, { once: true });
  const focusable = panel.querySelector("button, a[href], input, select, textarea");
  if (focusable) focusable.focus({ preventScroll: true });
  const api = { root: root, panel: panel, close: close };
  activeSheet = api;
  return api;
}

/* Material icons (path data from androidx.compose.material.icons) */
export const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>',
  menuBook: '<svg viewBox="0 0 24 24"><path d="M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.1.05.15.05.25.05.25 0 .5-.25.5-.5V6c-.6-.45-1.25-.75-2-1zm0 13.5c-1.1-.35-2.3-.5-3.5-.5-1.7 0-4.15.65-5.5 1.5V8c1.35-.85 3.8-1.5 5.5-1.5 1.2 0 2.4.15 3.5.5v11.5z"/></svg>',
  airplane: '<svg viewBox="0 0 24 24"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>',
  warning: '<svg viewBox="0 0 24 24"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/></svg>',
  account: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2a7.2 7.2 0 0 1-6-3.22c.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08a7.2 7.2 0 0 1-6 3.22z"/></svg>',
  info: '<svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>',
  help: '<svg viewBox="0 0 24 24"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>',
  logout: '<svg viewBox="0 0 24 24"><path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"/></svg>'
};

/* Re-renders replace the search input; keep the caret where the user left it. */
export function withSearchFocus(root, renderFn) {
  const active = document.activeElement;
  const hadFocus = active && active.type === "search" && root.contains(active);
  const pos = hadFocus ? active.selectionStart : null;
  renderFn();
  if (hadFocus) {
    const next = root.querySelector('input[type="search"]');
    if (next) { next.focus({ preventScroll: true }); try { next.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }
}
