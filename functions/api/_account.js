/*
  The stable per-account identifier used for storage namespaces.

  It lived inside qrh-edits/_store.js, which is why the Library and the Logbook
  both import their account id from the QRH editor. It is not a QRH concept -
  it is the answer to "whose data is this", and every store asks it - so it is
  here, and that file re-exports it so nothing else moves.

  ---------------------------------------------------------------------------
  WHY IT NOW REFUSES TO GUESS

  The old seed was:

      auth.role === "owner" ? "owner:" + payload.email : "license:" + payload.key

  A mobile session has neither. It carries a Firebase uid and no licence key,
  so it hashed the literal string "license:" - and every Android account in the
  product would have resolved to ONE namespace. They would have read each
  other's logbooks and each other's Library documents.

  Nothing reaches this with a mobile session today: the Library, the Logbook and
  the QRH editor all authorise with authorizeWebRequest alone. That is the only
  reason it has never happened, and it is not a reason to leave it. Phase 45
  introduced the mobile auth shape to this codebase; the next endpoint to accept
  it would have inherited a silent cross-account leak, and the failure would
  have looked like a data bug rather than an auth one.

  This is exactly the defect watermarkSeed() had and phase 45 fixed. Same shape,
  same cause, same fix - so the two now agree: an Android caller is identified
  by its uid.

  And an auth this cannot identify returns NULL rather than a hash of an empty
  seed. A shared namespace is the worst possible answer to "whose data is this",
  and it is precisely what an empty seed silently produces.
*/

function str(value) { return value == null ? "" : String(value); }

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
}

/*
  The namespace seed, or null when the caller cannot be identified.

  Deliberately the same shape as watermarkSeed() in _watermark.js, and
  deliberately NOT the same value: that one is an HMAC meant to be seen by
  whoever receives a leak, this one is a plain hash naming a storage bucket.
  See the header of _watermark.js for why they must not be the same string.
*/
export function accountSeed(auth) {
  const payload = (auth && auth.payload) || {};

  if (auth && auth.role === "owner") {
    const email = str(payload.email).trim().toLowerCase();
    return email ? "owner:" + email : null;
  }

  if (auth && auth.client === "android") {
    const uid = str(auth.uid).trim();
    return uid ? "firebase:" + uid : null;
  }

  const key = str(payload.key).trim().toUpperCase();
  return key ? "license:" + key : null;
}

/* Stable per-account id. Owner, subscriber and Android namespaces never
   collide, and an unidentifiable caller gets null rather than somebody else's
   bucket. */
export async function accountIdFor(auth) {
  const seed = accountSeed(auth);
  if (!seed) return null;
  return (await sha256Hex(seed)).slice(0, 32);
}
