import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";

const ORDERS_KEY = "kimchi-house:orders";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_ORDERS_FILE = path.join(__dirname, "../../data/orders.json");

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

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_ORDERS_FILE)) fs.writeFileSync(LOCAL_ORDERS_FILE, "[]", "utf8");
}

function readLocalOrders() {
  ensureLocalFile();
  try {
    const orders = JSON.parse(fs.readFileSync(LOCAL_ORDERS_FILE, "utf8"));
    return Array.isArray(orders) ? orders : [];
  } catch {
    return [];
  }
}

function writeLocalOrders(orders) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_ORDERS_FILE, JSON.stringify(orders, null, 2) + "\n", "utf8");
}

export async function readOrders() {
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) return [];
    return readLocalOrders();
  }
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
    if (process.env.VERCEL) {
      throw new Error(
        "주문 저장소(Redis)가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 연결해 주세요."
      );
    }
    writeLocalOrders(orders);
    return;
  }
  await redis.set(ORDERS_KEY, orders);
}
