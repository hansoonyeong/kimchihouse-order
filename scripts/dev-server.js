import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import {
  DEFAULT_DELIVERY_DATE,
  DEFAULT_DELIVERY_STATUS,
  DELIVERY_STATUSES,
  normalizeOrderDelivery,
  orderStatus,
  parseDeliveryDate,
  phonesMatch,
  publicOrderView,
  resolveDeliveryDate,
} from "../api/_lib/order-utils.js";
import { hasRedisEnv, readOrders, writeOrders } from "../api/_lib/orders-store.js";
import { readSettings, writeSettings } from "../api/_lib/settings-store.js";
import { buildStockRows, buildSalesRows, reservedByProduct, stockKeyFromItem, stockUnitsFromItem, productNameIndex, sellableProductIndex, SALE_CATEGORIES } from "../api/_lib/catalog.js";
import { patchStockPrepared, readStock } from "../api/_lib/stock-store.js";
import {
  IMPORTANT_PRODUCT_IDS,
  applyAutoSoldOutFromStock,
  assertItemsPurchasable,
  deletePreset,
  patchSaleStatuses,
  publicSaleDetails,
  publicSaleMap,
  readSales,
  savePreset,
  updateSalesSettings,
} from "../api/_lib/sales-store.js";
import { loadEnvFiles } from "./load-env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnvFiles(ROOT);

const PORT = process.env.PORT || 3456;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ORDER_SECRET = process.env.ORDER_SECRET || "CHANGE_ME_ORDER_SECRET";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
  });
  res.end(JSON.stringify(data));
}

