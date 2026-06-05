/* GET /api/health - basic service check. */
export async function onRequestGet(context) {
  const hasKv = Boolean(context.env && context.env.LICENSES);
  return new Response(
    JSON.stringify({ ok: true, service: "dhc6-trainer-licenses", kv: hasKv }),
    { headers: { "Content-Type": "application/json" } }
  );
}
