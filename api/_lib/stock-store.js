import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";

const STOCK_KEY = "kimchi-house:stock";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STOCK_FILE = path.join(__dirname, "../../data/stock.json");

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_STOCK_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_STOCK_FILE)) fs.writeFileSync(LOCAL_STOCK_FILE, "{}", "utf8");
}

function readLocalStock() {
  ensureLocalFile();
  try {
    const data = JSON.parse(fs.readFileSync(LOCAL_STOCK_FILE, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeLocalStock(stock) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_STOCK_FILE, JSON.stringify(stock, null, 2) + "\n", "utf8");
}

function normalizeStockMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (typeof value === "number") {
      out[id] = { prepared: Math.max(0, Math.floor(value)) };
      continue;
    }
    if (typeof value === "object") {
      out[id] = {
        prepared: Math.max(0, Math.floor(Number(value.prepared) || 0)),
      };
    }
  }
  return out;
}

export async function readStock() {
  const redis = getRedis();
  if (!redis) return normalizeStockMap(readLocalStock());
  try {
    const stock = await redis.get(STOCK_KEY);
    return normalizeStockMap(stock);
  } catch (err) {
    console.error("Redis stock read error:", err);
    return {};
  }
}

export async function writeStock(stock) {
  const normalized = normalizeStockMap(stock);
  const redis = getRedis();
  if (!redis) {
    writeLocalStock(normalized);
    return normalized;
  }
  await redis.set(STOCK_KEY, normalized);
  return normalized;
}

export async function patchStockPrepared(updates) {
  const current = await readStock();
  for (const [id, prepared] of Object.entries(updates || {})) {
    if (!id) continue;
    const next = Math.max(0, Math.floor(Number(prepared) || 0));
    current[id] = { prepared: next };
  }
  return writeStock(current);
}