function getAdminKey(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) return auth.slice(7);
  return req.headers["x-admin-key"] || "";
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1e6) reject(new Error("Payload too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function assertStockAvailable(items) {
  const stock = await readStock();
  const orders = await readOrders();
  const reserved = reservedByProduct(orders);
  const nameIndex = productNameIndex();
  const needed = {};
  for (const item of items || []) {
    for (const unit of stockUnitsFromItem(item, nameIndex)) {
      needed[unit.key] = (needed[unit.key] || 0) + unit.qty;
    }
  }
  for (const [id, qty] of Object.entries(needed)) {
    const prepared = Number(stock[id]?.prepared || 0);
    if (prepared <= 0) continue; // 준비수량 미설정 상품은 제한하지 않음
    const left = prepared - (reserved[id] || 0);
    if (qty > left) {
      return { ok: false, error: `재고 부족: ${id} (잔여 ${Math.max(0, left)} / 요청 ${qty})` };
    }
  }
  return { ok: true };
}

async function handleOrders(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    });
    return res.end();
  }

  if (req.method === "GET") {
    if (getAdminKey(req) !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }
    const orders = (await readOrders()).map((o) => normalizeOrderDelivery(o));
    return sendJson(res, 200, { ok: true, orders, store: hasRedisEnv() ? "redis" : "local" });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
    }

    if (body.secret !== ORDER_SECRET) {
      return sendJson(res, 401, { ok: false, error: "주문 요청이 유효하지 않습니다." });
    }

    const settings = await readSettings();
    if (settings.preorderOpen === false) {
      return sendJson(res, 403, { ok: false, error: "현재는 사전 주문 기간이 아닙니다." });
    }

    const { type, customer, items, subtotal, shippingFee, total, payment, note, shippingBreakdown, deliveryDate } = body;
    if (!type || !customer?.name || !customer?.phone || !customer?.address) {
      return sendJson(res, 400, { ok: false, error: "필수 주문 정보가 누락되었습니다." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendJson(res, 400, { ok: false, error: "주문 품목을 1개 이상 선택해 주세요." });
    }

    const salesDoc = await readSales();
    const saleCheck = assertItemsPurchasable(items, salesDoc, sellableProductIndex());
    if (!saleCheck.ok) return sendJson(res, 409, saleCheck);

    const stockCheck = await assertStockAvailable(items);
    if (!stockCheck.ok) return sendJson(res, 409, stockCheck);

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
      delivery: { date: resolvedDate, status: DEFAULT_DELIVERY_STATUS },
      confirmMessageSent: false,
      shipNoticeSent: false,
    };

    if (shippingBreakdown) order.shippingBreakdown = shippingBreakdown;

    const orders = await readOrders();
    orders.unshift(order);
    await writeOrders(orders);
    const stockAfter = await readStock();
    await applyAutoSoldOutFromStock(stockAfter, orders);
    return sendJson(res, 201, { ok: true, orderId: order.id });
  }

  if (req.method === "PATCH") {
    if (getAdminKey(req) !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
    }

    const orderId = String(body?.orderId || "").trim();
    if (!orderId) {
      return sendJson(res, 400, { ok: false, error: "주문번호가 필요합니다." });
    }

    const orders = await readOrders();
    const index = orders.findIndex((o) => o.id === orderId);
    if (index === -1) {
      return sendJson(res, 404, { ok: false, error: "주문을 찾을 수 없습니다." });
    }

    const current = orders[index];
    const patch = {};

    if (body.status != null && String(body.status).trim() !== "") {
      const status = String(body.status).trim();
      if (!DELIVERY_STATUSES.includes(status)) {
        return sendJson(res, 400, { ok: false, error: "유효하지 않은 배송 상태입니다." });
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
      const nextDate = parseDeliveryDate(body.deliveryDate);
      if (!nextDate) {
        return sendJson(res, 400, { ok: false, error: "유효하지 않은 배송 예정일입니다." });
      }
      patch.deliveryDate = nextDate;
      patch.delivery = {
        ...(typeof current.delivery === "object" && current.delivery ? current.delivery : {}),
        ...(patch.delivery || {}),
        date: nextDate,
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

    if (!Object.keys(patch).length) {
      return sendJson(res, 400, { ok: false, error: "변경할 항목이 없습니다." });
    }

    orders[index] = { ...current, ...patch };
    await writeOrders(orders);
    return sendJson(res, 200, { ok: true, orderId, order: normalizeOrderDelivery(orders[index]) });
  }

  if (req.method === "DELETE") {
    if (getAdminKey(req) !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }

    const orderId = new URL(req.url, "http://127.0.0.1").searchParams.get("orderId")?.trim();
    if (!orderId) {
      return sendJson(res, 400, { ok: false, error: "주문번호가 필요합니다." });
    }

    const orders = await readOrders();
    const nextOrders = orders.filter((o) => o.id !== orderId);
    if (nextOrders.length === orders.length) {
      return sendJson(res, 404, { ok: false, error: "주문을 찾을 수 없습니다." });
    }

    await writeOrders(nextOrders);
    return sendJson(res, 200, { ok: true, orderId });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleStock(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    });
    return res.end();
  }

  if (getAdminKey(req) !== ADMIN_PASSWORD) {
    return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
  }

  if (req.method === "GET") {
    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    return sendJson(res, 200, { ok: true, stock, rows: buildStockRows(stock, orders), store: hasRedisEnv() ? "redis" : "local" });
  }

  if (req.method === "PATCH") {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
    }
    const updates = {};
    if (body?.productId != null && body?.prepared != null) updates[String(body.productId)] = body.prepared;
    if (body?.updates && typeof body.updates === "object") Object.assign(updates, body.updates);
    if (!Object.keys(updates).length) {
      return sendJson(res, 400, { ok: false, error: "변경할 재고가 없습니다." });
    }
    const stock = await patchStockPrepared(updates);
    const orders = await readOrders();
    await applyAutoSoldOutFromStock(stock, orders);
    return sendJson(res, 200, { ok: true, stock, rows: buildStockRows(stock, orders) });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleLookup(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
  }

  const phone = String(body?.phone || "").trim();
  if (!phone) {
    return sendJson(res, 400, { ok: false, error: "연락처를 입력해 주세요." });
  }

  const orders = (await readOrders())
    .filter((order) => phonesMatch(order.customer?.phone, phone))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicOrderView);

  return sendJson(res, 200, { ok: true, orders });
}

async function handleConfig(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    });
    return res.end();
  }

  if (req.method === "GET") {
    const settings = await readSettings();
    const sales = await readSales();
    return sendJson(res, 200, {
      ok: true,
      orderSecret: ORDER_SECRET,
      preorderOpen: settings.preorderOpen !== false,
      store: hasRedisEnv() ? "redis" : "local",
      saleStatuses: publicSaleMap(sales),
      saleDetails: publicSaleDetails(sales),
      salesSettings: {
        autoSoldOutOnZero: sales.settings?.autoSoldOutOnZero !== false,
      },
    });
  }

  if (req.method === "PATCH") {
    if (getAdminKey(req) !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }

    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
    }

    if (typeof body?.preorderOpen !== "boolean") {
      return sendJson(res, 400, { ok: false, error: "preorderOpen 값이 필요합니다." });
    }

    const settings = { ...(await readSettings()), preorderOpen: body.preorderOpen };
    await writeSettings(settings);
    return sendJson(res, 200, { ok: true, preorderOpen: settings.preorderOpen });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

