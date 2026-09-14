/*
  GET  /api/web-access/devices   -> the browsers this licence is signed in on
  POST /api/web-access/devices   -> sign the other browsers out

  The self-service half of the seat limit. Refusing a fourth browser is only
  reasonable if the subscriber can free one themselves, from either side of
  the door:

    - Refused at sign-in, with no session: /api/web-access/session already
      proves the licence key, so it takes `signOutOthers` directly.
    - Already signed in, from Settings: this endpoint, where the session is
      the proof.

  Which seat is "mine" is never taken from the request body. It is the seat
  holding this session's id, which the caller cannot forge without the signing
  secret - otherwise anyone signed in could name someone else's device as
  their own and sign the real owner out instead.
*/

import { json } from "../_shared.js";
import { authorizeWebRequest, sameOriginRequest } from "./_session.js";
import { describeSeats, readSeats, seatLimitFor, signOutOtherSeats } from "./_seats.js";

function currentDeviceId(seats, sid) {
  const mine = (seats || []).find(function (seat) { return sid && seat.sid === sid; });
  return mine ? mine.id : null;
}

/* An owner session is one person with no licence record behind it, so there
   are no seats to show and nothing to sign out. Say so plainly rather than
   returning an empty list that reads as "you have no devices". */
function ownerAnswer() {
  return json({ ok: true, applies: false, devices: [], limit: null, used: 0 });
}

export async function onRequestGet(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (auth.role === "owner") return ownerAnswer();

  const seats = await readSeats(context.env, auth.record.key);
  return json({
    ok: true,
    applies: true,
    limit: seatLimitFor(context.env, auth.record),
    used: seats.length,
    devices: describeSeats(seats, currentDeviceId(seats, auth.payload.sid))
  });
}

export async function onRequestPost(context) {
  const auth = await authorizeWebRequest(context);
  if (!auth.ok) return json({ ok: false, error: auth.error }, auth.status);
  if (!sameOriginRequest(context.request)) return json({ ok: false, error: "cross_site_request" }, 403);
  if (auth.role === "owner") return ownerAnswer();

  const seats = await readSeats(context.env, auth.record.key);
  const keep = currentDeviceId(seats, auth.payload.sid);
  const result = await signOutOtherSeats(context.env, auth.record, keep);

  return json({
    ok: true,
    applies: true,
    signedOut: result.dropped,
    limit: seatLimitFor(context.env, auth.record),
    used: result.seats.length,
    devices: describeSeats(result.seats, keep)
  });
}
