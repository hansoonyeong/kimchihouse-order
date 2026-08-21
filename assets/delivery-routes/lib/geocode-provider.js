/**
 * Australian structured geocoding pipeline (Nominatim).
 * Free-form q= is never mixed with structured params.
 */
(function (global) {
  const CACHE_KEY = "kh-geocode-cache-v6-stabilize";
  const DEBUG_KEY = "kh-geocode-debug";
  const SETTINGS_KEY = "kh-geocode-settings-v1";

  const DEFAULT_GEOCODE_SETTINGS = {
    autoVerifyMinScore: 90,
    partialMatchMinScore: 75,
    ambiguousGap: 10,
    weights: { postcode: 40, suburb: 25, street: 20, house: 15 },
    suburbMismatchPenalty: -50,
    postcodeMismatchPenalty: -40,
    houseMismatchPenalty: -30,
    outOfRegionPenalty: -80,
  };

  function getGeocodeSettings() {
    try {
      const raw =
        typeof localStorage !== "undefined" ? localStorage.getItem(SETTINGS_KEY) : null;
      if (!raw) return { ...DEFAULT_GEOCODE_SETTINGS, weights: { ...DEFAULT_GEOCODE_SETTINGS.weights } };
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_GEOCODE_SETTINGS,
        ...parsed,
        weights: { ...DEFAULT_GEOCODE_SETTINGS.weights, ...(parsed.weights || {}) },
      };
    } catch (_) {
      return { ...DEFAULT_GEOCODE_SETTINGS, weights: { ...DEFAULT_GEOCODE_SETTINGS.weights } };
    }
  }

  function setGeocodeSettings(partial) {
    const next = {
      ...getGeocodeSettings(),
      ...(partial || {}),
      weights: {
        ...getGeocodeSettings().weights,
        ...((partial && partial.weights) || {}),
      },
    };
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }
    } catch (_) {
      /* ignore */
    }
    return next;
  }

  const VerificationStatus = {
    VERIFIED: "verified",
    PARTIAL_MATCH: "partial_match",
    NOT_FOUND: "not_found",
    INVALID: "invalid",
    MANUAL_OVERRIDE: "manual_override",
  };

  const STATUS_LABELS = {
    verified: "자동 확인 완료",
    partial_match: "부분 일치 · 자동 반영 (낮은 신뢰도)",
    not_found: "주소 검색 결과 없음",
    invalid: "주소 형식이 올바르지 않음",
    manual_override: "수동으로 위치 확정",
    suburb_only: "Suburb만 확인됨",
    locality_mismatch: "Suburb/지역이 일치하지 않음",
    postcode_mismatch: "우편번호가 일치하지 않음",
    house_mismatch: "번지가 일치하지 않음",
    ambiguous: "후보 주소가 여러 개로 애매함",
    out_of_region: "배송 권역 밖 좌표로 매칭됨",
    no_street: "도로명이 확인되지 않음",
    house_missing: "번지 확인 필요",
    low_score: "신뢰도 부족 · 수동 확인 필요",
    gnaf_not_found: "G-NAF에 주소 없음",
    gnaf_ambiguous: "G-NAF 후보가 여러 개로 애매함",
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
      addr.town ||
      addr.village ||
      addr.municipality ||
      addr.city_district ||
      ""
    );
  }

  function localityTokens(addr) {
    return [addr.suburb, addr.town, addr.village, addr.city_district, addr.municipality, addr.hamlet, addr.city]
      .filter(Boolean)
      .map((s) => normStr(s));
  }

  /** True when candidate locality matches expected suburb (or suburb unknown). */
  function suburbMatches(parsed, addr) {
    const want = normStr(parsed.suburb);
    if (!want) return true;
    const tokens = localityTokens(addr);
    if (tokens.some((t) => t === want || t.includes(want) || want.includes(t))) return true;
    // Nominatim often labels Greater Sydney suburbs as city=Sydney; trust matching postcode.
    const city = normStr(addr.city);
    const pc = String(addr.postcode || "").trim();
    if (
      (city === "sydney" || city === "cityofsydney") &&
      parsed.postcode &&
      pc === parsed.postcode
    ) {
      return true;
    }
    return false;
  }

  /** Greater Sydney / nearby metro — reject far regional false matches (e.g. Lidcombe → south coast). */
  function inDeliveryRegion(lat, lng) {
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
    return la <= -33.35 && la >= -34.4 && ln >= 150.5 && ln <= 151.4;
  }

  function scoreCandidate(hit, parsed, settings = getGeocodeSettings()) {
    const addr = hit.address || {};
    const w = settings.weights || DEFAULT_GEOCODE_SETTINGS.weights;
    let score = 0;
    const breakdown = {};

    const pc = String(addr.postcode || "").trim();
    if (parsed.postcode && pc) {
      if (pc === parsed.postcode) {
        score += w.postcode;
        breakdown.postcode = w.postcode;
      } else {
        score += settings.postcodeMismatchPenalty;
        breakdown.postcodeMismatch = settings.postcodeMismatchPenalty;
      }
    } else if (parsed.postcode && pc === parsed.postcode) {
      score += w.postcode;
      breakdown.postcode = w.postcode;
    }

    if (parsed.suburb && suburbMatches(parsed, addr)) {
      score += w.suburb;
      breakdown.suburb = w.suburb;
    } else if (parsed.suburb && localityTokens(addr).length) {
      score += settings.suburbMismatchPenalty;
      breakdown.suburbMismatch = settings.suburbMismatchPenalty;
    }

    const road = addr.road || addr.pedestrian || addr.footway || "";
    if (streetNameMatch(road, parsed.streetName, parsed.streetType)) {
      score += w.street;
      breakdown.road = w.street;
    }

    const hn = String(addr.house_number || "").trim();
    if (parsed.houseNumber && hn) {
      const a = normStr(parsed.houseNumber);
      const b = normStr(hn);
      if (a === b || b.startsWith(a) || a.startsWith(b)) {
        score += w.house;
        breakdown.houseNumber = w.house;
      } else {
        score += settings.houseMismatchPenalty;
        breakdown.houseMismatch = settings.houseMismatchPenalty;
      }
    } else if (parsed.houseNumber && !hn) {
      // Nominatim sometimes omits house_number but includes it in display_name
      const display = String(hit.display_name || "");
      const leading = display.match(/^\s*(\d+[A-Za-z]?)\b/);
      if (leading && normStr(leading[1]) === normStr(parsed.houseNumber)) {
        score += w.house;
        breakdown.houseNumber = w.house;
        breakdown.houseFromDisplay = true;
      }
    }

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (Number.isFinite(lat) && Number.isFinite(lng) && !inDeliveryRegion(lat, lng)) {
      score += settings.outOfRegionPenalty;
      breakdown.outOfRegion = settings.outOfRegionPenalty;
    }

    return { score, breakdown, suburbMatched: suburbMatches(parsed, addr) };
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

  function isAmbiguous(scored, settings = getGeocodeSettings()) {
    if (!scored || scored.length < 2) return false;
    const a = scored[0];
    const b = scored[1];
    if (!a?.streetLevel || !b?.streetLevel) return false;
    // Clear structural winner with house match is never "ambiguous"
    if ((a.score || 0) >= 90 && (a.breakdown?.houseNumber || 0) > 0) return false;
    if ((b.score || 0) < 50) return false;

    const aAddr = a.hit?.address || {};
    const bAddr = b.hit?.address || {};
    const aHn = String(aAddr.house_number || "").trim();
    const bHn = String(bAddr.house_number || "").trim();
    const aRoad = normStr(aAddr.road || aAddr.pedestrian || "");
    const bRoad = normStr(bAddr.road || bAddr.pedestrian || "");
    // Duplicate OSM features for the same house/road → not ambiguous
    if (aHn && bHn && aHn === bHn && aRoad && aRoad === bRoad) return false;
    if (aRoad && aRoad === bRoad && !aHn && !bHn) return false;

    const gap = settings.ambiguousGap ?? 10;
    return (a.score || 0) - (b.score || 0) < gap;
  }

  /**
   * Auto-verify only at high confidence.
   * 90+ → verified (auto)
   * 75–89 → partial_match (Needs Review, candidate kept)
   * <75 → Needs Review
   * Hard blocks: postcode/suburb/house mismatch, out of region, suburb-only, ambiguous.
   * Missing postcode on input: house+street+suburb exact match may still auto-verify.
   */
  function decideAutoVerify(best, parsed, scored, settings = getGeocodeSettings()) {
    const autoMin = settings.autoVerifyMinScore ?? 90;
    const partialMin = settings.partialMatchMinScore ?? settings.lowConfidenceMinScore ?? 75;

    if (!best) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.NOT_FOUND,
        reviewReason: STATUS_LABELS.not_found,
      };
    }

    const suggestedLabel = formatSuggested(parsed, best.hit);

    if (best.breakdown?.outOfRegion) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.out_of_region,
        suggestedLabel,
      };
    }
    if (best.breakdown?.postcodeMismatch) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.postcode_mismatch,
        suggestedLabel,
      };
    }
    if (best.breakdown?.suburbMismatch) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.locality_mismatch,
        suggestedLabel,
      };
    }
    if (best.breakdown?.houseMismatch) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.house_mismatch,
        suggestedLabel,
      };
    }
    if (best.suburbOnly || !best.streetLevel) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.suburb_only,
        suggestedLabel,
      };
    }

    const hnMatched = (best.breakdown.houseNumber || 0) > 0;
    const roadMatched = (best.breakdown.road || 0) > 0;
    const suburbMatched = (best.breakdown.suburb || 0) > 0 || best.suburbMatched;
    const postcodeMatched = (best.breakdown.postcode || 0) > 0;

    if (!roadMatched) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.no_street,
        suggestedLabel,
      };
    }

    if (isAmbiguous(scored, settings)) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason: STATUS_LABELS.ambiguous,
        suggestedLabel,
      };
    }

    const availableFieldsMatched =
      roadMatched &&
      (!parsed.houseNumber || hnMatched) &&
      (!parsed.suburb || suburbMatched) &&
      (!parsed.postcode || postcodeMatched);

    const strongStructural =
      hnMatched &&
      roadMatched &&
      (!parsed.suburb || suburbMatched) &&
      (!parsed.postcode || postcodeMatched);

    // Auto verified: score ≥ 90, or complete structural match on available fields
    const scoreOk = (best.score || 0) >= autoMin;
    if ((scoreOk || strongStructural) && availableFieldsMatched && best.streetLevel) {
      if (parsed.houseNumber && !hnMatched && (best.score || 0) < autoMin) {
        // fall through to partial band
      } else if (!(parsed.houseNumber && !hnMatched)) {
        return {
          approve: true,
          lowConfidence: false,
          confirmMode: parsed.normalizedChanged ? "auto_corrected" : "auto",
          verificationStatus: VerificationStatus.VERIFIED,
          reviewReason: STATUS_LABELS.verified,
          suggestedLabel,
        };
      } else if ((best.score || 0) >= autoMin) {
        return {
          approve: true,
          lowConfidence: false,
          confirmMode: parsed.normalizedChanged ? "auto_corrected" : "auto",
          verificationStatus: VerificationStatus.VERIFIED,
          reviewReason: STATUS_LABELS.verified,
          suggestedLabel,
        };
      }
    }

    // 75–89 (or street+locality without OSM house): auto-place for ops, not Needs Review
    // Hard mismatches already returned above. OSM AU often lacks house_number → score 85.
    if (
      (best.score || 0) >= partialMin &&
      roadMatched &&
      (suburbMatched || postcodeMatched) &&
      !best.breakdown?.houseMismatch &&
      best.streetLevel
    ) {
      return {
        approve: true,
        lowConfidence: true,
        confirmMode: "partial_auto",
        verificationStatus: VerificationStatus.VERIFIED,
        reviewReason: STATUS_LABELS.partial_match,
        suggestedLabel,
      };
    }

    if ((best.score || 0) >= partialMin && roadMatched) {
      return {
        approve: false,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        reviewReason:
          parsed.houseNumber && !hnMatched
            ? STATUS_LABELS.house_missing
            : STATUS_LABELS.partial_match,
        suggestedLabel,
      };
    }

    return {
      approve: false,
      verificationStatus: VerificationStatus.PARTIAL_MATCH,
      reviewReason: STATUS_LABELS.low_score,
      suggestedLabel,
    };
  }

  function buildConfirmLog(original, parsed, best, decision) {
    const parts = [String(original || "").trim() || "(원본 없음)"];
    if (parsed?.normalizedChanged && parsed.normalizedAddress) {
      parts.push(`${parsed.normalizedAddress}로 자동 보정`);
    } else if (parsed?.normalizedAddress) {
      parts.push(parsed.normalizedAddress);
    }
    parts.push(`geocoding · score ${best?.score ?? "—"}`);
    if (decision?.approve) {
      parts.push(
        decision.confirmMode === "auto_corrected" || parsed?.normalizedChanged
          ? "보정 후 자동 확인 완료"
          : "자동 확인 완료"
      );
    } else {
      parts.push(`수동 확인 필요 (${decision?.reviewReason || "partial_match"})`);
    }
    return parts.join(" → ");
  }

  /**
   * GeocodingProvider interface (duck-typed):
   *   geocode(address: ParsedAddress): Promise<GeocodingResult>
   *
   * GeocodingResult:
   *   { provider, status, ready?, candidates[], best, message? }
   */

  class GeocodingProvider {
    async geocode(_address) {
      throw new Error("GeocodingProvider.geocode() not implemented");
    }
  }

  /**
   * Primary provider — server-side NSW G-NAF index via /api/gnaf-geocode.
   * Does not embed G-NAF data in the browser bundle.
   */
  class GnafGeocodingProvider extends GeocodingProvider {
    constructor({ endpoint } = {}) {
      super();
      this.endpoint = endpoint || "/api/gnaf-geocode";
    }

    _bodyFromParsed(parsed) {
      return {
        id: parsed.id,
        houseNumber: parsed.houseNumber || "",
        streetName: parsed.streetName || "",
        streetType: parsed.streetType || "",
        suburb: parsed.suburb || "",
        postcode: parsed.postcode || "",
        state: parsed.state || "NSW",
        unit: parsed.unit || parsed.unitOrShop || "",
        subpremise: parsed.subpremise || parsed.unit || parsed.unitOrShop || "",
        limit: 8,
      };
    }

    async geocode(parsed) {
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(this._bodyFromParsed(parsed)),
        });
        if (!res.ok) {
          return {
            provider: "gnaf",
            status: "not_ready",
            ready: false,
            candidates: [],
            best: null,
            message: `G-NAF API ${res.status}`,
          };
        }
        const data = await res.json();
        return {
          provider: "gnaf",
          status: data.status || (data.best ? "ok" : "not_found"),
          ready: data.ready !== false,
          candidates: data.candidates || [],
          best: data.best || null,
          keys: data.keys,
          message: data.message || "",
          timings: data.timings,
          store: data.store,
        };
      } catch (err) {
        return {
          provider: "gnaf",
          status: "not_ready",
          ready: false,
          candidates: [],
          best: null,
          message: err.message || "G-NAF request failed",
        };
      }
    }

    /** Batch G-NAF lookup — one HTTP round-trip for N addresses. */
    async geocodeBatch(parsedList) {
      const addresses = (parsedList || []).map((p) => this._bodyFromParsed(p));
      if (!addresses.length) {
        return { results: [], performance: null, ready: false };
      }
      try {
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ addresses, limit: 8 }),
        });
        if (!res.ok) {
          return {
            results: addresses.map(() => ({
              provider: "gnaf",
              status: "not_ready",
              ready: false,
              candidates: [],
              best: null,
              message: `G-NAF API ${res.status}`,
            })),
            performance: null,
            ready: false,
          };
        }
        const data = await res.json();
        return {
          results: (data.results || []).map((r) => ({
            provider: "gnaf",
            status: r.status || (r.best ? "ok" : "not_found"),
            ready: r.ready !== false,
            candidates: r.candidates || [],
            best: r.best || null,
            keys: r.keys,
            message: r.message || "",
            timings: r.timings,
          })),
          performance: data.performance || null,
          summary: data.summary || null,
          ready: true,
          store: data.store,
        };
      } catch (err) {
        return {
          results: addresses.map(() => ({
            provider: "gnaf",
            status: "not_ready",
            ready: false,
            candidates: [],
            best: null,
            message: err.message || "G-NAF batch failed",
          })),
          performance: null,
          ready: false,
        };
      }
    }
  }

  function decideGnafVerify(gnafResult, parsed, settings = getGeocodeSettings()) {
    const autoMin = settings.autoVerifyMinScore ?? 90;
    if (!gnafResult || gnafResult.ready === false) {
      return { action: "fallback_nominatim", reason: "gnaf_not_ready" };
    }
    if (gnafResult.status === "not_found" || !gnafResult.best) {
      return { action: "fallback_nominatim", reason: "gnaf_not_found" };
    }
    if (gnafResult.status === "ambiguous") {
      return {
        action: "needs_review",
        reason: STATUS_LABELS.gnaf_ambiguous,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        best: gnafResult.best,
      };
    }

    const best = gnafResult.best;
    const addr = best.address || {};
    const pcMismatch =
      parsed.postcode && addr.postcode && String(parsed.postcode) !== String(addr.postcode);
    const hnMismatch =
      parsed.houseNumber &&
      addr.houseNumber &&
      normStr(parsed.houseNumber) !== normStr(addr.houseNumber);
    const suburbMismatch =
      parsed.suburb &&
      addr.suburb &&
      normStr(parsed.suburb) !== normStr(addr.suburb);

    if (pcMismatch) {
      return {
        action: "needs_review",
        reason: STATUS_LABELS.postcode_mismatch,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        best,
      };
    }
    if (hnMismatch) {
      return {
        action: "needs_review",
        reason: STATUS_LABELS.house_mismatch,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        best,
      };
    }
    if (suburbMismatch && (best.matchLevel === "fuzzy" || (best.score || 0) < autoMin)) {
      return {
        action: "needs_review",
        reason: STATUS_LABELS.locality_mismatch,
        verificationStatus: VerificationStatus.PARTIAL_MATCH,
        best,
      };
    }

    const high =
      best.matchLevel === "exact" ||
      best.matchLevel === "postcode_street" ||
      best.matchLevel === "suburb_street" ||
      ((best.score || 0) >= autoMin && best.matchLevel !== "fuzzy");

    // Clear G-NAF hit → verified without calling Nominatim
    if (high && !pcMismatch && !hnMismatch) {
      return {
        action: "verify",
        lowConfidence: false,
        best,
        reason: STATUS_LABELS.verified,
      };
    }

    // Fuzzy-only soft hit: still G-NAF result — do not call Nominatim
    if (best.matchLevel === "fuzzy" && (best.score || 0) >= 80 && !pcMismatch && !hnMismatch) {
      return {
        action: "verify",
        lowConfidence: true,
        best,
        reason: STATUS_LABELS.verified,
      };
    }

    return {
      action: "needs_review",
      reason: STATUS_LABELS.low_score,
      verificationStatus: VerificationStatus.PARTIAL_MATCH,
      best,
    };
  }

  class NominatimStructuredProvider {
    constructor({ userAgent } = {}) {
      this._queue = Promise.resolve();
      this.userAgent =
        userAgent ||
        "KimchiHouseDeliveryRoutes/1.0 (https://kimchihouse-order.vercel.app; delivery-route-planner)";
    }

    async _fetchNominatim(sp) {
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
      // Prefer Greater Sydney results (soft bias; not hard-bounded)
      sp.set("viewbox", "150.55,-33.40,151.35,-34.35");
      sp.set("bounded", "0");
      return this._fetchNominatim(sp);
    }

    /** Free-form secondary search (q= only — never mixed with structured fields). */
    async searchFreeForm(query, { limit = 5 } = {}) {
      const q = String(query || "").trim();
      if (!q) return [];
      const sp = new URLSearchParams();
      sp.set("format", "json");
      sp.set("addressdetails", "1");
      sp.set("limit", String(limit));
      sp.set("countrycodes", "au");
      sp.set("q", q);
      sp.set("viewbox", "150.55,-33.40,151.35,-34.35");
      sp.set("bounded", "0");
      return this._fetchNominatim(sp);
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

  /** Fallback provider — Nominatim structured search wrapped as GeocodingProvider. */
  class NominatimGeocodingProvider extends GeocodingProvider {
    constructor(opts = {}) {
      super();
      this.inner = new NominatimStructuredProvider(opts);
    }

    async searchStructured(params) {
      return this.inner.searchStructured(params);
    }

    async searchFreeForm(query, opts) {
      return this.inner.searchFreeForm(query, opts);
    }

    async geocode(parsed) {
      const steps = buildFallbackSteps(parsed);
      const settings = getGeocodeSettings();
      let bestScored = null;
      for (const step of steps) {
        let hits = [];
        try {
          if (step.freeform) {
            hits = await this.searchFreeForm(step.query || step.params?.q, {
              limit: step.params?.limit || 5,
            });
          } else {
            hits = await this.searchStructured(step.params);
          }
        } catch {
          continue;
        }
        const scored = pickBest(hits, parsed, settings);
        if (scored[0] && (!bestScored || scored[0].score > bestScored[0].score)) {
          bestScored = scored;
        }
        if (scored[0] && scored[0].score >= (settings.autoVerifyMinScore || 90)) break;
      }
      if (!bestScored?.length) {
        return {
          provider: "nominatim",
          status: "not_found",
          ready: true,
          candidates: [],
          best: null,
        };
      }
      return {
        provider: "nominatim",
        status: "ok",
        ready: true,
        candidates: bestScored,
        best: bestScored[0],
      };
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
    const streetFull =
      parsed.geocodeStreet ||
      cleanJoin([parsed.houseNumber, parsed.streetName, parsed.streetType], " ");
    const streetNoHouse = cleanJoin([parsed.streetName, parsed.streetType], " ");

    // 1: full structured (unit kept in street when present — often fails, then fallback)
    if (parsed.unit && streetFull && parsed.suburb) {
      steps.push({
        id: "1-full-with-unit",
        label: "full structured with unit",
        autoApprove: true,
        params: {
          ...base,
          street: `${parsed.unit} / ${streetFull}`,
          postalcode: parsed.postcode || undefined,
        },
      });
    }

    // 2: unit/shop removed — primary structured full
    if (streetFull && parsed.suburb) {
      steps.push({
        id: "2-unit-removed",
        label: "unit removed full",
        autoApprove: true,
        params: {
          ...base,
          street: streetFull,
          postalcode: parsed.postcode || undefined,
        },
      });
    }

    // 3: house + street + suburb + postcode
    if (parsed.houseNumber && streetNoHouse && parsed.suburb && parsed.postcode) {
      steps.push({
        id: "3-house-suburb-pc",
        label: "house+street+suburb+postcode",
        autoApprove: true,
        params: {
          ...base,
          street: `${parsed.houseNumber} ${streetNoHouse}`,
          postalcode: parsed.postcode,
        },
      });
    }

    // 4: house + street + suburb (no postcode)
    if (parsed.houseNumber && streetNoHouse && parsed.suburb) {
      steps.push({
        id: "4-house-suburb",
        label: "house+street+suburb",
        autoApprove: true,
        params: {
          street: `${parsed.houseNumber} ${streetNoHouse}`,
          city: parsed.suburb,
          state: "NSW",
          country: "Australia",
          limit: 5,
        },
      });
    }

    // 5: street + suburb + postcode (no house)
    if (streetNoHouse && parsed.suburb) {
      steps.push({
        id: "5-street-suburb-pc",
        label: "street+suburb+postcode",
        autoApprove: true,
        params: {
          street: streetNoHouse,
          city: parsed.suburb,
          state: "NSW",
          postalcode: parsed.postcode || undefined,
          country: "Australia",
          limit: 5,
        },
      });
    }

    // Optional single free-form assist (never the only/failure path)
    if (parsed.normalizedAddress) {
      steps.push({
        id: "6-freeform-assist",
        label: "freeform assist",
        autoApprove: true,
        freeform: true,
        query: parsed.normalizedAddress,
        params: { q: parsed.normalizedAddress, limit: 5 },
      });
    }

    const seen = new Set();
    return steps.filter((s) => {
      const key = JSON.stringify(s.params);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function pickBest(hits, parsed, settings = getGeocodeSettings()) {
    const scored = (hits || []).map((hit) => {
      const { score, breakdown, suburbMatched } = scoreCandidate(hit, parsed, settings);
      return {
        hit,
        score,
        breakdown,
        suburbMatched,
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

  /** @deprecated use decideAutoVerify — kept for callers */
  function classifyResult(best, parsed, _opts = {}) {
    return decideAutoVerify(best, parsed, best ? [best] : [], getGeocodeSettings());
  }

  class PipelineGeocodeService {
    /**
     * @param {object} [opts]
     * @param {GeocodingProvider} [opts.gnaf]
     * @param {GeocodingProvider|NominatimStructuredProvider} [opts.nominatim]
     * @param {NominatimStructuredProvider} [opts.provider] legacy alias for nominatim search API
     */
    constructor(opts = {}) {
      if (opts && typeof opts.searchStructured === "function" && !opts.nominatim && !opts.gnaf) {
        // legacy: new PipelineGeocodeService(nominatimProvider)
        this.nominatim = new NominatimGeocodingProvider();
        this.nominatim.inner = opts;
        this.provider = opts;
      } else {
        this.gnaf = opts.gnaf || new GnafGeocodingProvider();
        this.nominatim =
          opts.nominatim ||
          (opts.provider ? null : new NominatimGeocodingProvider());
        if (opts.provider && !this.nominatim) {
          this.nominatim = new NominatimGeocodingProvider();
          this.nominatim.inner = opts.provider;
        }
        if (!this.nominatim) this.nominatim = new NominatimGeocodingProvider();
        this.provider = this.nominatim.inner || this.nominatim;
      }
      if (!this.gnaf) this.gnaf = new GnafGeocodingProvider();
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
      order.subpremise = parsed.subpremise || parsed.unit || "";
      order.parsedAddress = {
        unit: parsed.unit,
        subpremise: parsed.subpremise || parsed.unit,
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

      const originalNorm = String(original || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const normalizedNorm = String(parsed.normalizedAddress || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      parsed.normalizedChanged = Boolean(
        originalNorm && normalizedNorm && originalNorm !== normalizedNorm
      );
      order.geocodingStatus = "running";

      const settings = getGeocodeSettings();
      const debugBase = {
        originalAddress: original,
        normalizedAddress: parsed.normalizedAddress,
        parsed,
        settings: {
          autoVerifyMinScore: settings.autoVerifyMinScore,
          partialMatchMinScore:
            settings.partialMatchMinScore ?? settings.lowConfidenceMinScore ?? 75,
        },
      };

      if (!parsed.valid) {
        return this._applyFailure(order, {
          verificationStatus: VerificationStatus.INVALID,
          reviewReason: parsed.invalidReason || STATUS_LABELS.invalid,
          confirmMode: "needs_review",
          confirmLog: `${original} → 정규화 실패 → 수동 확인 필요`,
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
            confirmMode: "auto",
            confirmLog: `${original} → 캐시 히트 → 자동 확인 완료`,
            lowConfidence: false,
            placeId: cached.placeId || "",
            provider: cached.provider || "cache",
          });
        }
      }

      // ---------- Primary: G-NAF ----------
      let gnafResult = null;
      try {
        gnafResult = await this.gnaf.geocode(parsed);
      } catch (err) {
        gnafResult = {
          provider: "gnaf",
          status: "not_ready",
          ready: false,
          candidates: [],
          best: null,
          message: err.message,
        };
      }

      pushDebug({
        ...debugBase,
        phase: "gnaf",
        gnafStatus: gnafResult?.status,
        gnafReady: gnafResult?.ready,
        gnafMessage: gnafResult?.message,
        candidateResults: (gnafResult?.candidates || []).map((c) => ({
          displayName: c.displayName,
          score: c.score,
          matchLevel: c.matchLevel,
          lat: c.lat,
          lng: c.lng,
          gnafPid: c.gnafPid,
        })),
        selectedResult: gnafResult?.best
          ? {
              displayName: gnafResult.best.displayName,
              score: gnafResult.best.score,
              matchLevel: gnafResult.best.matchLevel,
              lat: gnafResult.best.lat,
              lng: gnafResult.best.lng,
            }
          : null,
      });

      const gnafDecision = decideGnafVerify(gnafResult, parsed, settings);
      if (gnafDecision.action === "verify" && gnafDecision.best) {
        const best = gnafDecision.best;
        const label = best.displayName || parsed.normalizedAddress;
        cacheSet(cacheKey, {
          lat: best.lat,
          lng: best.lng,
          verificationStatus: VerificationStatus.VERIFIED,
          confidence: 0.98,
          suggestedLabel: label,
          score: best.score,
          placeId: best.gnafPid || "",
          provider: "gnaf",
        });
        pushDebug({
          ...debugBase,
          phase: "auto-verify",
          provider: "gnaf",
          final: { lat: best.lat, lng: best.lng, score: best.score, matchLevel: best.matchLevel },
        });
        return this._applySuccess(order, {
          lat: best.lat,
          lng: best.lng,
          verificationStatus: VerificationStatus.VERIFIED,
          reviewReason: STATUS_LABELS.verified,
          confidence: 0.98,
          source: "gnaf",
          suggestedLabel: label,
          score: best.score,
          confirmMode: parsed.normalizedChanged ? "auto_corrected" : "auto",
          confirmLog: `${original} → G-NAF (${best.matchLevel}) · score ${best.score} → 자동 확인 완료`,
          lowConfidence: false,
          placeId: best.gnafPid || "",
          provider: "gnaf",
          queryStep: best.matchLevel || "gnaf",
        });
      }

      if (gnafDecision.action === "needs_review") {
        const best = gnafDecision.best;
        pushDebug({
          ...debugBase,
          phase: "needs-review",
          provider: "gnaf",
          failureReason: gnafDecision.reason,
          final: best,
        });
        return this._applyFailure(order, {
          verificationStatus: gnafDecision.verificationStatus || VerificationStatus.PARTIAL_MATCH,
          reviewReason: gnafDecision.reason,
          suggestedLabel: best?.displayName || parsed.normalizedAddress,
          suggestedLat: best?.lat ?? null,
          suggestedLng: best?.lng ?? null,
          suggestedScore: best?.score ?? null,
          confirmMode: "needs_review",
          confirmLog: `${original} → G-NAF → 수동 확인 필요 (${gnafDecision.reason})`,
        });
      }

      // ---------- Fallback: Nominatim (only when G-NAF has no usable result) ----------
      pushDebug({
        ...debugBase,
        phase: "nominatim-fallback",
        reason: gnafDecision.reason || "gnaf_miss",
      });

      const steps = buildFallbackSteps(parsed);
      let bestReference = null;
      let bestScoredList = null;
      const allCandidates = [];

      for (const step of steps) {
        let hits = [];
        try {
          if (step.freeform) {
            if (typeof this.provider.searchFreeForm !== "function") continue;
            hits = await this.provider.searchFreeForm(step.query || step.params?.q, {
              limit: step.params?.limit || 5,
            });
          } else {
            hits = await this.provider.searchStructured(step.params);
          }
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

        const scored = pickBest(hits, parsed, settings);
        allCandidates.push({ step: step.id, scored });

        pushDebug({
          ...debugBase,
          phase: "candidates",
          step: step.id,
          query: step.freeform ? step.query : step.params,
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
          selectedResult: scored[0]
            ? {
                displayName: scored[0].displayName,
                score: scored[0].score,
                lat: scored[0].lat,
                lng: scored[0].lng,
              }
            : null,
        });

        if (!scored.length) continue;
        const top = scored[0];
        const decision = decideAutoVerify(top, parsed, scored, settings);
        const suggestedLabel = decision.suggestedLabel || formatSuggested(parsed, top.hit);

        if (decision.approve) {
          cacheSet(cacheKey, {
            lat: top.lat,
            lng: top.lng,
            verificationStatus: VerificationStatus.VERIFIED,
            confidence: decision.lowConfidence ? 0.8 : 0.95,
            suggestedLabel,
            score: top.score,
            placeId: top.hit?.place_id ? String(top.hit.place_id) : "",
            provider: "nominatim",
          });
          pushDebug({
            ...debugBase,
            phase: "auto-verify",
            provider: "nominatim",
            step: step.id,
            final: { lat: top.lat, lng: top.lng, score: top.score },
          });
          return this._applySuccess(order, {
            lat: top.lat,
            lng: top.lng,
            verificationStatus: VerificationStatus.VERIFIED,
            reviewReason: decision.reviewReason || STATUS_LABELS.verified,
            confidence: decision.lowConfidence ? 0.8 : 0.95,
            source: "nominatim-structured",
            suggestedLabel,
            score: top.score,
            confirmMode: decision.confirmMode || "auto",
            confirmLog: buildConfirmLog(original, parsed, top, decision),
            lowConfidence: !!decision.lowConfidence,
            placeId: top.hit?.place_id ? String(top.hit.place_id) : "",
            provider: "nominatim",
            queryStep: step.id,
          });
        }

        if (!bestReference || (top.score || 0) > (bestReference.score || 0)) {
          bestReference = {
            ...decision,
            lat: top.lat,
            lng: top.lng,
            score: top.score,
            suggestedLabel,
            verificationStatus: decision.verificationStatus,
            reviewReason: decision.reviewReason,
          };
          bestScoredList = scored;
        }

        // Strong structural miss on early step — keep trying softer steps
        if ((top.score || 0) >= 70 && step.autoApprove === false) {
          /* continue */
        }
      }

      if (bestReference && bestReference.lat != null) {
        pushDebug({
          ...debugBase,
          phase: "needs-review",
          provider: "nominatim",
          failureReason: bestReference.reviewReason,
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
          confirmMode: "needs_review",
          confirmLog: `${original} → ${parsed.normalizedAddress || "정규화"} → Nominatim score ${bestReference.score ?? "—"} → 수동 확인 필요 (${bestReference.reviewReason || ""})`,
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
        reviewReason:
          gnafDecision.reason === "gnaf_not_found"
            ? `${STATUS_LABELS.gnaf_not_found} · ${STATUS_LABELS.not_found}`
            : STATUS_LABELS.not_found,
        confirmMode: "needs_review",
        confirmLog: `${original} → G-NAF 없음 → Nominatim 없음 → 수동 확인 필요`,
      });
    }

    /**
     * Batch geocode many orders: one G-NAF HTTP round-trip, then Nominatim only for misses.
     * @returns {{ orders: object[], performance: object }}
     */
    async geocodeOrdersBatch(orders, { force = false, onProgress } = {}) {
      const N = global.KHAddressNormalize;
      if (!N?.parseAustralianAddress) throw new Error("KHAddressNormalize missing");
      const t0 =
        typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const settings = getGeocodeSettings();
      const perf = {
        totalAddresses: orders.length,
        cacheHits: 0,
        gnafExact: 0,
        gnafFuzzy: 0,
        nominatimFallback: 0,
        needsReview: 0,
        gnafBatchMs: 0,
        nominatimMs: 0,
        processingTimeSeconds: 0,
        gnafServer: null,
      };

      const pending = []; // { order, parsed, original, index }

      for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const original = order.originalAddress || order.address || "";
        order.originalAddress = original;
        order.address = original;

        const parsed = N.parseAustralianAddress({
          address: original,
          suburb: order.suburb || "",
          postcode: order.postcode || "",
        });
        order.normalizedAddress = parsed.normalizedAddress;
        order.unitOrShop = parsed.unit || parsed.unitOrShop || "";
        order.subpremise = parsed.subpremise || parsed.unit || "";
        order.parsedAddress = {
          unit: parsed.unit,
          subpremise: parsed.subpremise || parsed.unit,
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

        if (!parsed.valid) {
          this._applyFailure(order, {
            verificationStatus: VerificationStatus.INVALID,
            reviewReason: parsed.invalidReason || STATUS_LABELS.invalid,
            confirmMode: "needs_review",
            confirmLog: `${original} → 정규화 실패 → 수동 확인 필요`,
          });
          perf.needsReview += 1;
          continue;
        }

        const cacheKey = parsed.normalizedAddress;
        if (!force && cacheKey) {
          const cached = cacheGet(cacheKey);
          if (cached && cached.verificationStatus === VerificationStatus.VERIFIED && cached.lat != null) {
            this._applySuccess(order, {
              lat: cached.lat,
              lng: cached.lng,
              verificationStatus: VerificationStatus.VERIFIED,
              reviewReason: STATUS_LABELS.verified,
              confidence: cached.confidence || 0.95,
              source: "cache",
              suggestedLabel: cached.suggestedLabel || parsed.normalizedAddress,
              score: cached.score,
              confirmMode: "auto",
              confirmLog: `${original} → 캐시 히트 → 자동 확인 완료`,
              lowConfidence: false,
              placeId: cached.placeId || "",
              provider: cached.provider || "cache",
            });
            perf.cacheHits += 1;
            continue;
          }
        }

        pending.push({ order, parsed, original, index: i });
      }

      const tGnaf =
        typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const batch = await this.gnaf.geocodeBatch(pending.map((p) => p.parsed));
      perf.gnafBatchMs = Math.round(
        ((typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) -
          tGnaf)
      );
      perf.gnafServer = batch.performance || null;

      const nominatimQueue = [];

      for (let j = 0; j < pending.length; j++) {
        const { order, parsed, original } = pending[j];
        const gnafResult = batch.results[j] || {
          ready: false,
          status: "not_ready",
          best: null,
          candidates: [],
        };
        const gnafDecision = decideGnafVerify(gnafResult, parsed, settings);

        if (gnafDecision.action === "verify" && gnafDecision.best) {
          const best = gnafDecision.best;
          const label = best.displayName || parsed.normalizedAddress;
          cacheSet(parsed.normalizedAddress, {
            lat: best.lat,
            lng: best.lng,
            verificationStatus: VerificationStatus.VERIFIED,
            confidence: 0.98,
            suggestedLabel: label,
            score: best.score,
            placeId: best.gnafPid || "",
            provider: "gnaf",
          });
          this._applySuccess(order, {
            lat: best.lat,
            lng: best.lng,
            verificationStatus: VerificationStatus.VERIFIED,
            reviewReason: STATUS_LABELS.verified,
            confidence: 0.98,
            source: "gnaf",
            suggestedLabel: label,
            score: best.score,
            confirmMode: parsed.normalizedChanged ? "auto_corrected" : "auto",
            confirmLog: `${original} → G-NAF (${best.matchLevel}) · score ${best.score} → 자동 확인 완료`,
            lowConfidence: !!gnafDecision.lowConfidence,
            placeId: best.gnafPid || "",
            provider: "gnaf",
            queryStep: best.matchLevel || "gnaf",
          });
          if (best.matchLevel === "fuzzy") perf.gnafFuzzy += 1;
          else perf.gnafExact += 1;
        } else if (gnafDecision.action === "needs_review") {
          const best = gnafDecision.best;
          this._applyFailure(order, {
            verificationStatus: gnafDecision.verificationStatus || VerificationStatus.PARTIAL_MATCH,
            reviewReason: gnafDecision.reason,
            suggestedLabel: best?.displayName || parsed.normalizedAddress,
            suggestedLat: best?.lat ?? null,
            suggestedLng: best?.lng ?? null,
            suggestedScore: best?.score ?? null,
            confirmMode: "needs_review",
            confirmLog: `${original} → G-NAF → 수동 확인 필요 (${gnafDecision.reason})`,
          });
          perf.needsReview += 1;
        } else {
          nominatimQueue.push({ order, parsed, original, gnafDecision });
        }

        if (typeof onProgress === "function") {
          onProgress(perf.cacheHits + j + 1, orders.length);
        }
      }

      const tNom =
        typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      for (const item of nominatimQueue) {
        // Reuse single-order Nominatim path via geocodeOrder after marking force + skip gnaf
        // by temporarily stubbing gnaf to return the miss we already know.
        const prevGnaf = this.gnaf;
        this.gnaf = {
          geocode: async () => ({
            provider: "gnaf",
            status: "not_found",
            ready: true,
            candidates: [],
            best: null,
            message: "batch-miss",
          }),
        };
        try {
          await this.geocodeOrder(item.order, { force: true });
        } finally {
          this.gnaf = prevGnaf;
        }
        perf.nominatimFallback += 1;
        if (item.order.status === "needs_review" || item.order.geocodingStatus === "needs_review") {
          perf.needsReview += 1;
        }
        if (typeof onProgress === "function") {
          onProgress(
            perf.cacheHits + pending.length - nominatimQueue.length + perf.nominatimFallback,
            orders.length
          );
        }
      }
      perf.nominatimMs = Math.round(
        ((typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) -
          tNom)
      );

      const elapsed =
        ((typeof performance !== "undefined" && performance.now ? performance.now() : Date.now()) -
          t0) / 1000;
      perf.processingTimeSeconds = +elapsed.toFixed(3);

      return { orders, performance: perf };
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
      order.suggestedLat = null;
      order.suggestedLng = null;
      order.geocodeSource = result.source || "nominatim-structured";
      order.geocodingProvider = result.provider || result.source || "nominatim";
      order.geocodeScore = result.score;
      order.geocodeQueryUsed = result.queryStep || "A";
      order.geocodeLowConfidence = !!result.lowConfidence;
      order.placeId = result.placeId || "";
      order.addressConfirmMode = result.confirmMode || "auto";
      order.addressConfirmLog = result.confirmLog || "";
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
      order.suggestedScore = info.suggestedScore ?? null;
      order.geocodeScore = info.suggestedScore ?? order.geocodeScore ?? null;
      order.geocodeLowConfidence = false;
      order.addressConfirmMode = info.confirmMode || "needs_review";
      order.addressConfirmLog = info.confirmLog || "";
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
      order.geocodingProvider = "manual";
      order.addressConfirmMode = "manual";
      order.addressConfirmLog = `${order.originalAddress || order.address || ""} → 수동 확인 완료`;
      order.suggestedLat = null;
      order.suggestedLng = null;
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
  class GeocodeProvider extends GeocodingProvider {
    async geocodeQuery() {
      throw new Error("Use PipelineGeocodeService.geocodeOrder / GeocodingProvider.geocode");
    }
  }
  class NominatimGeocodeProvider extends NominatimGeocodingProvider {}
  class PhotonGeocodeProvider extends GeocodingProvider {}
  class CompositeGeocodeProvider extends NominatimGeocodingProvider {}

  global.KHGeocode = {
    GeocodingProvider,
    GnafGeocodingProvider,
    NominatimGeocodingProvider,
    GeocodeProvider,
    PhotonGeocodeProvider,
    NominatimGeocodeProvider,
    NominatimStructuredProvider,
    CompositeGeocodeProvider,
    PipelineGeocodeService,
    VerificationStatus,
    STATUS_LABELS,
    DEFAULT_GEOCODE_SETTINGS,
    getGeocodeSettings,
    setGeocodeSettings,
    decideAutoVerify,
    decideGnafVerify,
    scoreCandidate,
    pickBest,
    buildFallbackSteps,
    buildConfirmLog,
    hasStreetLevel,
    isSuburbCentroid,
    cacheGet,
    cacheSet,
    CACHE_KEY,
    SETTINGS_KEY,
    isDebugEnabled,
    setDebugEnabled,
    getDebugLog: () => debugLog.slice(),
    clearDebugLog: () => {
      debugLog.length = 0;
    },
    pushDebug,
  };
})(typeof window !== "undefined" ? window : globalThis);
