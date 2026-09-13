/*
  Protected content API (subscriber or owner session required).

    GET /api/content/manifest   -> list of published packs (or published:false)
    GET /api/content/pack/<id>  -> one pack's JSON

  Every response is `Cache-Control: private, no-store` so shared caches and
  the service worker never retain protected material.
*/

import { json } from "../_shared.js";
import { authorizeWebRequest } from "../web-access/_session.js";
import { PACK_ID_PATTERN, readManifest, readPack } from "./_store.js";

function protectedJson(body, status) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Vary": "Cookie, Authorization",
      "X-Robots-Tag": "noindex, nofollow"
    }
  });
}

export async function onRequestGet(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);

  const url = new URL(context.request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (path === "/api/content/manifest") {
    const manifest = await readManifest(context.env);
    if (!manifest) return protectedJson({ ok: true, published: false, packs: [], version: null });
    return protectedJson(Object.assign({ ok: true, published: true }, manifest));
  }

  const match = path.match(/^\/api\/content\/pack\/([^/]+)$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    if (!PACK_ID_PATTERN.test(id)) return json({ ok: false, error: "bad_pack_id" }, 400);
    const raw = await readPack(context.env, id);
    if (!raw) return json({ ok: false, error: "pack_not_found" }, 404);
    return protectedJson(raw);
  }

  return json({ ok: false, error: "api_route_not_found" }, 404);
}
