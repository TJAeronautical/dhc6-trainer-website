/*
  Stamping a 3D model without touching the model.

  The .glb files are the library's most valuable asset by a wide margin - 20
  files and 168.1 MB, against 7.3 MB of everything else - and they cannot be
  withheld, because the Technical Lab has to fetch one to display it. So the
  goal is attribution rather than prevention: a leaked model should name the
  account it was served to.

  A GLB is a 12-byte header followed by length-prefixed chunks, and the glTF
  spec requires readers to ignore chunk types they do not know. The bundled
  three.js GLTFLoader does exactly that - its chunk loop handles JSON and BIN
  and steps over everything else, with no else branch - so the stamp rides in
  a chunk of its own.

  The test that matters is the first one: the glTF JSON and the binary buffer
  must come out of a stamped file byte-for-byte identical, read by the same
  walk the loader performs. Everything else is detail.
*/
import test from "node:test";
import assert from "node:assert/strict";

import {
  stampModel, stampModelStream, readModelStamp, modelStampChunk, isGlb,
  GLB_MAGIC, GLB_HEADER_BYTES, GLB_CHUNK_JSON, GLB_CHUNK_BIN, GLB_CHUNK_STAMP
} from "../functions/api/_watermark.js";
import { onRequestGet as media } from "../functions/api/media/index.js";
import { MEDIA_KV_PREFIX } from "../functions/api/media/_store.js";
import { createWebSession, SESSION_COOKIE } from "../functions/api/web-access/_session.js";
import { activeLicense, envWithLicense } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";

/* A minimal but structurally real GLB: header, JSON chunk, BIN chunk. */
function buildGlb(json, binary) {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  const bin = new Uint8Array(binary);
  const binPad = (4 - (bin.length % 4)) % 4;

  const total = GLB_HEADER_BYTES + 8 + text.length + jsonPad + 8 + bin.length + binPad;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);

  let o = GLB_HEADER_BYTES;
  view.setUint32(o, text.length + jsonPad, true);
  view.setUint32(o + 4, GLB_CHUNK_JSON, true);
  out.set(text, o + 8);
  out.fill(0x20, o + 8 + text.length, o + 8 + text.length + jsonPad);
  o += 8 + text.length + jsonPad;

  view.setUint32(o, bin.length + binPad, true);
  view.setUint32(o + 4, GLB_CHUNK_BIN, true);
  out.set(bin, o + 8);
  return out;
}

/*
  The bundled GLTFLoader's chunk loop, transcribed. This is the contract: if
  this sees the same JSON and BIN after stamping, so does the viewer.

      for (; o < header.length - 12; ) {
        const len = view.getUint32(o, true); o += 4;
        const type = view.getUint32(o, true); o += 4;
        if (type === JSON) content = decode(...)
        else if (type === BIN) body = slice(...)
        o += len;                       // unknown types: skipped
      }
*/
function readAsLoaderDoes(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = view.getUint32(8, true);
  const limit = declared - GLB_HEADER_BYTES;
  let o = 0;
  let content = null;
  let body = null;
  const skipped = [];
  while (o < limit) {
    const length = view.getUint32(GLB_HEADER_BYTES + o, true); o += 4;
    const type = view.getUint32(GLB_HEADER_BYTES + o, true); o += 4;
    const start = GLB_HEADER_BYTES + o;
    if (type === GLB_CHUNK_JSON) content = new TextDecoder().decode(bytes.subarray(start, start + length));
    else if (type === GLB_CHUNK_BIN) body = bytes.slice(start, start + length);
    else skipped.push(type);
    o += length;
  }
  return { content: content, body: body, skipped: skipped, declared: declared };
}

const MODEL = { asset: { version: "2.0" }, meshes: [{ name: "FLAP_ACTUATOR" }] };
const BINARY = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
const glb = () => buildGlb(MODEL, BINARY);

