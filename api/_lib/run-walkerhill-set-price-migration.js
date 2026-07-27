import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";
import { getRedisEnv, readOrders, writeOrders } from "./orders-store.js";
import { migrateOrdersSetPrices } from "./walkerhill-set-price-fix.js";

const MIGRATION_KEY = "kimchi-house:migration:walkerhill-set-3-5-price-fix-v1";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_FLAG_FILE = path.join(__dirname, "../../data/.walkerhill-set-price-migration-v1");

function getRedis() {
  const { url, token } = getRedisEnv();
  if (!url || !token) return null;
  return new Redis({ url, token });
}

async function migrationAlreadyDone(redis) {
  if (redis) {
    const done = await redis.get(MIGRATION_KEY);
    return Boolean(done);
  }
  if (process.env.VERCEL) return false;
  return fs.existsSync(LOCAL_FLAG_FILE);
}

async function markMigrationDone(redis, result) {
  const payload = {
    at: new Date().toISOString(),
    updatedOrders: result.updatedOrders,
    itemChanges: result.itemChanges,
  };
  if (redis) {
    await redis.set(MIGRATION_KEY, payload);
    return;
  }
  if (!process.env.VERCEL) {
    fs.mkdirSync(path.dirname(LOCAL_FLAG_FILE), { recursive: true });
    fs.writeFileSync(LOCAL_FLAG_FILE, JSON.stringify(payload, null, 2) + "\n", "utf8");
  }
}

export async function runWalkerhillSetPriceMigration({ force = false } = {}) {
  const redis = getRedis();
  if (!force && (await migrationAlreadyDone(redis))) {
    return { ok: true, skipped: true, reason: "already_done", updatedOrders: 0, itemChanges: 0, changes: [] };
  }

  const orders = await readOrders();
  const result = migrateOrdersSetPrices(orders);

  if (result.updatedOrders > 0) {
    await writeOrders(result.orders);
  }

  if (!force) {
    await markMigrationDone(redis, result);
  }

  return {
    ok: true,
    skipped: false,
    updatedOrders: result.updatedOrders,
    itemChanges: result.itemChanges,
    changes: result.changes,
  };
}
