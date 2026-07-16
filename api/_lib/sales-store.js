import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";
import { buildStockRows, listSellableProducts } from "./catalog.js";

const SALES_KEY = "kimchi-house:sales";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SALES_FILE = path.join(__dirname, "../../data/sales.json");

export const SALE_STATUSES = ["active", "sold_out", "coming_soon", "hidden"];
export const DEFAULT_SALE_STATUS = "active";
export const IMPORTANT_PRODUCT_IDS = new Set(["w1", "w2", "b1", "b2", "b3", "b4", "a1", "a2", "a3"]);

const DEFAULT_SALES = {
  products: {},
  settings: {
    autoSoldOutOnZero: true,
  },
  presets: [],
  logs: [],
};

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_SALES_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_SALES_FILE)) {
    fs.writeFileSync(LOCAL_SALES_FILE, JSON.stringify(DEFAULT_SALES, null, 2) + "\n", "utf8");
  }
}

function readLocal() {
  ensureLocalFile();
  try {
    return JSON.parse(fs.readFileSync(LOCAL_SALES_FILE, "utf8"));
  } catch {
    return { ...DEFAULT_SALES, products: {}, presets: [], logs: [] };
  }
}

function writeLocal(data) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_SALES_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function normalizeSaleStatus(value, fallbackSoldOut = false) {
  if (SALE_STATUSES.includes(value)) return value;
  if (value === true || value === "on" || value === "sale" || value === "true") return "active";
  if (value === false || value === "off" || value === "false") return "hidden";
  if (fallbackSoldOut) return "sold_out";
  return DEFAULT_SALE_STATUS;
}

function normalizeProductEntry(val, catalogSoldOut = false) {
  if (typeof val === "string" || typeof val === "boolean") {
    return {
      saleStatus: normalizeSaleStatus(val, catalogSoldOut),
      sortOrder: null,
      price: null,
    };
  }
  if (val && typeof val === "object") {
    return {
      saleStatus: normalizeSaleStatus(val.saleStatus ?? val.status, catalogSoldOut),
      sortOrder: val.sortOrder == null ? null : Number(val.sortOrder),
      price: val.price == null || val.price === "" ? null : Number(val.price),
    };
  }
  return {
    saleStatus: catalogSoldOut ? "sold_out" : DEFAULT_SALE_STATUS,
    sortOrder: null,
    price: null,
  };
}

function normalizeSalesDoc(raw) {
  const base = {
    products: {},
    settings: { ...DEFAULT_SALES.settings },
    presets: [],
    logs: [],
  };
  if (!raw || typeof raw !== "object") return base;
  base.settings = {
    ...base.settings,
    ...(raw.settings && typeof raw.settings === "object" ? raw.settings : {}),
  };
  base.settings.autoSoldOutOnZero = base.settings.autoSoldOutOnZero !== false;
  if (raw.products && typeof raw.products === "object") {
    for (const [id, val] of Object.entries(raw.products)) {
      base.products[id] = normalizeProductEntry(val);
    }
  }
  if (Array.isArray(raw.presets)) {
    base.presets = raw.presets
      .filter((p) => p && typeof p === "object" && p.id && p.name)
      .map((p) => ({
        id: String(p.id),
        name: String(p.name),
        createdAt: p.createdAt || new Date().toISOString(),
        snapshot: p.snapshot && typeof p.snapshot === "object" ? p.snapshot : { products: {}, stock: {} },
      }));
  }
  if (Array.isArray(raw.logs)) base.logs = raw.logs.slice(0, 500);
  return base;
}

export async function readSales() {
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) return normalizeSalesDoc(null);
    return normalizeSalesDoc(readLocal());
  }
  try {
    const data = await redis.get(SALES_KEY);
    return normalizeSalesDoc(data);
  } catch (err) {
    console.error("Redis sales read error:", err);
    return normalizeSalesDoc(null);
  }
}

export async function writeSales(doc) {
  const normalized = normalizeSalesDoc(doc);
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) {
      throw new Error("판매 상태 저장소(Redis)가 연결되지 않았습니다.");
    }
    writeLocal(normalized);
    return normalized;
  }
  await redis.set(SALES_KEY, normalized);
  return normalized;
}

export function publicSaleMap(doc, catalogProducts) {
  const out = {};
  const list = catalogProducts || listSellableProducts();
  for (const p of list) {
    const stored = doc?.products?.[p.id];
    if (stored) {
      out[p.id] = normalizeSaleStatus(stored.saleStatus, p.soldOut);
    } else {
      out[p.id] = p.soldOut ? "sold_out" : DEFAULT_SALE_STATUS;
    }
  }
  return out;
}

export function publicSaleDetails(doc, catalogProducts) {
  const list = catalogProducts || listSellableProducts();
  const out = {};
  for (const p of list) {
    const stored = doc?.products?.[p.id];
    const entry = stored || normalizeProductEntry(null, p.soldOut);
    out[p.id] = {
      saleStatus: normalizeSaleStatus(entry.saleStatus, p.soldOut),
      sortOrder: entry.sortOrder,
      price: entry.price,
    };
  }
  return out;
}

export function resolveSaleStatus(doc, productId, catalogSoldOut = false) {
  const stored = doc?.products?.[productId];
  if (stored) return normalizeSaleStatus(stored.saleStatus, catalogSoldOut);
  return catalogSoldOut ? "sold_out" : DEFAULT_SALE_STATUS;
}

