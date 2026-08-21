/**
 * G-NAF store abstraction.
 * Backend options (priority):
 *  1. SQLite file at data/gnaf-nsw.sqlite (local / self-hosted)
 *  2. JSONL index at data/gnaf-nsw.jsonl
 *  3. Sample JSONL at data/gnaf-nsw.sample.jsonl
 *  4. Empty stub → Nominatim fallback only
 *
 * Runtime NEVER reads Geoscape CSV/PSV — import scripts only.
 * Full Geoscape G-NAF must NEVER be shipped to the browser.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  localityNormKey,
  normalizeHouseNumber,
  normalizeLocality,
  normalizeStreetName,
  normalizeStreetType,
  streetNameNormKey,
} from "./street-normalize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../../..");
export const DEFAULT_SQLITE = path.join(ROOT, "data", "gnaf-nsw.sqlite");
export const DEFAULT_JSONL = path.join(ROOT, "data", "gnaf-nsw.jsonl");
const SAMPLE_JSONL = path.join(ROOT, "scripts", "import-gnaf-nsw", "sample", "gnaf-nsw.sample.jsonl");

const INDEX_DDL = [
  `CREATE INDEX IF NOT EXISTS idx_gnaf_pc_loc_street_hn
    ON gnaf_address (postcode, locality_norm, street_name_norm, house_number_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_pc_street_hn
    ON gnaf_address (postcode, street_name_norm, house_number_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_loc_street_hn
    ON gnaf_address (locality_norm, street_name_norm, house_number_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_street_fuzzy
    ON gnaf_address (street_name_norm, locality_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_postcode
    ON gnaf_address (postcode)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_locality
    ON gnaf_address (locality_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_street_name
    ON gnaf_address (street_name_norm)`,
  `CREATE INDEX IF NOT EXISTS idx_gnaf_pc_street
    ON gnaf_address (postcode, street_name_norm)`,
];

function ensureSqliteIndexes(db) {
  // Skip DDL when indexes already present (open path must stay milliseconds).
  try {
    const row = db
      .prepare(
        `SELECT 1 AS ok FROM sqlite_master WHERE type='index' AND name='idx_gnaf_pc_street' LIMIT 1`
      )
      .get();
    if (row) return;
  } catch {
    /* continue */
  }
  for (const ddl of INDEX_DDL) {
    try {
      db.exec(ddl);
    } catch {
      /* ignore */
    }
  }
}

function readMetaCount(db) {
  try {
    const row = db.prepare(`SELECT value FROM gnaf_meta WHERE key = 'count'`).get();
    const n = Number(row?.value);
    if (Number.isFinite(n) && n > 0) return n;
  } catch {
    /* no meta */
  }
  return null;
}

function writeMetaCount(db, n) {
  try {
    db.prepare(`INSERT OR REPLACE INTO gnaf_meta (key, value) VALUES ('count', ?)`).run(String(n));
  } catch {
    /* ignore */
  }
}

/**
 * Open SQLite without full-table COUNT(*) on the hot path.
 * Presence check: LIMIT 1. Row count: gnaf_meta, else one-time COUNT cached to meta.
 */
async function openSqliteAsync(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const mod = await import("node:sqlite");
    const DatabaseSync = mod.DatabaseSync;
    if (!DatabaseSync) return null;
    const db = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA cache_size = -64000"); // ~64MB page cache
    } catch {
      /* ignore */
    }
    const probe = db.prepare("SELECT 1 AS ok FROM gnaf_address LIMIT 1").get();
    if (!probe) return null;
    // Indexes / meta writes happen once at open (not per lookup).
    ensureSqliteIndexes(db);
    let count = readMetaCount(db);
    if (count == null) {
      // One-time only (expensive on 5M+ rows). Persist so runtime never rescans.
      count = Number(db.prepare("SELECT COUNT(*) AS n FROM gnaf_address").get()?.n || 0);
      if (count > 0) writeMetaCount(db, count);
    }
    if (!count) return null;
    db.__gnafCachedCount = count;
    return db;
  } catch {
    return null;
  }
}

function loadJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    try {
      rows.push(normalizeRow(JSON.parse(t)));
    } catch {
      /* skip */
    }
  }
  return rows.filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude) && r.street_name_norm);
}

