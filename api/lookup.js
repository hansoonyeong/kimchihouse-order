import { json, optionsResponse, requireEnv } from "./_lib/http.js";
import { phonesMatch, publicOrderView } from "./_lib/order-utils.js";
import { readOrders } from "./_lib/orders-store.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "잘못된 요청입니다." }, 400);
    }

    const phone = String(body?.phone || "").trim();
    if (!phone) {
      return json({ ok: false, error: "연락처를 입력해 주세요." }, 400);
    }

    const orders = await readOrders();
    const matched = orders
      .filter((order) => phonesMatch(order.customer?.phone, phone))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map(publicOrderView);

    return json({ ok: true, orders: matched });
  } catch (err) {
    console.error("lookup POST error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
