/* GET /api/health - basic service check. */
export async function onRequestGet(context) {
  const hasKv = Boolean(context.env && context.env.LICENSES);
  const hasPaddleApi = Boolean(context.env && context.env.PADDLE_API_KEY);
  return new Response(
    JSON.stringify({
      ok: true,
      service: "dhc6-trainer-billing",
      kv: hasKv,
      paddleApi: hasPaddleApi
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
}
