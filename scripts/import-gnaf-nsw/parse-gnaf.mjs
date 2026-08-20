/**
 * Parse Geoscape G-NAF PSV/CSV extracts into denormalized NSW address rows.
 *
 * Expected extract layout (folder):
 *   ADDRESS_DETAIL*.psv
 *   STREET_LOCALITY*.psv   (not STREET_LOCALITY_POINT / _ALIAS)
 *   LOCALITY*.psv          (not LOCALITY_ALIAS / _POINT)
 *   ADDRESS_DEFAULT_GEOCODE*.psv
 *   STATE*.psv             (optional NSW filter)
 *
 * Pipe-separated (.psv) is official; comma CSV also accepted.
 * A single denormalized .csv / .jsonl file is also accepted by import.mjs.
 */

import fs from "fs";
import path from "path";
import readline from "readline";
import {
  localityNormKey,
  normalizeHouseNumber,
  normalizeLocality,
  normalizeStreetName,
  normalizeStreetType,
  streetNameNormKey,
} from "../../api/_lib/gnaf/street-normalize.js";

/** Exact table file match — avoids STREET_LOCALITY matching STREET_LOCALITY_POINT etc. */
export function findTableFiles(dir, tableName) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  const want = tableName.toUpperCase();
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        walk(p);
        continue;
      }
      const upper = name.toUpperCase();
      if (!/\.(PSV|CSV|TXT)$/.test(upper)) continue;
      // Require table token as whole segment (underscores / start)
      const re = new RegExp(`(?:^|[_\\-])${want}(?:[_\\-.]|$)`);
      if (!re.test(upper)) continue;
      // Exclude related satellite tables
      if (upper.includes(`${want}_ALIAS`)) continue;
      if (upper.includes(`${want}_POINT`)) continue;
      if (upper.includes(`${want}_AUT`)) continue;
      if (want === "LOCALITY" && upper.includes("STREET_LOCALITY")) continue;
      if (want === "STATE" && upper.includes("STREET")) continue;
      out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function detectDelimiter(headerLine) {
  const pipes = (headerLine.match(/\|/g) || []).length;
  const commas = (headerLine.match(/,/g) || []).length;
  return pipes >= commas ? "|" : ",";
}

function splitLine(line, delim) {
  if (delim === "|") return line.split("|");
  // simple CSV (G-NAF rarely quotes; handle basic quotes)
  const cols = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQ = !inQ;
      continue;
    }
    if (ch === "," && !inQ) {
      cols.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  cols.push(cur);
  return cols;
}

async function readDelimited(filePath, onRow) {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  let delim = "|";
  for await (const line of rl) {
    if (!line.trim()) continue;
    if (!headers) {
      delim = detectDelimiter(line);
      headers = splitLine(line, delim).map((h) => h.trim().toUpperCase());
      continue;
    }
    const cols = splitLine(line, delim);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cols[i] ?? "").trim();
    });
    onRow(row);
  }
  return { headers, delim };
}

function pick(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return "";
}

