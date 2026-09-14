/*
  Data access on top of the protected content packs — the browser equivalent of
  ProcedureRepository.allProceduresWithContent() / proceduresByCategory() and the
  KnowledgeRepository candidate pool.
*/
import { mergePool } from "./logic/import.js";
import { importedCards } from "./screens/import.js";
import { Content, currentVariant } from "./core.js";
import { materializeProcedures, findByCompiledId } from "./logic/procedures.js";

const PACKS = ["procedures-normal", "procedures-abnormal", "procedures-emergency"];
const cache = new Map();

Content.onChange(function () { cache.clear(); });

/* ProcedureRepository.allProceduresWithContent() for the selected variant. */
export async function allProcedures(variant) {
  const v = variant || currentVariant();
  const key = "procs:" + v + ":" + (Content.manifest && Content.manifest.version);
  if (cache.has(key)) return cache.get(key);
  const packs = await Promise.all(PACKS.map(function (id) { return Content.pack(id); }));
  const raw = [];
  packs.forEach(function (pack) { (pack.procedures || []).forEach(function (p) { raw.push(Object.assign({ pack: pack.id }, p)); }); });
  const materialized = materializeProcedures(raw, v);
  cache.set(key, materialized);
  return materialized;
}

export async function proceduresByCategory(category, variant) {
  const all = await allProcedures(variant);
  return all.filter(function (p) { return p.category === category; });
}

/* QrhRepository.getProcedureById(compiledId) — optional variant disambiguation. */
export async function procedureById(compiledId, variant, preferVariant) {
  const all = await allProcedures(variant);
  return findByCompiledId(all, compiledId, preferVariant);
}

export async function knowledgePool() {
  const pack = await Content.pack("knowledge-pool");
  /*
    Cards the pilot imported from their own manual study alongside the bundled
    pool rather than in a separate lane - which is the whole point of importing
    them. The published pack always wins a collision: an import may add to the
    authoritative content, never shadow it.
  */
  return mergePool(pack.units || [], importedCards());
}