export async function patchSaleStatuses(updates, meta = {}) {
  const doc = await readSales();
  const logs = [];
  const now = new Date().toISOString();
  for (const [id, value] of Object.entries(updates || {})) {
    const nextStatus =
      typeof value === "object" && value != null
        ? normalizeSaleStatus(value.saleStatus ?? value.status)
        : normalizeSaleStatus(value);
    const prev = resolveSaleStatus(doc, id);
    const prevEntry = doc.products[id] || normalizeProductEntry(null);
    const nextEntry = {
      ...prevEntry,
      saleStatus: nextStatus,
    };
    if (typeof value === "object" && value != null) {
      if ("sortOrder" in value) nextEntry.sortOrder = value.sortOrder == null ? null : Number(value.sortOrder);
      if ("price" in value) nextEntry.price = value.price == null || value.price === "" ? null : Number(value.price);
    }
    doc.products[id] = nextEntry;
    if (prev !== nextStatus) {
      logs.push({
        productId: id,
        name: meta.names?.[id] || id,
        from: prev,
        to: nextStatus,
        at: now,
        admin: meta.admin || "admin",
      });
    }
  }
  if (logs.length) {
    doc.logs = [...logs, ...(doc.logs || [])].slice(0, 500);
  }
  await writeSales(doc);
  return { doc, logs };
}

export async function updateSalesSettings(settingsPatch, meta = {}) {
  const doc = await readSales();
  doc.settings = {
    ...doc.settings,
    ...settingsPatch,
  };
  if ("autoSoldOutOnZero" in settingsPatch) {
    doc.settings.autoSoldOutOnZero = settingsPatch.autoSoldOutOnZero !== false;
  }
  doc.logs = [
    {
      productId: "_settings",
      name: "판매 설정",
      from: "-",
      to: JSON.stringify(doc.settings),
      at: new Date().toISOString(),
      admin: meta.admin || "admin",
    },
    ...(doc.logs || []),
  ].slice(0, 500);
  await writeSales(doc);
  return doc;
}

export async function savePreset({ name, snapshot }, meta = {}) {
  const doc = await readSales();
  const preset = {
    id: `preset_${Date.now()}`,
    name: String(name || "").trim() || `프리셋 ${doc.presets.length + 1}`,
    createdAt: new Date().toISOString(),
    snapshot: {
      products: snapshot?.products && typeof snapshot.products === "object" ? snapshot.products : {},
      stock: snapshot?.stock && typeof snapshot.stock === "object" ? snapshot.stock : {},
    },
  };
  doc.presets = [preset, ...(doc.presets || [])].slice(0, 50);
  doc.logs = [
    {
      productId: "_preset",
      name: `프리셋 저장: ${preset.name}`,
      from: "-",
      to: preset.id,
      at: preset.createdAt,
      admin: meta.admin || "admin",
    },
    ...(doc.logs || []),
  ].slice(0, 500);
  await writeSales(doc);
  return { doc, preset };
}

export async function deletePreset(presetId, meta = {}) {
  const doc = await readSales();
  const before = doc.presets.length;
  doc.presets = (doc.presets || []).filter((p) => p.id !== presetId);
  if (doc.presets.length === before) return { doc, deleted: false };
  doc.logs = [
    {
      productId: "_preset",
      name: `프리셋 삭제: ${presetId}`,
      from: presetId,
      to: "-",
      at: new Date().toISOString(),
      admin: meta.admin || "admin",
    },
    ...(doc.logs || []),
  ].slice(0, 500);
  await writeSales(doc);
  return { doc, deleted: true };
}

/** 재고 0(준비>0 & 잔여<=0)이면 sold_out — 복구 시 active로 되돌리지 않음 */
export async function applyAutoSoldOutFromStock(stockMap, orders) {
  const doc = await readSales();
  if (!doc.settings.autoSoldOutOnZero) return { doc, changed: [] };

  const rows = buildStockRows(stockMap, orders);
  const byBase = {};
  for (const row of rows) {
    const baseId = row.baseId || row.id;
    if (!byBase[baseId]) {
      byBase[baseId] = { name: row.name, soldOut: row.soldOut, tracked: false, allEmpty: true };
    }
    const prepared = Number(row.prepared || 0);
    const remaining = Number(row.remaining || 0);
    if (prepared > 0) {
      byBase[baseId].tracked = true;
      if (remaining > 0) byBase[baseId].allEmpty = false;
      // keep a cleaner name without variant suffix when possible
      if (!row.hasVariants) byBase[baseId].name = row.name;
    }
  }

  const updates = {};
  const names = {};
  for (const [baseId, info] of Object.entries(byBase)) {
    if (!info.tracked || !info.allEmpty) continue;
    const current = resolveSaleStatus(doc, baseId, info.soldOut);
    if (current === "active") {
      updates[baseId] = "sold_out";
      names[baseId] = info.name;
    }
  }
  if (!Object.keys(updates).length) return { doc, changed: [] };
  const result = await patchSaleStatuses(updates, { names, admin: "system:auto-sold-out" });
  return { doc: result.doc, changed: result.logs };
}

export function assertItemsPurchasable(items, doc, catalogById) {
  for (const item of items || []) {
    const productId = String(item?.productId || item?.id || "").split(":")[0];
    if (!productId) continue;
    const catalog = catalogById?.get?.(productId);
    const status = resolveSaleStatus(doc, productId, catalog?.soldOut);
    if (status !== "active") {
      const label = catalog?.name || item?.name || productId;
      const msg =
        status === "sold_out"
          ? `품절 상품은 주문할 수 없습니다: ${label}`
          : status === "coming_soon"
            ? `판매 예정 상품은 주문할 수 없습니다: ${label}`
            : `판매 중지된 상품입니다: ${label}`;
      return { ok: false, error: msg };
    }
  }
  return { ok: true };
}
