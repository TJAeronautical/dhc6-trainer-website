/* GET /api/health - basic service check. */
export async function onRequestGet(context) {
  const hasKv = Boolean(context.env && context.env.LICENSES);
  const hasPaddleApi = Boolean(context.env && context.env.PADDLE_API_KEY);
  const hasPaddleWebhookSecret = Boolean(context.env && context.env.PADDLE_WEBHOOK_SECRET);
  const hasLicenseSigningSecret = Boolean(context.env && context.env.LICENSE_SIGNING_SECRET);
  const paddleEnvironment = context.env && context.env.PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "production";
  const hasPaddleClientToken = Boolean(context.env && context.env.PADDLE_CLIENT_TOKEN);
  const hasPaddlePrices = Boolean(
    context.env &&
      context.env.PADDLE_PRICE_PREMIUM_MONTHLY &&
      context.env.PADDLE_PRICE_PREMIUM_ANNUAL &&
      context.env.PADDLE_PRICE_INSTRUCTOR_MONTHLY &&
      context.env.PADDLE_PRICE_INSTRUCTOR_ANNUAL &&
      context.env.PADDLE_PRICE_ENTERPRISE_MONTHLY &&
      context.env.PADDLE_PRICE_ENTERPRISE_ANNUAL
  );
  const desktopReleaseVersion = String((context.env && context.env.DESKTOP_RELEASE_VERSION) || "1.7.0");
  const hasDesktopR2 = Boolean(context.env && context.env.DESKTOP_RELEASES);
  const hasDesktopExeUrl = Boolean(context.env && context.env.DESKTOP_WINDOWS_EXE_URL);
  const hasDesktopMsiUrl = Boolean(context.env && context.env.DESKTOP_WINDOWS_MSI_URL);
  const hasOpenAiApi = Boolean(context.env && context.env.OPENAI_API_KEY);
  const hasFirebaseWebApi = Boolean(context.env && context.env.FIREBASE_WEB_API_KEY);
  const hasFirebaseProject = Boolean(context.env && context.env.FIREBASE_PROJECT_ID);
  const hasGooglePlayServiceAccount = Boolean(
    context.env &&
      context.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL &&
      context.env.GOOGLE_PLAY_SERVICE_ACCOUNT_PRIVATE_KEY
  );
  const mobileBackendConfigured = Boolean(
    hasOpenAiApi &&
      hasFirebaseWebApi &&
      hasFirebaseProject &&
      hasGooglePlayServiceAccount
  );
  return new Response(
    JSON.stringify({
      ok: true,
      service: "dhc6-trainer-billing",
      kv: hasKv,
      paddleEnvironment: paddleEnvironment,
      paddleApi: hasPaddleApi,
      paddleCheckoutConfigured: hasPaddleClientToken && hasPaddlePrices,
      paddleClientToken: hasPaddleClientToken,
      paddlePrices: hasPaddlePrices,
      paddleWebhookSecret: hasPaddleWebhookSecret,
      licenseSigningSecret: hasLicenseSigningSecret,
      desktopReleaseVersion: desktopReleaseVersion,
      desktopDownloadConfigured: hasDesktopR2 || hasDesktopExeUrl || hasDesktopMsiUrl,
      desktopDownloadR2: hasDesktopR2,
      desktopDownloadExeUrl: hasDesktopExeUrl,
      desktopDownloadMsiUrl: hasDesktopMsiUrl,
      mobileBackendConfigured: mobileBackendConfigured,
      openAiApi: hasOpenAiApi,
      firebaseWebApi: hasFirebaseWebApi,
      firebaseProject: hasFirebaseProject,
      googlePlayServiceAccount: hasGooglePlayServiceAccount
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