test("the model survives the stamp byte for byte", async () => {
  const original = glb();
  const before = readAsLoaderDoes(original);
  const after = readAsLoaderDoes(stampModel(original, "abc123"));

  assert.equal(after.content, before.content, "the glTF JSON must be identical - geometry, materials, names, all of it");
  assert.deepEqual(Array.from(after.body), Array.from(before.body), "and so must the binary buffer");
  assert.deepEqual(after.skipped, [GLB_CHUNK_STAMP], "the loader steps over exactly one unknown chunk: ours");
});

test("the original bytes are a prefix of the stamped file, but for one integer", async () => {
  /* Proof that nothing is rewritten: the stamp is appended, and the only
     edited byte range is the declared length in the header. */
  const original = glb();
  const stamped = stampModel(original, "abc123");

  assert.ok(stamped.byteLength > original.byteLength);
  for (let i = 0; i < original.byteLength; i++) {
    if (i >= 8 && i < 12) continue;
    assert.equal(stamped[i], original[i], "byte " + i + " changed, and it should not have");
  }
});

test("the declared length matches the real one, or the stamp is invisible", async () => {
  const stamped = stampModel(glb(), "abc123");
  const declared = new DataView(stamped.buffer, stamped.byteOffset).getUint32(8, true);
  assert.equal(declared, stamped.byteLength,
    "the loader reads chunks only up to the declared length; an unchanged one hides the stamp from forensics too");
});

test("a leaked model names the account it was served to", async () => {
  const stamped = stampModel(glb(), "deadbeefcafe0001", "2026-09-14");
  const found = readModelStamp(stamped);
  assert.equal(found.id, "deadbeefcafe0001");
  assert.equal(found.d, "2026-09-14");
  assert.equal(readModelStamp(glb()), null, "an unstamped model resolves to nobody rather than guessing");
});

test("two accounts leave two different stamps on the same model", async () => {
  const a = readModelStamp(stampModel(glb(), "aaaa111122223333"));
  const b = readModelStamp(stampModel(glb(), "bbbb444455556666"));
  assert.notEqual(a.id, b.id);
});

test("the chunk type cannot collide with the two that mean something", () => {
  assert.notEqual(GLB_CHUNK_STAMP, GLB_CHUNK_JSON);
  assert.notEqual(GLB_CHUNK_STAMP, GLB_CHUNK_BIN);
  const chunk = modelStampChunk("abc123");
  assert.equal(chunk.byteLength % 4, 0, "chunks are 4-byte aligned or every later offset is wrong");
});

test("anything that is not a GLB is passed through untouched", () => {
  /* A poster, a corrupt file, a truncated download: never damage it. */
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(Array.from(stampModel(png, "abc123")), Array.from(png));
  assert.equal(isGlb(png), false);

  const tooShort = Uint8Array.from([1, 2, 3]);
  assert.deepEqual(Array.from(stampModel(tooShort, "abc123")), Array.from(tooShort));

  /* No watermark to apply: the very same object comes back, not a copy of it. */
  const unstamped = glb();
  assert.equal(stampModel(unstamped, null), unstamped, "with no watermark the input is returned as-is");
  assert.equal(stampModel(unstamped, ""), unstamped);
});

test("the streaming path produces the same bytes as the buffered one", async () => {
  /* A 40 MB model must never sit in Worker memory, so the endpoint streams -
     but it has to arrive at exactly the same file. */
  const original = glb();
  const expected = stampModel(original, "abc123", "2026-09-14");

  const source = new ReadableStream({
    start(controller) {
      /* Split across the header boundary on purpose: the transform has to
         hold bytes back until it has all 12. */
      controller.enqueue(original.slice(0, 5));
      controller.enqueue(original.slice(5, 9));
      controller.enqueue(original.slice(9));
      controller.close();
    }
  });

  const chunks = [];
  for await (const piece of stampModelStream(source, "abc123", "2026-09-14")) chunks.push(piece);
  const joined = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { joined.set(c, at); at += c.byteLength; }

  assert.deepEqual(Array.from(joined), Array.from(expected));
  assert.deepEqual(readAsLoaderDoes(joined).skipped, [GLB_CHUNK_STAMP]);
});

