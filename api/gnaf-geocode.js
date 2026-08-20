import { json, optionsResponse } from "./_lib/http.js";
import { getGnafStore } from "./_lib/gnaf/store.js";
import { lookupGnaf } from "./_lib/gnaf/lookup.js";

/**
 * Server G-NAF geocode lookup.
 * GET  /api/gnaf-geocode?houseNumber=&streetName=&streetType=&suburb=&postcode=
 * POST /api/gnaf-geocode  { ParsedAddress fields }
 * GET  /api/gnaf-geocode?stats=1
 */
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

    let parsed = {};
    if (request.method === "POST") {
      parsed = await request.json().catch(() => ({}));
    } else if (request.method === "GET") {
      parsed = {
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

    const result = lookupGnaf(store, parsed, {
      limit: Number(url.searchParams.get("limit") || parsed.limit || 8),
    });

    return json({
      ok: true,
      ...result,
      store: store.stats(),
    });
  } catch (err) {
    return json({ ok: false, error: err.message || "G-NAF lookup failed" }, 500);
  }
}
