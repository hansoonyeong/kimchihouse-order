import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CURRENT_ROUND_MIN_DATE, parseDeliveryDate } from "./order-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");

/** 카탈로그에 없는 이번 차수 입고 품목 (products.js에 이미 있으면 비움) */
export const EXTRA_STOCK_ITEMS = [];

/** 관리자 판매 품목 관리 카테고리 */
export const SALE_CATEGORIES = [
  { id: "walkerhill", label: "워커힐 프리미엄" },
  { id: "pogi", label: "포기김치" },
  { id: "special", label: "별미김치" },
  { id: "seafood", label: "프리미엄 수산·반찬" },
  { id: "frozen", label: "냉동·간편식" },
  { id: "jang", label: "전통 장류·김" },
];

export function resolveSaleCategory(category, sectionId, productId) {
  if (category === "walkerhill") return { id: "walkerhill", label: "워커힐 프리미엄" };
  if (sectionId === "pogi" && category === "kimchi") return { id: "pogi", label: "포기김치" };
  if (sectionId === "special") return { id: "special", label: "별미김치" };
  if (sectionId === "jang") return { id: "jang", label: "전통 장류·김" };
  if (sectionId === "mandu" || sectionId === "kimbap") return { id: "frozen", label: "냉동·간편식" };
  if (sectionId === "jeotgal" || productId === "b10") {
    return { id: "seafood", label: "프리미엄 수산·반찬" };
  }
  if (productId === "extra-jaecheop" || productId === "extra-myeongtaecho") {
    return { id: "frozen", label: "냉동·간편식" };
  }
  if (sectionId === "fish" || sectionId === "namul") {
    return { id: "seafood", label: "프리미엄 수산·반찬" };
  }
  if (category === "frozen") return { id: "frozen", label: "냉동·간편식" };
  if (category === "kimchi") return { id: "special", label: "별미김치" };
  return { id: "other", label: "기타" };
}

export function catalogDisplayPrice(item, variant = null) {
  if (variant?.price != null) return Number(variant.price);
  if (item?.price != null) return Number(item.price);
  if (item?.tiers?.length) return Number(item.tiers[0][1]);
  if (item?.group === "special") return 27;
  if (item?.group === "pa") return 33;
  return null;
}

export function loadProductCatalog() {
  const filePath = path.join(ROOT, "assets", "products.js");
  const code = fs.readFileSync(filePath, "utf8");
  const sandbox = { window: {} };
  new Function("window", code)(sandbox.window);
  return sandbox.window.KH_PRODUCTS || {};
}

/** 재고 관리용 SKU 목록 (변형은 별도 행) */
export function listCatalogProducts() {
  const catalog = loadProductCatalog();
  const products = [];
  for (const [category, block] of Object.entries(catalog)) {
    for (const section of block.sections || []) {
      for (const item of section.items || []) {
        const saleCat = resolveSaleCategory(category, section.id, item.id);
        if (item.variants?.length) {
          for (const v of item.variants) {
            products.push({
              id: `${item.id}:${v.key}`,
              baseId: item.id,
              name: `${item.name} (${v.label})`,
              category,
              categoryLabel: block.label || category,
              sectionId: section.id,
              saleCategory: saleCat.id,
              saleCategoryLabel: saleCat.label,
              image: item.image || "",
              price: catalogDisplayPrice(item, v),
              soldOut: Boolean(item.soldOut),
              hasVariants: true,
              variantKey: v.key,
            });
          }
          continue;
        }
        products.push({
          id: item.id,
          baseId: item.id,
          name: item.name,
          category,
          categoryLabel: block.label || category,
          sectionId: section.id,
          saleCategory: saleCat.id,
          saleCategoryLabel: saleCat.label,
          image: item.image || "",
          price: catalogDisplayPrice(item),
          soldOut: Boolean(item.soldOut),
          hasVariants: false,
        });
      }
    }
  }
  for (const extra of EXTRA_STOCK_ITEMS) {
    products.push({
      ...extra,
      baseId: extra.id,
      soldOut: false,
      hasVariants: false,
      image: "",
      price: null,
    });
  }
  return products;
}

