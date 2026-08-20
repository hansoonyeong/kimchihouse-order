/**
 * Server-side Australian street token normalization for G-NAF matching.
 * Keep in sync with assets/delivery-routes/lib/address-normalize.js STREET_TYPES.
 */

const STREET_TYPE_MAP = new Map([
  ["parade", "PARADE"],
  ["pde", "PARADE"],
  ["road", "ROAD"],
  ["rd", "ROAD"],
  ["street", "STREET"],
  ["st", "STREET"],
  ["avenue", "AVENUE"],
  ["ave", "AVENUE"],
  ["av", "AVENUE"],
  ["drive", "DRIVE"],
  ["dr", "DRIVE"],
  ["crescent", "CRESCENT"],
  ["cres", "CRESCENT"],
  ["cr", "CRESCENT"],
  ["court", "COURT"],
  ["ct", "COURT"],
  ["place", "PLACE"],
  ["pl", "PLACE"],
  ["lane", "LANE"],
  ["ln", "LANE"],
  ["highway", "HIGHWAY"],
  ["hwy", "HIGHWAY"],
  ["terrace", "TERRACE"],
  ["tce", "TERRACE"],
  ["ter", "TERRACE"],
  ["close", "CLOSE"],
  ["cl", "CLOSE"],
  ["circuit", "CIRCUIT"],
  ["cct", "CIRCUIT"],
  ["boulevard", "BOULEVARD"],
  ["bvd", "BOULEVARD"],
  ["blvd", "BOULEVARD"],
  ["way", "WAY"],
  ["grove", "GROVE"],
  ["gr", "GROVE"],
]);

export function cleanSpaces(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normKey(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeStreetType(token) {
  const key = String(token || "")
    .replace(/\./g, "")
    .toLowerCase()
    .trim();
  return STREET_TYPE_MAP.get(key) || (key ? key.toUpperCase() : "");
}

export function normalizeStreetName(name) {
  return cleanSpaces(String(name || ""))
    .toUpperCase()
    .replace(/[^A-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeHouseNumber(hn) {
  return String(hn || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .trim();
}

export function normalizeLocality(locality) {
  return cleanSpaces(String(locality || ""))
    .toUpperCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bNSW\b/g, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/[^A-Z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function streetNameNormKey(name) {
  return normKey(normalizeStreetName(name));
}

export function localityNormKey(locality) {
  return normKey(normalizeLocality(locality));
}

/**
 * Expand ParsedAddress fields used for G-NAF lookup.
 */
export function toLookupKeys(parsed = {}) {
  return {
    houseNumber: normalizeHouseNumber(parsed.houseNumber),
    streetName: normalizeStreetName(parsed.streetName),
    streetNameKey: streetNameNormKey(parsed.streetName),
    streetType: normalizeStreetType(parsed.streetType),
    locality: normalizeLocality(parsed.suburb || parsed.locality),
    localityKey: localityNormKey(parsed.suburb || parsed.locality),
    postcode: String(parsed.postcode || "").trim(),
    state: String(parsed.state || "NSW").toUpperCase(),
    subpremise: cleanSpaces(parsed.subpremise || parsed.unit || parsed.unitOrShop || ""),
  };
}