export function describeExpectedFiles() {
  return {
    format: "PSV (pipe-separated) preferred; CSV accepted",
    requiredTables: [
      {
        table: "ADDRESS_DETAIL",
        exampleNames: [
          "NSW_ADDRESS_DETAIL_psv.psv",
          "GNAF_*_ADDRESS_DETAIL_psv.psv",
          "ADDRESS_DETAIL_NSW.psv",
        ],
        requiredColumns: [
          "ADDRESS_DETAIL_PID",
          "STREET_LOCALITY_PID",
          "NUMBER_FIRST",
          "POSTCODE",
        ],
        optionalColumns: [
          "NUMBER_FIRST_PREFIX",
          "NUMBER_FIRST_SUFFIX",
          "NUMBER_LAST",
          "FLAT_TYPE_CODE",
          "FLAT_NUMBER",
          "LEVEL_TYPE_CODE",
          "LEVEL_NUMBER",
          "LOT_NUMBER",
          "CONFIDENCE",
        ],
      },
      {
        table: "STREET_LOCALITY",
        exampleNames: ["NSW_STREET_LOCALITY_psv.psv"],
        requiredColumns: [
          "STREET_LOCALITY_PID",
          "STREET_NAME",
          "LOCALITY_PID",
        ],
        optionalColumns: ["STREET_TYPE_CODE", "STREET_SUFFIX_CODE"],
      },
      {
        table: "LOCALITY",
        exampleNames: ["NSW_LOCALITY_psv.psv"],
        requiredColumns: ["LOCALITY_PID", "LOCALITY_NAME", "STATE_PID"],
        optionalColumns: ["PRIMARY_POSTCODE"],
      },
      {
        table: "ADDRESS_DEFAULT_GEOCODE",
        exampleNames: ["NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv"],
        requiredColumns: ["ADDRESS_DETAIL_PID", "LATITUDE", "LONGITUDE"],
        optionalColumns: ["GEOCODE_TYPE_CODE"],
      },
    ],
    optionalTables: [
      {
        table: "STATE",
        exampleNames: ["Authority_Code_STATE_psv.psv", "STATE_psv.psv"],
        requiredColumns: ["STATE_PID", "STATE_NAME"],
        note: "Used to keep NSW only when national extract is provided",
      },
    ],
    denormalizedAlt: {
      note: "Or pass a single denormalized CSV/JSONL with columns below",
      columns: [
        "address_detail_pid (or id)",
        "house_number",
        "street_name",
        "street_type",
        "locality (or suburb)",
        "postcode",
        "latitude (or lat)",
        "longitude (or lng/lon)",
        "state (optional, default NSW)",
        "subpremise (optional)",
      ],
    },
  };
}

/**
 * @param {string} inputDir
 * @param {{ onProgress?: (msg: string) => void }} [opts]
 * @returns {Promise<object[]>}
 */
