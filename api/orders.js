import { kv } from "@vercel/kv";

const ORDERS_KEY = "kimchi-house:orders";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Key");
}

function unauthorized(res, message = "Unauthorized") {
  return res.status(401).json({ ok: false, error: message });
}

function getAdminKey(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return req.headers["x-admin-key"] || "";
}

async function readOrders() {
  try {
    const orders = await kv.get(ORDERS_KEY);
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

async function writeOrders(orders) {
  await kv.set(ORDERS_KEY, orders);
}

export default async function handler(req, res) {
  cors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const orderSecret = process.env.ORDER_SECRET;

  if (!adminPassword || !orderSecret) {
    return res.status(500).json({
      ok: false,
      error: "서버 환경변수(ADMIN_PASSWORD, ORDER_SECRET)가 설정되지 않았습니다.",
    });
  }

  if (req.method === "GET") {
    if (getAdminKey(req) !== adminPassword) {
      return unauthorized(res, "관리자 인증이 필요합니다.");
    }

    const orders = await readOrders();
    return res.status(200).json({ ok: true, orders });
  }

  if (req.method === "POST") {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    if (!body || body.secret !== orderSecret) {
      return unauthorized(res, "주문 요청이 유효하지 않습니다.");
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
      return res.status(400).json({ ok: false, error: "필수 주문 정보가 누락되었습니다." });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, error: "주문 품목을 1개 이상 선택해 주세요." });
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

    return res.status(201).json({ ok: true, orderId: order.id });
  }

  return res.status(405).json({ ok: false, error: "Method not allowed" });
}
