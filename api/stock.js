import { buildStockRows, listCatalogProducts } from "./_lib/catalog.js";
import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { readOrders } from "./_lib/orders-store.js";
import { applyAutoSoldOutFromStock } from "./_lib/sales-store.js";
import {
  ensureStockMigrated,
  patchStockFields,
  readStockLogs,
  restoreStockFromBackup,
} from "./_lib/stock-store.js";

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
    const stock = await ensureStockMigrated(orders);
    const rows = buildStockRows(stock, orders);
    const logs = await readStockLogs(80);
    return json({ ok: true, stock, rows, logs });
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

    const orders = await readOrders();

    if (body?.action === "restore_backup") {
      const result = await restoreStockFromBackup({ force: body.force === true, orders });
      if (!result.ok) return json(result, 400);
      await applyAutoSoldOutFromStock(result.stock, orders);
      const rows = buildStockRows(result.stock, orders);
      const logs = await readStockLogs(80);
      return json({ ok: true, restored: true, stock: result.stock, rows, logs });
    }

    const preparedUpdates = {};
    const remainingUpdates = {};

    if (body?.productId != null) {
      const id = String(body.productId);
      if (body.prepared != null) preparedUpdates[id] = body.prepared;
      if (body.remaining != null) remainingUpdates[id] = body.remaining;
    }

    if (body?.updates && typeof body.updates === "object") {
      for (const [id, value] of Object.entries(body.updates)) {
        if (value == null) continue;
        if (typeof value === "number" || typeof value === "string") {
          preparedUpdates[id] = value;
          continue;
        }
        if (typeof value === "object") {
          if (value.prepared != null) preparedUpdates[id] = value.prepared;
          if (value.remaining != null) remainingUpdates[id] = value.remaining;
        }
      }
    }

    if (body?.remainingUpdates && typeof body.remainingUpdates === "object") {
      Object.assign(remainingUpdates, body.remainingUpdates);
    }
    if (body?.preparedUpdates && typeof body.preparedUpdates === "object") {
      Object.assign(preparedUpdates, body.preparedUpdates);
    }

    // 남은 재고 단일 수정 (사유 포함)
    if (body?.action === "set_remaining" && body?.productId != null && body?.remaining != null) {
      remainingUpdates[String(body.productId)] = body.remaining;
    }

    for (const [id, value] of Object.entries(remainingUpdates)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return json({ ok: false, error: `남은 재고는 0 이상의 숫자여야 합니다: ${id}` }, 400);
      }
      remainingUpdates[id] = Math.floor(n);
    }
    for (const [id, value] of Object.entries(preparedUpdates)) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        return json({ ok: false, error: `준비 수량은 0 이상의 숫자여야 합니다: ${id}` }, 400);
      }
      preparedUpdates[id] = Math.floor(n);
    }

    if (!Object.keys(preparedUpdates).length && !Object.keys(remainingUpdates).length) {
      return json({ ok: false, error: "변경할 재고가 없습니다." }, 400);
    }

    await ensureStockMigrated(orders);
    const names = Object.fromEntries(listCatalogProducts().map((p) => [p.id, p.name]));

    const { stock, logs: changeLogs } = await patchStockFields({
      preparedUpdates,
      remainingUpdates,
      admin: body?.admin || "admin",
      note: body?.note || body?.reason || "",
      names,
    });

    await applyAutoSoldOutFromStock(stock, orders);
    const rows = buildStockRows(stock, orders);
    const logs = await readStockLogs(80);
    return json({ ok: true, stock, rows, logs, changeLogs });
  } catch (err) {
    console.error("stock PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
