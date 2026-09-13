/*
  Protected training-content store.

  Content transformed from the Android app's authoritative assets is published
  to Cloudflare KV (never committed to this public repository):

    webcontent:manifest        -> { version, publishedAt, source, packs:[{ id, title, module, items, bytes, sha256 }] }
    webcontent:pack:<id>       -> JSON payload for one pack (QRH, checklists, drills, ...)

  A dedicated WEB_CONTENT KV namespace is used when bound; otherwise the
  existing LICENSES namespace is used with the same key prefix so that no new
  binding is required for the first deployment.
*/

export const CONTENT_PREFIX = "webcontent:";
export const PACK_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function contentStore(env) {
  if (!env) return null;
  return env.WEB_CONTENT || env.LICENSES || null;
}

export async function readManifest(env) {
  const store = contentStore(env);
  if (!store) return null;
  const raw = await store.get(CONTENT_PREFIX + "manifest");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

export async function readPack(env, id) {
  const store = contentStore(env);
  if (!store || !PACK_ID_PATTERN.test(String(id || ""))) return null;
  return store.get(CONTENT_PREFIX + "pack:" + id);
}