/** 판매 상태 관리용 — 용량 변형(7kg/3kg)은 각각 별도 행으로 품절 관리 */
export function listSellableProducts() {
  const catalog = loadProductCatalog();
  const products = [];
  for (const [category, block] of Object.entries(catalog)) {
    for (const section of block.sections || []) {
      for (const item of section.items || []) {
        const saleCat = resolveSaleCategory(category, section.id, item.id);
        if (item.variants?.length) {
          for (const v of item.variants) {
            products.push({
              id: `${item.id}:${v.key}`,
              baseId: item.id,
              name: `${item.name} (${v.label})`,
              category,
              categoryLabel: block.label || category,
              sectionId: section.id,
              saleCategory: saleCat.id,
              saleCategoryLabel: saleCat.label,
              image: item.image || "",
              price: catalogDisplayPrice(item, v),
              soldOut: Boolean(item.soldOut),
              hasVariants: true,
              variantKey: v.key,
              variantKeys: [v.key],
            });
          }
          continue;
        }
        products.push({
          id: item.id,
          baseId: item.id,
          name: item.name,
          category,
          categoryLabel: block.label || category,
          sectionId: section.id,
          saleCategory: saleCat.id,
          saleCategoryLabel: saleCat.label,
          image: item.image || "",
          price: catalogDisplayPrice(item),
          soldOut: Boolean(item.soldOut),
          hasVariants: false,
          variantKeys: [],
        });
      }
    }
  }
  for (const extra of EXTRA_STOCK_ITEMS) {
    products.push({
      ...extra,
      baseId: extra.id,
      soldOut: false,
      hasVariants: false,
      image: "",
      price: null,
      variantKeys: [],
    });
  }
  return products;
}

export function sellableProductIndex() {
  const map = new Map();
  for (const p of listSellableProducts()) map.set(p.id, p);
  return map;
}

export function productNameIndex() {
  const map = new Map();
  for (const p of listCatalogProducts()) {
    map.set(p.name, p.id);
    map.set(p.name.replace(/\s+/g, ""), p.id);
    if (p.baseId && p.baseId !== p.id) {
      map.set(p.baseId, p.baseId);
    }
  }
  return map;
}

/** 주문 라인 → 재고 SKU (변형은 productId:variantKey) */
export function stockKeyFromItem(item, nameIndex) {
  const productId = String(item?.productId || "").trim();
  const variantKey = String(item?.variantKey || "").trim();
  if (productId && variantKey) return `${productId}:${variantKey}`;
  if (productId.includes(":")) return productId;

  const raw = String(item?.id || "").trim();
  if (raw.includes(":")) return raw;

  const name = String(item?.name || "").trim();
  if (name && nameIndex?.has(name)) return nameIndex.get(name);

  if (productId) return productId;
  if (raw) return raw;

  if (!name || !nameIndex) return "";
  const base = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (nameIndex.has(base)) return nameIndex.get(base);
  for (const [key, id] of nameIndex) {
    if (name.startsWith(key)) return id;
  }
  return "";
}

/** 워커힐 세트 → 단품(w1 포기 / w2 총각) 구성 */
export const WALKERHILL_SET_CONTENTS = {
  w_set2a: { w1: 2 },
  w_set2b: { w1: 1, w2: 1 },
  w_set2c: { w2: 2 },
  w_set3a: { w1: 3 },
  w_set3b: { w1: 2, w2: 1 },
  w_set3c: { w1: 1, w2: 2 },
  w_set3d: { w2: 3 },
  w_set5a: { w1: 5 },
  w_set5b: { w1: 3, w2: 2 },
  w_set5c: { w1: 2, w2: 3 },
  w_set5d: { w2: 5 },
};

/** 주문 라인 → 재고 차감 단위 목록 [{ key, qty }] (세트는 단품으로 분해) */
export function stockUnitsFromItem(item, nameIndex) {
  const qty = Number(item?.qty) || 0;
  if (qty <= 0) return [];

  const productId = String(item?.productId || item?.id || "").trim().split(":")[0];
  const contents = WALKERHILL_SET_CONTENTS[productId];
  if (contents) {
    return Object.entries(contents).map(([key, n]) => ({ key, qty: n * qty }));
  }

  const key = stockKeyFromItem(item, nameIndex);
  if (!key) return [];
  return [{ key, qty }];
}

/** 주문에 명시된 배송일 (없으면 null — 기본 회차일로 추정하지 않음) */
export function explicitDeliveryDate(order) {
  const candidates = [
    order?.deliveryDate,
    order?.delivery?.date,
    order?.shippingBreakdown?.kimchi?.delivery,
    order?.shippingBreakdown?.frozen?.delivery,
    order?.shippingBreakdown?.walkerhill?.delivery,
  ];
  for (const value of candidates) {
    const parsed = parseDeliveryDate(value);
    if (parsed) return parsed;
  }
  return null;
}

