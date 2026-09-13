/*
  Build the `cockpit-plates` content pack and the cockpit media set.

  Input : the Android cockpit assets (core-res/src/main/assets/cockpit or the
          _web_export/assets_cockpit mirror) — plates, hitbox JSON and the
          source_exact sprite families.
  Output: one JSON pack (published to KV, no imagery) plus a small set of image
          files (published to R2 behind /api/media):
            cockpit/plates/<variant>.webp      the canonical base plate
            cockpit/atlas/<variant>.webp       every sprite / instrument / lamp

  The geometry (alpha-content bounds, per-hitbox scale, draw offsets) is computed
  here exactly as CanonicalVisualStatePolicy.buildCanonicalControlSpritePack does
  on Android, so the browser renderer only has to place what this file resolved.
*/
import fs from "node:fs";
import path from "node:path";
import { parseHitboxes, normalizeForVariantParity, REFERENCE_SIZES } from "../../app/js/logic/cockpit/hitboxes.js";
import { familySpecFor, calibrationFor, spriteScale, familyDirs, pickDefaultState, instrumentDirs, compositeFallbackDirs, annunciatorDirs, MASTER_LAMP_FILES, MASTER_LAMP_KEYS, MFD_KEYS, MAX_SOURCE_EXACT_BITMAP_DIMENSION_PX } from "../../app/js/logic/cockpit/sprites.js";
import { visualOverlayCandidateIds, resolveVisualHostRole, isInstrumentVisualHost, isAnnunciatorVisualHost, visualKeysMatch, canonicalVisualKey, ROLE } from "../../app/js/logic/cockpit/keys.js";

const VARIANTS = ["LEGACY", "G950"];
const ATLAS_SUPERSAMPLE = 1.15;   // headroom for pinch-zoom before the atlas softens
const ATLAS_MAX_DIM = 640;       // never store an entry larger than this
const ATLAS_PADDING = 2;
/* The plate is drawn into the canonical image space, so it only has to carry
   enough pixels for the deepest zoom a browser pane reaches (~6x on a phone,
   ~4x on a desktop pane). Shipping the full 3748x5276 master would cost ~79 MB
   of decoded RGBA on the client for no visible gain. */
const PLATE_MAX_WIDTH = 2000;

export async function loadSharp() {
  try { const m = await import("sharp"); return m.default || m; }
  catch (error) {
    throw new Error("The cockpit build needs the `sharp` image library. Run `npm install sharp` in the website repo and try again.\n(" + (error && error.message) + ")");
  }
}

/* Resolve the cockpit asset root: either <android>/core-res/src/main/assets/cockpit
   or a flattened _web_export/assets_cockpit export. */
export function resolveCockpitRoot(candidates) {
  for (const dir of candidates) {
    if (!dir) continue;
    if (fs.existsSync(path.join(dir, "hitboxes", "hitboxes_legacy.json"))) return dir;
    const nested = path.join(dir, "cockpit");
    if (fs.existsSync(path.join(nested, "hitboxes", "hitboxes_legacy.json"))) return nested;
  }
  return null;
}

