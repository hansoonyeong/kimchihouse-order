import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { buildStockRows } from "./_lib/catalog.js";
import { readOrders } from "./_lib/orders-store.js";
import { applyAutoSoldOutFromStock } from "./_lib/sales-store.js";
import { patchStockPrepared, readStock } from "./_lib/stock-store.js";

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

    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    const rows = buildStockRows(stock, orders);
    return json({ ok: true, stock, rows });
  } catch (err) {
    console.error("stock GET error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}

export async function PATCH(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;
    if (getAdminKey(request) !== env.adminPassword) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "잘못된 요청입니다." }, 400);
    }

    const updates = {};
    if (body?.productId != null && body?.prepared != null) {
      updates[String(body.productId)] = body.prepared;
    }
    if (body?.updates && typeof body.updates === "object") {
      Object.assign(updates, body.updates);
    }
    if (!Object.keys(updates).length) {
      return json({ ok: false, error: "변경할 재고가 없습니다." }, 400);
    }

    const stock = await patchStockPrepared(updates);
    const orders = await readOrders();
    await applyAutoSoldOutFromStock(stock, orders);
    const rows = buildStockRows(stock, orders);
    return json({ ok: true, stock, rows });
  } catch (err) {
    console.error("stock PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