/* ------------------------------------------------------ through the API */

function envWithModel() {
  const license = activeLicense();
  const env = envWithLicense(license);
  env.LICENSES.map.set(MEDIA_KV_PREFIX + "index", JSON.stringify({
    version: "v1",
    items: [
      { path: "models/FLAP_SYSTEM.glb", contentType: "model/gltf-binary", bytes: 100 },
      { path: "systems/fuel.png", contentType: "image/png", bytes: 10 }
    ]
  }));
  env.LICENSES.map.set(MEDIA_KV_PREFIX + "blob:models/FLAP_SYSTEM.glb", glb());
  env.LICENSES.map.set(MEDIA_KV_PREFIX + "blob:systems/fuel.png", Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9]));
  return { env: env, license: license };
}

async function fetchAs(env, license, path, headers) {
  const session = await createWebSession(env.LICENSE_SIGNING_SECRET, license);
  const request = new Request(ORIGIN + path, {
    headers: Object.assign({ cookie: SESSION_COOKIE + "=" + session.token }, headers || {})
  });
  const response = await media({ request: request, env: env });
  const body = new Uint8Array(await response.arrayBuffer());
  return { response: response, body: body };
}

test("a model served through the API carries the account's stamp", async () => {
  const { env, license } = envWithModel();
  const result = await fetchAs(env, license, "/api/media/models/FLAP_SYSTEM.glb");

  assert.equal(result.response.status, 200);
  const stamp = readModelStamp(result.body);
  assert.ok(stamp && stamp.id, "the delivered model must be attributable");

  /* And it still loads: same JSON, same binary. */
  const served = readAsLoaderDoes(result.body);
  const plain = readAsLoaderDoes(glb());
  assert.equal(served.content, plain.content);
  assert.deepEqual(Array.from(served.body), Array.from(plain.body));
});

test("two subscribers get the same model with different stamps", async () => {
  const first = envWithModel();
  const other = activeLicense({ key: "DHC6-ZZZZ-YYYY-XXXX", email: "other@example.com" });
  first.env.LICENSES.map.set("license:" + other.key, JSON.stringify(other));

  const a = await fetchAs(first.env, first.license, "/api/media/models/FLAP_SYSTEM.glb");
  const b = await fetchAs(first.env, other, "/api/media/models/FLAP_SYSTEM.glb");

  assert.notEqual(readModelStamp(a.body).id, readModelStamp(b.body).id,
    "one stamp per account, or a leak names everybody");
});

test("the stamp carries no address and no licence key", async () => {
  /* Same rule as the pack watermark: it identifies an account to the owner,
     it does not publish who they are to whoever holds the file. */
  const { env, license } = envWithModel();
  const result = await fetchAs(env, license, "/api/media/models/FLAP_SYSTEM.glb");
  const text = new TextDecoder().decode(result.body);

  assert.ok(!text.includes(license.email), "no email in the file");
  assert.ok(!text.includes(license.key), "no licence key either");
  assert.match(readModelStamp(result.body).id, /^[0-9a-f]{16}$/, "an opaque id, resolvable only by the owner");
});

test("a poster is not a model and is left alone", async () => {
  const { env, license } = envWithModel();
  const result = await fetchAs(env, license, "/api/media/systems/fuel.png");
  assert.equal(result.response.status, 200);
  assert.deepEqual(Array.from(result.body), [0x89, 0x50, 0x4e, 0x47, 9, 9, 9, 9], "returned byte for byte");
});

test("a range request cannot fetch a model without its stamp", async () => {
  /* The obvious bypass: ask for bytes 0- and get the stored object straight
     from the shelf. Models are served whole, stamped, whatever is asked. */
  const { env, license } = envWithModel();
  const result = await fetchAs(env, license, "/api/media/models/FLAP_SYSTEM.glb", { Range: "bytes=0-" });

  assert.equal(result.response.status, 200, "not 206: the range is refused, not honoured");
  assert.ok(readModelStamp(result.body), "and the body is still stamped");
});
