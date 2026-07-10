import http from "http";
import fs from "fs";
import path from "path";
import { exec } from "child_process";
import { fileURLToPath } from "url";
import {
  DEFAULT_DELIVERY_STATUS,
  DELIVERY_STATUSES,
  phonesMatch,
  publicOrderView,
} from "../api/_lib/order-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 3456;
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");
const SETTINGS_FILE = path.join(ROOT, "data", "settings.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin1234";
const ORDER_SECRET = process.env.ORDER_SECRET || "CHANGE_ME_ORDER_SECRET";
const DEFAULT_SETTINGS = { preorderOpen: true };

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function ensureOrdersFile() {
  const dir = path.dirname(ORDERS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "[]", "utf8");
}

function readOrders() {
  ensureOrdersFile();
  try {
    return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeOrders(orders) {
  ensureOrdersFile();
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}

function ensureSettingsFile() {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), "utf8");
  }
}

function readSettings() {
  ensureSettingsFile();
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  ensureSettingsFile();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf8");
}

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
    return sendJson(res, 200, { ok: true, orders: readOrders() });
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

    if (readSettings().preorderOpen === false) {
      return sendJson(res, 403, { ok: false, error: "현재는 사전 주문 기간이 아닙니다." });
    }

    const { type, customer, items, subtotal, shippingFee, total, payment, note, shippingBreakdown } = body;
    if (!type || !customer?.name || !customer?.phone || !customer?.address) {
      return sendJson(res, 400, { ok: false, error: "필수 주문 정보가 누락되었습니다." });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return sendJson(res, 400, { ok: false, error: "주문 품목을 1개 이상 선택해 주세요." });
    }

    const date = new Date();
    const y = String(date.getFullYear()).slice(-2);
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const orderId = `KH${y}${m}${d}-` + Math.floor(1000 + Math.random() * 9000);

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
    };

    if (shippingBreakdown) order.shippingBreakdown = shippingBreakdown;

    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);
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
    const status = String(body?.status || "").trim();

    if (!orderId) {
      return sendJson(res, 400, { ok: false, error: "주문번호가 필요합니다." });
    }

    if (!DELIVERY_STATUSES.includes(status)) {
      return sendJson(res, 400, { ok: false, error: "유효하지 않은 배송 상태입니다." });
    }

    const orders = readOrders();
    const index = orders.findIndex((o) => o.id === orderId);
    if (index === -1) {
      return sendJson(res, 404, { ok: false, error: "주문을 찾을 수 없습니다." });
    }

    orders[index] = { ...orders[index], status };
    writeOrders(orders);
    return sendJson(res, 200, { ok: true, orderId, status });
  }

  if (req.method === "DELETE") {
    if (getAdminKey(req) !== ADMIN_PASSWORD) {
      return sendJson(res, 401, { ok: false, error: "관리자 인증이 필요합니다." });
    }

    const orderId = new URL(req.url, "http://127.0.0.1").searchParams.get("orderId")?.trim();
    if (!orderId) {
      return sendJson(res, 400, { ok: false, error: "주문번호가 필요합니다." });
    }

    const orders = readOrders();
    const nextOrders = orders.filter((o) => o.id !== orderId);
    if (nextOrders.length === orders.length) {
      return sendJson(res, 404, { ok: false, error: "주문을 찾을 수 없습니다." });
    }

    writeOrders(nextOrders);
    return sendJson(res, 200, { ok: true, orderId });
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

  const orders = readOrders()
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
    const settings = readSettings();
    return sendJson(res, 200, {
      ok: true,
      orderSecret: ORDER_SECRET,
      preorderOpen: settings.preorderOpen !== false,
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

    const settings = { ...readSettings(), preorderOpen: body.preorderOpen };
    writeSettings(settings);
    return sendJson(res, 200, { ok: true, preorderOpen: settings.preorderOpen });
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

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

  if (urlPath.startsWith("/api/config")) {
    try {
      await handleConfig(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  serveStatic(req, res);
});

ensureOrdersFile();
ensureSettingsFile();

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
  console.log("  ※ HTML 파일을 직접 열면 동작하지 않습니다. 위 주소로 접속하세요.");
  console.log("  ※ 이 터미널을 닫으면 서버가 종료됩니다.");
  console.log(`  관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log(`  주문 secret:     ${ORDER_SECRET}`);
  console.log("");
  console.log("  종료: Ctrl + C");
  console.log("");

  openBrowser(homeUrl);
});
