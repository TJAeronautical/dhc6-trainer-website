import { json } from "../_shared.js";
import {
  GOOGLE_API_SCOPES,
  firestoreArray,
  firestoreInteger,
  firestoreMap,
  firestoreString,
  googleJson,
  parseFirestoreArray,
  parseFirestoreString,
  readJson,
  sha256Hex,
  verifyFirebaseUser
} from "../_mobile_shared.js";

const PLAY_BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/";
const FIRESTORE_BASE = "https://firestore.googleapis.com/v1/projects/";
const PRODUCT_TYPE_SUBS = "subs";
const PRODUCT_TYPE_INAPP = "inapp";
const VALIDATION_SOURCE_SERVER = "SERVER_VALIDATED";

const FREE_ENTITLEMENTS = ["BASIC_STUDY", "FLASHCARD_SELF_ENTRY"];
const PRO_ENTITLEMENTS = [
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
const INSTRUCTOR_ENTITLEMENTS = PRO_ENTITLEMENTS.concat([
  "INSTRUCTOR_TOOLS",
  "CONTENT_AUTHORING",
  "QRH_MANUAL_EDIT",
  "CORPORATE_REPORTS"
]);
const ENTERPRISE_ENTITLEMENTS = [
  "BASIC_STUDY",
  "FULL_STUDY",
  "SYSTEMS_LAB_3D",
  "FLASHCARD_SELF_ENTRY",
  "QRH_DRILLS",
  "AI_TRAINER",
  "ADVANCED_SCENARIOS",
  "CLOUD_SYNC",
  "TRAINING_INTELLIGENCE",
  "COCKPIT_DEBUG_TOOLS",
  "QRH_MANUAL_EDIT",
  "CONTENT_PACK_MANAGEMENT",
  "INSTRUCTOR_TOOLS",
  "CONTENT_AUTHORING",
  "ORGANIZATION_MANAGEMENT",
  "CORPORATE_REPORTS"
];

const ALL_TRAINING_PACKS = [
  "built-in-cockpit-familiarisation",
  "built-in-aircraft-systems",
  "built-in-qrh-drills",
  "generic-dhc6-float-ops-memory-only-v4",
  "built-in-pt6-powerplant",
  "dhc6-g950-procedures",
  "dhc6-legacy-procedures",
  "built-in-full-training"
];

const PRODUCTS = {
  dhc6_trainer_premium_monthly: { type: PRODUCT_TYPE_SUBS, tier: "PRO", packIds: ALL_TRAINING_PACKS },
  dhc6_trainer_premium_yearly: { type: PRODUCT_TYPE_SUBS, tier: "PRO", packIds: ALL_TRAINING_PACKS },
  dhc6_trainer_instructor_monthly: { type: PRODUCT_TYPE_SUBS, tier: "INSTRUCTOR", packIds: ALL_TRAINING_PACKS },
  dhc6_trainer_enterprise_airline: { type: PRODUCT_TYPE_SUBS, tier: "ENTERPRISE", packIds: ALL_TRAINING_PACKS },
  dhc6_cockpit_familiarisation_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["built-in-cockpit-familiarisation"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "FLASHCARD_SELF_ENTRY"]
  },
  dhc6_aircraft_systems_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["built-in-aircraft-systems", "built-in-pt6-powerplant"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "SYSTEMS_LAB_3D", "FLASHCARD_SELF_ENTRY"]
  },
  dhc6_qrh_drills_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["built-in-qrh-drills"],
    entitlements: ["BASIC_STUDY", "QRH_DRILLS", "ADVANCED_SCENARIOS", "FLASHCARD_SELF_ENTRY"]
  },
  dhc6_float_operations_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["generic-dhc6-float-ops-memory-only-v4"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "QRH_DRILLS", "FLASHCARD_SELF_ENTRY"]
  },
  dhc6_pt6_powerplant_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["built-in-pt6-powerplant"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "SYSTEMS_LAB_3D", "FLASHCARD_SELF_ENTRY"]
  },
  dhc6_full_training_pack: { type: PRODUCT_TYPE_INAPP, tier: "PRO", packIds: ALL_TRAINING_PACKS },
  dhc6_trainer_g950_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["dhc6-g950-procedures"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "QRH_DRILLS"]
  },
  dhc6_trainer_legacy_pack: {
    type: PRODUCT_TYPE_INAPP,
    tier: "FREE",
    packIds: ["dhc6-legacy-procedures"],
    entitlements: ["BASIC_STUDY", "FULL_STUDY", "QRH_DRILLS"]
  }
};

function tierRank(tier) {
  return { FREE: 0, PRO: 1, INSTRUCTOR: 2, ENTERPRISE: 3 }[tier] || 0;
}

function maxTier(a, b) {
  return tierRank(a) >= tierRank(b) ? a : b;
}

function entitlementsForTier(tier) {
  if (tier === "ENTERPRISE") return ENTERPRISE_ENTITLEMENTS;
  if (tier === "INSTRUCTOR") return INSTRUCTOR_ENTITLEMENTS;
  if (tier === "PRO") return PRO_ENTITLEMENTS;
  return FREE_ENTITLEMENTS;
}

