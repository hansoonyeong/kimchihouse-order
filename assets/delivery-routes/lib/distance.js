/** Haversine distance helpers (km). */
(function (global) {
  const R = 6371;

  function toRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function haversineKm(a, b) {
    if (!a || !b || a.lat == null || b.lat == null) return Infinity;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Rough road factor for Sydney urban estimate. */
  function estimateRoadKm(a, b) {
    return haversineKm(a, b) * 1.35;
  }

  /** ~25 km/h average door-to-door urban delivery speed incl. stops. */
  function estimateMinutes(roadKm, stopCount) {
    const drive = (roadKm / 25) * 60;
    const stop = Math.max(0, stopCount - 1) * 4;
    return Math.round(drive + stop);
  }

  function formatDuration(mins) {
    if (mins == null || !Number.isFinite(mins)) return "—";
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `약 ${m}분`;
    return `약 ${h}시간 ${m}분`;
  }

  global.KHDeliveryDistance = {
    haversineKm,
    estimateRoadKm,
    estimateMinutes,
    formatDuration,
  };
})(typeof window !== "undefined" ? window : globalThis);
