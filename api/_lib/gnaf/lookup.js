/**
 * G-NAF address lookup with matching priority:
 * 1. postcode + suburb + street + house number exact
 * 2. postcode + normalized street + house number
 * 3. suburb + normalized street + house number
 * 4. fuzzy street-name candidate (only after exact tiers fail; scoped to suburb/postcode)
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

/** Process-local cache: normalized lookup key → result (without timings). */
const _resultCache = new Map();
const CACHE_MAX = 4000;

function cacheKeyFromParsed(parsed) {
  const keys = toLookupKeys(parsed);
  return [
    keys.postcode || "",
    keys.localityKey || "",
    keys.streetNameKey || "",
    keys.streetType || "",
    keys.houseNumber || "",
  ].join("|");
}

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

function emptyResult(keys, status, message, timings) {
  return {
    ready: true,
    status,
    provider: "gnaf",
    candidates: [],
    best: null,
    keys,
    message,
    timings,
    cacheHit: false,
  };
}

/**
 * @param {import('./store.js').SqliteGnafStore|import('./store.js').JsonlGnafStore|import('./store.js').EmptyGnafStore} store
 * @param {object} parsed ParsedAddress-like
 * @param {{ limit?: number, skipCache?: boolean }} [opts]
 */
export function lookupGnaf(store, parsed, opts = {}) {
  const limit = opts.limit || 8;
  const tAll = performance.now();
  const timings = {
    normalizeMs: 0,
    exactMs: 0,
    postcodeStreetMs: 0,
    suburbStreetMs: 0,
    fuzzyMs: 0,
    totalMs: 0,
    fuzzyRan: false,
    cacheHit: false,
  };

  const tNorm = performance.now();
  const keys = toLookupKeys(parsed);
  timings.normalizeMs = +(performance.now() - tNorm).toFixed(3);

  if (!store?.isReady?.()) {
    timings.totalMs = +(performance.now() - tAll).toFixed(3);
    return {
      ready: false,
      status: "not_ready",
      provider: "gnaf",
      candidates: [],
      best: null,
      keys,
      message: "G-NAF index not loaded. Run scripts/import-gnaf-nsw.",
      timings,
      cacheHit: false,
    };
  }

  if (!keys.streetNameKey && !keys.houseNumber) {
    timings.totalMs = +(performance.now() - tAll).toFixed(3);
    return emptyResult(keys, "not_found", "Insufficient address parts for G-NAF lookup", timings);
  }

  const ck = cacheKeyFromParsed(parsed);
  if (!opts.skipCache && _resultCache.has(ck)) {
    const cached = _resultCache.get(ck);
    timings.cacheHit = true;
    timings.totalMs = +(performance.now() - tAll).toFixed(3);
    return {
      ...cached,
      timings: { ...timings, ...(cached.timings || {}), cacheHit: true, totalMs: timings.totalMs },
      cacheHit: true,
    };
  }

  const candidates = [];

  // 1. postcode + suburb + street + house exact
  if (keys.postcode && keys.localityKey && keys.streetNameKey && keys.houseNumber) {
    const t = performance.now();
    const rows = store.findExact({
      postcode: keys.postcode,
      localityKey: keys.localityKey,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    timings.exactMs = +(performance.now() - t).toFixed(3);
    for (const row of dedupeByPid(rows)) {
      candidates.push(rowToCandidate(row, MATCH_LEVEL.EXACT, { tier: 1 }));
    }
  }

  // 2. postcode + normalized street + house
  if (candidates.length === 0 && keys.postcode && keys.streetNameKey && keys.houseNumber) {
    const t = performance.now();
    const rows = store.findByPostcodeStreet({
      postcode: keys.postcode,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    timings.postcodeStreetMs = +(performance.now() - t).toFixed(3);
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
    const t = performance.now();
    const rows = store.findByLocalityStreet({
      localityKey: keys.localityKey,
      streetNameKey: keys.streetNameKey,
      streetType: keys.streetType,
      houseNumber: keys.houseNumber,
    });
    timings.suburbStreetMs = +(performance.now() - t).toFixed(3);
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

  // 4. fuzzy — only after exact tiers miss; require suburb or postcode scope
  if (
    candidates.length === 0 &&
    keys.streetNameKey &&
    keys.streetNameKey.length >= 4 &&
    (keys.localityKey || keys.postcode)
  ) {
    timings.fuzzyRan = true;
    const t = performance.now();
    const rows = store.findFuzzyStreet({
      streetNameKey: keys.streetNameKey,
      localityKey: keys.localityKey,
      postcode: keys.postcode,
      houseNumber: keys.houseNumber,
      limit: limit * 2,
    });
    timings.fuzzyMs = +(performance.now() - t).toFixed(3);
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

  // Same building / unit variants share lat/lng — not truly ambiguous for delivery.
  function samePoint(a, b) {
    if (!a || !b) return false;
    return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
  }
  function sameStreetAddress(a, b) {
    if (!a?.address || !b?.address) return false;
    return (
      String(a.address.postcode || "") === String(b.address.postcode || "") &&
      streetNameNormKey(a.address.streetName) === streetNameNormKey(b.address.streetName) &&
      normalizeHouseNumber(a.address.houseNumber) === normalizeHouseNumber(b.address.houseNumber)
    );
  }
  const uniquePoints = [];
  for (const c of top) {
    if (!uniquePoints.some((u) => samePoint(u, c) || sameStreetAddress(u, c))) {
      uniquePoints.push(c);
    }
  }
  // Prefer primary (no subpremise) among same-street matches
  if (top.length > 1 && uniquePoints.length === 1) {
    top.sort((a, b) => {
      const as = a.address?.subpremise ? 1 : 0;
      const bs = b.address?.subpremise ? 1 : 0;
      if (as !== bs) return as - bs;
      return b.score - a.score;
    });
  }

  let status = "not_found";
  if (top.length === 0) status = "not_found";
  else if (
    uniquePoints.length >= 2 &&
    uniquePoints[0].score - uniquePoints[1].score < 8 &&
    uniquePoints[1].score >= 80
  ) {
    status = "ambiguous";
  } else status = "ok";

  timings.totalMs = +(performance.now() - tAll).toFixed(3);

  const result = {
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
    timings,
    cacheHit: false,
  };

  if (!opts.skipCache) {
    if (_resultCache.size >= CACHE_MAX) {
      const first = _resultCache.keys().next().value;
      _resultCache.delete(first);
    }
    const { timings: _t, ...rest } = result;
    _resultCache.set(ck, rest);
  }

  return result;
}

/**
 * Batch lookup — one store open, prepared statements reused, shared cache.
 * @param {object} store
 * @param {object[]} parsedList
 * @param {{ limit?: number }} [opts]
 */
export function lookupGnafBatch(store, parsedList, opts = {}) {
  const t0 = performance.now();
  const results = [];
  const summary = {
    total: parsedList.length,
    exact: 0,
    postcodeStreet: 0,
    suburbStreet: 0,
    fuzzy: 0,
    notFound: 0,
    ambiguous: 0,
    notReady: 0,
    cacheHits: 0,
    fuzzyRan: 0,
    timings: {
      normalizeMs: 0,
      exactMs: 0,
      postcodeStreetMs: 0,
      suburbStreetMs: 0,
      fuzzyMs: 0,
      totalMs: 0,
    },
  };

  for (const parsed of parsedList) {
    const r = lookupGnaf(store, parsed, opts);
    results.push(r);
    if (r.cacheHit) summary.cacheHits += 1;
    if (r.timings?.fuzzyRan) summary.fuzzyRan += 1;
    if (r.timings) {
      summary.timings.normalizeMs += r.timings.normalizeMs || 0;
      summary.timings.exactMs += r.timings.exactMs || 0;
      summary.timings.postcodeStreetMs += r.timings.postcodeStreetMs || 0;
      summary.timings.suburbStreetMs += r.timings.suburbStreetMs || 0;
      summary.timings.fuzzyMs += r.timings.fuzzyMs || 0;
    }
    if (!r.ready) {
      summary.notReady += 1;
      continue;
    }
    if (r.status === "ambiguous") summary.ambiguous += 1;
    else if (r.status === "not_found" || !r.best) summary.notFound += 1;
    else if (r.best.matchLevel === MATCH_LEVEL.EXACT) summary.exact += 1;
    else if (r.best.matchLevel === MATCH_LEVEL.POSTCODE_STREET) summary.postcodeStreet += 1;
    else if (r.best.matchLevel === MATCH_LEVEL.SUBURB_STREET) summary.suburbStreet += 1;
    else if (r.best.matchLevel === MATCH_LEVEL.FUZZY) summary.fuzzy += 1;
  }

  summary.timings.totalMs = +(performance.now() - t0).toFixed(1);
  for (const k of ["normalizeMs", "exactMs", "postcodeStreetMs", "suburbStreetMs", "fuzzyMs"]) {
    summary.timings[k] = +summary.timings[k].toFixed(1);
  }

  return { results, summary };
}

export function clearGnafLookupCache() {
  _resultCache.clear();
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
