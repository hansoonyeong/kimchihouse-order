/**
 * Map provider — Leaflet + per-route layers (cluster / polyline / legend).
 * Each Route has its own color, marker cluster group, and polyline.
 */
(function (global) {
  /** Calm palette aligned with Kimchi House admin greens / earth tones */
  const ROUTE_COLORS = [
    "#0f4a35", // deep green
    "#c45c26", // terracotta orange
    "#2f6f9f", // muted blue
    "#6b4c7a", // soft purple
    "#8a6a3a", // brown
    "#3d6b5a", // sage
    "#8b4557", // dusty rose
    "#4a5d73", // slate
  ];

  function hexToRgba(hex, alpha) {
    const h = String(hex || "#888").replace("#", "");
    const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const n = parseInt(full, 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  class LeafletMapProvider {
    constructor(container, opts = {}) {
      this.container = container;
      this.center = opts.center || { lat: -33.649215, lng: 151.034199 };
      this.zoom = opts.zoom || 11;
      this.map = null;
      this.markers = new Map();
      this.startMarker = null;
      this.routeLayers = new Map(); // routeIndex -> { cluster, line, color }
      this.unassignedCluster = null;
      this.focusRouteIndex = null;
      this._pins = [];
      this._routePaths = []; // [{ routeIndex, path: [{lat,lng}], name }]
      this._legend = [];
      this._start = null;
      this._legendEl = null;
      this.onPinClick = opts.onPinClick || (() => {});
      this.onLegendClick = opts.onLegendClick || (() => {});
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

      this._ensureLegendDom();
      return this;
    }

    routeColor(routeIndex) {
      if (routeIndex == null || routeIndex < 0) return "#7a7a7a";
      return ROUTE_COLORS[routeIndex % ROUTE_COLORS.length];
    }

    _clusterIcon(color, count, dimmed) {
      const size = count < 10 ? 36 : count < 50 ? 42 : 48;
      const bg = hexToRgba(color, dimmed ? 0.35 : 0.88);
      const ring = hexToRgba(color, dimmed ? 0.2 : 0.28);
      return L.divIcon({
        html: `<div class="dr-route-cluster${dimmed ? " is-dimmed" : ""}" style="--c:${color};--bg:${bg};--ring:${ring};width:${size}px;height:${size}px"><span>${count}</span></div>`,
        className: "dr-route-cluster-wrap",
        iconSize: L.point(size, size),
      });
    }

    _makeRouteCluster(color) {
      if (!L.markerClusterGroup) return null;
      const self = this;
      return L.markerClusterGroup({
        showCoverageOnHover: false,
        maxClusterRadius: 60,
        disableClusteringAtZoom: 15,
        spiderfyOnMaxZoom: true,
        iconCreateFunction(cluster) {
          const dimmed =
            self.focusRouteIndex != null &&
            // dim non-focused clusters: infer from first child marker option
            false;
          return self._clusterIcon(color, cluster.getChildCount(), dimmed);
        },
      });
    }

    setStart(coords, label = "출발지") {
      if (this.startMarker) {
        this.map.removeLayer(this.startMarker);
        this.startMarker = null;
      }
      this._start = coords;
      if (!coords?.lat) return;
      this.startMarker = L.circleMarker([coords.lat, coords.lng], {
        radius: 10,
        color: "#1c1c1c",
        weight: 2,
        fillColor: "#e6c85c",
        fillOpacity: 1,
        zIndexOffset: 1200,
      })
        .bindTooltip(label || "출발지", {
          permanent: true,
          direction: "top",
          offset: [0, -10],
          className: "dr-start-tooltip",
        })
        .addTo(this.map);
    }

    _clearRouteLayers() {
      this.routeLayers.forEach((layer) => {
        if (layer.cluster) this.map.removeLayer(layer.cluster);
        if (layer.line) this.map.removeLayer(layer.line);
        if (layer.markers) {
          layer.markers.forEach((m) => {
            if (layer.cluster) layer.cluster.removeLayer(m);
            else this.map.removeLayer(m);
          });
        }
      });
      this.routeLayers.clear();
      if (this.unassignedCluster) {
        this.map.removeLayer(this.unassignedCluster);
        this.unassignedCluster = null;
      }
      this.markers.clear();
    }

    /**
     * @param {Array} pins
     * @param {{
     *   start?: object,
     *   focusRouteIndex?: number|null,
     *   routePaths?: Array<{ routeIndex:number, path:Array<{lat,lng}>, name?:string }>,
     *   legend?: Array<{ routeIndex:number, name:string, stops:number, boxes?:number, distanceKm?:number, durationLabel?:string }>,
     *   fit?: boolean
     * }} opts
     */
    setPins(pins, opts = {}) {
      this._pins = pins || [];
      this.focusRouteIndex =
        opts.focusRouteIndex === undefined ? this.focusRouteIndex : opts.focusRouteIndex;
      if (opts.start) this._start = opts.start;
      if (opts.routePaths) this._routePaths = opts.routePaths;
      if (opts.legend) this._legend = opts.legend;

      this._clearRouteLayers();

      const byRoute = new Map();
      const unassigned = [];
      for (const pin of this._pins) {
        if (pin.lat == null || pin.lng == null) continue;
        if (pin.routeIndex == null) unassigned.push(pin);
        else {
          if (!byRoute.has(pin.routeIndex)) byRoute.set(pin.routeIndex, []);
          byRoute.get(pin.routeIndex).push(pin);
        }
      }

      const bounds = [];
      if (this.focusRouteIndex == null && this._start?.lat != null) {
        bounds.push([this._start.lat, this._start.lng]);
      }

      // Build per-route layers
      const routeIndexes = [...byRoute.keys()].sort((a, b) => a - b);
      for (const rIdx of routeIndexes) {
        const color = this.routeColor(rIdx);
        const focused = this.focusRouteIndex == null || this.focusRouteIndex === rIdx;
        const dimmed = this.focusRouteIndex != null && !focused;
        const cluster = this._makeRouteCluster(color);
        if (cluster) {
          // re-bind iconCreateFunction with dimmed awareness
          const self = this;
          cluster.options.iconCreateFunction = (c) =>
            self._clusterIcon(color, c.getChildCount(), dimmed);
          this.map.addLayer(cluster);
        }

        const markers = [];
        for (const pin of byRoute.get(rIdx)) {
          const label = pin.stopNumber != null ? String(pin.stopNumber) : "";
          const icon = L.divIcon({
            className: "dr-map-pin",
            html: `<span class="dr-map-pin-inner${dimmed ? " is-dimmed" : ""}${
              label ? "" : " is-dot"
            }" style="--pin:${color}">${label}</span>`,
            iconSize: label ? [26, 26] : [12, 12],
            iconAnchor: label ? [13, 13] : [6, 6],
          });
          const marker = L.marker([pin.lat, pin.lng], {
            icon,
            opacity: dimmed ? 0.2 : 1,
            zIndexOffset: focused ? 300 : 0,
          }).bindPopup(pin.popupHtml || label || "stop", { maxWidth: 280 });
          marker.on("click", () => this.onPinClick(pin.id));
          this.markers.set(pin.id, marker);
          markers.push(marker);
          if (cluster) cluster.addLayer(marker);
          else marker.addTo(this.map);
          if (focused) bounds.push([pin.lat, pin.lng]);
        }

        // Polyline: overview soft lines; focused strong; others at 20% opacity
        const pathEntry = (this._routePaths || []).find((p) => p.routeIndex === rIdx);
        let line = null;
        if (pathEntry?.path?.length >= 2) {
          line = L.polyline(
            pathEntry.path.map((p) => [p.lat, p.lng]),
            {
              color,
              weight: focused && this.focusRouteIndex != null ? 5 : 3.5,
              opacity: dimmed
                ? 0.2
                : this.focusRouteIndex == null
                  ? 0.62
                  : 0.95,
              lineJoin: "round",
              lineCap: "round",
            }
          ).addTo(this.map);
        }

        this.routeLayers.set(rIdx, { cluster, line, color, markers });
      }

      // Unassigned (only in overview)
      if (unassigned.length && this.focusRouteIndex == null) {
        const color = "#7a7a7a";
        this.unassignedCluster = this._makeRouteCluster(color);
        if (this.unassignedCluster) {
          this.unassignedCluster.options.iconCreateFunction = (c) =>
            this._clusterIcon(color, c.getChildCount(), false);
          this.map.addLayer(this.unassignedCluster);
        }
        for (const pin of unassigned) {
          const icon = L.divIcon({
            className: "dr-map-pin",
            html: `<span class="dr-map-pin-inner is-dot" style="--pin:${color}"></span>`,
            iconSize: [12, 12],
            iconAnchor: [6, 6],
          });
          const marker = L.marker([pin.lat, pin.lng], { icon, opacity: 0.7 }).bindPopup(
            pin.popupHtml || "미배정",
            { maxWidth: 280 }
          );
          marker.on("click", () => this.onPinClick(pin.id));
          this.markers.set(pin.id, marker);
          if (this.unassignedCluster) this.unassignedCluster.addLayer(marker);
          else marker.addTo(this.map);
          bounds.push([pin.lat, pin.lng]);
        }
      }

      this._renderLegend();
      this.map.invalidateSize();

      if (opts.fit !== false) {
        if (bounds.length >= 2) {
          this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 14 });
        } else if (bounds.length === 1) {
          this.map.setView(bounds[0], 13);
        } else if (this._start?.lat != null) {
          this.map.setView([this._start.lat, this._start.lng], this.zoom);
        }
      }
    }

    _ensureLegendDom() {
      if (this._legendBound) return;
      let el = document.getElementById("dr-map-legend");
      if (!el && this.container?.parentElement) {
        el = document.createElement("div");
        el.id = "dr-map-legend";
        el.className = "dr-map-legend";
        this.container.parentElement.appendChild(el);
      }
      this._legendEl = el;
      this._legendBound = true;
      if (el) {
        el.addEventListener("click", (e) => {
          const item = e.target.closest("[data-legend-route]");
          if (!item) return;
          const idx = Number(item.dataset.legendRoute);
          if (Number.isFinite(idx)) this.onLegendClick(idx);
        });
      }
    }

    _renderLegend() {
      if (!this._legendEl) this._ensureLegendDom();
      const el = this._legendEl;
      if (!el) return;
      const items = this._legend || [];
      if (!items.length) {
        el.hidden = true;
        el.innerHTML = "";
        return;
      }
      el.hidden = false;
      el.innerHTML =
        `<div class="dr-map-legend-title">Routes</div>` +
        items
          .map((it) => {
            const color = this.routeColor(it.routeIndex);
            const active =
              this.focusRouteIndex == null || this.focusRouteIndex === it.routeIndex;
            const meta = [
              `${it.stops} stops`,
              it.departureTime ? `출발 ${it.departureTime}` : null,
              it.distanceKm != null ? `~${it.distanceKm} km` : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return `<button type="button" class="dr-map-legend-item${
              active ? " is-active" : " is-dim"
            }" data-legend-route="${it.routeIndex}">
              <span class="dr-map-legend-dot" style="background:${color}"></span>
              <span class="dr-map-legend-text">
                <strong>${escapeHtml(it.name || `Route ${it.routeIndex + 1}`)}</strong>
                <small>${escapeHtml(meta)}</small>
              </span>
            </button>`;
          })
          .join("");
    }

    highlight(orderId) {
      const m = this.markers.get(orderId);
      if (!m) return;
      const ll = m.getLatLng();
      this.map.setView(ll, Math.max(this.map.getZoom(), 15), { animate: true });
      m.openPopup();
    }

    flyTo(lat, lng, zoom = 16) {
      const la = Number(lat);
      const ln = Number(lng);
      if (!this.map || !Number.isFinite(la) || !Number.isFinite(ln)) return;
      this.map.setView([la, ln], zoom, { animate: true });
    }

    invalidate() {
      this.map?.invalidateSize();
    }

    destroy() {
      this._clearRouteLayers();
      this.map?.remove();
      this.map = null;
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  global.KHMap = {
    LeafletMapProvider,
    ROUTE_COLORS,
  };
})(typeof window !== "undefined" ? window : globalThis);