export async function parseGnafNswExtract(inputDir, opts = {}) {
  const log = opts.onProgress || ((m) => console.log(m));

  const stateFiles = findTableFiles(inputDir, "STATE");
  const localityFiles = findTableFiles(inputDir, "LOCALITY");
  const streetFiles = findTableFiles(inputDir, "STREET_LOCALITY");
  const detailFiles = findTableFiles(inputDir, "ADDRESS_DETAIL");
  const geoFiles = findTableFiles(inputDir, "ADDRESS_DEFAULT_GEOCODE");

  log("Discovered G-NAF tables:");
  log(`  STATE:                    ${stateFiles.length} → ${stateFiles.map((f) => path.basename(f)).join(", ") || "(none)"}`);
  log(`  LOCALITY:                 ${localityFiles.length} → ${localityFiles.map((f) => path.basename(f)).join(", ") || "(none)"}`);
  log(`  STREET_LOCALITY:          ${streetFiles.length} → ${streetFiles.map((f) => path.basename(f)).join(", ") || "(none)"}`);
  log(`  ADDRESS_DETAIL:           ${detailFiles.length} → ${detailFiles.map((f) => path.basename(f)).join(", ") || "(none)"}`);
  log(`  ADDRESS_DEFAULT_GEOCODE:  ${geoFiles.length} → ${geoFiles.map((f) => path.basename(f)).join(", ") || "(none)"}`);

  if (!detailFiles.length) {
    throw new Error(
      `ADDRESS_DETAIL not found under ${inputDir}.\n` +
        `Need files like NSW_ADDRESS_DETAIL_psv.psv (see scripts/import-gnaf-nsw/README.md).`
    );
  }
  if (!streetFiles.length) {
    throw new Error(`STREET_LOCALITY not found under ${inputDir}`);
  }
  if (!localityFiles.length) {
    throw new Error(`LOCALITY not found under ${inputDir}`);
  }
  if (!geoFiles.length) {
    throw new Error(`ADDRESS_DEFAULT_GEOCODE not found under ${inputDir}`);
  }

  const nswStatePids = new Set();
  for (const f of stateFiles) {
    await readDelimited(f, (row) => {
      const name = pick(row, "STATE_NAME", "NAME").toUpperCase();
      const pid = pick(row, "STATE_PID", "PID");
      if (pid && (name === "NSW" || name === "NEW SOUTH WALES" || name.includes("NEW SOUTH WALES"))) {
        nswStatePids.add(pid);
      }
    });
  }
  if (nswStatePids.size) log(`  NSW STATE_PID filter: ${[...nswStatePids].join(", ")}`);
  else log("  NSW STATE_PID filter: (none — keeping all localities found)");

  const localities = new Map();
  for (const f of localityFiles) {
    await readDelimited(f, (row) => {
      const pid = pick(row, "LOCALITY_PID", "PID");
      if (!pid) return;
      const statePid = pick(row, "STATE_PID");
      if (nswStatePids.size && statePid && !nswStatePids.has(statePid)) return;
      localities.set(pid, {
        name: pick(row, "LOCALITY_NAME", "NAME"),
        statePid,
        primaryPostcode: pick(row, "PRIMARY_POSTCODE"),
      });
    });
  }
  log(`  Localities loaded: ${localities.size}`);

  const streets = new Map();
  for (const f of streetFiles) {
    await readDelimited(f, (row) => {
      const pid = pick(row, "STREET_LOCALITY_PID", "PID");
      if (!pid) return;
      const localityPid = pick(row, "LOCALITY_PID");
      if (localities.size && localityPid && !localities.has(localityPid)) return;
      streets.set(pid, {
        name: pick(row, "STREET_NAME", "NAME"),
        type: pick(row, "STREET_TYPE_CODE", "STREET_TYPE", "TYPE"),
        localityPid,
      });
    });
  }
  log(`  Street localities loaded: ${streets.size}`);

  const geos = new Map();
  for (const f of geoFiles) {
    await readDelimited(f, (row) => {
      const pid = pick(row, "ADDRESS_DETAIL_PID", "PID");
      const lat = Number(pick(row, "LATITUDE", "LAT"));
      const lng = Number(pick(row, "LONGITUDE", "LON", "LNG"));
      if (!pid || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      geos.set(pid, { lat, lng });
    });
  }
  log(`  Geocodes loaded: ${geos.size}`);

  const rows = [];
  let detailSeen = 0;
  let skippedNoStreet = 0;
  let skippedNoLocality = 0;
  let skippedNoGeo = 0;
  for (const f of detailFiles) {
    await readDelimited(f, (row) => {
      detailSeen += 1;
      const pid = pick(row, "ADDRESS_DETAIL_PID", "PID");
      if (!pid) return;
      const streetPid = pick(row, "STREET_LOCALITY_PID");
      const street = streets.get(streetPid);
      if (!street) {
        skippedNoStreet += 1;
        return;
      }
      const loc = localities.get(street.localityPid);
      if (!loc) {
        skippedNoLocality += 1;
        return;
      }
      const geo = geos.get(pid);
      if (!geo) {
        skippedNoGeo += 1;
        return;
      }

      const prefix = pick(row, "NUMBER_FIRST_PREFIX");
      const house = pick(row, "NUMBER_FIRST", "HOUSE_NUMBER_1", "HOUSE_NUMBER") || pick(row, "LOT_NUMBER");
      const houseSuffix = pick(row, "NUMBER_FIRST_SUFFIX", "HOUSE_NUMBER_SUFFIX");
      const houseNumber = `${prefix}${house}${houseSuffix}`.trim();
      const postcode = pick(row, "POSTCODE", "POST_CODE") || loc.primaryPostcode || "";
      const flatType = pick(row, "FLAT_TYPE_CODE", "FLAT_TYPE", "LEVEL_TYPE_CODE", "LEVEL_TYPE");
      const flat = pick(row, "FLAT_NUMBER", "LEVEL_NUMBER");
      const subpremise = [flatType, flat].filter(Boolean).join(" ").trim();

      const streetName = street.name;
      const streetType = street.type;
      const locality = loc.name;

      rows.push({
        address_detail_pid: pid,
        house_number: houseNumber,
        house_number_norm: normalizeHouseNumber(houseNumber),
        street_name: streetName,
        street_name_norm: streetNameNormKey(streetName),
        street_type: streetType,
        street_type_norm: normalizeStreetType(streetType),
        locality,
        locality_norm: localityNormKey(locality) || normalizeLocality(locality),
        postcode,
        state: "NSW",
        latitude: geo.lat,
        longitude: geo.lng,
        subpremise,
        confidence: Number(pick(row, "CONFIDENCE") || 0),
        address_label: [
          [
            houseNumber,
            normalizeStreetName(streetName),
            normalizeStreetType(streetType) || streetType,
          ]
            .filter(Boolean)
            .join(" "),
          locality,
          `NSW ${postcode}`,
        ]
          .filter(Boolean)
          .join(", "),
      });

      if (rows.length % 100000 === 0) log(`  … denormalized ${rows.length} addresses`);
    });
  }

  log(`  ADDRESS_DETAIL rows seen: ${detailSeen}`);
  log(`  Skipped (no street join): ${skippedNoStreet}`);
  log(`  Skipped (no locality join): ${skippedNoLocality}`);
  log(`  Skipped (no geocode): ${skippedNoGeo}`);
  log(`  Imported NSW addresses: ${rows.length}`);
  return rows;
}

/** Load denormalized JSONL/CSV into the same row shape. */
export function normalizeFlatRow(obj) {
  const streetName = obj.street_name || obj.streetName || "";
  const streetType = obj.street_type || obj.streetType || "";
  const locality = obj.locality || obj.suburb || "";
  const house = String(obj.house_number || obj.houseNumber || "");
  return {
    address_detail_pid: obj.address_detail_pid || obj.gnafPid || obj.id || "",
    house_number: house,
    house_number_norm: normalizeHouseNumber(house),
    street_name: streetName,
    street_name_norm: streetNameNormKey(streetName),
    street_type: streetType,
    street_type_norm: normalizeStreetType(streetType),
    locality,
    locality_norm: localityNormKey(locality) || normalizeLocality(locality),
    postcode: String(obj.postcode || "").trim(),
    state: obj.state || "NSW",
    latitude: Number(obj.latitude ?? obj.lat),
    longitude: Number(obj.longitude ?? obj.lng ?? obj.lon),
    subpremise: obj.subpremise || obj.unit || "",
    confidence: obj.confidence || 0,
    address_label:
      obj.address_label ||
      obj.label ||
      [
        [house, streetName, streetType].filter(Boolean).join(" "),
        locality,
        `NSW ${obj.postcode || ""}`,
      ]
        .filter(Boolean)
        .join(", "),
  };
}

export async function loadSampleRows(samplePath) {
  const text = fs.readFileSync(samplePath, "utf8");
  const rows = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    rows.push(normalizeFlatRow(JSON.parse(t)));
  }
  return rows;
}

