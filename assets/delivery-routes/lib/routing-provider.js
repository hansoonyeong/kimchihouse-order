/**
 * Routing provider — proximity clustering + open-path TSP.
 */
(function (global) {
  const Dist = global.KHDeliveryDistance;

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

  /**
   * Proximity packing:
   * - Seed = nearest unassigned to depot (keeps early routes local)
   * - Grow by nearest to cluster centroid
   * - Hard reject candidates farther than maxRadiusKm from centroid
   * - Soft prefer same suburb/postcode
   */
  function autoGroupStops(
    stops,
    { maxPerRoute = 30, origin, maxRadiusKm = 12, warnSpreadKm = 18 } = {}
  ) {
    const geocoded = stops.filter(hasCoords);
    if (!geocoded.length) return [];

    const unassigned = new Set(geocoded.map((s) => s.id));
    const byId = new Map(geocoded.map((s) => [s.id, s]));
    const routes = [];
    const depot = origin || { lat: -33.649215, lng: 151.034199 };

    while (unassigned.size) {
      // Seed: closest to depot among remaining (local-first)
      let seedId = null;
      let seedScore = Infinity;
      for (const id of unassigned) {
        const d = Dist.haversineKm(depot, coordsOf(byId.get(id)));
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
          const dCentroid = Dist.haversineKm(centroid, coordsOf(s));
          if (dCentroid > maxRadiusKm) continue;

          let score = dCentroid;
          const seed = byId.get(clusterIds[0]);
          if (
            s.suburb &&
            seed.suburb &&
            String(s.suburb).toLowerCase() === String(seed.suburb).toLowerCase()
          ) {
            score *= 0.7;
          }
          if (s.postcode && seed.postcode && s.postcode === seed.postcode) {
            score *= 0.8;
          }
          if (score < bestScore) {
            bestScore = score;
            bestId = id;
          }
        }

        if (!bestId) break;
        clusterIds.push(bestId);
        unassigned.delete(bestId);
      }

      routes.push(clusterIds.map((id) => byId.get(id)));
    }

    // If last route is tiny (<4) and previous can absorb within radius, merge
    if (routes.length >= 2) {
      const last = routes[routes.length - 1];
      const prev = routes[routes.length - 2];
      if (last.length < 4 && prev.length + last.length <= maxPerRoute) {
        const merged = prev.concat(last);
        const spread = geographicSpreadKm(merged);
        if (spread <= maxRadiusKm * 1.4) {
          routes[routes.length - 2] = merged;
          routes.pop();
        }
      }
    }

    return routes.map((group, i) => {
      const ordered = nearestNeighbourOrder(depot, group);
      const stats = pathStats(depot, ordered);
      const spreadKm = geographicSpreadKm(ordered);
      const warning =
        spreadKm >= warnSpreadKm
          ? `지역 범위가 넓습니다 (최대 ${spreadKm}km). 먼 배송지를 다른 Route로 옮기세요.`
          : null;
      return {
        id: `route-${i + 1}`,
        name: `Route ${i + 1}`,
        stopIds: ordered.map((s) => s.id),
        locked: false,
        stats,
        spreadKm,
        warning,
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
    hasCoords,
    coordsOf,
  };
})(typeof window !== "undefined" ? window : globalThis);
