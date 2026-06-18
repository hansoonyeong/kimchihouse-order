import { json, optionsResponse, requireEnv } from "./_lib/http.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;
    return json({ ok: true, orderSecret: env.orderSecret });
  } catch (err) {
    console.error("config GET error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
