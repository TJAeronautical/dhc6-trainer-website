/*
  One tier model, shared by the web and by Google Play.

  The defect this exists to close: the web app had exactly two plan-dependent
  behaviours - QRH manual edit and publishing to the shared Library shelf - and
  each carried its own hand-written `plan.indexOf("instructor") === 0` test.
  Everything else was byte-identical for premium, instructor, enterprise and the
  legacy `desktop` plan, `enterprise` was indistinguishable from `instructor`,
  and nothing told a subscriber which tier they were on or what it bought them.

  Meanwhile functions/api/play/validate-purchase.js already held a complete
  FREE / PRO / INSTRUCTOR / ENTERPRISE model with sixteen entitlements, written
  to Firestore for the Android client and never read by a single web code path.
  Two systems, one product, no translation between them.

  This is that model, lifted out so both sides read the same table. The Play
  path keeps writing what it always wrote - there is a test asserting the
  entitlement lists are byte-identical to the ones that shipped, so an Android
  client cannot be broken by a change made for the web.

  The rule for adding anything: a capability check is `hasEntitlement(auth, X)`,
  never a plan-string comparison. Plan strings are a billing detail; entitlements
  are what the product actually sells.
*/

/* ------------------------------------------------------------- Entitlements */
export const AI_TRAINER = "AI_TRAINER";
export const CONTENT_AUTHORING = "CONTENT_AUTHORING";
export const CONTENT_PACK_MANAGEMENT = "CONTENT_PACK_MANAGEMENT";
export const CORPORATE_REPORTS = "CORPORATE_REPORTS";
export const INSTRUCTOR_TOOLS = "INSTRUCTOR_TOOLS";
export const ORGANIZATION_MANAGEMENT = "ORGANIZATION_MANAGEMENT";
export const QRH_MANUAL_EDIT = "QRH_MANUAL_EDIT";

/* ------------------------------------------------------------------- Tiers */
export const FREE = "FREE";
export const PRO = "PRO";
export const INSTRUCTOR = "INSTRUCTOR";
export const ENTERPRISE = "ENTERPRISE";

export const FREE_ENTITLEMENTS = ["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"];

export const PRO_ENTITLEMENTS = [
  "BASIC_STUDY",
  "FULL_STUDY",
  "SYSTEMS_LAB_3D",
  "FLASHCARD_SELF_ENTRY",
  "AI_TRAINER",
  "QRH_DRILLS",
  "ADVANCED_SCENARIOS",
  "CLOUD_SYNC",
  "TRAINING_INTELLIGENCE"
];

export const INSTRUCTOR_ENTITLEMENTS = PRO_ENTITLEMENTS.concat([
  "INSTRUCTOR_TOOLS",
  "CONTENT_AUTHORING",
  "QRH_MANUAL_EDIT",
  "CORPORATE_REPORTS"
]);

export const ENTERPRISE_ENTITLEMENTS = INSTRUCTOR_ENTITLEMENTS.concat([
  "COCKPIT_DEBUG_TOOLS",
  "CONTENT_PACK_MANAGEMENT",
  "ORGANIZATION_MANAGEMENT"
]);

const TIER_RANK = { FREE: 0, PRO: 1, INSTRUCTOR: 2, ENTERPRISE: 3 };

export function tierRank(tier) {
  return TIER_RANK[String(tier || "").toUpperCase()] || 0;
}

export function maxTier(a, b) {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function entitlementsForTier(tier) {
  const name = String(tier || "").toUpperCase();
  if (name === ENTERPRISE) return ENTERPRISE_ENTITLEMENTS;
  if (name === INSTRUCTOR) return INSTRUCTOR_ENTITLEMENTS;
  if (name === PRO) return PRO_ENTITLEMENTS;
  return FREE_ENTITLEMENTS;
}

/* Every tier above FREE, in ascending order - what a paid web plan can be. */
export const PAID_TIERS = [PRO, INSTRUCTOR, ENTERPRISE];

/*
  A Paddle plan string to a tier.

  `premium_*` is PRO, which is the decision that matters: a premium subscriber
  keeps the 3D Technical Lab, the AI trainer, cloud sync and training
  intelligence. Nothing a paying customer can use today is taken away by
  introducing this layer, and that is deliberate - the split is authoring and
  administration, not training content.

  An unrecognised plan on an ACTIVE licence resolves to PRO rather than FREE.
  The gate that decides whether somebody is entitled at all is the status
  allowlist in authorizeWebRequest; by the time a plan string is being read the
  subscription is already known good, so a typo in a plan name must not cost a
  paying pilot their training content. It costs them authoring, which is the
  right direction to fail.
*/
export function tierForPlan(plan) {
  const name = String(plan || "").trim().toLowerCase();
  if (!name) return PRO;
  if (name === "owner") return ENTERPRISE;
  /* Anchored, and on a word boundary: `indexOf(...) === 0` would have handed
     authoring rights to a future plan called "instructorship". */
  if (/^enterprise(_|$)/.test(name)) return ENTERPRISE;
  if (/^instructor(_|$)/.test(name)) return INSTRUCTOR;
  if (/^premium(_|$)/.test(name)) return PRO;
  /* Legacy `desktop`, `desktop_annual`, and anything unrecognised. */
  return PRO;
}

/*
  The tier for an authorised request. The owner is ENTERPRISE: they own the
  product, and an owner locked out of their own administration tools would be
  absurd.
*/
export function tierFor(auth) {
  if (!auth || !auth.ok) return FREE;
  if (auth.role === "owner") return ENTERPRISE;
  return tierForPlan(auth.plan);
}

export function entitlementsFor(auth) {
  return entitlementsForTier(tierFor(auth));
}

export function hasEntitlement(auth, entitlement) {
  if (!auth || !auth.ok || !entitlement) return false;
  return entitlementsFor(auth).indexOf(entitlement) >= 0;
}

/* What to tell somebody who does not have it: the cheapest tier that does. */
export function lowestTierWith(entitlement) {
  for (let i = 0; i < PAID_TIERS.length; i++) {
    if (entitlementsForTier(PAID_TIERS[i]).indexOf(entitlement) >= 0) return PAID_TIERS[i];
  }
  return null;
}

export const TIER_LABEL = {
  FREE: "Free",
  PRO: "Premium",
  INSTRUCTOR: "Instructor",
  ENTERPRISE: "Enterprise"
};

export function tierLabel(tier) {
  return TIER_LABEL[String(tier || "").toUpperCase()] || "Premium";
}
