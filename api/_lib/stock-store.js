import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";
import {
  migrateLegacyVariantStock,
  productNameIndex,
  reservedByProduct,
  resolveRemaining,
  stockUnitsFromItem,
} from "./catalog.js";
import stockBackup from "../_data/stock-backup.js";

const STOCK_KEY = "kimchi-house:stock";
const STOCK_LOG_KEY = "kimchi-house:stock-logs";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_STOCK_FILE = path.join(__dirname, "../../data/stock.json");
const LOCAL_STOCK_LOG_FILE = path.join(__dirname, "../../data/stock-logs.json");
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
  if (!fs.existsSync(LOCAL_STOCK_LOG_FILE)) fs.writeFileSync(LOCAL_STOCK_LOG_FILE, "[]\n", "utf8");
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

function readLocalLogs() {
  ensureLocalFile();
  try {
    const data = JSON.parse(fs.readFileSync(LOCAL_STOCK_LOG_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLocalLogs(logs) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_STOCK_LOG_FILE, JSON.stringify(logs, null, 2) + "\n", "utf8");
}

function clampNonNeg(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

function normalizeStockMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [id, value] of Object.entries(raw)) {
    if (value == null) continue;
    if (typeof value === "number") {
      out[id] = { prepared: clampNonNeg(value) };
      continue;
    }
    if (typeof value === "object") {
      const entry = {
        prepared: clampNonNeg(value.prepared),
      };
      if (value.remaining != null && value.remaining !== "") {
        entry.remaining = clampNonNeg(value.remaining);
      }
      out[id] = entry;
    }
  }
  return out;
}

function stockHasPrepared(stock) {
  return Object.values(stock || {}).some((v) => Number(v?.prepared ?? v ?? 0) > 0);
}

function stockHasAnyQty(stock) {
  return Object.values(stock || {}).some((v) => {
    if (typeof v === "number") return v > 0;
    return Number(v?.prepared || 0) > 0 || (v?.remaining != null && Number(v.remaining) >= 0);
  });
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

function hasExplicitRemaining(stockMap, id) {
  const entry = stockMap?.[id];
  if (!entry || typeof entry !== "object") return false;
  return entry.remaining != null && entry.remaining !== "";
}

export { resolveRemaining };

export function unitsNeededFromItems(items) {
  const nameIndex = productNameIndex();
  const needed = {};
  for (const item of items || []) {
    for (const unit of stockUnitsFromItem(item, nameIndex)) {
      needed[unit.key] = (needed[unit.key] || 0) + unit.qty;
    }
  }
  return needed;
}

export function remainingDeltaBetweenItems(prevItems, nextItems) {
  const prev = unitsNeededFromItems(prevItems);
  const next = unitsNeededFromItems(nextItems);
  const ids = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const delta = {};
  for (const id of ids) {
    const change = (next[id] || 0) - (prev[id] || 0);
    if (change) delta[id] = change;
  }
  return delta;
}

/** 주문 검증: 추적 상품만 remaining 기준 */
export function assertRemainingAvailable(stockMap, neededById) {
  for (const [id, qty] of Object.entries(neededById || {})) {
    const left = resolveRemaining(stockMap, id);
    if (left == null) continue;
    if (qty > left) {
      return {
        ok: false,
        error: `재고 부족: ${id} (남은 재고 ${Math.max(0, left)} / 요청 ${qty})`,
      };
    }
  }
  return { ok: true };
}

/**
 * prepared만 있고 remaining이 없으면
 * remaining = max(0, prepared - 온라인 reserved) 로 초기화.
 */
export function migrateRemainingFromReserved(stockMap, orders) {
  const current = normalizeStockMap(stockMap);
  const reserved = reservedByProduct(orders || []);
  let changed = false;

  for (const [id, entry] of Object.entries(current)) {
    if (entry.remaining != null) continue;
    const prepared = clampNonNeg(entry.prepared);
    if (prepared <= 0) continue;
    entry.remaining = Math.max(0, prepared - clampNonNeg(reserved[id]));
    current[id] = entry;
    changed = true;
  }

  // reserved만 있고 stock에 없는 경우는 생성하지 않음 (기존과 동일)
  return { stock: current, changed };
}

async function appendStockLogs(entries) {
  if (!entries?.length) return [];
  const redis = getRedis();
  let logs = [];
  try {
    if (redis) {
      const raw = await redis.get(STOCK_LOG_KEY);
      logs = Array.isArray(raw) ? raw : [];
    } else {
      logs = readLocalLogs();
    }
  } catch (err) {
    console.error("Stock log read error:", err);
    logs = [];
  }
  const next = [...entries, ...logs].slice(0, 500);
  if (redis) await redis.set(STOCK_LOG_KEY, next);
  else writeLocalLogs(next);
  return next;
}

export async function readStockLogs(limit = 100) {
  const redis = getRedis();
  try {
    let logs = [];
    if (redis) {
      const raw = await redis.get(STOCK_LOG_KEY);
      logs = Array.isArray(raw) ? raw : [];
    } else {
      logs = readLocalLogs();
    }
    return logs.slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
  } catch (err) {
    console.error("Stock log read error:", err);
    return [];
  }
}

async function nameForProduct(id) {
  try {
    const mod = await import("./catalog.js");
    return mod.listCatalogProducts().find((p) => p.id === id)?.name || id;
  } catch {
    return id;
  }
}

/** 재고가 전부 0이면 커밋된 백업으로 복구 */
export async function restoreStockFromBackup({ force = false, orders = [] } = {}) {
  const backup = loadBackupStock();
  if (!stockHasPrepared(backup)) {
    return { ok: false, error: "백업 재고가 비어 있습니다.", stock: await readRawStock() };
  }
  const current = await readRawStock();
  if (!force && stockHasAnyQty(current)) {
    return { ok: false, error: "현재 재고가 이미 있습니다. 강제 복구가 필요합니다.", stock: current };
  }
  const migratedLegacy = migrateLegacyVariantStock(backup);
  let stock = normalizeStockMap(migratedLegacy.stock);
  const migratedRemaining = migrateRemainingFromReserved(stock, orders);
  stock = migratedRemaining.stock;
  const saved = await persistStock(stock);
  return { ok: true, stock: saved, restored: true };
}

export async function readStock(ordersForMigration = null) {
  let stock = await readRawStock();
  const migratedLegacy = migrateLegacyVariantStock(stock);
  stock = normalizeStockMap(migratedLegacy.stock);

  let changed = migratedLegacy.changed;
  if (ordersForMigration) {
    const migratedRemaining = migrateRemainingFromReserved(stock, ordersForMigration);
    stock = migratedRemaining.stock;
    changed = changed || migratedRemaining.changed;
  }

  if (changed) {
    try {
      await persistStock(stock);
    } catch (err) {
      console.error("Stock migration persist error:", err);
    }
  }

  if (!stockHasAnyQty(stock) && !stockHasPrepared(stock)) {
    const restored = await restoreStockFromBackup({ force: true, orders: ordersForMigration || [] });
    if (restored.ok) return restored.stock;
  }

  return stock;
}

export async function writeStock(stock) {
  const normalized = normalizeStockMap(stock);
  const migrated = migrateLegacyVariantStock(normalized);
  return persistStock(normalizeStockMap(migrated.stock));
}

/**
 * 준비수량 / 남은 재고 패치.
 * remainingUpdates가 있으면 이력 기록.
 */
export async function patchStockFields({
  preparedUpdates = {},
  remainingUpdates = {},
  admin = "admin",
  note = "",
  names = {},
} = {}) {
  let current = await readRawStock();
  const migrated = migrateLegacyVariantStock(current);
  current = normalizeStockMap(migrated.stock);

  const logs = [];
  const now = new Date().toISOString();
  const noteText = String(note || "").trim();

  for (const [id, prepared] of Object.entries(preparedUpdates || {})) {
    if (!id) continue;
    const prev = current[id] || { prepared: 0 };
    current[id] = {
      ...prev,
      prepared: clampNonNeg(prepared),
      ...(prev.remaining != null ? { remaining: clampNonNeg(prev.remaining) } : {}),
    };
  }

  for (const [id, remaining] of Object.entries(remainingUpdates || {})) {
    if (!id) continue;
    const prev = current[id] || { prepared: 0 };
    const before = hasExplicitRemaining(current, id)
      ? clampNonNeg(prev.remaining)
      : clampNonNeg(prev.prepared);
    const after = clampNonNeg(remaining);
    current[id] = {
      prepared: clampNonNeg(prev.prepared),
      remaining: after,
    };
    if (before !== after) {
      logs.push({
        productId: id,
        name: names[id] || (await nameForProduct(id)),
        before,
        after,
        delta: after - before,
        at: now,
        admin: String(admin || "admin"),
        note: noteText,
      });
    }
  }

  const saved = await writeStock(current);
  if (logs.length) await appendStockLogs(logs);
  return { stock: saved, logs };
}

/** 하위 호환: prepared만 갱신 */
export async function patchStockPrepared(updates) {
  const { stock } = await patchStockFields({ preparedUpdates: updates });
  return stock;
}

/**
 * 온라인 주문 등 수량 증감 반영.
 * delta > 0: 재고 차감, delta < 0: 복구
 */
export async function applyRemainingDeltas(deltas, meta = {}) {
  let current = await readRawStock();
  const migrated = migrateLegacyVariantStock(current);
  current = normalizeStockMap(migrated.stock);

  const logs = [];
  const now = new Date().toISOString();
  const admin = String(meta.admin || "system:order");
  const note = String(meta.note || "").trim();

  for (const [id, deltaRaw] of Object.entries(deltas || {})) {
    if (!id) continue;
    const delta = Math.floor(Number(deltaRaw) || 0);
    if (!delta) continue;

    const left = resolveRemaining(current, id);
    if (left == null) continue;

    const before = left;
    const after = clampNonNeg(before - delta);
    const prev = current[id] || { prepared: 0 };
    current[id] = {
      prepared: clampNonNeg(prev.prepared),
      remaining: after,
    };
    logs.push({
      productId: id,
      name: meta.names?.[id] || (await nameForProduct(id)),
      before,
      after,
      delta: after - before,
      at: now,
      admin,
      note: note || (delta > 0 ? "온라인 주문 차감" : "온라인 주문 복구"),
    });
  }

  const saved = await writeStock(current);
  if (logs.length) await appendStockLogs(logs);
  return { stock: saved, logs };
}

export async function ensureStockMigrated(orders) {
  let stock = await readRawStock();
  const migratedLegacy = migrateLegacyVariantStock(stock);
  stock = normalizeStockMap(migratedLegacy.stock);
  const migratedRemaining = migrateRemainingFromReserved(stock, orders || []);
  stock = migratedRemaining.stock;
  if (migratedLegacy.changed || migratedRemaining.changed) {
    stock = await persistStock(stock);
  }
  return stock;
}
