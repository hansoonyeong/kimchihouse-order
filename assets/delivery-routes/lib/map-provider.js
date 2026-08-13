/**
 * Map provider adapter — Leaflet + OpenStreetMap.
 * Swap implementation for GoogleMapProvider later; keep same public API.
 */
(function (global) {
  const ROUTE_COLORS = [
    "#0f4a35",
    "#c45c26",
    "#1d6fd8",
    "#7a3e9d",
    "#b8860b",
    "#0e7c7b",
    "#8b2942",
    "#3d5a80",
  ];

  class LeafletMapProvider {
    constructor(container, opts = {}) {
      this.container = container;
      this.center = opts.center || { lat: -33.85, lng: 151.1 };
      this.zoom = opts.zoom || 11;
      this.map = null;
      this.layer = null;
      this.markers = new Map();
      this.startMarker = null;
      this.onPinClick = opts.onPinClick || (() => {});
    }

    init() {
      if (!global.L) throw new Error("Leaflet가 로드되지 않았습니다.");
      this.map = L.map(this.container, {
        zoomControl: true,
        attributionControl: true,
      }).setView([this.center.lat, this.center.lng], this.zoom);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
      }).addTo(this.map);

      this.layer = L.layerGroup().addTo(this.map);
      return this;
    }

    routeColor(routeIndex) {
      if (routeIndex == null || routeIndex < 0) return "#888";
      return ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
    }

    setStart(coords, label = "출발지") {
      if (this.startMarker) {
        this.layer.removeLayer(this.startMarker);
        this.startMarker = null;
      }
      if (!coords) return;
      this.startMarker = L.circleMarker([coords.lat, coords.lng], {
        radius: 10,
        color: "#111",
        weight: 2,
        fillColor: "#f5e6a8",
        fillOpacity: 1,
      })
        .bindTooltip(label, { permanent: false })
        .addTo(this.layer);
    }

    clearPins() {
      this.markers.forEach((m) => this.layer.removeLayer(m));
      this.markers.clear();
    }

    /**
     * @param {Array} pins { id, lat, lng, label, routeIndex, stopNumber, popupHtml, dimmed }
     */
    setPins(pins) {
      this.clearPins();
      const bounds = [];
      for (const pin of pins) {
        if (pin.lat == null || pin.lng == null) continue;
        const color = this.routeColor(pin.routeIndex);
        const label =
          pin.routeIndex != null && pin.stopNumber != null
            ? `R${pin.routeIndex + 1}-${pin.stopNumber}`
            : pin.label || "·";

        const icon = L.divIcon({
          className: "dr-map-pin",
          html: `<span class="dr-map-pin-inner${pin.dimmed ? " is-dimmed" : ""}" style="--pin:${color}">${label}</span>`,
          iconSize: [44, 28],
          iconAnchor: [22, 14],
        });

        const marker = L.marker([pin.lat, pin.lng], { icon })
          .bindPopup(pin.popupHtml || label, { maxWidth: 280 })
          .addTo(this.layer);

        marker.on("click", () => this.onPinClick(pin.id));
        this.markers.set(pin.id, marker);
        if (!pin.dimmed) bounds.push([pin.lat, pin.lng]);
      }

      this.map.invalidateSize();
      if (bounds.length >= 2) {
        this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
      } else if (bounds.length === 1) {
        this.map.setView(bounds[0], 13);
      } else {
        this.map.setView([this.center.lat, this.center.lng], this.zoom);
      }
    }

    highlight(orderId) {
      const m = this.markers.get(orderId);
      if (m) {
        m.openPopup();
        this.map.panTo(m.getLatLng());
      }
    }

    invalidate() {
      this.map?.invalidateSize();
    }

    destroy() {
      this.map?.remove();
      this.map = null;
    }
  }

  global.KHMap = {
    LeafletMapProvider,
    ROUTE_COLORS,
  };
})(typeof window !== "undefined" ? window : globalThis);
