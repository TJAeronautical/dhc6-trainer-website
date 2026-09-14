/*
  One unreadable licence record must not take an endpoint down.

  Found in production. A licence written by hand through
  `wrangler kv key put --path` picked up a UTF-8 byte order mark, because
  Windows PowerShell's `-Encoding utf8` writes one. JSON.parse threw on the
  invisible leading character, the exception escaped the handler, and every
  /api/billing/status and /api/web-access/request-link call for that address
  returned 500 - all for a single malformed row.
*/
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseLicenseRecord, getLicense, getLicenseByEmail } from "../functions/api/_shared.js";
import { onRequestPost as billingStatus } from "../functions/api/billing/status.js";
import { activeLicense, envWithLicense, jsonRequest } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";
const BOM = "\uFEFF";

test("a byte order mark does not lose the licence", () => {
  const record = activeLicense();
  const parsed = parseLicenseRecord(BOM + JSON.stringify(record));
  assert.equal(parsed.key, record.key, "the BOM is an encoding artefact, not corruption - strip it and keep the licence");
  assert.equal(parsed.status, "active");

  assert.equal(parseLicenseRecord("  " + JSON.stringify(record) + "\n").key, record.key, "whitespace too");
});

test("anything genuinely unreadable is treated as absent, not thrown", () => {
  /* null is the safe direction: every caller already refuses access on null. */
  assert.equal(parseLicenseRecord("not json at all"), null);
  assert.equal(parseLicenseRecord("{"), null);
  assert.equal(parseLicenseRecord("[1,2,3]"), null, "an array is not a licence record");
  assert.equal(parseLicenseRecord('"a string"'), null);
  assert.equal(parseLicenseRecord("null"), null);
  assert.equal(parseLicenseRecord(""), null);
  assert.equal(parseLicenseRecord(null), null);
  assert.equal(parseLicenseRecord(undefined), null);
});

test("a corrupt row answers 'no account' instead of 500", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  env.LICENSES.map.set("license:" + license.key, "{ this is not json");

  /* Straight through the real endpoint, which is where the 500 came from. */
  const response = await billingStatus({
    request: jsonRequest(ORIGIN + "/api/billing/status", { email: license.email }),
    env: env
  });
  assert.notEqual(response.status, 500, "a malformed row must not surface as a server error");
  const body = await response.json();
  assert.equal(body.ok, false, "it reads as no account, which is the safe direction");

  assert.equal(await getLicense(env, license.key), null);
  assert.equal(await getLicenseByEmail(env, license.email), null);
});

test("the same row with a BOM still signs in", async () => {
  const license = activeLicense();
  const env = envWithLicense(license);
  env.LICENSES.map.set("license:" + license.key, BOM + JSON.stringify(license));

  const response = await billingStatus({
    request: jsonRequest(ORIGIN + "/api/billing/status", { email: license.email, licenseKey: license.key }),
    env: env
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.license.status, "active", "the account is usable despite how the row was written");
});

test("the BOM is written as an escape, not as an invisible character", () => {
  /*
    It was originally spelled as a literal U+FEFF inside the regex - in the
    source AND in the constant above. That works, but both are invisible, and
    a tool that strips a BOM while "cleaning" the repo would empty the regex
    to /^/ and this test's constant to "", so the guard would keep passing
    while guarding nothing. An escape is readable and cannot be lost silently.

    This check spells the character as an escape too, for the same reason.
  */
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  for (const file of ["functions/api/_shared.js", "tests/license-record.test.mjs"]) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(text.indexOf("\uFEFF"), -1, file + " carries an invisible U+FEFF; write the escape instead");
  }
  assert.match(fs.readFileSync(path.join(root, "functions/api/_shared.js"), "utf8"), /\/\^\\uFEFF\//,
    "and the strip must still be there, spelled out");
});

test("no shipped script begins with a byte order mark", () => {
  /* assets/js/desktop-access-request.js did. Browsers skip a leading BOM in a
     script, so it broke nothing - but it is the same encoding slip that made
     a licence row unparseable, and it has no business in the repo. */
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const offenders = [];
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "_delivery"].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|mjs|json|css|html)$/.test(entry.name)) {
        if (fs.readFileSync(full, "utf8").charCodeAt(0) === 0xFEFF) offenders.push(path.relative(root, full));
      }
    }
  })(root);
  assert.deepEqual(offenders, [], "files starting with a BOM: " + offenders.join(", "));
});