/* Files inside a `cockpit/...` path resolve against the export root. */
function assetPath(root, rel) { return path.join(root, rel.replace(/^cockpit\//, "")); }

function listPngs(dir) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).sort();
}

function stemOf(file) { return file.replace(/\.png$/i, ""); }

/* analyzeBitmap: min/max x,y over pixels with alpha > 8 (whole bitmap when opaque). */
async function analyze(sharp, file) {
  const image = sharp(file);
  const meta = await image.metadata();
  const width = meta.width || 1, height = meta.height || 1;
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width * channels;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x * channels + 3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { width: width, height: height, left: 0, top: 0, contentWidth: width, contentHeight: height };
  return { width: width, height: height, left: minX, top: minY, contentWidth: maxX - minX + 1, contentHeight: maxY - minY + 1 };
}

/* Untrimmed bounds, for bitmaps that are stretched over their whole host rect. */
async function fullBounds(sharp, file) {
  const meta = await sharp(file).metadata();
  const width = meta.width || 1, height = meta.height || 1;
  return { width: width, height: height, left: 0, top: 0, contentWidth: width, contentHeight: height };
}

class AtlasBuilder {
  constructor(sharp) { this.sharp = sharp; this.entries = []; this.byFile = new Map(); }
  /* Stores only the OPAQUE CONTENT region of the bitmap (everything outside it has
     alpha <= 8 and never contributes a pixel), scaled down to the largest size the
     region is ever drawn at. drawWidth/drawHeight are that size, in plate px. */
  async add(file, bounds, drawWidth, drawHeight) {
    const key = file + "|" + Math.round(drawWidth) + "x" + Math.round(drawHeight);
    if (this.byFile.has(key)) return this.byFile.get(key);
    const cw = Math.max(1, bounds.contentWidth), ch = Math.max(1, bounds.contentHeight);
    const wantedW = Math.max(1, drawWidth * ATLAS_SUPERSAMPLE);
    const factor = Math.min(1, Math.min(ATLAS_MAX_DIM, wantedW) / cw, ATLAS_MAX_DIM / ch);
    const outW = Math.max(1, Math.round(cw * factor)), outH = Math.max(1, Math.round(ch * factor));
    const entry = { file: file, bounds: bounds, bmpWidth: bounds.width, bmpHeight: bounds.height, width: outW, height: outH };
    this.entries.push(entry);
    this.byFile.set(key, entry);
    return entry;
  }
  /* Shelf packing, tallest first. */
  layout(maxWidth) {
    const sorted = this.entries.slice().sort((a, b) => b.height - a.height || b.width - a.width);
    let x = 0, y = 0, shelf = 0, width = 0;
    for (const e of sorted) {
      if (x + e.width + ATLAS_PADDING > maxWidth) { x = 0; y += shelf + ATLAS_PADDING; shelf = 0; }
      e.x = x; e.y = y;
      x += e.width + ATLAS_PADDING;
      shelf = Math.max(shelf, e.height);
      width = Math.max(width, x);
    }
    return { width: Math.max(1, width), height: Math.max(1, y + shelf) };
  }
  async render(maxWidth) {
    const size = this.layout(maxWidth);
    const composites = await Promise.all(this.entries.map(async (e) => ({
      input: await this.sharp(e.file)
        .extract({ left: e.bounds.left, top: e.bounds.top, width: Math.max(1, e.bounds.contentWidth), height: Math.max(1, e.bounds.contentHeight) })
        .resize(e.width, e.height, { fit: "fill" }).png().toBuffer(),
      left: e.x, top: e.y
    })));
    return { size: size, buffer: await this.sharp({ create: { width: size.width, height: size.height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).webp({ quality: 88, alphaQuality: 92 }).toBuffer() };
  }
}

/* Atlas coordinates are only known after layout(), so records keep a reference to
   their entry and the frames are materialised once the atlas has been packed. */
function frameRef(entry) { return { entry: entry }; }
function materialiseFrames(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { node.forEach(materialiseFrames); return; }
  for (const key of Object.keys(node)) {
    const value = node[key];
    if (value && typeof value === "object" && value.entry && typeof value.entry.x === "number") {
      node[key] = { x: value.entry.x, y: value.entry.y, w: value.entry.width, h: value.entry.height };
    } else {
      materialiseFrames(value);
    }
  }
}

/* Resolve one instrument / annunciator bitmap the way buildCockpitVisualOverlayAssetPack does. */
function resolveAssetFile(root, dirs, candidateIds) {
  for (const dir of dirs) {
    const abs = assetPath(root, dir);
    if (!fs.existsSync(abs)) continue;
    const files = listPngs(abs);
    const lower = new Map(files.map((f) => [stemOf(f).toLowerCase(), f]));
    for (const id of candidateIds) {
      const direct = files.find((f) => stemOf(f) === id) || lower.get(id.toLowerCase());
      if (direct) return path.join(abs, direct);
      for (const folderName of [id, id.toLowerCase(), id.toLowerCase().replace(/ /g, "_"), id.toLowerCase().replace(/-/g, "_")]) {
        const nested = path.join(abs, folderName);
        if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
          const nestedFiles = listPngs(nested);
          if (nestedFiles.length) return path.join(nested, nestedFiles[0]);
        }
      }
    }
  }
  return null;
}

export async function buildCockpitPack(options) {
  const root = options.cockpitRoot;
  const sharp = options.sharp || (await loadSharp());
  const media = [];              // { path, buffer, contentType }
  const variants = {};

  for (const variant of VARIANTS) {
    const reference = REFERENCE_SIZES[variant];
    const lower = variant.toLowerCase();
    const hitboxFile = assetPath(root, "cockpit/hitboxes/hitboxes_" + lower + ".json");
    if (!fs.existsSync(hitboxFile)) throw new Error("Missing cockpit hitboxes: " + hitboxFile);
    const hitboxes = normalizeForVariantParity(parseHitboxes(JSON.parse(fs.readFileSync(hitboxFile, "utf8"))), variant);

    /* ---------------------------------------------------------- plate */
    const plateSource = assetPath(root, reference.asset);
    if (!fs.existsSync(plateSource)) throw new Error("Missing cockpit plate: " + plateSource);
    const plateMeta = await sharp(plateSource).metadata();
    if (plateMeta.width !== reference.width || plateMeta.height !== reference.height) {
      throw new Error("Cockpit plate " + reference.asset + " is " + plateMeta.width + "x" + plateMeta.height + ", expected " + reference.width + "x" + reference.height);
    }
    const platePath = "cockpit/plates/" + lower + ".webp";
    const plateWidth = Math.min(PLATE_MAX_WIDTH, reference.width);
    const plateHeight = Math.round(reference.height * (plateWidth / reference.width));
    media.push({ path: platePath, buffer: await sharp(plateSource).resize(plateWidth, plateHeight, { fit: "fill" }).webp({ quality: 88 }).toBuffer(), contentType: "image/webp", label: variant + " cockpit plate" });

    /* --------------------------------------------------------- sprites */
    const atlas = new AtlasBuilder(sharp);
    const sprites = {};
    const skipped = [];
    for (const hb of hitboxes) {
      const spec = familySpecFor(hb);
      if (!spec) continue;
      let dir = null;
      for (const candidate of familyDirs(lower, spec.family)) {
        const abs = assetPath(root, candidate);
        if (listPngs(abs).length) { dir = abs; break; }
      }
      if (!dir) { skipped.push({ id: hb.id, family: spec.family, reason: "family folder missing" }); continue; }
      const files = listPngs(dir).filter((f) => true);
      const usable = [];
      for (const file of files) {
        const meta = await sharp(path.join(dir, file)).metadata();
        if ((meta.width || 0) > MAX_SOURCE_EXACT_BITMAP_DIMENSION_PX || (meta.height || 0) > MAX_SOURCE_EXACT_BITMAP_DIMENSION_PX) continue;
        usable.push(file);
      }
      if (!usable.length) { skipped.push({ id: hb.id, family: spec.family, reason: "no usable png" }); continue; }
      const stems = usable.map(stemOf);
      const defaultStem = pickDefaultState(spec.preferredStates, stems);
      const defaultFile = usable[stems.indexOf(defaultStem)] || usable[0];
      const defaultBounds = await analyze(sharp, path.join(dir, defaultFile));
      const override = calibrationFor(hb);
      const scale = spriteScale(hb, reference.width, reference.height, defaultBounds.contentWidth, defaultBounds.contentHeight, override);
      const states = {};
      for (const file of usable) {
        const bounds = await analyze(sharp, path.join(dir, file));
        const entry = await atlas.add(path.join(dir, file), bounds, bounds.contentWidth * scale, bounds.contentHeight * scale);
        states[stemOf(file).toLowerCase()] = {
          frame: frameRef(entry), bmp: { w: bounds.width, h: bounds.height },
          content: { left: bounds.left, top: bounds.top, w: bounds.contentWidth, h: bounds.contentHeight }
        };
      }
      sprites[hb.id] = {
        family: spec.family, defaultState: stemOf(defaultFile).toLowerCase(), scaleMul: scale,
        offsetXPx: override ? override.ox : 0, offsetYPx: override ? override.oy : 0, states: states
      };
    }

    /* --------------------------------- instrument / display / region faces */
    const instruments = {};
    const annunciators = {};
    for (const hb of hitboxes) {
      const role = resolveVisualHostRole(hb);
      const isInstrument = isInstrumentVisualHost(hb);
      const isLamp = isAnnunciatorVisualHost(hb);
      if (!isInstrument && !isLamp) continue;
      const candidates = visualOverlayCandidateIds(hb);
      const dirs = isLamp ? annunciatorDirs(lower) : (candidates.some((c) => MFD_KEYS.indexOf(c) > -1) ? compositeFallbackDirs(lower) : instrumentDirs(lower));
      const file = resolveAssetFile(root, dirs, candidates);
      if (!file) continue;
      const drawW = hb.rect.w * reference.width, drawH = hb.rect.h * reference.height;
      /* Instrument / lamp faces are stretched over the WHOLE host rect, transparent
         margins included, so they are stored untrimmed. */
      const entry = await atlas.add(file, await fullBounds(sharp, file), drawW, drawH);
      const record = { frame: frameRef(entry), bmp: { w: entry.bmpWidth, h: entry.bmpHeight } };
      const target = isLamp ? annunciators : instruments;
      candidates.forEach((key) => { if (!target[key]) target[key] = record; });
    }
    /* Master lamps are pre-seeded from the annunciators folder. */
    for (const kind of ["WARNING", "CAUTION"]) {
      const dirs = annunciatorDirs(lower);
      let file = null;
      for (const dir of dirs) {
        const abs = assetPath(root, dir);
        if (!fs.existsSync(abs)) continue;
        for (const name of MASTER_LAMP_FILES[kind]) {
          const direct = path.join(abs, name);
          if (fs.existsSync(direct)) { file = direct; break; }
          const nested = path.join(abs, name.replace(/\.png$/i, ""));
          if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
            const files = listPngs(nested);
            if (files.length) { file = path.join(nested, files[0]); break; }
          }
        }
        if (file) break;
      }
      if (!file) continue;
      const hosts = hitboxes.filter((hb) => visualOverlayCandidateIds(hb).some((c) => MASTER_LAMP_KEYS[kind].indexOf(c) > -1));
      const drawW = Math.max(...hosts.map((h) => h.rect.w * reference.width), 120);
      const drawH = Math.max(...hosts.map((h) => h.rect.h * reference.height), 60);
      const entry = await atlas.add(file, await fullBounds(sharp, file), drawW, drawH);
      const record = { frame: frameRef(entry), bmp: { w: entry.bmpWidth, h: entry.bmpHeight } };
      MASTER_LAMP_KEYS[kind].forEach((key) => { annunciators[key] = record; });
    }

    const rendered = await atlas.render(2048);
    materialiseFrames(sprites); materialiseFrames(instruments); materialiseFrames(annunciators);
    const atlasPath = "cockpit/atlas/" + lower + ".webp";
    media.push({ path: atlasPath, buffer: rendered.buffer, contentType: "image/webp", label: variant + " cockpit sprite atlas" });

    variants[variant] = {
      /* width/height are the CANONICAL image space every rect and sprite offset is
         expressed in; pixelWidth/pixelHeight are what the shipped bitmap holds. */
      plate: { path: platePath, width: reference.width, height: reference.height, pixelWidth: plateWidth, pixelHeight: plateHeight, source: reference.asset },
      atlas: { path: atlasPath, width: rendered.size.width, height: rendered.size.height },
      hitboxes: hitboxes,
      sprites: sprites,
      instruments: instruments,
      annunciators: annunciators,
      skipped: skipped
    };
  }

  return {
    pack: {
      id: "cockpit-plates",
      source: "DHC-6-Trainer core-res/src/main/assets/cockpit (plates, hitboxes, source_exact)",
      disclaimer: "Training support only. Not a replacement for the approved AFM, QRH, MEL, company manuals, approved checklists or regulatory/operator documentation.",
      count: VARIANTS.reduce((n, v) => n + variants[v].hitboxes.length, 0),
      variants: variants
    },
    media: media
  };
}
