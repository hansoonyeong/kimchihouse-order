import { json, optionsResponse } from "./_lib/http.js";
import { getGnafStore } from "./_lib/gnaf/store.js";
import { lookupGnaf, lookupGnafBatch } from "./_lib/gnaf/lookup.js";

/**
 * Server G-NAF geocode lookup.
 * GET  /api/gnaf-geocode?houseNumber=&streetName=&streetType=&suburb=&postcode=
 * POST /api/gnaf-geocode  { ParsedAddress fields }
 * POST /api/gnaf-geocode  { addresses: [ ParsedAddress, ... ] }  → batch
 * GET  /api/gnaf-geocode?stats=1
 */
function parseSingle(parsed) {
  return {
    houseNumber: parsed.houseNumber || "",
    streetName: parsed.streetName || "",
    streetType: parsed.streetType || "",
    suburb: parsed.suburb || parsed.locality || "",
    postcode: parsed.postcode || "",
    state: parsed.state || "NSW",
    unit: parsed.unit || parsed.unitOrShop || "",
    subpremise: parsed.subpremise || parsed.unit || "",
    id: parsed.id,
  };
}

export default async function handler(request) {
  if (request.method === "OPTIONS") return optionsResponse();

  try {
    const url = new URL(request.url);
    const store = await getGnafStore();

    if (request.method === "GET" && url.searchParams.get("stats") === "1") {
      return json({
        ok: true,
        ready: store.isReady(),
        ...store.stats(),
      });
    }

    let body = {};
    if (request.method === "POST") {
      body = await request.json().catch(() => ({}));
    } else if (request.method === "GET") {
      body = {
        houseNumber: url.searchParams.get("houseNumber") || "",
        streetName: url.searchParams.get("streetName") || "",
        streetType: url.searchParams.get("streetType") || "",
        suburb: url.searchParams.get("suburb") || url.searchParams.get("locality") || "",
        postcode: url.searchParams.get("postcode") || "",
        state: url.searchParams.get("state") || "NSW",
        unit: url.searchParams.get("unit") || url.searchParams.get("subpremise") || "",
        subpremise: url.searchParams.get("subpremise") || url.searchParams.get("unit") || "",
      };
    } else {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const limit = Number(url.searchParams.get("limit") || body.limit || 8);
    const batchList = Array.isArray(body.addresses)
      ? body.addresses
      : Array.isArray(body.batch)
        ? body.batch
        : null;

    if (batchList) {
      const parsedList = batchList.map(parseSingle);
      const { results, summary } = lookupGnafBatch(store, parsedList, { limit });
      return json({
        ok: true,
        batch: true,
        results,
        summary,
        performance: {
          totalAddresses: summary.total,
          gnafExact: summary.exact + summary.postcodeStreet + summary.suburbStreet,
          gnafExactStrict: summary.exact,
          gnafPostcodeStreet: summary.postcodeStreet,
          gnafSuburbStreet: summary.suburbStreet,
          gnafFuzzy: summary.fuzzy,
          gnafFuzzyRan: summary.fuzzyRan,
          notFound: summary.notFound,
          ambiguous: summary.ambiguous,
          cacheHits: summary.cacheHits,
          processingTimeSeconds: +(summary.timings.totalMs / 1000).toFixed(3),
          timings: summary.timings,
        },
        store: store.stats(),
      });
    }

    const parsed = parseSingle(body);
    const result = lookupGnaf(store, parsed, { limit });

    return json({
      ok: true,
      ...result,
      store: store.stats(),
    });
  } catch (err) {
    return json({ ok: false, error: err.message || "G-NAF lookup failed" }, 500);
  }
}