function productEntitlements(product) {
  return Array.from(new Set(entitlementsForTier(product.tier).concat(product.entitlements || [])));
}

function publicProductType(productType) {
  return productType === PRODUCT_TYPE_SUBS ? "subs" : "inapp";
}

function playProductTypeFromRequest(value) {
  const lower = String(value || "").toLowerCase();
  if (lower === "subs" || lower === "subscription") return PRODUCT_TYPE_SUBS;
  if (lower === "inapp" || lower === "in_app" || lower === "product") return PRODUCT_TYPE_INAPP;
  return "";
}

function activeSubscriptionPurchase(data, productId) {
  const state = String(data.subscriptionState || "");
  if (state !== "SUBSCRIPTION_STATE_ACTIVE" && state !== "SUBSCRIPTION_STATE_IN_GRACE_PERIOD") {
    return { active: false, reason: state || "subscription_not_active" };
  }

  const matchingItem = (data.lineItems || []).find(function (item) {
    return item && item.productId === productId;
  });
  if (!matchingItem) return { active: false, reason: "subscription_product_mismatch" };

  const expiryMillis = matchingItem.expiryTime ? Date.parse(matchingItem.expiryTime) : null;
  if (expiryMillis && expiryMillis <= Date.now()) {
    return { active: false, reason: "subscription_expired", expiryMillis: expiryMillis };
  }

  return {
    active: true,
    purchaseState: "PURCHASED",
    acknowledged: data.acknowledgementState === "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED",
    autoRenewing: Boolean(matchingItem.autoRenewingPlan && matchingItem.autoRenewingPlan.autoRenewEnabled),
    expiryMillis: expiryMillis
  };
}

function activeInappPurchase(data, productId) {
  if (data.productId && data.productId !== productId) {
    return { active: false, reason: "product_mismatch" };
  }
  if (Number(data.purchaseState) !== 0) {
    return { active: false, reason: "product_not_purchased" };
  }
  if (Number(data.consumptionState || 0) !== 0) {
    return { active: false, reason: "product_consumed" };
  }
  return {
    active: true,
    purchaseState: "PURCHASED",
    acknowledged: Number(data.acknowledgementState) === 1,
    autoRenewing: null,
    expiryMillis: null
  };
}

async function acknowledgePurchase(env, packageName, productId, productType, purchaseToken) {
  const encodedPackage = encodeURIComponent(packageName);
  const encodedProduct = encodeURIComponent(productId);
  const encodedToken = encodeURIComponent(purchaseToken);
  const url = productType === PRODUCT_TYPE_SUBS
    ? PLAY_BASE + encodedPackage + "/purchases/subscriptions/" + encodedProduct + "/tokens/" + encodedToken + ":acknowledge"
    : PLAY_BASE + encodedPackage + "/purchases/products/" + encodedProduct + "/tokens/" + encodedToken + ":acknowledge";
  return googleJson(env, url, { method: "POST", body: {} }, GOOGLE_API_SCOPES);
}

async function verifyPlayPurchase(env, requestBody) {
  const packageName = String(requestBody.packageName || "");
  const productId = String(requestBody.productId || "");
  const purchaseToken = String(requestBody.purchaseToken || "");
  const requestedType = playProductTypeFromRequest(requestBody.productType);
  const product = PRODUCTS[productId];

  if (!packageName || packageName !== String(env.MOBILE_ANDROID_PACKAGE || "com.dhc6trainer")) {
    return { valid: false, error: "package_mismatch" };
  }
  if (!product) return { valid: false, error: "unknown_product" };
  if (!purchaseToken) return { valid: false, error: "purchase_token_missing" };
  if (requestedType && requestedType !== product.type) {
    return { valid: false, error: "product_type_mismatch" };
  }

  const encodedPackage = encodeURIComponent(packageName);
  const encodedProduct = encodeURIComponent(productId);
  const encodedToken = encodeURIComponent(purchaseToken);
  const url = product.type === PRODUCT_TYPE_SUBS
    ? PLAY_BASE + encodedPackage + "/purchases/subscriptionsv2/tokens/" + encodedToken
    : PLAY_BASE + encodedPackage + "/purchases/products/" + encodedProduct + "/tokens/" + encodedToken;
  const playResponse = await googleJson(env, url, { method: "GET" }, GOOGLE_API_SCOPES);
  if (!playResponse.ok) {
    return { valid: false, error: "play_api_rejected", status: playResponse.status, details: playResponse.data };
  }

  const state = product.type === PRODUCT_TYPE_SUBS
    ? activeSubscriptionPurchase(playResponse.data, productId)
    : activeInappPurchase(playResponse.data, productId);
  if (!state.active) {
    return { valid: false, error: state.reason || "purchase_not_active", expiryMillis: state.expiryMillis || null };
  }

  if (!state.acknowledged) {
    const ack = await acknowledgePurchase(env, packageName, productId, product.type, purchaseToken);
    if (!ack.ok) {
      return { valid: false, error: "acknowledge_failed", status: ack.status, details: ack.data };
    }
    state.acknowledged = true;
  }

  return {
    valid: true,
    product: product,
    productType: product.type,
    purchaseState: state.purchaseState,
    acknowledged: state.acknowledged,
    autoRenewing: state.autoRenewing,
    expiryMillis: state.expiryMillis,
    play: playResponse.data
  };
}

