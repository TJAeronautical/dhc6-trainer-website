import { json } from "../_shared.js";
import { readJson, verifyFirebaseUser } from "../_mobile_shared.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_OUTPUT_TOKENS = 600;

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await verifyFirebaseUser(context);
  if (!auth.ok) return auth.response;

  if (!env.OPENAI_API_KEY) {
    return json({ ok: false, error: "openai_api_key_missing" }, 503);
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const payload = {
    model: String(env.OPENAI_MODEL || body.model || DEFAULT_MODEL),
    instructions: String(body.instructions || ""),
    input: Array.isArray(body.input) ? body.input : [],
    max_output_tokens: Math.min(
      MAX_OUTPUT_TOKENS,
      Math.max(1, Number(body.max_output_tokens || MAX_OUTPUT_TOKENS))
    )
  };

  if (!payload.instructions || payload.input.length === 0) {
    return json({ ok: false, error: "invalid_oral_exam_payload" }, 400);
  }

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.OPENAI_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("Content-Type") || "application/json",
      "Cache-Control": "no-store"
    }
  });
}