/** 이번 차수(일정 변경 전 예약 포함) 주문만 재고 예약에 반영 */
export function ordersForStockReservation(orders, minDeliveryDate = CURRENT_ROUND_MIN_DATE) {
  const minDate = parseDeliveryDate(minDeliveryDate) || CURRENT_ROUND_MIN_DATE;
  return (orders || []).filter((order) => {
    const date = explicitDeliveryDate(order);
    return Boolean(date && date >= minDate);
  });
}

export function reservedByProduct(orders) {
  const nameIndex = productNameIndex();
  const reserved = {};
  for (const order of ordersForStockReservation(orders)) {
    for (const item of order.items || []) {
      for (const unit of stockUnitsFromItem(item, nameIndex)) {
        reserved[unit.key] = (reserved[unit.key] || 0) + unit.qty;
      }
    }
  }
  return reserved;
}

function rawPrepared(stockMap, id) {
  if (!id) return 0;
  return Number(stockMap?.[id]?.prepared ?? stockMap?.[id] ?? 0) || 0;
}

function hasExplicitRemaining(stockMap, id) {
  const entry = stockMap?.[id];
  if (!entry || typeof entry !== "object") return false;
  return entry.remaining != null && entry.remaining !== "";
}

function rawRemaining(stockMap, id) {
  if (!hasExplicitRemaining(stockMap, id)) return null;
  return Math.max(0, Math.floor(Number(stockMap[id].remaining) || 0));
}

function isTrackedEntry(stockMap, id) {
  if (!id) return false;
  if (hasExplicitRemaining(stockMap, id)) return true;
  return rawPrepared(stockMap, id) > 0;
}

function variantsByBaseId() {
  const map = new Map();
  for (const p of listCatalogProducts()) {
    if (!p.hasVariants || !p.baseId) continue;
    if (!map.has(p.baseId)) map.set(p.baseId, []);
    map.get(p.baseId).push(p);
  }
  return map;
}

function primaryVariantId(variants) {
  if (!variants?.length) return "";
  const preferred = variants.find((v) => v.variantKey === "7kg") || variants[0];
  return preferred.id;
}

/**
 * 용량 변형 도입 전 baseId(b1) 재고를 기본 용량(b1:7kg)으로 연결.
 * 변형 SKU가 전부 0인데 base에만 값이 있으면(저장 실수 포함) 복구한다.
 */
export function migrateLegacyVariantStock(stockMap) {
  const current = stockMap && typeof stockMap === "object" ? { ...stockMap } : {};
  const byBase = variantsByBaseId();
  let changed = false;

  for (const [baseId, variants] of byBase) {
    const basePrepared = rawPrepared(current, baseId);
    if (basePrepared <= 0) continue;

    const variantPreparedSum = variants.reduce((sum, v) => sum + rawPrepared(current, v.id), 0);
    if (variantPreparedSum > 0) continue;

    const primaryId = primaryVariantId(variants);
    if (!primaryId) continue;
    const baseEntry = current[baseId];
    const remaining =
      baseEntry && typeof baseEntry === "object" && baseEntry.remaining != null
        ? Math.max(0, Math.floor(Number(baseEntry.remaining) || 0))
        : null;
    current[primaryId] = {
      prepared: basePrepared,
      ...(remaining != null ? { remaining } : {}),
    };
    changed = true;
  }

  return { stock: current, changed };
}

/** 재고 조회: 변형 SKU → 없으면 baseId(레거시) */
export function resolvePrepared(stockMap, productOrId) {
  const id = typeof productOrId === "string" ? productOrId : productOrId?.id;
  const baseId =
    typeof productOrId === "string"
      ? String(productOrId).split(":")[0]
      : productOrId?.baseId || String(id || "").split(":")[0];

  const direct = rawPrepared(stockMap, id);
  if (direct > 0) return direct;

  if (!baseId || baseId === id) return direct;

  const byBase = variantsByBaseId();
  const variants = byBase.get(baseId) || [];
  const anyVariant = variants.some((v) => rawPrepared(stockMap, v.id) > 0);
  if (anyVariant) return direct;

  const basePrepared = rawPrepared(stockMap, baseId);
  if (basePrepared <= 0) return direct;

  const primaryId = primaryVariantId(variants);
  if (primaryId && id === primaryId) return basePrepared;
  if (!variants.length && id === baseId) return basePrepared;
  return direct;
}

