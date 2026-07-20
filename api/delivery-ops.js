import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import {
  DEFAULT_OPS_STATUS,
  OPS_STATUSES,
  normalizeOpsEntry,
  readDeliveryOps,
  writeDeliveryOps,
} from "./_lib/delivery-ops-store.js";
import { hasRedisEnv } from "./_lib/orders-store.js";

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
    const doc = await readDeliveryOps();
    return json({
      ok: true,
      ops: doc,
      statuses: OPS_STATUSES,
      defaultStatus: DEFAULT_OPS_STATUS,
      store: hasRedisEnv() ? "redis" : "local",
    });
  } catch (err) {
    console.error("delivery-ops GET error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}

/**
 * PATCH body:
 * - { orderId, status?, routeIndex?, note? }  single upsert
 * - { updates: [{ orderId, status?, routeIndex?, note? }, ...] }  bulk upsert
 * Does not read or write the orders collection.
 */
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

    const updates = Array.isArray(body?.updates)
      ? body.updates
      : body?.orderId
        ? [body]
        : [];

    if (!updates.length) {
      return json({ ok: false, error: "변경할 배송 작업 항목이 없습니다." }, 400);
    }

    const doc = await readDeliveryOps();
    const byOrderId = { ...doc.byOrderId };

    for (const item of updates) {
      const orderId = String(item?.orderId || "").trim();
      if (!orderId) continue;
      const prev = normalizeOpsEntry(byOrderId[orderId]);
      const next = { ...prev };
      if (item.status != null) {
        const status = String(item.status).trim();
        if (!OPS_STATUSES.includes(status)) {
          return json({ ok: false, error: `유효하지 않은 배송 작업 상태: ${status}` }, 400);
        }
        next.status = status;
      }
      if (item.routeIndex !== undefined) {
        next.routeIndex =
          item.routeIndex == null || item.routeIndex === ""
            ? null
            : Math.max(0, Math.floor(Number(item.routeIndex) || 0));
      }
      if (item.note != null) next.note = String(item.note);
      byOrderId[orderId] = next;
    }

    const saved = await writeDeliveryOps({ ...doc, byOrderId });
    return json({ ok: true, ops: saved });
  } catch (err) {
    console.error("delivery-ops PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
