import { hasRedisEnv } from "./orders-store.js";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
};

export function json(data, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

export function optionsResponse() {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function getAdminKey(request) {
  const header = request.headers.get("authorization") || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return request.headers.get("x-admin-key") || "";
}

export function requireEnv() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const orderSecret = process.env.ORDER_SECRET;
  if (!adminPassword || !orderSecret) {
    return {
      ok: false,
      response: json(
        {
          ok: false,
          error: "서버 환경변수(ADMIN_PASSWORD, ORDER_SECRET)가 설정되지 않았습니다.",
        },
        500
      ),
    };
  }
  return { ok: true, adminPassword, orderSecret };
}

export { hasRedisEnv };
