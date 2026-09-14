/*
  A preload the page never uses.

  Chrome said so out loud, in the console of the live site: "The resource was
  preloaded using link preload but not used within a few seconds from the
  window's load event." index.html was preloading
  assets/screenshots/web-phone-dashboard.webp at high priority - a file that
  appears nowhere on the page. It is the og:image, which social crawlers fetch
  for themselves; a visitor's browser never renders it.

  So every homepage visit pulled ~100 KB of nothing, ahead of the hero reel's
  first frame, which is the LCP element and is what the visitor is actually
  waiting to see. On a phone that is the difference people feel.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function pages() {
  return fs.readdirSync(root).filter((name) => name.endsWith(".html"));
}

const PRELOAD = /<link[^>]*rel=["']preload["'][^>]*>/gi;
const HREF = /href=["']([^"']+)["']/i;
const AS = /\bas=["']([^"']+)["']/i;

test("every preloaded image is one the page actually renders", () => {
  /* The rule, stated so it survives the next person to add a preload: a
     preload is a promise that this file is needed immediately. og:image is
     not that - it is metadata for somebody else's crawler. */
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    const links = html.match(PRELOAD) || [];

    for (const link of links) {
      const as = (link.match(AS) || [, ""])[1].toLowerCase();
      if (as !== "image") continue;

      const href = (link.match(HREF) || [, ""])[1];
      assert.ok(href, page + ": a preload with no href");

      /* Rendered means it appears in a src, srcset or a CSS url() on this
         page - not merely somewhere in the file, which og:image also
         satisfies. */
      const rendered = new RegExp(
        "(?:src|srcset)=[\"'][^\"']*" + href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        + "|url\\(['\"]?[^)]*" + href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      ).test(html);

      assert.ok(rendered,
        page + " preloads " + href + " but never renders it. A preload competes with the "
        + "images the visitor is waiting for; if the file is only an og:image, drop the preload.");
    }
  }
});

test("the homepage preloads its LCP image, and that image is the reel's first frame", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

  const preloads = (html.match(PRELOAD) || [])
    .filter((link) => /as=["']image["']/i.test(link))
    .map((link) => (link.match(HREF) || [, ""])[1]);

  assert.equal(preloads.length, 1, "exactly one image preload: more than one is no priority at all");

  /* The first <img> inside the reel track is what a visitor sees first, and it
     is the one marked fetchpriority="high". They must agree. */
  const track = /<div class="reel-track">([\s\S]*?)<\/div>/.exec(html);
  assert.ok(track, "the hero reel should still be a .reel-track of <img> frames");
  const firstFrame = (/<img[^>]*src=["']([^"']+)["']/.exec(track[1]) || [, ""])[1];

  assert.equal(preloads[0], firstFrame,
    "the preload must name the frame the hero shows first, or it is racing the thing it should be helping");
  assert.match(track[1], new RegExp('src=["\']' + firstFrame + '["\'][^>]*fetchpriority=["\']high'),
    "and that frame keeps its high fetch priority");
});

test("preloaded files exist", () => {
  for (const page of pages()) {
    const html = fs.readFileSync(path.join(root, page), "utf8");
    for (const link of html.match(PRELOAD) || []) {
      const href = (link.match(HREF) || [, ""])[1];
      if (!href || /^(?:https?:)?\/\//.test(href)) continue;
      assert.ok(fs.existsSync(path.join(root, href.replace(/^\//, ""))),
        page + " preloads " + href + ", which is not in the repository");
    }
  }
});
