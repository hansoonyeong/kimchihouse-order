/**
 * 기존 주문 데이터의 김치/냉동 분리 배송 상태를 단일 배송으로 정규화합니다.
 *
 * 로컬 파일:
 *   node scripts/migrate-unify-delivery.js
 *   node scripts/migrate-unify-delivery.js --dry-run
 *
 * Redis(Upstash) — 환경변수 KV_REST_API_URL / KV_REST_API_TOKEN 필요:
 *   node scripts/migrate-unify-delivery.js --redis
 *   node scripts/migrate-unify-delivery.js --redis --dry-run
 *
 * 원본은 삭제하지 않고, 로컬은 orders.backup-*.json 백업,
 * Redis는 kimchi-house:orders:backup:<timestamp> 키로 백업합니다.
 */
import { readFileSync, writeFileSync, existsSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DELIVERY_DATE,
  normalizeOrderDelivery,
  orderStatus,
  resolveDeliveryDate,
} from "../api/_lib/order-utils.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ordersPath = resolve(__dirname, "../data/orders.json");
const dryRun = process.argv.includes("--dry-run");
const useRedis = process.argv.includes("--redis");

function migrateOrder(order) {
  const status = orderStatus(order);
  const deliveryDate = resolveDeliveryDate(order) || DEFAULT_DELIVERY_DATE;
  const next = {
    ...order,
    status,
    deliveryDate,
    deliveryStatus: status,
    delivery: {
      ...(typeof order.delivery === "object" &&
      order.delivery &&
      !order.delivery.kimchi &&
      !order.delivery.frozen
        ? order.delivery
        : {}),
      date: deliveryDate,
      status,
    },
  };
  if (next.confirmMessageSent == null) next.confirmMessageSent = false;
  if (next.shipNoticeSent == null) next.shipNoticeSent = false;
  return normalizeOrderDelivery(next);
}

async function migrateLocal() {
  if (!existsSync(ordersPath)) {
    console.error("orders.json not found:", ordersPath);
    process.exit(1);
  }
  const raw = JSON.parse(readFileSync(ordersPath, "utf8"));
  if (!Array.isArray(raw)) {
    console.error("orders.json must be an array");
    process.exit(1);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = resolve(__dirname, `../data/orders.backup-${stamp}.json`);
  const migrated = raw.map(migrateOrder);
  console.log(`Source: local file (${raw.length} orders)`);
  console.log(`Backup: ${backupPath}`);
  console.log(`Dry run: ${dryRun}`);
  if (!dryRun) {
    copyFileSync(ordersPath, backupPath);
    writeFileSync(ordersPath, JSON.stringify(migrated, null, 2) + "\n", "utf8");
    console.log("Migration complete.");
  } else {
    console.log("Sample:", JSON.stringify(migrated[0] || null, null, 2));
    console.log("Dry run only — no files written.");
  }
}

async function migrateRedis() {
  const { hasRedisEnv, readOrders, writeOrders, getRedisEnv } = await import("../api/_lib/orders-store.js");
  if (!hasRedisEnv()) {
    console.error("Redis env missing. Set KV_REST_API_URL and KV_REST_API_TOKEN.");
    process.exit(1);
  }
  const { Redis } = await import("@upstash/redis");
  const { url, token } = getRedisEnv();
  const redis = new Redis({ url, token });
  const raw = await readOrders();
  const migrated = raw.map(migrateOrder);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupKey = `kimchi-house:orders:backup:${stamp}`;
  console.log(`Source: Redis (${raw.length} orders)`);
  console.log(`Backup key: ${backupKey}`);
  console.log(`Dry run: ${dryRun}`);
  if (!dryRun) {
    await redis.set(backupKey, raw);
    await writeOrders(migrated);
    console.log("Migration complete.");
  } else {
    console.log("Sample:", JSON.stringify(migrated[0] || null, null, 2));
    console.log("Dry run only — Redis not modified.");
  }
}

if (useRedis) await migrateRedis();
else await migrateLocal();
