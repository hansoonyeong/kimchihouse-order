#!/usr/bin/env node
/**
 * Import NSW G-NAF extract → data/gnaf-nsw.sqlite | .jsonl
 *
 * Usage:
 *   npm run import-gnaf -- --sample
 *   npm run import-gnaf -- --input ./data/gnaf-extract
 *   npm run import-gnaf -- --input ./data/NSW_GNAF_flat.csv --out data/gnaf-nsw.sqlite
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  describeExpectedFiles,
  loadDenormalizedFile,
  loadSampleRows,
  parseGnafNswExtract,
} from "./parse-gnaf.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const SCHEMA = path.join(ROOT, "api/_lib/gnaf/schema.sql");
const SAMPLE = path.join(__dirname, "sample/gnaf-nsw.sample.jsonl");

function parseArgs(argv) {
  const args = {
    input: "",
    out: path.join(ROOT, "data/gnaf-nsw.sqlite"),
    format: "",
    sample: false,
    describe: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") args.input = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--format") args.format = argv[++i];
    else if (a === "--sample") args.sample = true;
    else if (a === "--describe") args.describe = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  if (!args.format) {
    args.format = String(args.out).endsWith(".jsonl") ? "jsonl" : "sqlite";
  }
  return args;
}

async function writeJsonl(outPath, rows) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const fd = fs.openSync(outPath, "w");
  let n = 0;
  for (const row of rows) {
    fs.writeSync(fd, JSON.stringify(row) + "\n");
    n += 1;
  }
  fs.closeSync(fd);
  return n;
}

async function writeSqlite(outPath, rows) {
  const { DatabaseSync } = await import("node:sqlite");
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
  const db = new DatabaseSync(outPath);
  db.exec(fs.readFileSync(SCHEMA, "utf8"));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO gnaf_address (
      address_detail_pid, house_number, house_number_norm,
      street_name, street_name_norm, street_type, street_type_norm,
      locality, locality_norm, postcode, state,
      latitude, longitude, subpremise, confidence, address_label
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const BATCH = 5000;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const tx = db.transaction((list) => {
      for (const r of list) {
        insert.run(
          r.address_detail_pid,
          r.house_number,
          r.house_number_norm,
          r.street_name,
          r.street_name_norm,
          r.street_type,
          r.street_type_norm,
          r.locality,
          r.locality_norm,
          r.postcode,
          r.state || "NSW",
          r.latitude,
          r.longitude,
          r.subpremise || "",
          r.confidence || 0,
          r.address_label || ""
        );
      }
    });
    tx(chunk);
    written += chunk.length;
    if (written % 50000 === 0 || written === rows.length) {
      console.log(`  Writing SQLite… ${written} / ${rows.length}`);
    }
  }
  db.prepare(
    `INSERT OR REPLACE INTO gnaf_meta (key, value) VALUES ('imported_at', ?)`
  ).run(new Date().toISOString());
  db.prepare(`INSERT OR REPLACE INTO gnaf_meta (key, value) VALUES ('count', ?)`).run(
    String(rows.length)
  );
  db.prepare(`INSERT OR REPLACE INTO gnaf_meta (key, value) VALUES ('state', ?)`).run("NSW");
  db.close();
  return rows.length;
}

async function collectRows(args) {
  if (args.sample) {
    console.log(`Loading committed sample:\n  ${SAMPLE}`);
    return loadSampleRows(SAMPLE);
  }
  if (!args.input) {
    throw new Error("Provide --input <gnaf-folder|flat.csv|flat.jsonl> or --sample");
  }
  const inputPath = path.isAbsolute(args.input) ? args.input : path.join(ROOT, args.input);
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Input not found: ${inputPath}`);
  }
  const st = fs.statSync(inputPath);
  if (st.isDirectory()) {
    console.log(`Parsing Geoscape G-NAF extract folder:\n  ${inputPath}`);
    return parseGnafNswExtract(inputPath);
  }
  console.log(`Loading denormalized file:\n  ${inputPath}`);
  return loadDenormalizedFile(inputPath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(`Usage:
  npm run import-gnaf -- --sample
  npm run import-gnaf -- --input ./data/gnaf-extract
  npm run import-gnaf -- --input ./data/NSW_GNAF_flat.csv --out data/gnaf-nsw.sqlite
  npm run import-gnaf -- --describe`);
    process.exit(0);
  }
  if (args.describe) {
    console.log(JSON.stringify(describeExpectedFiles(), null, 2));
    process.exit(0);
  }

  const t0 = Date.now();
  const rows = await collectRows(args);
  console.log("");
  console.log(`✅ Collected ${rows.length.toLocaleString()} NSW addresses`);

  if (!rows.length) {
    throw new Error("No rows to import — check input files / columns");
  }

  const out = path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out);
  console.log(`Writing ${args.format} → ${out}`);
  let n;
  if (args.format === "jsonl") n = await writeJsonl(out, rows);
  else n = await writeSqlite(out, rows);

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("");
  console.log("========== G-NAF IMPORT RESULT ==========");
  console.log(`  Rows imported : ${n.toLocaleString()}`);
  console.log(`  Output        : ${out}`);
  console.log(`  Format        : ${args.format}`);
  console.log(`  Elapsed       : ${secs}s`);
  console.log("=========================================");
  console.log("Next:");
  console.log("  1) Restart: npm run dev");
  console.log("  2) Check:   curl -s 'http://localhost:3456/api/gnaf-geocode?stats=1'");
  console.log("  3) Test:    npm run test:gnaf");
}

main().catch((err) => {
  console.error("\n❌ Import failed:", err.message || err);
  process.exit(1);
});
