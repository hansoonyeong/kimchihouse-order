import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import {
  DEFAULT_DELIVERY_DATE,
  DEFAULT_DELIVERY_STATUS,
  DELIVERY_STATUSES,
  normalizeOrderDelivery,
  orderStatus,
  parseDeliveryDate,
  resolveDeliveryDate,
} from "./_lib/order-utils.js";
import { productNameIndex, reservedByProduct, resolvePrepared, sellableProductIndex, stockUnitsFromItem } from "./_lib/catalog.js";
import { readOrders, writeOrders } from "./_lib/orders-store.js";
import {
  applyAutoSoldOutFromStock,
  assertItemsPurchasable,
  readSales,
} from "./_lib/sales-store.js";
import { readSettings } from "./_lib/settings-store.js";
import { readStock } from "./_lib/stock-store.js";

async function assertStockAvailable(items, { excludeOrderId } = {}) {
  const stock = await readStock();
  const orders = await readOrders();
  const scoped = excludeOrderId
    ? orders.filter((o) => o.id !== excludeOrderId)
    : orders;
  const reserved = reservedByProduct(scoped);
  const nameIndex = productNameIndex();
  const needed = {};
  for (const item of items || []) {
    for (const unit of stockUnitsFromItem(item, nameIndex)) {
      needed[unit.key] = (needed[unit.key] || 0) + unit.qty;
    }
  }
  for (const [id, qty] of Object.entries(needed)) {
    const prepared = resolvePrepared(stock, id);
    if (prepared <= 0) continue;
    const left = prepared - (reserved[id] || 0);
    if (qty > left) {
      return { ok: false, error: `재고 부족: ${id} (잔여 ${Math.max(0, left)} / 요청 ${qty})` };
    }
  }
  return { ok: true };
}

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

    const orders = (await readOrders()).map((order) => normalizeOrderDelivery(order));
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

    const settings = await readSettings();
    if (settings.preorderOpen === false) {
      return json({ ok: false, error: "현재는 사전 주문 기간이 아닙니다." }, 403);
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
      deliveryDate,
    } = body;

    if (!type || !customer?.name || !customer?.phone || !customer?.address) {
      return json({ ok: false, error: "필수 주문 정보가 누락되었습니다." }, 400);
    }

    if (!Array.isArray(items) || items.length === 0) {
      return json({ ok: false, error: "주문 품목을 1개 이상 선택해 주세요." }, 400);
    }

    const salesDoc = await readSales();
    const saleCheck = assertItemsPurchasable(items, salesDoc, sellableProductIndex());
    if (!saleCheck.ok) return json(saleCheck, 409);

    const stockCheck = await assertStockAvailable(items);
    if (!stockCheck.ok) return json(stockCheck, 409);

    const date = new Date();
    const y = String(date.getFullYear()).slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const orderId = `KH${y}${m}${d}-` + Math.floor(1000 + Math.random() * 9000);

    const resolvedDate =
      parseDeliveryDate(deliveryDate) ||
      parseDeliveryDate(shippingBreakdown?.kimchi?.delivery) ||
      parseDeliveryDate(shippingBreakdown?.frozen?.delivery) ||
      parseDeliveryDate(shippingBreakdown?.walkerhill?.delivery) ||
      DEFAULT_DELIVERY_DATE;

    const order = {
      id: orderId,
      type,
      customer,
      items,
      subtotal: Number(subtotal) || 0,
      shippingFee: Number(shippingFee) || 0,
      total: Number(total) || 0,
      payment: payment || "transfer",
      note: note || "",
      createdAt: new Date().toISOString(),
      status: DEFAULT_DELIVERY_STATUS,
      deliveryDate: resolvedDate,
      deliveryStatus: DEFAULT_DELIVERY_STATUS,
      delivery: {
        date: resolvedDate,
        status: DEFAULT_DELIVERY_STATUS,
      },
      confirmMessageSent: false,
      shipNoticeSent: false,
    };

    if (shippingBreakdown) order.shippingBreakdown = shippingBreakdown;

    const orders = await readOrders();
    orders.unshift(order);
    await writeOrders(orders);

    const stock = await readStock();
    await applyAutoSoldOutFromStock(stock, orders);

    return json({ ok: true, orderId: order.id }, 201);
  } catch (err) {
    console.error("orders POST error:", err);
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

    const orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return json({ ok: false, error: "주문번호가 필요합니다." }, 400);
    }

    const orders = await readOrders();
    const index = orders.findIndex((o) => o.id === orderId);
    if (index === -1) {
      return json({ ok: false, error: "주문을 찾을 수 없습니다." }, 404);
    }

    const current = orders[index];
    const patch = {};

    if (body.status != null && String(body.status).trim() !== "") {
      const status = String(body.status).trim();
      if (!DELIVERY_STATUSES.includes(status)) {
        return json({ ok: false, error: "유효하지 않은 배송 상태입니다." }, 400);
      }
      patch.status = status;
      patch.deliveryStatus = status;
      patch.delivery = {
        ...(typeof current.delivery === "object" && current.delivery ? current.delivery : {}),
        date: resolveDeliveryDate(current),
        status,
      };
    }

    if (body.deliveryDate != null && String(body.deliveryDate).trim() !== "") {
      const date = parseDeliveryDate(body.deliveryDate);
      if (!date) {
        return json({ ok: false, error: "유효하지 않은 배송 예정일입니다." }, 400);
      }
      patch.deliveryDate = date;
      patch.delivery = {
        ...(typeof current.delivery === "object" && current.delivery ? current.delivery : {}),
        ...(patch.delivery || {}),
        date,
        status: patch.status || orderStatus(current),
      };
    }

    if (typeof body.confirmMessageSent === "boolean") {
      patch.confirmMessageSent = body.confirmMessageSent;
      if (body.confirmMessageSent) patch.confirmMessageSentAt = new Date().toISOString();
    }

    if (typeof body.shipNoticeSent === "boolean") {
      patch.shipNoticeSent = body.shipNoticeSent;
      if (body.shipNoticeSent) patch.shipNoticeSentAt = new Date().toISOString();
    }

    const wantsOrderEdit =
      body.customer != null ||
      body.items != null ||
      body.payment != null ||
      body.note != null ||
      body.subtotal != null ||
      body.shippingFee != null ||
      body.total != null;

    if (wantsOrderEdit) {
      const nextCustomer = body.customer
        ? {
            name: String(body.customer.name || current.customer?.name || "").trim(),
            phone: String(body.customer.phone || current.customer?.phone || "").trim(),
            address: String(body.customer.address || current.customer?.address || "").trim(),
            suburb: String(body.customer.suburb || current.customer?.suburb || "").trim(),
            kakao: String(body.customer.kakao ?? current.customer?.kakao ?? "").trim(),
          }
        : current.customer;

      if (!nextCustomer?.name || !nextCustomer?.phone || !nextCustomer?.address) {
        return json({ ok: false, error: "주문자 이름·연락처·주소는 필수입니다." }, 400);
      }

      let nextItems = current.items;
      if (body.items != null) {
        if (!Array.isArray(body.items) || !body.items.length) {
          return json({ ok: false, error: "주문 품목을 1개 이상 입력해 주세요." }, 400);
        }
        nextItems = [];
        for (let i = 0; i < body.items.length; i += 1) {
          const item = body.items[i];
          const name = String(item?.name || "").trim();
          const qty = Math.max(0, Math.floor(Number(item?.qty) || 0));
          const price = Math.max(0, Number(item?.price) || 0);
          if (!name || qty <= 0) {
            return json({ ok: false, error: `품목 ${i + 1}: 상품명과 수량을 확인해 주세요.` }, 400);
          }
          const id = String(item?.id || item?.productId || `custom-${i + 1}`);
          nextItems.push({
            id,
            ...(item?.productId || item?.id ? { productId: String(item.productId || item.id) } : {}),
            name,
            qty,
            price,
            ...(item?.category ? { category: item.category } : {}),
            ...(item?.variantKey ? { variantKey: item.variantKey } : {}),
          });
        }
      }

      const stockCheck = await assertStockAvailable(nextItems, { excludeOrderId: orderId });
      if (!stockCheck.ok) return json(stockCheck, 409);

      const subtotal = body.subtotal != null
        ? Number(body.subtotal) || 0
        : nextItems.reduce((sum, item) => sum + Number(item.price || 0), 0);
      const shippingFee = body.shippingFee != null
        ? Number(body.shippingFee) || 0
        : Number(current.shippingFee) || 0;
      const total = body.total != null
        ? Number(body.total) || 0
        : subtotal + shippingFee;

      patch.customer = nextCustomer;
      patch.items = nextItems;
      patch.subtotal = subtotal;
      patch.shippingFee = shippingFee;
      patch.total = total;
      if (body.payment != null) {
        const payment = String(body.payment).trim();
        if (payment !== "cash" && payment !== "transfer") {
          return json({ ok: false, error: "결제 방법이 올바르지 않습니다." }, 400);
        }
        patch.payment = payment;
      }
      if (body.note != null) patch.note = String(body.note);
      patch.updatedAt = new Date().toISOString();
    }

    if (!Object.keys(patch).length) {
      return json({ ok: false, error: "변경할 항목이 없습니다." }, 400);
    }

    orders[index] = { ...current, ...patch };
    await writeOrders(orders);

    if (wantsOrderEdit) {
      const stock = await readStock();
      await applyAutoSoldOutFromStock(stock, orders);
    }

    return json({ ok: true, orderId, order: normalizeOrderDelivery(orders[index]) });
  } catch (err) {
    console.error("orders PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}

export async function DELETE(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    if (getAdminKey(request) !== env.adminPassword) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    const orderId = new URL(request.url).searchParams.get("orderId")?.trim();
    if (!orderId) {
      return json({ ok: false, error: "주문번호가 필요합니다." }, 400);
    }

    const orders = await readOrders();
    const nextOrders = orders.filter((o) => o.id !== orderId);
    if (nextOrders.length === orders.length) {
      return json({ ok: false, error: "주문을 찾을 수 없습니다." }, 404);
    }

    await writeOrders(nextOrders);
    return json({ ok: true, orderId });
  } catch (err) {
    console.error("orders DELETE error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
