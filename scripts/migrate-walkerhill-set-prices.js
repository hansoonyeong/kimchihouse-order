/**
 * One-off: fix 3·5 SET line prices on existing orders (old → new catalog prices).
 * Usage: node scripts/migrate-walkerhill-set-prices.js [--dry-run] [--force]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadEnvFiles } from "./load-env.js";
import { hasRedisEnv, readOrders, writeOrders } from "../api/_lib/orders-store.js";
import { migrateOrdersSetPrices } from "../api/_lib/walkerhill-set-price-fix.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
loadEnvFiles(ROOT);
delete process.env.VERCEL;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const force = process.argv.includes("--force");
  const store = hasRedisEnv() ? "redis" : "local";
  console.log(`Store: ${store}${dryRun ? " (dry-run)" : ""}${force ? " (force)" : ""}`);

  const orders = await readOrders();
  console.log(`Orders loaded: ${orders.length}`);

  const backupPath = path.join(
    ROOT,
    "data",
    `orders-backup-before-set-price-fix-${Date.now()}.json`
  );
  if (!dryRun && orders.length) {
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    fs.writeFileSync(backupPath, JSON.stringify(orders, null, 2) + "\n", "utf8");
    console.log(`Backup: ${backupPath}`);
  }

  const result = migrateOrdersSetPrices(orders);
  const { changes } = result;

  if (!changes.length) {
    console.log("No orders needed updating.");
    return;
  }

  const byOrder = new Map();
  for (const c of changes) {
    if (!byOrder.has(c.orderId)) byOrder.set(c.orderId, []);
    byOrder.get(c.orderId).push(c);
  }

  console.log(`Orders to update: ${byOrder.size}`);
  for (const [orderId, lines] of byOrder) {
    const delta = lines.reduce((s, l) => s + (l.to - l.from), 0);
    console.log(`  ${orderId} (+$${delta})`);
    for (const l of lines) {
      console.log(`    ${l.productId} ${l.name}: $${l.from} → $${l.to}`);
    }
  }

  if (dryRun) {
    console.log("Dry-run complete. No data written.");
    return;
  }

  await writeOrders(result.orders);
  console.log("Done. Orders saved.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
