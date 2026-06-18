import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { readOrders, writeOrders } from "./_lib/orders-store.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    if (getAdminKey(request) !== env.adminPassword) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    const orders = await readOrders();
    return json({ ok: true, orders });
  } catch (err) {
    console.error("orders GET error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
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

    if (!body || body.secret !== env.orderSecret) {
      return json({ ok: false, error: "주문 요청이 유효하지 않습니다." }, 401);
    }

    const {
      type,
      customer,
      items,
      subtotal,
      shippingFee,
      total,
      payment,
      note,
      shippingBreakdown,
    } = body;

    if (!type || !customer?.name || !customer?.phone || !customer?.address) {
      return json({ ok: false, error: "필수 주문 정보가 누락되었습니다." }, 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return json({ ok: false, error: "주문 품목을 1개 이상 선택해 주세요." }, 400);
    }

    const order = {
      id: `KH-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      type,
      customer,
      items,
      subtotal: Number(subtotal) || 0,
      shippingFee: Number(shippingFee) || 0,
      total: Number(total) || 0,
      payment: payment || "transfer",
      note: note || "",
      createdAt: new Date().toISOString(),
    };

    if (shippingBreakdown) order.shippingBreakdown = shippingBreakdown;

    const orders = await readOrders();
    orders.unshift(order);
    await writeOrders(orders);

    return json({ ok: true, orderId: order.id }, 201);
  } catch (err) {
    console.error("orders POST error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
