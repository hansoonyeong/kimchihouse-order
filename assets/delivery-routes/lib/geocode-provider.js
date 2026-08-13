/**
 * Australian structured geocoding pipeline (Nominatim).
 * Free-form q= is never mixed with structured params.
 */
(function (global) {
  const CACHE_KEY = "kh-geocode-cache-v4-structured";
  const DEBUG_KEY = "kh-geocode-debug";

  const VerificationStatus = {
    VERIFIED: "verified",
    PARTIAL_MATCH: "partial_match",
    NOT_FOUND: "not_found",
    INVALID: "invalid",
    MANUAL_OVERRIDE: "manual_override",
  };

  const STATUS_LABELS = {
    verified: "번지까지 확인됨",
    partial_match: "도로는 확인됐으나 번지 확인 필요",
    not_found: "주소 검색 결과 없음",
    invalid: "주소 형식이 올바르지 않음",
    manual_override: "수동으로 위치 확정",
    suburb_only: "Suburb만 확인됨",
  };

  function isDebugEnabled() {
    try {
      if (global.KH_GEOCODE_DEBUG === true) return true;
      if (typeof localStorage !== "undefined" && localStorage.getItem(DEBUG_KEY) === "1")
        return true;
      if (typeof location !== "undefined") {
        const p = new URLSearchParams(location.search);
        if (p.get("debug") === "1" || p.get("geocodeDebug") === "1") return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  function setDebugEnabled(on) {
    try {
      if (typeof localStorage !== "undefined") {
        if (on) localStorage.setItem(DEBUG_KEY, "1");
        else localStorage.removeItem(DEBUG_KEY);
      }
      global.KH_GEOCODE_DEBUG = !!on;
    } catch (_) {
      /* ignore */
    }
  }

  const debugLog = [];
  function pushDebug(entry) {
    debugLog.push({ ...entry, at: new Date().toISOString() });
    if (debugLog.length > 200) debugLog.shift();
    if (isDebugEnabled()) {
      console.groupCollapsed(
        `[KH Geocode] ${entry.phase || "step"} · ${entry.originalAddress || ""}`
      );
      console.log(entry);
      console.groupEnd();
    }
    try {
      global.dispatchEvent?.(
        new CustomEvent("kh-geocode-debug", { detail: entry })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function loadCache() {
    try {
      if (typeof localStorage === "undefined") return global.__khGeoCache || {};
      return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  function saveCache(cache) {
    try {
      if (typeof localStorage === "undefined") {
        global.__khGeoCache = cache;
        return;
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      /* quota */
    }
  }

  function cacheGet(normalizedKey) {
    const cache = loadCache();
    return cache[String(normalizedKey).toLowerCase()] || null;
  }

  function cacheSet(normalizedKey, value) {
    const cache = loadCache();
    cache[String(normalizedKey).toLowerCase()] = { ...value, cachedAt: Date.now() };
    const keys = Object.keys(cache);
    if (keys.length > 1500) {
      keys
        .sort((a, b) => (cache[a].cachedAt || 0) - (cache[b].cachedAt || 0))
        .slice(0, keys.length - 1000)
        .forEach((k) => delete cache[k]);
    }
    saveCache(cache);
  }

  function normStr(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function streetNameMatch(candidateRoad, streetName, streetType) {
    const road = normStr(candidateRoad);
    if (!road) return false;
    const name = normStr(streetName);
    const type = normStr(streetType);
    if (name && road.includes(name)) return true;
    if (name && type && road.includes(name + type)) return true;
    return false;
  }

  function suburbOf(addr) {
    return (
      addr.suburb ||
      addr.city ||
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.city_district ||
      ""
    );
  }

  function scoreCandidate(hit, parsed) {
    const addr = hit.address || {};
    let score = 0;
    const breakdown = {};

    const pc = String(addr.postcode || "").trim();
    if (parsed.postcode && pc && pc === parsed.postcode) {
      score += 40;
      breakdown.postcode = 40;
    }

    const sub = suburbOf(addr);
    if (parsed.suburb && sub && normStr(sub) === normStr(parsed.suburb)) {
      score += 30;
      breakdown.suburb = 30;
    }

    const road = addr.road || addr.pedestrian || addr.footway || "";
    if (streetNameMatch(road, parsed.streetName, parsed.streetType)) {
      score += 20;
      breakdown.road = 20;
    }

    const hn = String(addr.house_number || "").trim();
    if (parsed.houseNumber && hn) {
      const a = normStr(parsed.houseNumber);
      const b = normStr(hn);
      if (a === b || b.startsWith(a) || a.startsWith(b)) {
        score += 10;
        breakdown.houseNumber = 10;
      }
    }

    return { score, breakdown };
  }

  function hasStreetLevel(hit) {
    const addr = hit.address || {};
    const cls = String(hit.class || "");
    const type = String(hit.type || "");
    if (addr.house_number) return true;
    if (addr.road || addr.pedestrian || addr.footway) return true;
    if (cls === "highway" || cls === "building") return true;
    if (cls === "place" && ["house", "houses"].includes(type)) return true;
    return false;
  }

  function isSuburbCentroid(hit) {
    const addr = hit.address || {};
    if (addr.house_number || addr.road) return false;
    const cls = String(hit.class || "");
    const type = String(hit.type || "");
    if (cls === "boundary") return true;
    if (
      cls === "place" &&
      ["suburb", "town", "city", "village", "municipality", "county", "state", "postcode"].includes(
        type
      )
    ) {
      return true;
    }
    return false;
  }

  function formatSuggested(parsed, hit) {
    const addr = hit?.address || {};
    const hn = addr.house_number || parsed.houseNumber || "";
    const road = addr.road || [parsed.streetName, parsed.streetType].filter(Boolean).join(" ");
    const sub = suburbOf(addr) || parsed.suburb;
    const pc = addr.postcode || parsed.postcode;
    return cleanJoin([
      cleanJoin([hn, road], " "),
      sub,
      pc ? `NSW ${pc}` : "NSW",
    ]);
  }

  function cleanJoin(parts, sep = ", ") {
    return parts.filter(Boolean).join(sep).replace(/\s+/g, " ").trim();
  }

  class NominatimStructuredProvider {
    constructor({ userAgent } = {}) {
      this._queue = Promise.resolve();
      this.userAgent =
        userAgent ||
        "KimchiHouseDeliveryRoutes/1.0 (https://kimchihouse-order.vercel.app; delivery-route-planner)";
    }

    /** Structured search only — never pass q= with these params. */
    async searchStructured(params) {
      const sp = new URLSearchParams();
      sp.set("format", "json");
      sp.set("addressdetails", "1");
      sp.set("limit", String(params.limit || 5));
      sp.set("countrycodes", "au");
      if (params.street) sp.set("street", params.street);
      if (params.city) sp.set("city", params.city);
      if (params.state) sp.set("state", params.state);
      if (params.postalcode) sp.set("postalcode", params.postalcode);
      if (params.country) sp.set("country", params.country);

      const url = "https://nominatim.openstreetmap.org/search?" + sp.toString();
      return this._throttled(async () => {
        const headers = {
          Accept: "application/json",
          "Accept-Language": "en-AU",
        };
        // Browsers forbid custom User-Agent; non-browser runtimes must identify per OSM policy.
        const inBrowser = typeof document !== "undefined";
        if (!inBrowser) {
          headers["User-Agent"] = this.userAgent;
        }
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error("Nominatim 요청 실패 (" + res.status + ")");
        const data = await res.json();
        return Array.isArray(data) ? data : [];
      });
    }

    _throttled(fn) {
      const run = this._queue
        .then(() => new Promise((r) => setTimeout(r, 1100)))
        .then(fn);
      this._queue = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    }
  }

  function buildFallbackSteps(parsed) {
    const steps = [];
    const base = {
      city: parsed.suburb || undefined,
      state: "NSW",
      country: "Australia",
      limit: 5,
    };

    // A: structured full
    if (parsed.geocodeStreet && parsed.suburb) {
      steps.push({
        id: "A",
        label: "structured full",
        autoApprove: true,
        params: {
          ...base,
          street: parsed.geocodeStreet,
          postalcode: parsed.postcode || undefined,
        },
      });
    }

    // B: house + street + suburb + state + postcode
    if (parsed.houseNumber && parsed.streetName && parsed.streetType && parsed.suburb && parsed.postcode) {
      const street = `${parsed.houseNumber} ${parsed.streetName} ${parsed.streetType}`;
      steps.push({
        id: "B",
        label: "house+street+suburb+postcode",
        autoApprove: true,
        params: { ...base, street, postalcode: parsed.postcode },
      });
    }

    // C: house + street + suburb + NSW (no postcode)
    if (parsed.houseNumber && parsed.streetName && parsed.streetType && parsed.suburb) {
      const street = `${parsed.houseNumber} ${parsed.streetName} ${parsed.streetType}`;
      steps.push({
        id: "C",
        label: "house+street+suburb+NSW",
        autoApprove: true,
        params: {
          street,
          city: parsed.suburb,
          state: "NSW",
          country: "Australia",
          limit: 5,
        },
      });
    }

    // D: street name only + suburb + postcode — reference only
    if (parsed.streetName && parsed.streetType && parsed.suburb) {
      steps.push({
        id: "D",
        label: "street+suburb+postcode (reference)",
        autoApprove: false,
        params: {
          street: `${parsed.streetName} ${parsed.streetType}`,
          city: parsed.suburb,
          state: "NSW",
          postalcode: parsed.postcode || undefined,
          country: "Australia",
          limit: 5,
        },
      });
    }

    // de-dupe identical param sets
    const seen = new Set();
    return steps.filter((s) => {
      const key = JSON.stringify(s.params);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pickBest(hits, parsed) {
    const scored = (hits || []).map((hit) => {
      const { score, breakdown } = scoreCandidate(hit, parsed);
      return {
        hit,
        score,
        breakdown,
        streetLevel: hasStreetLevel(hit),
        suburbOnly: isSuburbCentroid(hit),
        displayName: hit.display_name || "",
        lat: Number(hit.lat),
        lng: Number(hit.lon),
      };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  function classifyResult(best, parsed, { fromReferenceStep = false } = {}) {
    if (!best) {
      return {
        verificationStatus: VerificationStatus.NOT_FOUND,
        reviewReason: STATUS_LABELS.not_found,
        approve: false,
      };
    }

    if (best.suburbOnly || !best.streetLevel) {
      return {
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.suburb_only,
        approve: false,
        suggestedLabel: formatSuggested(parsed, best.hit),
      };
    }

    const hnMatched = (best.breakdown.houseNumber || 0) > 0;
    const roadMatched = (best.breakdown.road || 0) > 0;

    if (fromReferenceStep) {
      return {
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: hnMatched
          ? STATUS_LABELS.partial_match
          : roadMatched
            ? STATUS_LABELS.partial_match
            : STATUS_LABELS.suburb_only,
        approve: false,
        suggestedLabel: formatSuggested(parsed, best.hit),
      };
    }

    // Auto-approve only when street-level and meaningful score
    if (roadMatched && hnMatched && best.score >= 60) {
      return {
        verificationStatus: VerificationStatus.VERIFIED,
        reviewReason: STATUS_LABELS.verified,
        approve: true,
      };
    }

    if (roadMatched && hnMatched && best.score >= 40) {
      return {
        verificationStatus: VerificationStatus.VERIFIED,
        reviewReason: STATUS_LABELS.verified,
        approve: true,
      };
    }

    if (roadMatched && !hnMatched) {
      return {
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.partial_match,
        approve: false,
        suggestedLabel: formatSuggested(parsed, best.hit),
      };
    }

    if (roadMatched && hnMatched) {
      return {
        verificationStatus: VerificationStatus.VERIFIED,
        reviewReason: STATUS_LABELS.verified,
        approve: true,
      };
    }

    return {
      verificationStatus: VerificationStatus.PARTIAL_MATCH,
      reviewReason: STATUS_LABELS.suburb_only,
      approve: false,
      suggestedLabel: formatSuggested(parsed, best.hit),
    };
  }

  class PipelineGeocodeService {
    constructor(provider) {
      this.provider = provider || new NominatimStructuredProvider();
    }

    async geocodeOrder(order, { force = false } = {}) {
      const N = global.KHAddressNormalize;
      if (!N?.parseAustralianAddress) throw new Error("KHAddressNormalize missing");

      const original = order.originalAddress || order.address || "";
      // Never alter original delivery address
      order.originalAddress = original;
      order.address = original;

      const parsed = N.parseAustralianAddress({
        address: original,
        suburb: order.suburb || "",
        postcode: order.postcode || "",
      });

      order.normalizedAddress = parsed.normalizedAddress;
      order.unitOrShop = parsed.unit || parsed.unitOrShop || "";
      order.parsedAddress = {
        unit: parsed.unit,
        houseNumber: parsed.houseNumber,
        streetName: parsed.streetName,
        streetType: parsed.streetType,
        street: parsed.street,
        suburb: parsed.suburb,
        state: parsed.state,
        postcode: parsed.postcode,
        country: parsed.country,
      };
      if (parsed.suburb) order.suburb = parsed.suburb;
      if (parsed.postcode) order.postcode = parsed.postcode;
      order.geocodingStatus = "running";

      const debugBase = {
        originalAddress: original,
        normalizedAddress: parsed.normalizedAddress,
        parsed,
      };

      if (!parsed.valid) {
        return this._applyFailure(order, {
          verificationStatus: VerificationStatus.INVALID,
          reviewReason: parsed.invalidReason || STATUS_LABELS.invalid,
          debug: { ...debugBase, phase: "invalid", failureReason: parsed.invalidReason },
        });
      }

      const cacheKey = parsed.normalizedAddress;
      if (!force && cacheKey) {
        const cached = cacheGet(cacheKey);
        if (cached && cached.verificationStatus === VerificationStatus.VERIFIED && cached.lat != null) {
          pushDebug({
            ...debugBase,
            phase: "cache-hit",
            final: cached,
          });
          return this._applySuccess(order, {
            lat: cached.lat,
            lng: cached.lng,
            verificationStatus: VerificationStatus.VERIFIED,
            reviewReason: STATUS_LABELS.verified,
            confidence: cached.confidence || 0.95,
            source: "cache",
            suggestedLabel: cached.suggestedLabel || parsed.normalizedAddress,
            score: cached.score,
          });
        }
      }

      const steps = buildFallbackSteps(parsed);
      let bestReference = null;
      const allCandidates = [];

      for (const step of steps) {
        let hits = [];
        try {
          hits = await this.provider.searchStructured(step.params);
        } catch (err) {
          pushDebug({
            ...debugBase,
            phase: "request-error",
            step,
            structuredQuery: step.params,
            failureReason: err.message,
          });
          continue;
        }

        const scored = pickBest(hits, parsed);
        allCandidates.push({ step: step.id, scored });

        pushDebug({
          ...debugBase,
          phase: "candidates",
          step: step.id,
          structuredQuery: step.params,
          candidateResults: scored.map((c) => ({
            displayName: c.displayName,
            score: c.score,
            breakdown: c.breakdown,
            streetLevel: c.streetLevel,
            suburbOnly: c.suburbOnly,
            lat: c.lat,
            lng: c.lng,
          })),
        });

        const best = scored[0] || null;
        if (!best) continue;

        const decision = classifyResult(best, parsed, {
          fromReferenceStep: !step.autoApprove,
        });

        if (decision.approve && step.autoApprove) {
          const result = {
            lat: best.lat,
            lng: best.lng,
            verificationStatus: decision.verificationStatus,
            reviewReason: decision.reviewReason,
            confidence: Math.min(0.99, 0.5 + best.score / 200),
            source: "nominatim-structured",
            suggestedLabel: formatSuggested(parsed, best.hit),
            score: best.score,
            queryStep: step.id,
          };
          cacheSet(cacheKey, result);
          pushDebug({
            ...debugBase,
            phase: "selected",
            structuredQuery: step.params,
            candidateScores: scored.map((c) => c.score),
            finalSelectedCoordinate: { lat: result.lat, lng: result.lng },
            final: result,
          });
          return this._applySuccess(order, result);
        }

        // Keep best street-level reference for Needs Review
        if (
          best.streetLevel &&
          (!bestReference || best.score > bestReference.score)
        ) {
          bestReference = {
            ...best,
            suggestedLabel: decision.suggestedLabel || formatSuggested(parsed, best.hit),
            reviewReason: decision.reviewReason,
            verificationStatus: decision.verificationStatus,
            step: step.id,
          };
        } else if (!bestReference && decision.suggestedLabel) {
          bestReference = {
            ...best,
            suggestedLabel: decision.suggestedLabel,
            reviewReason: decision.reviewReason,
            verificationStatus: decision.verificationStatus,
            step: step.id,
          };
        }
      }

      if (bestReference) {
        pushDebug({
          ...debugBase,
          phase: "needs-review",
          failureReason: bestReference.reviewReason,
          finalSelectedCoordinate: { lat: bestReference.lat, lng: bestReference.lng },
          reference: bestReference,
          allCandidates,
        });
        return this._applyFailure(order, {
          verificationStatus: bestReference.verificationStatus || VerificationStatus.PARTIAL_MATCH,
          reviewReason: bestReference.reviewReason || STATUS_LABELS.partial_match,
          suggestedLabel: bestReference.suggestedLabel,
          suggestedLat: bestReference.lat,
          suggestedLng: bestReference.lng,
          suggestedScore: bestReference.score,
        });
      }

      pushDebug({
        ...debugBase,
        phase: "not-found",
        failureReason: STATUS_LABELS.not_found,
        allCandidates,
      });
      return this._applyFailure(order, {
        verificationStatus: VerificationStatus.NOT_FOUND,
        reviewReason: STATUS_LABELS.not_found,
      });
    }

    _applySuccess(order, result) {
      order.latitude = result.lat;
      order.longitude = result.lng;
      order.lat = result.lat;
      order.lng = result.lng;
      order.verificationStatus = result.verificationStatus;
      order.geocodingStatus = "ok";
      order.status = "ok";
      order.geocodingConfidence = result.confidence || 0.9;
      order.reviewReason = null;
      order.suggestedAddress = result.suggestedLabel || order.normalizedAddress;
      order.geocodeSource = result.source || "nominatim-structured";
      order.geocodeScore = result.score;
      order.geocodeQueryUsed = result.queryStep || "A";
      return order;
    }

    _applyFailure(order, info) {
      order.latitude = null;
      order.longitude = null;
      order.lat = null;
      order.lng = null;
      order.verificationStatus = info.verificationStatus;
      order.geocodingStatus = "needs_review";
      order.status = "needs_review";
      order.geocodingConfidence = info.suggestedScore ? Math.min(0.5, info.suggestedScore / 100) : 0;
      order.reviewReason = info.reviewReason;
      order.suggestedAddress = info.suggestedLabel || order.normalizedAddress || "";
      order.suggestedLat = info.suggestedLat ?? null;
      order.suggestedLng = info.suggestedLng ?? null;
      if (info.debug) pushDebug(info.debug);
      return order;
    }

    /** User accepts suggested coordinate from Needs Review. */
    applyManualOverride(order, { lat, lng, label } = {}) {
      const useLat = lat ?? order.suggestedLat;
      const useLng = lng ?? order.suggestedLng;
      if (useLat == null || useLng == null) {
        throw new Error("추천 좌표가 없습니다");
      }
      order.latitude = useLat;
      order.longitude = useLng;
      order.lat = useLat;
      order.lng = useLng;
      order.verificationStatus = VerificationStatus.MANUAL_OVERRIDE;
      order.geocodingStatus = "ok";
      order.status = "ok";
      order.geocodingConfidence = 0.85;
      order.reviewReason = null;
      order.suggestedAddress = label || order.suggestedAddress || order.normalizedAddress;
      order.geocodeSource = "manual_override";
      if (order.normalizedAddress) {
        cacheSet(order.normalizedAddress, {
          lat: useLat,
          lng: useLng,
          verificationStatus: VerificationStatus.VERIFIED,
          confidence: 0.85,
          suggestedLabel: order.suggestedAddress,
          score: 70,
        });
      }
      return order;
    }
  }

  // Back-compat stubs
  class GeocodeProvider {
    async geocodeQuery() {
      throw new Error("Use PipelineGeocodeService.geocodeOrder / structured search");
    }
  }
  class NominatimGeocodeProvider extends NominatimStructuredProvider {}
  class PhotonGeocodeProvider extends GeocodeProvider {}
  class CompositeGeocodeProvider extends NominatimStructuredProvider {}

  global.KHGeocode = {
    GeocodeProvider,
    PhotonGeocodeProvider,
    NominatimGeocodeProvider,
    NominatimStructuredProvider,
    CompositeGeocodeProvider,
    PipelineGeocodeService,
    VerificationStatus,
    STATUS_LABELS,
    scoreCandidate,
    pickBest,
    buildFallbackSteps,
    hasStreetLevel,
    isSuburbCentroid,
    cacheGet,
    cacheSet,
    CACHE_KEY,
    isDebugEnabled,
    setDebugEnabled,
    getDebugLog: () => debugLog.slice(),
    clearDebugLog: () => {
      debugLog.length = 0;
    },
    pushDebug,
  };
})(typeof window !== "undefined" ? window : globalThis);
