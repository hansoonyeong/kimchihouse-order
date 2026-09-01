import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import {
  SALE_CATEGORIES,
  buildSalesRows,
  buildStockRows,
  sellableProductIndex,
} from "./_lib/catalog.js";
import { hasRedisEnv, readOrders } from "./_lib/orders-store.js";
import {
  IMPORTANT_PRODUCT_IDS,
  applyAutoSoldOutFromStock,
  deletePreset,
  patchSaleStatuses,
  publicSaleDetails,
  publicSaleMap,
  readSales,
  savePreset,
  updateSalesSettings,
} from "./_lib/sales-store.js";
import { patchStockFields, patchStockPrepared, ensureStockMigrated, readStock } from "./_lib/stock-store.js";

function storeLabel() {
  try {
    return hasRedisEnv() ? "redis" : "local";
  } catch {
    return "local";
  }
}

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    const url = new URL(request.url);
    const admin = getAdminKey(request) === env.adminPassword;
    const doc = await readSales();

    if (!admin) {
      const orders = await readOrders();
      const stock = await ensureStockMigrated(orders);
      const rows = buildStockRows(stock, orders);
      const remaining = {};
      for (const row of rows) {
        if (row.tracked) remaining[row.id] = Math.max(0, Math.floor(Number(row.remaining) || 0));
      }
      return json({
        ok: true,
        statuses: publicSaleMap(doc),
        details: publicSaleDetails(doc),
        remaining,
        settings: {
          autoSoldOutOnZero: doc.settings.autoSoldOutOnZero !== false,
        },
      });
    }

    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    const rows = buildSalesRows(stock, orders, doc);
    return json({
      ok: true,
      store: storeLabel(),
      categories: SALE_CATEGORIES,
      settings: doc.settings,
      products: doc.products,
      rows,
      presets: doc.presets,
      logs: (doc.logs || []).slice(0, 100),
      importantIds: [...IMPORTANT_PRODUCT_IDS],
      statuses: publicSaleMap(doc),
      details: publicSaleDetails(doc),
    });
  } catch (err) {
    console.error("sales GET error:", err);
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

    const action = String(body?.action || "statuses").trim();
    const admin = "admin";
    const catalogIndex = sellableProductIndex();
    const names = {};
    for (const [id, p] of catalogIndex) names[id] = p.name;

    if (action === "settings") {
      if (typeof body.autoSoldOutOnZero !== "boolean") {
        return json({ ok: false, error: "autoSoldOutOnZero 값이 필요합니다." }, 400);
      }
      const doc = await updateSalesSettings(
        { autoSoldOutOnZero: body.autoSoldOutOnZero },
        { admin }
      );
      const [stock, orders] = await Promise.all([readStock(), readOrders()]);
      if (body.autoSoldOutOnZero) {
        await applyAutoSoldOutFromStock(stock, orders);
      }
      const latest = await readSales();
      return json({
        ok: true,
        settings: latest.settings,
        rows: buildSalesRows(stock, orders, latest),
        logs: latest.logs.slice(0, 100),
      });
    }

    if (action === "save_preset") {
      const name = String(body.name || "").trim();
      if (!name) return json({ ok: false, error: "프리셋 이름이 필요합니다." }, 400);
      const [stock, salesDoc] = await Promise.all([readStock(), readSales()]);
      const snapshot = {
        products: {},
        stock: {},
      };
      for (const [id, entry] of Object.entries(salesDoc.products || {})) {
        snapshot.products[id] = { ...entry };
      }
      for (const [id, row] of Object.entries(stock || {})) {
        snapshot.stock[id] = {
          prepared: Number(row?.prepared || 0),
          ...(row?.remaining != null ? { remaining: Number(row.remaining) } : {}),
        };
      }
      // also capture current defaults for products without explicit entry
      for (const [id, p] of catalogIndex) {
        if (!snapshot.products[id]) {
          snapshot.products[id] = {
            saleStatus: p.soldOut ? "sold_out" : "active",
            sortOrder: null,
            price: null,
          };
        }
      }
      const { doc, preset } = await savePreset({ name, snapshot }, { admin });
      return json({ ok: true, preset, presets: doc.presets });
    }

    if (action === "delete_preset") {
      const presetId = String(body.presetId || "").trim();
      if (!presetId) return json({ ok: false, error: "프리셋 ID가 필요합니다." }, 400);
      const { doc, deleted } = await deletePreset(presetId, { admin });
      if (!deleted) return json({ ok: false, error: "프리셋을 찾을 수 없습니다." }, 404);
      return json({ ok: true, presets: doc.presets });
    }

    if (action === "apply_preset") {
      const presetId = String(body.presetId || "").trim();
      const confirmed = body.confirm === true;
      if (!confirmed) {
        return json({ ok: false, error: "프리셋 적용 전 확인이 필요합니다." }, 400);
      }
      const doc = await readSales();
      const preset = (doc.presets || []).find((p) => p.id === presetId);
      if (!preset) return json({ ok: false, error: "프리셋을 찾을 수 없습니다." }, 404);

      const snapProducts = preset.snapshot?.products || {};
      const snapStock = preset.snapshot?.stock || {};
      const updates = {};
      for (const [id, entry] of Object.entries(snapProducts)) {
        updates[id] = entry;
      }
      await patchSaleStatuses(updates, { names, admin: `${admin}:preset` });
      if (Object.keys(snapStock).length) {
        const preparedUpdates = {};
        const remainingUpdates = {};
        for (const [id, value] of Object.entries(snapStock)) {
          if (value != null && typeof value === "object") {
            if (value.prepared != null) preparedUpdates[id] = value.prepared;
            if (value.remaining != null) remainingUpdates[id] = value.remaining;
          } else {
            preparedUpdates[id] = value;
          }
        }
        await patchStockFields({
          preparedUpdates,
          remainingUpdates,
          admin: `${admin}:preset`,
          note: `프리셋 적용: ${preset.name}`,
        });
      }
      const [stock, orders, latest] = await Promise.all([readStock(), readOrders(), readSales()]);
      return json({
        ok: true,
        applied: preset.name,
        rows: buildSalesRows(stock, orders, latest),
        settings: latest.settings,
        presets: latest.presets,
        logs: latest.logs.slice(0, 100),
      });
    }

    // default: patch statuses
    const updates = body.updates && typeof body.updates === "object" ? body.updates : null;
    if (!updates || !Object.keys(updates).length) {
      if (body.productId != null && body.saleStatus != null) {
        const single = {};
        single[String(body.productId)] = body.saleStatus;
        const { doc, logs } = await patchSaleStatuses(single, { names, admin });
        const [stock, orders] = await Promise.all([readStock(), readOrders()]);
        return json({
          ok: true,
          logs,
          rows: buildSalesRows(stock, orders, doc),
          statuses: publicSaleMap(doc),
        });
      }
      return json({ ok: false, error: "변경할 판매 상태가 없습니다." }, 400);
    }

    const { doc, logs } = await patchSaleStatuses(updates, { names, admin });
    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    return json({
      ok: true,
      logs,
      rows: buildSalesRows(stock, orders, doc),
      settings: doc.settings,
      statuses: publicSaleMap(doc),
      logsAll: doc.logs.slice(0, 100),
    });
  } catch (err) {
    console.error("sales PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
