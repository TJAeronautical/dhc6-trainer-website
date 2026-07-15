/* GET /api/health - basic service check. */
export async function onRequestGet(context) {
  const hasKv = Boolean(context.env && context.env.LICENSES);
  const hasPaddleApi = Boolean(context.env && context.env.PADDLE_API_KEY);
  const hasPaddleWebhookSecret = Boolean(context.env && context.env.PADDLE_WEBHOOK_SECRET);
  const hasLicenseSigningSecret = Boolean(context.env && context.env.LICENSE_SIGNING_SECRET);
  return new Response(
    JSON.stringify({
      ok: true,
      service: "dhc6-trainer-billing",
      kv: hasKv,
      paddleApi: hasPaddleApi,
      paddleWebhookSecret: hasPaddleWebhookSecret,
      licenseSigningSecret: hasLicenseSigningSecret
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
