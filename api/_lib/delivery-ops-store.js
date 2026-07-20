import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";

/** Separate from orders — never mutates order documents. */
const DELIVERY_OPS_KEY = "kimchi-house:delivery-ops";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_FILE = path.join(__dirname, "../../data/delivery-ops.json");

export const OPS_STATUSES = ["배송준비", "배송중", "배송완료"];
export const DEFAULT_OPS_STATUS = "배송준비";

export const DEFAULT_DELIVERY_OPS = {
  byOrderId: {},
  updatedAt: null,
};

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_FILE)) {
    fs.writeFileSync(LOCAL_FILE, JSON.stringify(DEFAULT_DELIVERY_OPS, null, 2) + "\n", "utf8");
  }
}

function readLocal() {
  ensureLocalFile();
  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_FILE, "utf8"));
    return normalizeDoc(raw);
  } catch {
    return { ...DEFAULT_DELIVERY_OPS, byOrderId: {} };
  }
}

function writeLocal(doc) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(doc, null, 2) + "\n", "utf8");
}

function normalizeDoc(raw) {
  const byOrderId =
    raw && typeof raw === "object" && raw.byOrderId && typeof raw.byOrderId === "object"
      ? raw.byOrderId
      : {};
  return {
    byOrderId: { ...byOrderId },
    updatedAt: raw?.updatedAt || null,
  };
}

export function normalizeOpsEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return { status: DEFAULT_OPS_STATUS, routeIndex: null, note: "" };
  }
  const status = OPS_STATUSES.includes(entry.status) ? entry.status : DEFAULT_OPS_STATUS;
  const routeIndex =
    entry.routeIndex == null || entry.routeIndex === ""
      ? null
      : Math.max(0, Math.floor(Number(entry.routeIndex) || 0));
  return {
    status,
    routeIndex,
    note: String(entry.note || ""),
  };
}

export async function readDeliveryOps() {
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) return { ...DEFAULT_DELIVERY_OPS, byOrderId: {} };
    return readLocal();
  }
  try {
    const doc = await redis.get(DELIVERY_OPS_KEY);
    return normalizeDoc(doc);
  } catch (err) {
    console.error("Redis delivery-ops read error:", err);
    return { ...DEFAULT_DELIVERY_OPS, byOrderId: {} };
  }
}

export async function writeDeliveryOps(doc) {
  const next = normalizeDoc(doc);
  next.updatedAt = new Date().toISOString();
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) {
      throw new Error(
        "배송 작업 저장소(Redis)가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 연결해 주세요."
      );
    }
    writeLocal(next);
    return next;
  }
  await redis.set(DELIVERY_OPS_KEY, next);
  return next;
}
