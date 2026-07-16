import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";
import { migrateLegacyVariantStock } from "./catalog.js";
import stockBackup from "../_data/stock-backup.js";

const STOCK_KEY = "kimchi-house:stock";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STOCK_FILE = path.join(__dirname, "../../data/stock.json");
const BACKUP_STOCK_FILE = path.join(__dirname, "../_data/stock-backup.json");

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

function stockHasPrepared(stock) {
  return Object.values(stock || {}).some((v) => Number(v?.prepared ?? v ?? 0) > 0);
}

function loadBackupStock() {
  try {
    if (stockBackup && typeof stockBackup === "object") {
      return normalizeStockMap(stockBackup);
    }
  } catch (_) {
    /* fall through */
  }
  try {
    if (!fs.existsSync(BACKUP_STOCK_FILE)) return {};
    return normalizeStockMap(JSON.parse(fs.readFileSync(BACKUP_STOCK_FILE, "utf8")));
  } catch (err) {
    console.error("Stock backup read error:", err);
    return {};
  }
}

async function persistStock(normalized) {
  const redis = getRedis();
  if (!redis) {
    writeLocalStock(normalized);
    return normalized;
  }
  await redis.set(STOCK_KEY, normalized);
  return normalized;
}

async function readRawStock() {
  const redis = getRedis();
  try {
    if (!redis) return normalizeStockMap(readLocalStock());
    return normalizeStockMap(await redis.get(STOCK_KEY));
  } catch (err) {
    console.error("Redis stock read error:", err);
    return {};
  }
}

/** 재고가 전부 0이면 커밋된 백업으로 복구 */
export async function restoreStockFromBackup({ force = false } = {}) {
  const backup = loadBackupStock();
  if (!stockHasPrepared(backup)) {
    return { ok: false, error: "백업 재고가 비어 있습니다.", stock: await readRawStock() };
  }
  const current = await readRawStock();
  if (!force && stockHasPrepared(current)) {
    return { ok: false, error: "현재 재고가 이미 있습니다. 강제 복구가 필요합니다.", stock: current };
  }
  const migrated = migrateLegacyVariantStock(backup);
  const saved = await persistStock(normalizeStockMap(migrated.stock));
  return { ok: true, stock: saved, restored: true };
}

export async function readStock() {
  let stock = await readRawStock();
  const migrated = migrateLegacyVariantStock(stock);
  stock = normalizeStockMap(migrated.stock);

  if (migrated.changed) {
    try {
      await persistStock(stock);
    } catch (err) {
      console.error("Stock migration persist error:", err);
    }
  }

  // 프로덕션에서 용량 SKU 변경 후 재고가 전부 0이 된 경우 백업 복구
  if (!stockHasPrepared(stock)) {
    const restored = await restoreStockFromBackup({ force: true });
    if (restored.ok) return restored.stock;
  }

  return stock;
}

export async function writeStock(stock) {
  const normalized = normalizeStockMap(stock);
  const migrated = migrateLegacyVariantStock(normalized);
  return persistStock(normalizeStockMap(migrated.stock));
}

export async function patchStockPrepared(updates) {
  // 자동 백업 복구(readStock)를 타지 않고 현재 저장본을 직접 읽어 패치한다.
  let current = await readRawStock();
  const migrated = migrateLegacyVariantStock(current);
  current = normalizeStockMap(migrated.stock);
  for (const [id, prepared] of Object.entries(updates || {})) {
    if (!id) continue;
    const next = Math.max(0, Math.floor(Number(prepared) || 0));
    current[id] = { prepared: next };
  }
  return writeStock(current);
}
