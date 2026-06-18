import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const PORT = process.env.PORT || 3456;
const ORDERS_FILE = path.join(ROOT, "data", "orders.json");
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

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
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
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
    };

    if (shippingBreakdown) order.shippingBreakdown = shippingBreakdown;

    const orders = readOrders();
    orders.unshift(order);
    writeOrders(orders);
    return sendJson(res, 201, { ok: true, orderId: order.id });
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

  if (urlPath.startsWith("/api/orders")) {
    try {
      await handleOrders(req, res);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err.message || "Server error" });
    }
    return;
  }

  if (urlPath === "/api/config" && req.method === "GET") {
    return sendJson(res, 200, { ok: true, orderSecret: ORDER_SECRET });
  }

  if (urlPath === "/api/config" && req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  serveStatic(req, res);
});

ensureOrdersFile();

server.listen(PORT, "127.0.0.1", () => {
  console.log("");
  console.log("  김치하우스 사전예약 — 로컬 서버 실행 중");
  console.log("");
  console.log(`  홈:       http://127.0.0.1:${PORT}/`);
  console.log(`  주문:     http://127.0.0.1:${PORT}/order.html`);
  console.log(`  관리자:   http://127.0.0.1:${PORT}/admin.html`);
  console.log("");
  console.log(`  관리자 비밀번호: ${ADMIN_PASSWORD}`);
  console.log(`  주문 secret:     ${ORDER_SECRET}`);
  console.log("");
  console.log("  종료: Ctrl + C");
  console.log("");
});
