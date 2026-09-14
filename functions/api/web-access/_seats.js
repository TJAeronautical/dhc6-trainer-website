/*
  How many browsers one licence may sign in from.

  The hole this closes: desktop activations cap at `activationLimit` (3), but a
  web session was bound to nothing at all - not a device, not an address, not a
  count. One key shared with fifty people produced fifty working sessions, and
  every other protection on the 3D models was moot while that was true.

  A seat is a BROWSER, not a sign-in. Signing in again on the same laptop
  reuses that laptop's seat rather than spending a new one, so three seats
  really is phone + tablet + laptop rather than three sign-ins in a day.

  Stored in its own KV key rather than on the licence record, deliberately: the
  Paddle webhook writes that record, and a read-modify-write from two different
  paths is exactly the race that minted duplicate licences in phase 32. Seats
  live at `webseats:<key>` and nothing else touches them.

  Honest limit: KV is eventually consistent, so two sign-ins in the same
  instant can both read "2 seats used" and both write a third. The consequence
  is a fourth seat for one session's lifetime, not an unbounded one - the next
  sign-in reads the full list and refuses. That is a wide enough margin for a
  household and far too narrow for a shared key, which is the point.
*/

import { revokeWebSession } from "./_session.js";

const SEAT_PREFIX = "webseats:";

/* A seat outlives any one session on purpose. Bounding it to a session would
   make "three browsers" mean "three browsers in the next twelve hours", which
   a rota of sharers walks straight through. Thirty days matches the offline
   window, so the two limits expire together. */
export const SEAT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_SEAT_LIMIT = 3;
export const DEVICE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function seatKey(licenseKey) {
  return SEAT_PREFIX + String(licenseKey || "").trim().toUpperCase();
}

/*
  Per-licence override first, then the desktop activation allowance (an
  operator who bought ten desktop seats means ten), then a deployment-wide
  variable, then three. Every step is a positive integer or it is ignored -
  a malformed value must not silently mean "no limit".
*/
export function seatLimitFor(env, record) {
  const candidates = [
    record && record.webSeatLimit,
    record && record.activationLimit,
    env && env.WEB_SEAT_LIMIT
  ];
  for (let i = 0; i < candidates.length; i++) {
    const value = Number(candidates[i]);
    if (Number.isFinite(value) && value >= 1) return Math.floor(value);
  }
  return DEFAULT_SEAT_LIMIT;
}

/*
  A coarse label so a pilot deciding which device to sign out recognises it.
  Coarse on purpose: the full user-agent string is a fingerprint and there is
  no reason to keep one.
*/
export function deviceLabel(userAgent) {
  const ua = String(userAgent || "");
  if (!ua) return "Unknown browser";
  const browser =
    /\bEdg\//.test(ua) ? "Edge" :
    /\bOPR\/|\bOpera\b/.test(ua) ? "Opera" :
    /\bFirefox\//.test(ua) ? "Firefox" :
    /\bChrome\//.test(ua) ? "Chrome" :
    /\bSafari\//.test(ua) ? "Safari" : "Browser";
  const platform =
    /\biPhone\b/.test(ua) ? "iPhone" :
    /\biPad\b/.test(ua) ? "iPad" :
    /\bAndroid\b/.test(ua) ? "Android" :
    /\bWindows\b/.test(ua) ? "Windows" :
    /\bMac OS X\b|\bMacintosh\b/.test(ua) ? "Mac" :
    /\bCrOS\b/.test(ua) ? "ChromeOS" :
    /\bLinux\b/.test(ua) ? "Linux" : "";
  return platform ? browser + " on " + platform : browser;
}

function isoNow() {
  return new Date().toISOString();
}

function seatAlive(seat, nowMs) {
  if (!seat || !seat.id) return false;
  const seen = Date.parse(seat.lastSeenAt || "");
  if (!isFinite(seen)) return false;
  return seen + SEAT_TTL_SECONDS * 1000 > nowMs;
}