export function normalizeRow(obj) {
  const streetName = obj.street_name || obj.streetName || "";
  const streetType = obj.street_type || obj.streetType || "";
  const locality = obj.locality || obj.suburb || "";
  const house = obj.house_number || obj.houseNumber || "";
  return {
    address_detail_pid: obj.address_detail_pid || obj.gnafPid || obj.id || "",
    house_number: house,
    house_number_norm: normalizeHouseNumber(house),
    street_name: streetName,
    street_name_norm: streetNameNormKey(streetName) || normalizeStreetName(streetName),
    street_type: streetType,
    street_type_norm: normalizeStreetType(streetType),
    locality,
    locality_norm: localityNormKey(locality) || normalizeLocality(locality),
    postcode: String(obj.postcode || "").trim(),
    state: obj.state || "NSW",
    latitude: Number(obj.latitude ?? obj.lat),
    longitude: Number(obj.longitude ?? obj.lng ?? obj.lon),
    subpremise: obj.subpremise || obj.unit || "",
    confidence: obj.confidence ?? 0,
    address_label: obj.address_label || obj.label || "",
  };
}

export class JsonlGnafStore {
  constructor(rows, sourcePath) {
    this.rows = rows;
    this.sourcePath = sourcePath;
    this.backend = "jsonl";
    this._cachedCount = rows.length;
  }

  isReady() {
    return this.rows.length > 0;
  }

  stats() {
    return { backend: this.backend, count: this._cachedCount, path: this.sourcePath };
  }

