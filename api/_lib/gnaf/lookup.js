/**
 * G-NAF address lookup with matching priority:
 * 1. postcode + suburb + street + house number exact
 * 2. postcode + normalized street + house number
 * 3. suburb + normalized street + house number
 * 4. fuzzy street-name candidate
 */

import {
  localityNormKey,
  normalizeHouseNumber,
  streetNameNormKey,
  toLookupKeys,
} from "./street-normalize.js";

export const MATCH_LEVEL = {
  EXACT: "exact",
  POSTCODE_STREET: "postcode_street",
  SUBURB_STREET: "suburb_street",
  FUZZY: "fuzzy",
};

const MATCH_SCORE = {
  [MATCH_LEVEL.EXACT]: 100,
  [MATCH_LEVEL.POSTCODE_STREET]: 92,
  [MATCH_LEVEL.SUBURB_STREET]: 85,
  [MATCH_LEVEL.FUZZY]: 70,
};

function rowToCandidate(row, matchLevel, extras = {}) {
  const score = MATCH_SCORE[matchLevel] ?? 60;
  return {
    provider: "gnaf",
    matchLevel,
    score,
    lat: Number(row.latitude),
    lng: Number(row.longitude),
    gnafPid: row.address_detail_pid,
    displayName:
      row.address_label ||
      [
        [row.house_number, row.street_name, row.street_type].filter(Boolean).join(" "),
        row.locality,
        row.state,
        row.postcode,
      ]
        .filter(Boolean)
        .join(", "),
    address: {
      houseNumber: row.house_number || "",
      streetName: row.street_name || "",
      streetType: row.street_type || "",
      suburb: row.locality || "",
      postcode: row.postcode || "",
      state: row.state || "NSW",
      subpremise: row.subpremise || "",
    },
    breakdown: {
      matchLevel,
      ...extras,
    },
  };
}

function dedupeByPid(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    const id = r.address_detail_pid || `${r.latitude},${r.longitude},${r.house_number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(r);
  }
  return out;
}

/**
 * @param {import('./store.js').GnafStore} store
 * @param {object} parsed ParsedAddress-like
 * @param {{ limit?: number }} [opts]
 */
export function lookupGnaf(store, parsed, opts = {}) {
  const limit = opts.limit || 8;
  const keys = toLookupKeys(parsed);

  if (!store?.isReady?.()) {
    return {
      ready: false,
      status: "not_ready",
      provider: "gnaf",
      candidates: [],
      best: null,
      keys,
      message: "G-NAF index not loaded. Run scripts/import-gnaf-nsw.",
    };
  }

  if (!keys.streetNameKey && !keys.houseNumber) {
    return {
      ready: true,
      status: "not_found",
      provider: "gnaf",
      candidates: [],
      best: null,
      keys,
      message: "Insufficient address parts for G-NAF lookup",
    };
  }

  const candidates = [];

  // 1. postcode + suburb + street + house exact
  if (keys.postcode && keys.localityKey && keys.streetNameKey && keys.houseNumber) {
    const rows = store.findExact({
      postcode: keys.postcode,
      localityKey: keys.localityKey,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    for (const row of dedupeByPid(rows)) {
      candidates.push(rowToCandidate(row, MATCH_LEVEL.EXACT, { tier: 1 }));
    }
  }

  // 2. postcode + normalized street + house (suburb optional / soft)
  if (candidates.length === 0 && keys.postcode && keys.streetNameKey && keys.houseNumber) {
    const rows = store.findByPostcodeStreet({
      postcode: keys.postcode,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    for (const row of dedupeByPid(rows)) {
      const locOk = !keys.localityKey || localityNormKey(row.locality) === keys.localityKey;
      candidates.push(
        rowToCandidate(row, MATCH_LEVEL.POSTCODE_STREET, {
          tier: 2,
          localityMatched: locOk,
        })
      );
    }
  }

  // 3. suburb + normalized street + house
  if (candidates.length === 0 && keys.localityKey && keys.streetNameKey && keys.houseNumber) {
    const rows = store.findByLocalityStreet({
      localityKey: keys.localityKey,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    for (const row of dedupeByPid(rows)) {
      const pcOk = !keys.postcode || String(row.postcode || "") === keys.postcode;
      candidates.push(
        rowToCandidate(row, MATCH_LEVEL.SUBURB_STREET, {
          tier: 3,
          postcodeMatched: pcOk,
        })
      );
    }
  }

  // 4. fuzzy street-name (prefix / contains) within suburb or postcode
  if (candidates.length === 0 && keys.streetNameKey && keys.streetNameKey.length >= 4) {
    const rows = store.findFuzzyStreet({
      streetNameKey: keys.streetNameKey,
      localityKey: keys.localityKey,
      postcode: keys.postcode,
      houseNumber: keys.houseNumber,
      limit: limit * 2,
    });
    for (const row of dedupeByPid(rows)) {
      let scoreAdj = 0;
      if (keys.houseNumber && normalizeHouseNumber(row.house_number) === keys.houseNumber) {
        scoreAdj += 10;
      }
      if (keys.postcode && String(row.postcode || "") === keys.postcode) scoreAdj += 8;
      if (keys.localityKey && localityNormKey(row.locality) === keys.localityKey) scoreAdj += 8;
      const c = rowToCandidate(row, MATCH_LEVEL.FUZZY, { tier: 4, scoreAdj });
      c.score = Math.min(88, c.score + scoreAdj);
      candidates.push(c);
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, limit);

  let status = "not_found";
  if (top.length === 0) status = "not_found";
  else if (top.length >= 2 && top[0].score - top[1].score < 8 && top[1].score >= 80) {
    status = "ambiguous";
  } else status = "ok";

  return {
    ready: true,
    status,
    provider: "gnaf",
    candidates: top,
    best: top[0] || null,
    keys,
    message:
      status === "not_found"
        ? "No G-NAF match"
        : status === "ambiguous"
          ? "Multiple G-NAF candidates"
          : "G-NAF match",
  };
}

export function scoreGnafAgainstParsed(candidate, parsed) {
  const keys = toLookupKeys(parsed);
  const addr = candidate?.address || {};
  const breakdown = { ...(candidate?.breakdown || {}) };
  let score = candidate?.score ?? 0;

  if (keys.postcode && addr.postcode) {
    if (keys.postcode === String(addr.postcode)) {
      breakdown.postcode = 40;
    } else {
      breakdown.postcodeMismatch = -40;
      score = Math.min(score, 60);
    }
  }
  if (keys.localityKey && addr.suburb) {
    if (localityNormKey(addr.suburb) === keys.localityKey) breakdown.suburb = 25;
    else {
      breakdown.suburbMismatch = -50;
      score = Math.min(score, 55);
    }
  }
  if (keys.streetNameKey && streetNameNormKey(addr.streetName) === keys.streetNameKey) {
    breakdown.street = 20;
  }
  if (keys.houseNumber && normalizeHouseNumber(addr.houseNumber) === keys.houseNumber) {
    breakdown.house = 15;
  } else if (keys.houseNumber && addr.houseNumber) {
    breakdown.houseMismatch = -30;
    score = Math.min(score, 50);
  }

  return { score, breakdown };
}