async function handleSales(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key",
    });
    return res.end();
  }

  const admin = getAdminKey(req) === ADMIN_PASSWORD;

  if (req.method === "GET") {
    const doc = await readSales();
    if (!admin) {
      return sendJson(res, 200, {
        ok: true,
        statuses: publicSaleMap(doc),
        details: publicSaleDetails(doc),
        settings: { autoSoldOutOnZero: doc.settings.autoSoldOutOnZero !== false },
      });
    }
    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    return sendJson(res, 200, {
      ok: true,
      store: hasRedisEnv() ? "redis" : "local",
      categories: SALE_CATEGORIES,
      settings: doc.settings,
      products: doc.products,
      rows: buildSalesRows(stock, orders, doc),
      presets: doc.presets,
      logs: (doc.logs || []).slice(0, 100),
      importantIds: [...IMPORTANT_PRODUCT_IDS],
      statuses: publicSaleMap(doc),
      details: publicSaleDetails(doc),
    });
  }

  if (req.method === "PATCH") {
    if (!admin) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return sendJson(res, 400, { ok: false, error: "잘못된 요청입니다." });
    }

    const action = String(body?.action || "statuses").trim();
    const catalogIndex = sellableProductIndex();
    const names = {};
    for (const [id, p] of catalogIndex) names[id] = p.name;

    if (action === "settings") {
      if (typeof body.autoSoldOutOnZero !== "boolean") {
        return sendJson(res, 400, { ok: false, error: "autoSoldOutOnZero 값이 필요합니다." });
      }
      await updateSalesSettings({ autoSoldOutOnZero: body.autoSoldOutOnZero }, { admin: "admin" });
      const [stock, orders] = await Promise.all([readStock(), readOrders()]);
      if (body.autoSoldOutOnZero) await applyAutoSoldOutFromStock(stock, orders);
      const latest = await readSales();
      return sendJson(res, 200, {
        ok: true,
        settings: latest.settings,
        rows: buildSalesRows(stock, orders, latest),
        logs: latest.logs.slice(0, 100),
      });
    }

    if (action === "save_preset") {
      const name = String(body.name || "").trim();
      if (!name) return sendJson(res, 400, { ok: false, error: "프리셋 이름이 필요합니다." });
      const [stock, salesDoc] = await Promise.all([readStock(), readSales()]);
      const snapshot = { products: {}, stock: {} };
      for (const [id, entry] of Object.entries(salesDoc.products || {})) {
        snapshot.products[id] = { ...entry };
      }
      for (const [id, row] of Object.entries(stock || {})) {
        snapshot.stock[id] = Number(row?.prepared || 0);
      }
      for (const [id, p] of catalogIndex) {
        if (!snapshot.products[id]) {
          snapshot.products[id] = {
            saleStatus: p.soldOut ? "sold_out" : "active",
            sortOrder: null,
            price: null,
          };
        }
      }
      const { doc, preset } = await savePreset({ name, snapshot }, { admin: "admin" });
      return sendJson(res, 200, { ok: true, preset, presets: doc.presets });
    }

    if (action === "delete_preset") {
      const presetId = String(body.presetId || "").trim();
      if (!presetId) return sendJson(res, 400, { ok: false, error: "프리셋 ID가 필요합니다." });
      const { doc, deleted } = await deletePreset(presetId, { admin: "admin" });
      if (!deleted) return sendJson(res, 404, { ok: false, error: "프리셋을 찾을 수 없습니다." });
      return sendJson(res, 200, { ok: true, presets: doc.presets });
    }

    if (action === "apply_preset") {
      if (body.confirm !== true) {
        return sendJson(res, 400, { ok: false, error: "프리셋 적용 전 확인이 필요합니다." });
      }
      const presetId = String(body.presetId || "").trim();
      const doc = await readSales();
      const preset = (doc.presets || []).find((p) => p.id === presetId);
      if (!preset) return sendJson(res, 404, { ok: false, error: "프리셋을 찾을 수 없습니다." });
      await patchSaleStatuses(preset.snapshot?.products || {}, { names, admin: "admin:preset" });
      if (preset.snapshot?.stock && Object.keys(preset.snapshot.stock).length) {
        await patchStockPrepared(preset.snapshot.stock);
      }
      const [stock, orders, latest] = await Promise.all([readStock(), readOrders(), readSales()]);
      return sendJson(res, 200, {
        ok: true,
        applied: preset.name,
        rows: buildSalesRows(stock, orders, latest),
        settings: latest.settings,
        presets: latest.presets,
        logs: latest.logs.slice(0, 100),
      });
    }

    const updates = body.updates && typeof body.updates === "object" ? body.updates : null;
    if (!updates || !Object.keys(updates).length) {
      if (body.productId != null && body.saleStatus != null) {
        const single = { [String(body.productId)]: body.saleStatus };
        const { doc, logs } = await patchSaleStatuses(single, { names, admin: "admin" });
        const [stock, orders] = await Promise.all([readStock(), readOrders()]);
        return sendJson(res, 200, {
          ok: true,
          logs,
          rows: buildSalesRows(stock, orders, doc),
          statuses: publicSaleMap(doc),
        });
      }
      return sendJson(res, 400, { ok: false, error: "변경할 판매 상태가 없습니다." });
    }

    const { doc, logs } = await patchSaleStatuses(updates, { names, admin: "admin" });
    const [stock, orders] = await Promise.all([readStock(), readOrders()]);
    return sendJson(res, 200, {
      ok: true,
      logs,
      rows: buildSalesRows(stock, orders, doc),
      settings: doc.settings,
      statuses: publicSaleMap(doc),
      logsAll: doc.logs.slice(0, 100),
    });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  if (urlPath === "/walkerhill" || urlPath === "/walkerhill/") urlPath = "/index.html";

  const filePath = path.join(ROOT, urlPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Not found");
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split("?")[0];

  if (urlPath.startsWith("/api/lookup")) {
    try {
      await handleLookup(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  if (urlPath.startsWith("/api/orders")) {
    try {
      await handleOrders(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  if (urlPath.startsWith("/api/stock")) {
    try {
      await handleStock(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  if (urlPath.startsWith("/api/config")) {
    try {
      await handleConfig(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  if (urlPath.startsWith("/api/sales")) {
    try {
      await handleSales(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  serveStatic(req, res);
});

function openBrowser(url) {
  if (process.env.OPEN_BROWSER === "0") return;
  const openCmd =
    process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${openCmd} "${url}"`, (err) => {
    if (err) {
      console.log("");
      console.log(`  브라우저 자동 열기 실패 — 아래 주소를 직접 열어주세요:`);
      console.log(`  ${url}`);
      console.log("");
    }
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const homeUrl = `http://127.0.0.1:${PORT}/`;
    console.error(`\n  포트 ${PORT}이(가) 이미 사용 중입니다.`);
    console.error(`  이미 서버가 실행 중이면 브라우저에서 바로 접속하세요:`);
    console.error(`  ${homeUrl}`);
    console.error(`\n  서버가 없다면: PORT=3457 npm start\n`);
    openBrowser(homeUrl);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, "0.0.0.0", () => {
  const homeUrl = `http://127.0.0.1:${PORT}/`;
  console.log("");
  console.log("  김치하우스 사전예약 — 로컬 서버 실행 중");
  console.log(`  경로: ${ROOT}`);
  console.log("");
  console.log(`  홈:       http://localhost:${PORT}/`);
  console.log(`            http://127.0.0.1:${PORT}/`);
  console.log(`  주문:     http://localhost:${PORT}/order.html`);
  console.log(`  주문확인: http://localhost:${PORT}/lookup.html`);
  console.log(`  관리자:   http://localhost:${PORT}/admin.html`);
  console.log("");
  console.log(`  데이터 저장소: ${hasRedisEnv() ? "Upstash Redis (배포와 동일)" : "로컬 data/ 파일"}`);
  if (!hasRedisEnv()) {
    console.log("  ※ 배포 주문을 보려면 프로젝트 루트에 .env 파일을 만들고");
    console.log("    Vercel의 KV_REST_API_URL / KV_REST_API_TOKEN 과");
    console.log("    ADMIN_PASSWORD 를 넣어 서버를 다시 실행하세요.");
  }
  console.log("");
  console.log("  ※ HTML 파일을 직접 열면 동작하지 않습니다. 위 주소로 접속하세요.");
  console.log("  ※ 이 터미널을 닫으면 서버가 종료됩니다.");
  console.log(`  관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log(`  주문 secret:     ${ORDER_SECRET}`);
  console.log("");
  console.log("  종료: Ctrl + C");
  console.log("");

  openBrowser(homeUrl);
});
