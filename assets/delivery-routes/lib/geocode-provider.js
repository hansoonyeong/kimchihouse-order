/**
 * Geocoding provider abstraction.
 * Default: Sydney suburb/postcode lookup + optional Nominatim fallback.
 * Swap for GoogleGeocodeProvider later without changing callers.
 */
(function (global) {
  /** Approximate suburb / postcode centroids for Kimchi House coverage. */
  const SUBURB_COORDS = {
    hornsby: { lat: -33.7045, lng: 151.0993, postcodes: ["2077"] },
    wahroonga: { lat: -33.718, lng: 151.117, postcodes: ["2076"] },
    gordon: { lat: -33.7556, lng: 151.1514, postcodes: ["2072"] },
    chatswood: { lat: -33.7969, lng: 151.1832, postcodes: ["2067"] },
    willoughby: { lat: -33.807, lng: 151.2, postcodes: ["2068"] },
    lane cove: { lat: -33.814, lng: 151.168, postcodes: ["2066"] },
    north sydney: { lat: -33.839, lng: 151.207, postcodes: ["2060"] },
    ryde: { lat: -33.8148, lng: 151.1017, postcodes: ["2112"] },
    "eastwood": { lat: -33.79, lng: 151.082, postcodes: ["2122"] },
    "macquarie park": { lat: -33.777, lng: 151.1248, postcodes: ["2113"] },
    rhodes: { lat: -33.8292, lng: 151.0864, postcodes: ["2138"] },
    strathfield: { lat: -33.8773, lng: 151.0839, postcodes: ["2135"] },
    burwood: { lat: -33.8771, lng: 151.1038, postcodes: ["2134"] },
    "sydney": { lat: -33.8688, lng: 151.2093, postcodes: ["2000"] },
    "sydney cbd": { lat: -33.8688, lng: 151.2093, postcodes: ["2000"] },
    surry hills: { lat: -33.883, lng: 151.214, postcodes: ["2010"] },
    parramatta: { lat: -33.8151, lng: 151.0011, postcodes: ["2150"] },
    harris park: { lat: -33.822, lng: 151.008, postcodes: ["2150"] },
    bankstown: { lat: -33.9173, lng: 151.0344, postcodes: ["2200"] },
    blacktown: { lat: -33.7689, lng: 150.9054, postcodes: ["2148"] },
    bondi: { lat: -33.8915, lng: 151.2767, postcodes: ["2026"] },
    "bondi junction": { lat: -33.891, lng: 151.247, postcodes: ["2022"] },
    randwick: { lat: -33.913, lng: 151.241, postcodes: ["2031"] },
    "sutherland": { lat: -34.0312, lng: 151.0999, postcodes: ["2232"] },
    "caringbah": { lat: -34.043, lng: 151.122, postcodes: ["2229"] },
    "hurstville": { lat: -33.967, lng: 151.102, postcodes: ["2220"] },
    "epping": { lat: -33.772, lng: 151.082, postcodes: ["2121"] },
    "ashfield": { lat: -33.889, lng: 151.126, postcodes: ["2131"] },
    "lidcombe": { lat: -33.864, lng: 151.045, postcodes: ["2141"] },
  };

  const POSTCODE_TO_SUBURB = {};
  Object.entries(SUBURB_COORDS).forEach(([name, info]) => {
    (info.postcodes || []).forEach((pc) => {
      if (!POSTCODE_TO_SUBURB[pc]) POSTCODE_TO_SUBURB[pc] = name;
    });
  });

  function normalizeSuburb(suburb) {
    return String(suburb || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
  }

  function jitter(seed) {
    const n = String(seed || "x")
      .split("")
      .reduce((a, c) => a + c.charCodeAt(0), 0);
    return ((n % 17) - 8) * 0.0012;
  }

  function lookupLocal(order) {
    const suburbKey = normalizeSuburb(order.suburb);
    let hit = SUBURB_COORDS[suburbKey];
    if (!hit && order.postcode) {
      const byPc = POSTCODE_TO_SUBURB[String(order.postcode).trim()];
      if (byPc) hit = SUBURB_COORDS[byPc];
    }
    if (!hit) return null;
    const j = jitter(order.id || order.address || suburbKey);
    return {
      lat: hit.lat + j,
      lng: hit.lng + j * 0.8,
      source: "suburb-lookup",
      confidence: suburbKey && SUBURB_COORDS[suburbKey] ? 0.85 : 0.65,
    };
  }

  async function nominatimGeocode(query) {
    const url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=au&q=" +
      encodeURIComponent(query);
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error("Nominatim 요청 실패");
    const data = await res.json();
    if (!data?.length) return null;
    return {
      lat: Number(data[0].lat),
      lng: Number(data[0].lon),
      source: "nominatim",
      confidence: 0.75,
    };
  }

  class LocalGeocodeProvider {
    constructor(opts = {}) {
      this.useNominatim = opts.useNominatim !== false;
      this._queue = Promise.resolve();
    }

    async geocode(order) {
      if (order.lat != null && order.lng != null) {
        return {
          lat: Number(order.lat),
          lng: Number(order.lng),
          source: "provided",
          confidence: 1,
        };
      }
      const local = lookupLocal(order);
      if (local && local.confidence >= 0.8) return local;

      if (this.useNominatim) {
        const parts = [order.address, order.suburb, order.postcode, "NSW", "Australia"]
          .filter(Boolean)
          .join(", ");
        if (parts.length > 8) {
          try {
            const remote = await this._throttled(() => nominatimGeocode(parts));
            if (remote) return remote;
          } catch (_) {
            /* fall through */
          }
        }
      }
      return local;
    }

    _throttled(fn) {
      this._queue = this._queue
        .then(() => new Promise((r) => setTimeout(r, 1100)))
        .then(fn)
        .catch(() => null);
      return this._queue;
    }
  }

  global.KHGeocode = {
    LocalGeocodeProvider,
    SUBURB_COORDS,
    lookupLocal,
  };
})(typeof window !== "undefined" ? window : globalThis);