export async function readSeats(env, licenseKey) {
  if (!env || !env.LICENSES || !licenseKey) return [];
  let raw = null;
  try {
    raw = await env.LICENSES.get(seatKey(licenseKey));
  } catch (error) {
    /* A seat store that cannot be read must not lock a paying subscriber out.
       Failing open here costs at most the limit for one sign-in; failing
       closed would deny access because of an infrastructure blip. */
    return [];
  }
  if (!raw) return [];
  let parsed = null;
  try {
    parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch (error) {
    return [];
  }
  const seats = parsed && Array.isArray(parsed.seats) ? parsed.seats : [];
  const now = Date.now();
  return seats.filter(function (seat) { return seatAlive(seat, now); });
}

async function writeSeats(env, licenseKey, seats) {
  if (!env || !env.LICENSES || !licenseKey) return;
  try {
    await env.LICENSES.put(
      seatKey(licenseKey),
      JSON.stringify({ v: 1, seats: seats }),
      { expirationTtl: SEAT_TTL_SECONDS + 3600 }
    );
  } catch (error) {
    /* Same reasoning as the read: never fail a sign-in over the seat store. */
  }
}

/* The shape the browser is allowed to see. No session token, no sid. */
export function describeSeats(seats, currentDeviceId) {
  return (seats || []).map(function (seat) {
    return {
      label: seat.label || "Unknown browser",
      firstSeenAt: seat.firstSeenAt || null,
      lastSeenAt: seat.lastSeenAt || null,
      current: Boolean(currentDeviceId) && seat.id === currentDeviceId
    };
  });
}

function oldest(seats) {
  return seats.slice().sort(function (a, b) {
    return Date.parse(a.lastSeenAt || 0) - Date.parse(b.lastSeenAt || 0);
  })[0];
}

/*
  Take a seat for this browser.

  `deviceId` comes from the browser and is stable across sign-ins. A caller
  that presents none cannot be recognised on its next visit, so it can neither
  keep a seat nor be refused one meaningfully: at the limit it EVICTS the
  least recently used seat instead. That keeps an old cached copy of the
  sign-in page working - it would otherwise lock its owner out after three
  attempts - while still holding the concurrent total at the limit, which is
  the number that actually matters against a shared key.

  Returns { ok:true, deviceId, seats, limit, evicted } or
          { ok:false, reason:"seat_limit", seats, limit }.
*/
export async function claimSeat(env, record, options) {
  const opts = options || {};
  const limit = seatLimitFor(env, record);
  const seats = await readSeats(env, record.key);
  const known = DEVICE_ID_PATTERN.test(String(opts.deviceId || "")) ? String(opts.deviceId) : "";
  const deviceId = known || randomDeviceId();
  const label = deviceLabel(opts.userAgent);
  const now = isoNow();

  let evicted = null;
  const mine = known ? seats.find(function (seat) { return seat.id === known; }) : null;

  if (!mine && seats.length >= limit) {
    if (known) {
      return { ok: false, reason: "seat_limit", seats: seats, limit: limit };
    }
    evicted = oldest(seats);
    if (evicted) {
      await revokeSeat(env, evicted);
      seats.splice(seats.indexOf(evicted), 1);
    }
  }

  if (mine) {
    /* A second sign-in from the same browser replaces that browser's session
       rather than adding one. The old token is revoked so a copied cookie
       does not outlive the sign-in that replaced it. */
    if (mine.sid && mine.sid !== opts.sid) await revokeSeat(env, mine);
    mine.sid = opts.sid || mine.sid;
    mine.exp = opts.exp || mine.exp;
    mine.label = label;
    mine.lastSeenAt = now;
  } else {
    seats.push({
      id: deviceId,
      sid: opts.sid || "",
      exp: opts.exp || 0,
      label: label,
      firstSeenAt: now,
      lastSeenAt: now
    });
  }

  await writeSeats(env, record.key, seats);
  return { ok: true, deviceId: deviceId, seats: seats, limit: limit, evicted: evicted };
}

export function randomDeviceId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

async function revokeSeat(env, seat) {
  if (!seat || !seat.sid) return;
  try {
    await revokeWebSession(env, { sid: seat.sid, exp: seat.exp });
  } catch (error) {
    /* best effort - the seat is dropped either way */
  }
}

/*
  Free every seat but one. This is what the "sign out other devices" control
  calls, and it is the reason the limit can refuse rather than silently evict:
  a subscriber who legitimately hits it has a way through that does not
  involve waiting or contacting support.
*/
export async function signOutOtherSeats(env, record, keepDeviceId) {
  const seats = await readSeats(env, record.key);
  const keep = [];
  const dropped = [];
  for (let i = 0; i < seats.length; i++) {
    if (keepDeviceId && seats[i].id === keepDeviceId) keep.push(seats[i]);
    else dropped.push(seats[i]);
  }
  for (let i = 0; i < dropped.length; i++) await revokeSeat(env, dropped[i]);
  await writeSeats(env, record.key, keep);
  return { seats: keep, dropped: dropped.length };
}

/* Signing out gives the seat back, so the next browser is not refused over a
   session its owner deliberately ended. */
export async function releaseSeatBySid(env, licenseKey, sid) {
  if (!sid) return false;
  const seats = await readSeats(env, licenseKey);
  const remaining = seats.filter(function (seat) { return seat.sid !== sid; });
  if (remaining.length === seats.length) return false;
  await writeSeats(env, licenseKey, remaining);
  return true;
}
