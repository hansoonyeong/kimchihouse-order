import { Redis } from "@upstash/redis";

const ORDERS_KEY = "kimchi-house:orders";

export function getRedisEnv() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

export function hasRedisEnv() {
  const { url, token } = getRedisEnv();
  return Boolean(url && token);
}

function getRedis() {
  const { url, token } = getRedisEnv();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function readOrders() {
  const redis = getRedis();
  if (!redis) return [];
  try {
    const orders = await redis.get(ORDERS_KEY);
    return Array.isArray(orders) ? orders : [];
  } catch (err) {
    console.error("Redis read error:", err);
    return [];
  }
}

export async function writeOrders(orders) {
  const redis = getRedis();
  if (!redis) {
    throw new Error(
      "주문 저장소(Redis)가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 연결해 주세요."
    );
  }
  await redis.set(ORDERS_KEY, orders);
}
