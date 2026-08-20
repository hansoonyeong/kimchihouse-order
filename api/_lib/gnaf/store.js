/**
 * G-NAF store abstraction.
 * Backend options (priority):
 *  1. SQLite file at data/gnaf-nsw.sqlite (local / self-hosted)
 *  2. JSONL index at data/gnaf-nsw.jsonl
 *  3. Sample JSONL at data/gnaf-nsw.sample.jsonl
 *  4. Empty stub → Nominatim fallback only
 *
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

async function openSqliteAsync(dbPath) {
  if (!fs.existsSync(dbPath)) return null;
  try {
    const mod = await import("node:sqlite");
    const DatabaseSync = mod.DatabaseSync;
    if (!DatabaseSync) return null;
    const db = new DatabaseSync(dbPath);
    const row = db.prepare("SELECT COUNT(*) AS n FROM gnaf_address").get();
    if (!row || Number(row.n) === 0) return null;
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
  }

  isReady() {
    return this.rows.length > 0;
  }

  stats() {
    return { backend: this.backend, count: this.rows.length, path: this.sourcePath };
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
    const hn = houseNumber ? normalizeHouseNumber(houseNumber) : "";
    const out = [];
    for (const r of this.rows) {
      if (localityKey && r.locality_norm !== localityKey) {
        if (!postcode || r.postcode !== postcode) continue;
      } else if (!localityKey && postcode && r.postcode !== postcode) {
        continue;
      }
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
  }

  isReady() {
    return !!this.db;
  }

  stats() {
    try {
      const row = this.db.prepare("SELECT COUNT(*) AS n FROM gnaf_address").get();
      return { backend: this.backend, count: Number(row?.n || 0), path: this.sourcePath };
    } catch {
      return { backend: this.backend, count: 0, path: this.sourcePath };
    }
  }

  _all(sql, params) {
    return this.db.prepare(sql).all(...params);
  }

  findExact({ postcode, localityKey, streetNameKey, streetType, houseNumber }) {
    const hn = normalizeHouseNumber(houseNumber);
    const st = streetType ? normalizeStreetType(streetType) : "";
    if (st) {
      return this._all(
        `SELECT * FROM gnaf_address
         WHERE postcode = ? AND locality_norm = ? AND street_name_norm = ?
           AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [postcode, localityKey, streetNameKey, hn, st]
      );
    }
    return this._all(
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
        `SELECT * FROM gnaf_address
         WHERE postcode = ? AND street_name_norm = ? AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [postcode, streetNameKey, hn, st]
      );
    }
    return this._all(
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
        `SELECT * FROM gnaf_address
         WHERE locality_norm = ? AND street_name_norm = ? AND house_number_norm = ?
           AND (street_type_norm = '' OR street_type_norm = ?)
         LIMIT 20`,
        [localityKey, streetNameKey, hn, st]
      );
    }
    return this._all(
      `SELECT * FROM gnaf_address
       WHERE locality_norm = ? AND street_name_norm = ? AND house_number_norm = ?
       LIMIT 20`,
      [localityKey, streetNameKey, hn]
    );
  }

  findFuzzyStreet({ streetNameKey, localityKey, postcode, houseNumber, limit = 16 }) {
    const hn = houseNumber ? normalizeHouseNumber(houseNumber) : "";
    const like = `${streetNameKey}%`;
    if (localityKey) {
      return this._all(
        `SELECT * FROM gnaf_address
         WHERE locality_norm = ? AND street_name_norm LIKE ?
           AND (? = '' OR house_number_norm = ?)
         LIMIT ?`,
        [localityKey, like, hn, hn, limit]
      );
    }
    if (postcode) {
      return this._all(
        `SELECT * FROM gnaf_address
         WHERE postcode = ? AND street_name_norm LIKE ?
           AND (? = '' OR house_number_norm = ?)
         LIMIT ?`,
        [postcode, like, hn, hn, limit]
      );
    }
    return this._all(
      `SELECT * FROM gnaf_address
       WHERE street_name_norm LIKE ?
         AND (? = '' OR house_number_norm = ?)
       LIMIT ?`,
      [like, hn, hn, limit]
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