/**
 * 판매 가능 남은 재고.
 * remaining 필드가 있으면 그 값을 쓰고, 없으면 prepared(레거시)를 쓴다.
 * 추적 중이 아니면 null.
 */
export function resolveRemaining(stockMap, productOrId) {
  const id = typeof productOrId === "string" ? productOrId : productOrId?.id;
  const baseId =
    typeof productOrId === "string"
      ? String(productOrId).split(":")[0]
      : productOrId?.baseId || String(id || "").split(":")[0];

  if (hasExplicitRemaining(stockMap, id)) return rawRemaining(stockMap, id);

  if (isTrackedEntry(stockMap, id)) return rawPrepared(stockMap, id);

  if (!baseId || baseId === id) return null;

  const byBase = variantsByBaseId();
  const variants = byBase.get(baseId) || [];
  const anyVariantTracked = variants.some((v) => isTrackedEntry(stockMap, v.id));
  if (anyVariantTracked) return null;

  const primaryId = primaryVariantId(variants);
  if (primaryId && id === primaryId) {
    if (hasExplicitRemaining(stockMap, baseId)) return rawRemaining(stockMap, baseId);
    if (isTrackedEntry(stockMap, baseId)) return rawPrepared(stockMap, baseId);
  }
  return null;
}

function resolveReserved(reservedMap, product) {
  let reserved = Number(reservedMap[product.id] || 0);
  if (product.baseId && product.baseId !== product.id) {
    const byBase = variantsByBaseId();
    const variants = byBase.get(product.baseId) || [];
    const anyVariantReserved = variants.some((v) => Number(reservedMap[v.id] || 0) > 0);
    if (!anyVariantReserved && primaryVariantId(variants) === product.id) {
      reserved += Number(reservedMap[product.baseId] || 0);
    }
  }
  return reserved;
}

export function buildStockRows(stockMap, orders) {
  const { stock: hydrated } = migrateLegacyVariantStock(stockMap);
  const reservedMap = reservedByProduct(orders);
  // 워커힐 세트는 단품(w1/w2) 재고로만 관리 — 세트 SKU 행은 숨김
  return listCatalogProducts()
    .filter((p) => !WALKERHILL_SET_CONTENTS[p.id] && !WALKERHILL_SET_CONTENTS[p.baseId])
    .map((p) => {
      const prepared = resolvePrepared(hydrated, p);
      const reserved = resolveReserved(reservedMap, p);
      const storedRemaining = resolveRemaining(hydrated, p);
      const remaining = storedRemaining != null ? storedRemaining : Math.max(0, prepared - reserved);
      const tracked = storedRemaining != null || prepared > 0 || reserved > 0;
      return {
        ...p,
        prepared,
        reserved,
        remaining,
        tracked,
        remainingManaged: hasExplicitRemaining(hydrated, p.id),
      };
    });
}

/** 판매 품목 관리용 행 (변형 SKU별 재고·판매상태) */
export function buildSalesRows(stockMap, orders, salesDoc) {
  const stockRows = buildStockRows(stockMap, orders);
  const stockById = {};
  for (const row of stockRows) {
    stockById[row.id] = {
      prepared: Number(row.prepared || 0),
      reserved: Number(row.reserved || 0),
      remaining: Number(row.remaining || 0),
      tracked: Boolean(row.tracked),
    };
  }

  const products = salesDoc?.products || {};
  return listSellableProducts().map((p, index) => {
    const stock = stockById[p.id] || { prepared: 0, reserved: 0, remaining: 0, tracked: false };
    const stored = products[p.id] || products[p.baseId];
    let saleStatus = "active";
    if (products[p.id]?.saleStatus) saleStatus = products[p.id].saleStatus;
    else if (p.baseId && products[p.baseId]?.saleStatus) saleStatus = products[p.baseId].saleStatus;
    else if (p.soldOut) saleStatus = "sold_out";
    const sortOrder = stored?.sortOrder != null ? Number(stored.sortOrder) : index;
    const priceOverride = products[p.id]?.price != null
      ? Number(products[p.id].price)
      : stored?.price != null
        ? Number(stored.price)
        : null;
    return {
      ...p,
      prepared: stock.prepared,
      reserved: stock.reserved,
      remaining: stock.remaining,
      tracked: stock.tracked,
      saleStatus,
      sortOrder,
      priceOverride,
      displayPrice: priceOverride != null ? priceOverride : p.price,
    };
  });
}
