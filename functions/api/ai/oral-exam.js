import { json } from "../_shared.js";
import { readJson, verifyFirebaseAppCheck, verifyFirebaseUser } from "../_mobile_shared.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_OUTPUT_TOKENS = 600;
const MAX_INSTRUCTIONS_LENGTH = 12000;
const MAX_MESSAGE_LENGTH = 8000;
const MAX_HISTORY_ITEMS = 40;

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-MAX_HISTORY_ITEMS).map(function (item) {
    if (!item || (item.role !== "user" && item.role !== "assistant")) return null;
    const content = String(item.content || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    return content ? { role: item.role, content: content } : null;
  }).filter(Boolean);
}

function responseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item && item.content) ? item.content : [];
    for (const part of content) {
      if (part && typeof part.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const auth = await verifyFirebaseUser(context);
  if (!auth.ok) return auth.response;
  const appCheck = await verifyFirebaseAppCheck(context);
  if (!appCheck.ok) return appCheck.response;

  if (!env.OPENAI_API_KEY) {
    return json({ ok: false, error: "openai_api_key_missing" }, 503);
  }

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "bad_json" }, 400);
  }

  const instructions = String(body.instructions || "").trim().slice(0, MAX_INSTRUCTIONS_LENGTH);
  const history = cleanHistory(body.history);
  const message = String(body.message || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  if (message) history.push({ role: "user", content: message });

  const payload = {
    model: String(env.OPENAI_MODEL || DEFAULT_MODEL),
    instructions: instructions,
    input: history,
    max_output_tokens: MAX_OUTPUT_TOKENS
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

  let data = {};
  try { data = await response.json(); } catch (e) { data = {}; }
  if (!response.ok) {
    return json({ ok: false, error: "openai_request_failed" }, 502);
  }
  const text = responseText(data);
  if (!text) return json({ ok: false, error: "openai_response_empty" }, 502);
  return json({ text: text }, 200);
}