  findExact({ postcode, localityKey, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    return this.rows.filter(
      (r) =>
        r.postcode === postcode &&
        r.locality_norm === localityKey &&
        r.street_name_norm === streetNameKey &&
        r.house_number_norm === hn &&
        (!st || !r.street_type_norm || r.street_type_norm === st)
    );
  }

  findByPostcodeStreet({ postcode, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    return this.rows.filter(
      (r) =>
        r.postcode === postcode &&
        r.street_name_norm === streetNameKey &&
        r.house_number_norm === hn &&
        (!st || !r.street_type_norm || r.street_type_norm === st)
    );
  }

  findByLocalityStreet({ localityKey, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    return this.rows.filter(
      (r) =>
        r.locality_norm === localityKey &&
        r.street_name_norm === streetNameKey &&
        r.house_number_norm === hn &&
        (!st || !r.street_type_norm || r.street_type_norm === st)
    );
  }

  findFuzzyStreet({ streetNameKey, localityKey, postcode, houseNumber, limit = 16 }) {
    // Never full-scan: require locality or postcode scope.
    if (!localityKey && !postcode) return [];
    const hn = houseNumber ? normalizeHouseNumber(houseNumber) : "";
    const out = [];
    for (const r of this.rows) {
      if (localityKey && r.locality_norm !== localityKey) continue;
      if (!localityKey && postcode && r.postcode !== postcode) continue;
      const sn = r.street_name_norm || "";
      if (!(sn === streetNameKey || sn.startsWith(streetNameKey) || streetNameKey.startsWith(sn))) {
        continue;
      }
      if (hn && r.house_number_norm && r.house_number_norm !== hn) continue;
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }
}

export class SqliteGnafStore {
  constructor(db, sourcePath) {
    this.db = db;
    this.sourcePath = sourcePath;
    this.backend = "sqlite";
    this._cachedCount = Number(db.__gnafCachedCount || 0) || readMetaCount(db) || 0;
    this._stmts = Object.create(null);
  }

  isReady() {
    return !!this.db;
  }

  /** Cached — never runs COUNT(*) on the hot path. */
  stats() {
    return { backend: this.backend, count: this._cachedCount, path: this.sourcePath };
  }

  _stmt(key, sql) {
    if (!this._stmts[key]) this._stmts[key] = this.db.prepare(sql);
    return this._stmts[key];
  }

  _all(key, sql, params) {
    return this._stmt(key, sql).all(...params);
  }

  findExact({ postcode, localityKey, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    if (st) {
      return this._all(
        "exact_st",
        `SELECT * FROM gnaf_address
         WHERE postcode = ? AND locality_norm = ? AND street_name_norm = ?
           AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [postcode, localityKey, streetNameKey, hn, st]
      );
    }
    return this._all(
      "exact",
      `SELECT * FROM gnaf_address
       WHERE postcode = ? AND locality_norm = ? AND street_name_norm = ?
         AND house_number_norm = ?
       LIMIT 20`,
      [postcode, localityKey, streetNameKey, hn]
    );
  }

  findByPostcodeStreet({ postcode, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    if (st) {
      return this._all(
        "pc_st",
        `SELECT * FROM gnaf_address
         WHERE postcode = ? AND street_name_norm = ? AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [postcode, streetNameKey, hn, st]
      );
    }
    return this._all(
      "pc",
      `SELECT * FROM gnaf_address
       WHERE postcode = ? AND street_name_norm = ? AND house_number_norm = ?
       LIMIT 20`,
      [postcode, streetNameKey, hn]
    );
  }

  findByLocalityStreet({ localityKey, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    if (st) {
      return this._all(
        "loc_st",
        `SELECT * FROM gnaf_address
         WHERE locality_norm = ? AND street_name_norm = ? AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [localityKey, streetNameKey, hn, st]
      );
    }
    return this._all(
      "loc",
      `SELECT * FROM gnaf_address
       WHERE locality_norm = ? AND street_name_norm = ? AND house_number_norm = ?
       LIMIT 20`,
      [localityKey, streetNameKey, hn]
    );
  }

  /**
   * Prefix fuzzy within locality or postcode only.
   * Uses range scan on street_name_norm (index-friendly) instead of LIKE when possible.
   * NEVER runs without locality/postcode (would full-scan 5M+ rows).
   */
  findFuzzyStreet({ streetNameKey, localityKey, postcode, houseNumber, limit = 16 }) {
    if (!streetNameKey || (!localityKey && !postcode)) return [];
    const hn = houseNumber ? normalizeHouseNumber(houseNumber) : "";
    const prefixEnd = streetNameKey + "\uffff";

    if (localityKey) {
      if (hn) {
        return this._all(
          "fuzzy_loc_hn",
          `SELECT * FROM gnaf_address
           WHERE locality_norm = ?
             AND street_name_norm >= ? AND street_name_norm < ?
             AND house_number_norm = ?
           LIMIT ?`,
          [localityKey, streetNameKey, prefixEnd, hn, limit]
        );
      }
      return this._all(
        "fuzzy_loc",
        `SELECT * FROM gnaf_address
         WHERE locality_norm = ?
           AND street_name_norm >= ? AND street_name_norm < ?
         LIMIT ?`,
        [localityKey, streetNameKey, prefixEnd, limit]
      );
    }

    if (hn) {
      return this._all(
        "fuzzy_pc_hn",
        `SELECT * FROM gnaf_address
         WHERE postcode = ?
           AND street_name_norm >= ? AND street_name_norm < ?
           AND house_number_norm = ?
         LIMIT ?`,
        [postcode, streetNameKey, prefixEnd, hn, limit]
      );
    }
    return this._all(
      "fuzzy_pc",
      `SELECT * FROM gnaf_address
       WHERE postcode = ?
         AND street_name_norm >= ? AND street_name_norm < ?
       LIMIT ?`,
      [postcode, streetNameKey, prefixEnd, limit]
    );
  }
}

export class EmptyGnafStore {
  backend = "empty";
  isReady() {
    return false;
  }
  stats() {
    return { backend: this.backend, count: 0, path: null };
  }
  findExact() {
    return [];
  }
  findByPostcodeStreet() {
    return [];
  }
  findByLocalityStreet() {
    return [];
  }
  findFuzzyStreet() {
    return [];
  }
}

let _storePromise = null;

/** @returns {Promise<JsonlGnafStore|SqliteGnafStore|EmptyGnafStore>} */
export async function getGnafStore() {
  if (_storePromise) return _storePromise;
  _storePromise = (async () => {
    const sqlitePath = process.env.GNAF_SQLITE_PATH || DEFAULT_SQLITE;
    const db = await openSqliteAsync(sqlitePath);
    if (db) return new SqliteGnafStore(db, sqlitePath);

    const jsonlPath = process.env.GNAF_JSONL_PATH || DEFAULT_JSONL;
    let rows = loadJsonl(jsonlPath);
    let used = jsonlPath;
    const allowSample =
      process.env.GNAF_USE_SAMPLE === "1" ||
      (!process.env.VERCEL && process.env.NODE_ENV !== "production");
    if (!rows.length && allowSample) {
      rows = loadJsonl(SAMPLE_JSONL);
      used = SAMPLE_JSONL;
    }
    if (rows.length) return new JsonlGnafStore(rows, used);
    return new EmptyGnafStore();
  })();
  return _storePromise;
}

export function resetGnafStoreCache() {
  _storePromise = null;
}

/** Ensure gnaf_meta.count exists (one-time repair for DBs imported before meta write). */
export async function ensureGnafMetaCount() {
  const store = await getGnafStore();
  if (store.backend !== "sqlite" || !store.db) return store.stats();
  if (store._cachedCount > 0 && readMetaCount(store.db) != null) return store.stats();
  return store.stats();
}