export async function loadDenormalizedFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jsonl" || ext === ".ndjson") {
    return loadSampleRows(filePath);
  }
  if (ext === ".csv" || ext === ".psv" || ext === ".txt") {
    const rows = [];
    await readDelimited(filePath, (row) => {
      // map uppercase PSV headers to flat keys
      const flat = {
        address_detail_pid: pick(row, "ADDRESS_DETAIL_PID", "ID", "GNAF_PID"),
        house_number: pick(row, "HOUSE_NUMBER", "NUMBER_FIRST", "HOUSENUMBER"),
        street_name: pick(row, "STREET_NAME", "STREET"),
        street_type: pick(row, "STREET_TYPE", "STREET_TYPE_CODE", "TYPE"),
        locality: pick(row, "LOCALITY", "SUBURB", "LOCALITY_NAME"),
        postcode: pick(row, "POSTCODE", "POST_CODE"),
        state: pick(row, "STATE") || "NSW",
        latitude: pick(row, "LATITUDE", "LAT"),
        longitude: pick(row, "LONGITUDE", "LNG", "LON"),
        subpremise: pick(row, "SUBPREMISE", "UNIT", "FLAT_NUMBER"),
        address_label: pick(row, "ADDRESS_LABEL", "LABEL", "FULL_ADDRESS"),
        confidence: pick(row, "CONFIDENCE"),
      };
      const n = normalizeFlatRow(flat);
      if (Number.isFinite(n.latitude) && Number.isFinite(n.longitude) && n.street_name_norm) {
        rows.push(n);
      }
    });
    return rows;
  }
  throw new Error(`Unsupported file type: ${ext} (${filePath})`);
}
