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

import { parseLicenseRecord, getLicense, getLicenseByEmail } from "../functions/api/_shared.js";
import { onRequestPost as billingStatus } from "../functions/api/billing/status.js";
import { activeLicense, envWithLicense, jsonRequest } from "./helpers.mjs";

const ORIGIN = "https://dhc6trainer.com";
const BOM = "﻿";

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
