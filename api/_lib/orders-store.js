const ORDERS_KEY = "kimchi-house:orders";

async function getKv() {
  const { kv } = await import("@vercel/kv");
  return kv;
}

export async function readOrders() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    return [];
  }
  try {
    const kv = await getKv();
    const orders = await kv.get(ORDERS_KEY);
    return Array.isArray(orders) ? orders : [];
  } catch (err) {
    console.error("KV read error:", err);
    return [];
  }
}

export async function writeOrders(orders) {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) {
    throw new Error("주문 저장소(KV)가 연결되지 않았습니다. Vercel Storage에서 KV를 연결해 주세요.");
  }
  const kv = await getKv();
  await kv.set(ORDERS_KEY, orders);
}
