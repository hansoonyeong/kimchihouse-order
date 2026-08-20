/**
 * Routing provider — zone-aware geographic clustering + open-path TSP.
 *
 * Priority: geographic cohesion > filling maxStops (30 is a ceiling, not a target).
 */
(function (global) {
  const Dist = global.KHDeliveryDistance;
  const SETTINGS_KEY = "kh_route_grouping_settings_v1";

  const DEFAULT_GROUPING_SETTINGS = {
    maxStopsPerRoute: 30,
    maxRouteSpreadKm: 14,
    warnSpreadKm: 16,
    minStopsToMerge: 3,
  };

  /** Approximate Greater Sydney zone centroids + suburb hints (auxiliary). */
  const SYDNEY_ZONES = [
    {
      id: "north",
      name: "North / North West",
      lat: -33.72,
      lng: 151.1,
      suburbs: [
        "hornsby",
        "chatswood",
        "epping",
        "north ryde",
        "ryde",
        "eastwood",
        "carlingford",
        "beecroft",
        "pennant hills",
        "west pennant hills",
        "cherrybrook",
        "wahroonga",
        "turramurra",
        "gordon",
        "pymble",
        "lindfield",
        "killara",
        "normanhurst",
        "thornleigh",
        "waitara",
        "asquith",
        "gladesville",
        "putney",
        "denistone",
        "marsfield",
        "macquarie park",
        "lane cove",
        "artarmon",
        "willoughby",
        "roseville",
      ],
    },
    {
      id: "inner_west",
      name: "Inner West",
      lat: -33.86,
      lng: 151.1,
      suburbs: [
        "rhodes",
        "strathfield",
        "burwood",
        "ashfield",
        "concord",
        "homebush",
        "lidcombe",
        "auburn",
        "olympics park",
        "sydney olympic park",
        "wentworth point",
        "liberty grove",
        "croydon",
        "summer hill",
        "haberfield",
        "five dock",
        "drummoyne",
      ],
    },
    {
      id: "west",
      name: "West",
      lat: -33.8,
      lng: 150.95,
      suburbs: [
        "parramatta",
        "blacktown",
        "westmead",
        "harris park",
        "wentworthville",
        "toongabbie",
        "seven hills",
        "pendle hill",
        "greystanes",
        "merrylands",
        "guildford",
        "granville",
        "baulkham hills",
        "castle hill",
        "kellyville",
        "rouse hill",
      ],
    },
    {
      id: "south_west",
      name: "South West",
      lat: -33.92,
      lng: 151.02,
      suburbs: [
        "bankstown",
        "punchbowl",
        "lakemba",
        "campsie",
        "canterbury",
        "belmore",
        "yagoona",
        "condell park",
        "greenacre",
        "chester hill",
        "sefton",
        "regents park",
      ],
    },
    {
      id: "cbd_east",
      name: "CBD / East",
      lat: -33.89,
      lng: 151.22,
      suburbs: [
        "sydney",
        "zetland",
        "alexandria",
        "waterloo",
        "surry hills",
        "darlinghurst",
        "paddington",
        "bondi",
        "bondi junction",
        "randwick",
        "kensington",
        "coogee",
        "maroubra",
        "mascot",
        "botany",
        "rosebery",
        "redfern",
        "newtown",
        "glebe",
        "pyrmont",
        "ultimo",
      ],
    },
    {
      id: "south",
      name: "South",
      lat: -34.03,
      lng: 151.08,
      suburbs: [
        "sutherland",
        "cronulla",
        "miranda",
        "caringbah",
        "gymea",
        "kirrawee",
        "hurstville",
        "kogarah",
        "rockdale",
        "carlton",
        "allawah",
        "beverly hills",
        "penshurst",
        "mortdale",
        "oatley",
      ],
    },
  ];

  function getGroupingSettings() {
    try {
      const raw =
        typeof localStorage !== "undefined" ? localStorage.getItem(SETTINGS_KEY) : null;
      const parsed = raw ? JSON.parse(raw) : {};
      // Also allow admin extra settings to override capacity / spread
      let adminMax = null;
      try {
        const admin = JSON.parse(localStorage.getItem("kh_admin_settings_extra_v1") || "{}");
        if (admin.maxStops) adminMax = Number(admin.maxStops);
        if (admin.maxRouteSpreadKm != null && admin.maxRouteSpreadKm !== "") {
          parsed.maxRouteSpreadKm = Number(admin.maxRouteSpreadKm);
        }
        if (admin.warnSpreadKm != null && admin.warnSpreadKm !== "") {
          parsed.warnSpreadKm = Number(admin.warnSpreadKm);
        }
      } catch (_) {
        /* ignore */
      }
      return {
        ...DEFAULT_GROUPING_SETTINGS,
        ...parsed,
        maxStopsPerRoute: Number.isFinite(adminMax)
          ? adminMax
          : parsed.maxStopsPerRoute || DEFAULT_GROUPING_SETTINGS.maxStopsPerRoute,
      };
    } catch (_) {
      return { ...DEFAULT_GROUPING_SETTINGS };
    }
  }

  function setGroupingSettings(partial) {
    const next = { ...getGroupingSettings(), ...(partial || {}) };
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      }
    } catch (_) {
      /* ignore */
    }
    return next;
  }

  function nearestNeighbourOrder(origin, stops) {
    const remaining = stops.slice();
    const ordered = [];
    let current = origin;
    while (remaining.length) {
      let bestIdx = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const s = remaining[i];
        const d = Dist.haversineKm(current, coordsOf(s));
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      current = coordsOf(next);
    }
    return ordered;
  }

  function coordsOf(s) {
    return {
      lat: s.lat ?? s.latitude,
      lng: s.lng ?? s.longitude,
    };
  }

  function hasCoords(s) {
    const c = coordsOf(s);
    return c.lat != null && c.lng != null && Number.isFinite(c.lat) && Number.isFinite(c.lng);
  }

  /** Only fully verified addresses — Needs Review / partial_match excluded. */
  function isGroupingEligible(s) {
    if (!s || !hasCoords(s)) return false;
    const g = s.geocodingStatus || s.status;
    if (g === "needs_review") return false;
    const v = s.verificationStatus;
    if (v === "partial_match" || v === "not_found" || v === "invalid") return false;
    if (v === "verified" || v === "manual_override") return true;
    return g === "ok" || s.status === "ok";
  }

  function pathStats(origin, orderedStops) {
    let km = 0;
    let prev = origin;
    for (const s of orderedStops) {
      if (!hasCoords(s)) continue;
      km += Dist.estimateRoadKm(prev, coordsOf(s));
      prev = coordsOf(s);
    }
    const validCount = orderedStops.filter(hasCoords).length;
    const mins = Dist.estimateMinutes(km, validCount);
    return {
      distanceKm: Math.round(km * 10) / 10,
      durationMin: mins,
      durationLabel: Dist.formatDuration(mins),
      approximate: true,
    };
  }

  function clusterCentroid(stops) {
    const list = stops.filter(hasCoords);
    if (!list.length) return null;
    return {
      lat: list.reduce((a, s) => a + coordsOf(s).lat, 0) / list.length,
      lng: list.reduce((a, s) => a + coordsOf(s).lng, 0) / list.length,
    };
  }

  /** Max pairwise distance (km) within a route. */
  function geographicSpreadKm(stops) {
    const list = stops.filter(hasCoords);
    let max = 0;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const d = Dist.haversineKm(coordsOf(list[i]), coordsOf(list[j]));
        if (d > max) max = d;
      }
    }
    return Math.round(max * 10) / 10;
  }

  function maxRadiusFromCentroidKm(stops) {
    const list = stops.filter(hasCoords);
    const c = clusterCentroid(list);
    if (!c || !list.length) return 0;
    let max = 0;
    for (const s of list) {
      const d = Dist.haversineKm(c, coordsOf(s));
      if (d > max) max = d;
    }
    return Math.round(max * 10) / 10;
  }

  function suburbList(stops) {
    const set = new Set();
    for (const s of stops) {
      const sub = String(s.suburb || "")
        .trim()
        .toLowerCase();
      if (sub) set.add(String(s.suburb).trim());
    }
    return [...set];
  }

  function normSuburb(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\([^)]*\)/g, " ")
      .replace(/\bnsw\b/g, " ")
      .replace(/\b\d{4}\b/g, " ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function assignZone(stop) {
    const sub = normSuburb(stop.suburb);
    if (sub) {
      // 1) Exact suburb match wins (avoids "sydney" → "sydney olympic park")
      for (const zone of SYDNEY_ZONES) {
        if (zone.suburbs.includes(sub)) return zone.id;
      }
      // 2) Token-safe containment: only when one string fully contains the other
      //    and the shorter token is at least 6 chars (blocks "sydney"/"park" noise)
      for (const zone of SYDNEY_ZONES) {
        for (const hint of zone.suburbs) {
          if (hint.length < 6 && sub.length < 6) continue;
          if (sub === hint) return zone.id;
          if (sub.length >= 6 && hint.includes(sub)) return zone.id;
          if (hint.length >= 6 && sub.includes(hint)) return zone.id;
        }
      }
    }
    if (!hasCoords(stop)) return "unknown";
    const c = coordsOf(stop);
    let best = SYDNEY_ZONES[0];
    let bestD = Infinity;
    for (const zone of SYDNEY_ZONES) {
      const d = Dist.haversineKm(c, { lat: zone.lat, lng: zone.lng });
      if (d < bestD) {
        bestD = d;
        best = zone;
      }
    }
    return best.id;
  }

  function wouldExceedSpread(members, candidate, maxSpreadKm) {
    const c = coordsOf(candidate);
    for (const m of members) {
      if (Dist.haversineKm(coordsOf(m), c) > maxSpreadKm) return true;
    }
    return false;
  }

  /**
   * Capacity-constrained geographic packing inside one zone.
   * Grow by nearest-to-centroid with hard pairwise maxSpreadKm gate.
   * 30 is a ceiling — stop early when nothing nearby remains.
   */
  function packZone(stops, { maxPerRoute, maxSpreadKm, origin }) {
    const unassigned = new Set(stops.map((s) => s.id));
    const byId = new Map(stops.map((s) => [s.id, s]));
    const routes = [];
    const depot = origin || { lat: -33.649215, lng: 151.034199 };
    const zoneCentroid = clusterCentroid(stops) || depot;

    while (unassigned.size) {
      // Seed: closest to zone centroid (keeps clusters local within zone)
      let seedId = null;
      let seedScore = Infinity;
      for (const id of unassigned) {
        const d = Dist.haversineKm(zoneCentroid, coordsOf(byId.get(id)));
        if (d < seedScore) {
          seedScore = d;
          seedId = id;
        }
      }

      const clusterIds = [seedId];
      unassigned.delete(seedId);

      while (clusterIds.length < maxPerRoute && unassigned.size) {
        const members = clusterIds.map((id) => byId.get(id));
        const centroid = clusterCentroid(members);
        let bestId = null;
        let bestScore = Infinity;

        for (const id of unassigned) {
          const s = byId.get(id);
          if (wouldExceedSpread(members, s, maxSpreadKm)) continue;

          const dCentroid = Dist.haversineKm(centroid, coordsOf(s));
          // Soft radius: half spread keeps clusters compact; still allow up to full spread via pairwise check
          if (dCentroid > maxSpreadKm * 0.65) continue;

          let score = dCentroid;
          const seed = byId.get(clusterIds[0]);
          if (
            s.suburb &&
            seed.suburb &&
            normSuburb(s.suburb) === normSuburb(seed.suburb)
          ) {
            score *= 0.65;
          }
          if (s.postcode && seed.postcode && s.postcode === seed.postcode) {
            score *= 0.75;
          }
          if (score < bestScore) {
            bestScore = score;
            bestId = id;
          }
        }

        if (!bestId) break; // prefer smaller local route over distant fill
        clusterIds.push(bestId);
        unassigned.delete(bestId);
      }

      routes.push(clusterIds.map((id) => byId.get(id)));
    }

    return routes;
  }

  /** Peel outliers from an oversized-spread route into a new route. */
  function enforceMaxSpread(groups, maxSpreadKm, maxPerRoute) {
    const out = [];
    for (const group of groups) {
      let remaining = group.slice();
      remaining._zoneId = group._zoneId;
      while (remaining.length) {
        let spread = geographicSpreadKm(remaining);
        if (spread <= maxSpreadKm || remaining.length <= 1) {
          remaining._zoneId = group._zoneId;
          out.push(remaining);
          break;
        }
        const centroid = clusterCentroid(remaining);
        // Remove farthest from centroid until under limit or too small
        let farthestIdx = 0;
        let farthestD = -1;
        for (let i = 0; i < remaining.length; i++) {
          const d = Dist.haversineKm(centroid, coordsOf(remaining[i]));
          if (d > farthestD) {
            farthestD = d;
            farthestIdx = i;
          }
        }
        const peeled = remaining.splice(farthestIdx, 1);
        // Try to attach peeled to an existing compact group in the same zone
        let attached = false;
        for (const g of out) {
          if (g.length >= maxPerRoute) continue;
          if (g._zoneId && group._zoneId && g._zoneId !== group._zoneId) continue;
          if (wouldExceedSpread(g, peeled[0], maxSpreadKm)) continue;
          const trial = g.concat(peeled);
          if (geographicSpreadKm(trial) <= maxSpreadKm) {
            g.push(peeled[0]);
            attached = true;
            break;
          }
        }
        if (!attached) {
          // Start collecting peeled into a spill bucket — process recursively next loop
          const spill = peeled.concat();
          while (remaining.length) {
            spread = geographicSpreadKm(remaining);
            if (spread <= maxSpreadKm) break;
            const c2 = clusterCentroid(remaining);
            let fi = 0;
            let fd = -1;
            for (let i = 0; i < remaining.length; i++) {
              const d = Dist.haversineKm(c2, coordsOf(remaining[i]));
              if (d > fd) {
                fd = d;
                fi = i;
              }
            }
            spill.push(remaining.splice(fi, 1)[0]);
          }
          remaining._zoneId = group._zoneId;
          out.push(remaining);
          remaining = spill;
          remaining._zoneId = group._zoneId;
        }
      }
    }
    return out.filter((g) => g.length);
  }

  function tryMergeTinyRoutes(groups, maxPerRoute, maxSpreadKm, minStopsToMerge) {
    const result = groups.map((g) => {
      const copy = g.slice();
      copy._zoneId = g._zoneId;
      return copy;
    });
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < result.length; i++) {
        if (result[i].length >= minStopsToMerge) continue;
        let bestJ = -1;
        let bestSpread = Infinity;
        for (let j = 0; j < result.length; j++) {
          if (i === j) continue;
          // Never merge across geographic zones — prevents Bankstown↔Inner West etc.
          if (result[i]._zoneId && result[j]._zoneId && result[i]._zoneId !== result[j]._zoneId) {
            continue;
          }
          if (result[j].length + result[i].length > maxPerRoute) continue;
          const merged = result[j].concat(result[i]);
          const spread = geographicSpreadKm(merged);
          if (spread <= maxSpreadKm && spread < bestSpread) {
            bestSpread = spread;
            bestJ = j;
          }
        }
        if (bestJ >= 0) {
          const zoneId = result[bestJ]._zoneId || result[i]._zoneId;
          result[bestJ] = result[bestJ].concat(result[i]);
          result[bestJ]._zoneId = zoneId;
          result.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
    return result;
  }

  function routeQuality(group, warnSpreadKm) {
    const spreadKm = geographicSpreadKm(group);
    const radiusKm = maxRadiusFromCentroidKm(group);
    const centroid = clusterCentroid(group);
    const suburbs = suburbList(group);
    const warning =
      spreadKm >= warnSpreadKm
        ? `Route 범위가 너무 넓습니다 (최대 ${spreadKm}km). 먼 배송지를 다른 Route로 옮기세요.`
        : null;
    return { spreadKm, radiusKm, centroid, suburbs, warning };
  }

  /**
   * Zone-first geographic grouping.
   * maxStopsPerRoute is a ceiling — local cohesion wins.
   */
  function autoGroupStops(stops, opts = {}) {
    const settings = { ...getGroupingSettings(), ...opts };
    const maxPerRoute = settings.maxStopsPerRoute || 30;
    const maxSpreadKm = settings.maxRouteSpreadKm || 14;
    const warnSpreadKm = settings.warnSpreadKm || 16;
    const minStopsToMerge = settings.minStopsToMerge || 3;
    const depot = opts.origin || { lat: -33.649215, lng: 151.034199 };

    const eligible = (stops || []).filter(isGroupingEligible);
    if (!eligible.length) return [];

    // A. Split into geographic zones
    const byZone = new Map();
    for (const s of eligible) {
      const z = assignZone(s);
      if (!byZone.has(z)) byZone.set(z, []);
      byZone.get(z).push(s);
    }

    // B–C. Cluster within each zone with capacity + spread
    let groups = [];
    for (const [zoneId, zoneStops] of byZone.entries()) {
      const packed = packZone(zoneStops, {
        maxPerRoute,
        maxSpreadKm,
        origin: depot,
      });
      packed.forEach((g) => {
        g._zoneId = zoneId;
      });
      groups = groups.concat(packed);
    }

    // D. Enforce max pairwise spread (peel / reassign) — same zone preferred
    groups = enforceMaxSpread(groups, maxSpreadKm, maxPerRoute);
    groups = tryMergeTinyRoutes(groups, maxPerRoute, maxSpreadKm, minStopsToMerge);

    // Sort routes by distance of centroid from depot (stable operational order)
    groups.sort((a, b) => {
      const ca = clusterCentroid(a);
      const cb = clusterCentroid(b);
      const da = ca ? Dist.haversineKm(depot, ca) : 0;
      const db = cb ? Dist.haversineKm(depot, cb) : 0;
      return da - db;
    });

    // E. Stop order (NN) — separate from grouping
    return groups.map((group, i) => {
      const ordered = nearestNeighbourOrder(depot, group);
      const stats = pathStats(depot, ordered);
      const quality = routeQuality(ordered, warnSpreadKm);
      return {
        id: `route-${i + 1}`,
        name: `Route ${i + 1}`,
        stopIds: ordered.map((s) => s.id),
        locked: false,
        stats,
        spreadKm: quality.spreadKm,
        radiusKm: quality.radiusKm,
        centroid: quality.centroid,
        suburbs: quality.suburbs,
        warning: quality.warning,
        zoneHint: group._zoneId || assignZone(ordered[0]),
      };
    });
  }

  class LocalRoutingProvider {
    async optimizeRoute(origin, stops) {
      const valid = stops.filter(hasCoords);
      const invalid = stops.filter((s) => !hasCoords(s));
      const ordered = nearestNeighbourOrder(origin, valid).concat(invalid);
      const stats = pathStats(origin, ordered.filter(hasCoords));
      return { stops: ordered, ...stats };
    }

    async estimateRoute(origin, stops) {
      return pathStats(origin, stops.filter(hasCoords));
    }
  }

  global.KHRouting = {
    LocalRoutingProvider,
    autoGroupStops,
    nearestNeighbourOrder,
    pathStats,
    geographicSpreadKm,
    maxRadiusFromCentroidKm,
    routeQuality,
    hasCoords,
    coordsOf,
    isGroupingEligible,
    assignZone,
    SYDNEY_ZONES,
    getGroupingSettings,
    setGroupingSettings,
    DEFAULT_GROUPING_SETTINGS,
    SETTINGS_KEY,
  };
})(typeof window !== "undefined" ? window : globalThis);