function firestoreDocumentUrl(env, uid) {
  return FIRESTORE_BASE +
    encodeURIComponent(env.FIREBASE_PROJECT_ID) +
    "/databases/(default)/documents/users/" +
    encodeURIComponent(uid) +
    "/entitlements/current";
}

async function readCurrentEntitlements(env, uid) {
  const response = await googleJson(env, firestoreDocumentUrl(env, uid), { method: "GET" }, GOOGLE_API_SCOPES);
  if (!response.ok) return { tier: "FREE", entitlements: [], ownedPackIds: [], ownedBillingProductIds: [] };
  const fields = response.data.fields || {};
  return {
    tier: parseFirestoreString(fields.tier) || "FREE",
    entitlements: parseFirestoreArray(fields.entitlements),
    ownedPackIds: parseFirestoreArray(fields.ownedPackIds),
    ownedBillingProductIds: parseFirestoreArray(fields.ownedBillingProductIds)
  };
}

async function writeEntitlements(env, uid, productId, product, metadata) {
  if (!env.FIREBASE_PROJECT_ID) return { ok: false, skipped: true, error: "firebase_project_id_missing" };

  const current = await readCurrentEntitlements(env, uid);
  const tier = maxTier(current.tier || "FREE", product.tier || "FREE");
  const entitlements = Array.from(new Set((current.entitlements || []).concat(productEntitlements(product))));
  const ownedPackIds = Array.from(new Set((current.ownedPackIds || []).concat(product.packIds || [])));
  const ownedBillingProductIds = Array.from(new Set((current.ownedBillingProductIds || []).concat([productId])));

  const body = {
    fields: {
      tier: firestoreString(tier),
      entitlements: firestoreArray(entitlements),
      ownedPackIds: firestoreArray(ownedPackIds),
      ownedBillingProductIds: firestoreArray(ownedBillingProductIds),
      validatedAtMillis: firestoreInteger(metadata.lastVerifiedAtMillis),
      lastPlayPurchase: firestoreMap({
        productId: firestoreString(productId),
        productType: firestoreString(metadata.productType),
        purchaseTokenHash: firestoreString(metadata.purchaseTokenHash),
        purchaseState: firestoreString(metadata.purchaseState),
        validatedAtMillis: firestoreInteger(metadata.lastVerifiedAtMillis)
      })
    }
  };

  const updateMask = [
    "tier",
    "entitlements",
    "ownedPackIds",
    "ownedBillingProductIds",
    "validatedAtMillis",
    "lastPlayPurchase"
  ].map(function (field) {
    return "updateMask.fieldPaths=" + encodeURIComponent(field);
  }).join("&");

  return googleJson(env, firestoreDocumentUrl(env, uid) + "?" + updateMask, {
    method: "PATCH",
    body: body
  }, GOOGLE_API_SCOPES);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const auth = await verifyFirebaseUser(context);
  if (!auth.ok) return auth.response;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return json({ valid: false, error: "bad_json" }, 400);
  }
  if (String(body.userId || "") !== auth.uid) {
    return json({ valid: false, error: "user_mismatch" }, 403);
  }

  try {
    const verified = await verifyPlayPurchase(env, body);
    if (!verified.valid) {
      return json({
        valid: false,
        error: verified.error,
        status: verified.status || null,
        expiryMillis: verified.expiryMillis || null
      }, 200);
    }

    const now = Date.now();
    const metadata = {
      productId: String(body.productId),
      productType: publicProductType(verified.productType),
      purchaseTokenHash: await sha256Hex(body.purchaseToken),
      purchaseState: verified.purchaseState,
      purchaseTimeMillis: Number(body.purchaseTimeMillis || 0),
      acknowledged: Boolean(verified.acknowledged),
      autoRenewing: verified.autoRenewing,
      entitlementExpiresAtMillis: verified.expiryMillis || null,
      lastSeenAtMillis: now,
      lastVerifiedAtMillis: now,
      validationSource: VALIDATION_SOURCE_SERVER
    };

    const firestoreWrite = await writeEntitlements(env, auth.uid, String(body.productId), verified.product, metadata);
    return json({
      valid: true,
      metadata: metadata,
      tier: verified.product.tier || "FREE",
      ownedPackIds: verified.product.packIds || [],
      entitlements: productEntitlements(verified.product),
      firestoreUpdated: Boolean(firestoreWrite && firestoreWrite.ok)
    });
  } catch (e) {
    return json({ valid: false, error: "validation_exception" }, 500);
  }
}
