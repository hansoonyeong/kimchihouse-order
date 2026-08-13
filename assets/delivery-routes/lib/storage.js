/** Local persistence for delivery route planning state. */
(function (global) {
  const KEY = "kh-delivery-routes-v1";

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }

  global.KHRouteStorage = { KEY, load, save, clear };
})(typeof window !== "undefined" ? window : globalThis);
