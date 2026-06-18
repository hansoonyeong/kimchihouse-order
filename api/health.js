import { hasRedisEnv, json, optionsResponse, requireEnv } from "./_lib/http.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const env = requireEnv();
  return json({
    ok: true,
    envReady: env.ok,
    redisReady: hasRedisEnv(),
  });
}
