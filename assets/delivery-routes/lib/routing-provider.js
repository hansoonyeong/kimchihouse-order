/**
 * Routing provider — nearest-neighbour / open-path TSP.
 * Replace with GoogleRoutesProvider or MapboxProvider later.
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
        const d = Dist.haversineKm(current, { lat: s.lat, lng: s.lng });
        if (d < bestD) {
          bestD = d;
          bestIdx = i;
        }
      }
      const next = remaining.splice(bestIdx, 1)[0];
      ordered.push(next);
      current = { lat: next.lat, lng: next.lng };
    }
    return ordered;
  }

  function pathStats(origin, orderedStops) {
    let km = 0;
    let prev = origin;
    for (const s of orderedStops) {
      km += Dist.estimateRoadKm(prev, { lat: s.lat, lng: s.lng });
      prev = { lat: s.lat, lng: s.lng };
    }
    const mins = Dist.estimateMinutes(km, orderedStops.length);
    return {
      distanceKm: Math.round(km * 10) / 10,
      durationMin: mins,
      durationLabel: Dist.formatDuration(mins),
      approximate: true,
    };
  }

  class LocalRoutingProvider {
    async optimizeRoute(origin, stops) {
      const valid = stops.filter((s) => s.lat != null && s.lng != null);
      const invalid = stops.filter((s) => s.lat == null || s.lng == null);
      const ordered = nearestNeighbourOrder(origin, valid).concat(invalid);
      const stats = pathStats(origin, ordered.filter((s) => s.lat != null));
      return { stops: ordered, ...stats };
    }

    async estimateRoute(origin, stops) {
      return pathStats(
        origin,
        stops.filter((s) => s.lat != null && s.lng != null)
      );
    }
  }

  /**
   * Cluster by proximity then pack into routes of maxCapacity.
   * Uses geographic k-medoids-ish: seed farthest, grow nearest.
   */
  function autoGroupStops(stops, { maxPerRoute = 30, origin } = {}) {
    const geocoded = stops.filter((s) => s.lat != null && s.lng != null);
    if (!geocoded.length) return [];

    const unassigned = new Set(geocoded.map((s) => s.id));
    const byId = new Map(geocoded.map((s) => [s.id, s]));
    const routes = [];

    while (unassigned.size) {
      // Seed: farthest from origin (or from previous cluster center)
      let seedId = null;
      let seedScore = -1;
      const ref = origin || { lat: -33.85, lng: 151.1 };
      for (const id of unassigned) {
        const s = byId.get(id);
        const d = Dist.haversineKm(ref, s);
        if (d > seedScore) {
          seedScore = d;
          seedId = id;
        }
      }

      const cluster = [seedId];
      unassigned.delete(seedId);

      while (cluster.length < maxPerRoute && unassigned.size) {
        let bestId = null;
        let bestD = Infinity;
        // Distance to nearest member of current cluster
        for (const id of unassigned) {
          const s = byId.get(id);
          let minD = Infinity;
          for (const cid of cluster) {
            const d = Dist.haversineKm(s, byId.get(cid));
            if (d < minD) minD = d;
          }
          // Soft prefer same suburb/postcode
          const seed = byId.get(cluster[0]);
          if (
            s.suburb &&
            seed.suburb &&
            String(s.suburb).toLowerCase() === String(seed.suburb).toLowerCase()
          ) {
            minD *= 0.75;
          }
          if (s.postcode && seed.postcode && s.postcode === seed.postcode) {
            minD *= 0.85;
          }
          if (minD < bestD) {
            bestD = minD;
            bestId = id;
          }
        }
        // Don't pull in stops that are very far from the cluster (>18km soft limit)
        // unless remaining slots would leave tiny leftovers
        if (bestD > 18 && unassigned.size > maxPerRoute - cluster.length) {
          break;
        }
        cluster.push(bestId);
        unassigned.delete(bestId);
      }

      routes.push(cluster.map((id) => byId.get(id)));
    }

    // Optimize order within each route
    const router = new LocalRoutingProvider();
    const start = origin || { lat: -33.85, lng: 151.1 };
    return routes.map((group, i) => {
      const ordered = nearestNeighbourOrder(start, group);
      const stats = pathStats(start, ordered);
      return {
        id: `route-${i + 1}`,
        name: `Route ${i + 1}`,
        stopIds: ordered.map((s) => s.id),
        locked: false,
        stats,
      };
    });
  }

  global.KHRouting = {
    LocalRoutingProvider,
    autoGroupStops,
    nearestNeighbourOrder,
    pathStats,
  };
})(typeof window !== "undefined" ? window : globalThis);
