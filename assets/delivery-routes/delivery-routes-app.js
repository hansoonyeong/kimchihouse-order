/**
 * Kimchi House AU — Delivery Route Planner (main app)
 */
(function () {
  const MAX_STOPS = 30;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    deliveryDate: "2026-08-29",
    orders: [],
    routes: [],
    unassignedIds: [],
    start: null,
    filter: { q: "", routeId: "all", suburb: "all", postcode: "all", panel: "all" },
    selectedId: null,
    viewMode: "split", // split | list | map
    mapping: null,
    pendingRows: null,
    pendingHeaders: null,
    drag: null,
  };

  let mapProvider = null;
  let geocoder = null;
  let router = null;
  let sortableInstances = [];

  function money(n) {
    return `$${Number(n || 0).toLocaleString("en-AU", { maximumFractionDigits: 0 })}`;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ordersById() {
    return new Map(state.orders.map((o) => [o.id, o]));
  }

  function orderOf(id) {
    return state.orders.find((o) => o.id === id);
  }

  function routeIndexOf(routeId) {
    return state.routes.findIndex((r) => r.id === routeId);
  }

  function findRouteOfOrder(orderId) {
    return state.routes.find((r) => r.stopIds.includes(orderId)) || null;
  }

  function persist() {
    window.KHRouteStorage.save({
      deliveryDate: state.deliveryDate,
      orders: state.orders,
      routes: state.routes,
      unassignedIds: state.unassignedIds,
      start: state.start,
    });
  }

  function loadPersisted() {
    const data = window.KHRouteStorage.load();
    if (!data?.orders?.length) return false;
    state.deliveryDate = data.deliveryDate || state.deliveryDate;
    state.orders = data.orders;
    state.routes = data.routes || [];
    state.unassignedIds = data.unassignedIds || [];
    state.start = data.start || window.KHDeliverySample.DEFAULT_START;
    return true;
  }

  function loadDemo() {
    state.orders = window.KHDeliverySample.buildSampleOrders(64);
    state.routes = [];
    state.unassignedIds = state.orders.filter((o) => o.status === "ok").map((o) => o.id);
    state.start = { ...window.KHDeliverySample.DEFAULT_START };
    state.deliveryDate = "2026-08-29";
    persist();
  }

  async function prepareOrderGeo(order) {
    // suburb가 비어 있으면 주소에서 추정
    if (!order.suburb && order.address) {
      const parts = String(order.address).split(",");
      if (parts.length >= 2) {
        order.suburb = window.KHOrderSource.cleanSuburb(parts[parts.length - 1]);
      }
    }
    if (!order.postcode) {
      order.postcode = window.KHOrderSource.extractPostcode(order.address, order.suburb) || "";
    }

    const reasons = window.KHSpreadsheet.validateOrder(order);
    if (reasons.length) {
      // 주소만 있고 suburb 추정 실패해도 로컬 geocode 한 번 더 시도
      const geoTry = await geocoder.geocode(order);
      if (geoTry) {
        order.lat = geoTry.lat;
        order.lng = geoTry.lng;
        order.status = "ok";
        order.reviewReason = null;
        return order;
      }
      order.status = "needs_review";
      order.reviewReason = reasons.join(" · ");
      order.lat = null;
      order.lng = null;
      return order;
    }
    const geo = await geocoder.geocode(order);
    if (!geo) {
      order.status = "needs_review";
      order.reviewReason = "주소를 지도에서 찾지 못했습니다 (Suburb 확인 필요)";
      order.lat = null;
      order.lng = null;
      return order;
    }
    order.lat = geo.lat;
    order.lng = geo.lng;
    order.status = "ok";
    order.reviewReason = null;
    return order;
  }

  /**
   * 관리자 주문 DB → 배송루트.
   * 기존에 잡아둔 Route 배정은 같은 주문번호에 한해 유지하고, 신규 주문만 미배정에 추가.
   */
  async function loadLiveOrders({ quiet = false } = {}) {
    const key = sessionStorage.getItem("kh_admin_key");
    if (!key) throw new Error("로그인이 필요합니다.");
    if (!geocoder) {
      geocoder = new window.KHGeocode.LocalGeocodeProvider({ useNominatim: false });
    }
    if (!window.KHOrderSource?.KimchiHouseApiOrderSource) {
      throw new Error("주문 연동 모듈을 불러오지 못했습니다. 새로고침 해주세요.");
    }

    const progress = $("#dr-upload-progress");
    if (progress) {
      progress.hidden = false;
      progress.textContent = "이번 차수 주문 불러오는 중…";
    }

    const source = new window.KHOrderSource.KimchiHouseApiOrderSource({ adminKey: key });
    const fetched = await source.getOrdersForPlanner();
    let live = fetched.orders || [];

    if (!live.length) {
      if (progress) progress.hidden = true;
      throw new Error(
        `불러온 주문이 0건입니다. (API 전체 ${fetched.rawCount || 0}건 / 이번 차수 ${fetched.currentCount || 0}건)`
      );
    }

    for (let i = 0; i < live.length; i++) {
      if (progress) progress.textContent = `주소 확인 중… ${i + 1}/${live.length}`;
      try {
        const prev = orderOf(live[i].id);
        if (
          prev?.lat != null &&
          prev?.lng != null &&
          prev.address === live[i].address &&
          prev.suburb === live[i].suburb
        ) {
          live[i].lat = prev.lat;
          live[i].lng = prev.lng;
          live[i].status = prev.status === "needs_review" ? "needs_review" : "ok";
          live[i].reviewReason = prev.reviewReason;
        } else {
          await prepareOrderGeo(live[i]);
        }
      } catch (err) {
        live[i].status = "needs_review";
        live[i].reviewReason = "주소 처리 중 오류: " + (err.message || "unknown");
        live[i].lat = null;
        live[i].lng = null;
      }
    }

    const prevRoutes = (state.routes || []).map((r) => ({
      ...r,
      stopIds: (r.stopIds || []).slice(),
    }));
    const liveIds = new Set(live.map((o) => o.id));

    const nextRoutes = prevRoutes
      .map((r) => ({
        ...r,
        stopIds: r.stopIds.filter((id) => liveIds.has(id)),
      }))
      .filter((r) => r.locked || r.stopIds.length > 0);

    const assigned = new Set(nextRoutes.flatMap((r) => r.stopIds));
    const unassignedIds = live
      .filter((o) => o.status === "ok" && !assigned.has(o.id))
      .map((o) => o.id);

    const D = window.KH_DELIVERY;
    const dates = live.map((o) => o.sourceDeliveryDate).filter(Boolean);
    const dateCounts = {};
    dates.forEach((d) => {
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const topDate =
      Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      D?.DEFAULT_DELIVERY_DATE ||
      state.deliveryDate ||
      "2026-08-29";

    state.orders = live;
    state.routes = nextRoutes;
    state.unassignedIds = unassignedIds;
    state.deliveryDate = topDate;
    if (!state.start) state.start = { ...window.KHDeliverySample.DEFAULT_START };

    refreshRouteStats();
    persist();

    const reviewN = live.filter((o) => o.status === "needs_review").length;
    const okN = live.filter((o) => o.status === "ok").length;
    const msg =
      `주문 ${live.length}건 로드` +
      (fetched.scope === "all" ? ` (이번 차수 필터 0건 → 전체 ${fetched.rawCount}건 사용)` : "") +
      ` · 지도가능 ${okN} · 확인필요 ${reviewN}`;

    if (progress) {
      progress.hidden = false;
      progress.textContent = msg;
      setTimeout(() => {
        if (progress.textContent === msg) progress.hidden = true;
      }, 4000);
    }
    if (!quiet) alert(msg);
    return live.length;
  }

  /* ---------- Auth ---------- */
  async function tryLogin() {
    const key = $("#dr-password").value.trim();
    if (!key) return alert("비밀번호를 입력해 주세요.");
    try {
      const res = await fetch("/api/orders", { headers: { Authorization: `Bearer ${key}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "로그인 실패");
      sessionStorage.setItem("kh_admin_key", key);
      showApp();
    } catch (err) {
      alert(err.message || "로그인 실패");
    }
  }

  function showApp() {
    const login = $("#dr-login");
    const app = $("#dr-app");
    if (login) login.hidden = true;
    if (app) app.hidden = false;
    initApp();
  }

  function logout() {
    sessionStorage.removeItem("kh_admin_key");
    location.href = "/admin.html";
  }

  /* ---------- Stats / filters ---------- */
  function stats() {
    const review = state.orders.filter((o) => o.status === "needs_review");
    const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
    const ok = state.orders.filter((o) => o.status === "ok");
    return {
      total: state.orders.length,
      grouped: assigned.size,
      unassigned: state.unassignedIds.length,
      review: review.length,
      routes: state.routes.length,
      stops: assigned.size,
    };
  }

  function matchesFilter(order) {
    const f = state.filter;
    const q = f.q.trim().toLowerCase();
    if (q) {
      const hay = [order.name, order.phone, order.address, order.suburb, order.postcode, order.id, order.notes]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.suburb !== "all" && order.suburb !== f.suburb) return false;
    if (f.postcode !== "all" && order.postcode !== f.postcode) return false;
    const route = findRouteOfOrder(order.id);
    if (f.routeId !== "all") {
      if (f.routeId === "unassigned") {
        if (!state.unassignedIds.includes(order.id)) return false;
      } else if (f.routeId === "review") {
        if (order.status !== "needs_review") return false;
      } else if (!route || route.id !== f.routeId) {
        return false;
      }
    }
    if (f.panel === "unassigned" && !state.unassignedIds.includes(order.id)) return false;
    if (f.panel === "review" && order.status !== "needs_review") return false;
    return true;
  }

  function renderHeader() {
    const s = stats();
    $("#dr-date").value = state.deliveryDate;
    $("#stat-total").textContent = s.total;
    $("#stat-grouped").textContent = s.grouped;
    $("#stat-unassigned").textContent = s.unassigned;
    $("#stat-review").textContent = s.review;
    $("#stat-routes").textContent = s.routes;
    $("#stat-stops").textContent = s.stops;
    const startLabel = $("#dr-start-label");
    if (startLabel && state.start) {
      startLabel.textContent = `${state.start.label || "출발지"} · ${state.start.address || ""}`;
    }
  }

  function fillFilterOptions() {
    const suburbs = [...new Set(state.orders.map((o) => o.suburb).filter(Boolean))].sort();
    const postcodes = [...new Set(state.orders.map((o) => o.postcode).filter(Boolean))].sort();
    const suburbSel = $("#filter-suburb");
    const pcSel = $("#filter-postcode");
    const routeSel = $("#filter-route");
    suburbSel.innerHTML =
      `<option value="all">Suburb 전체</option>` +
      suburbs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    pcSel.innerHTML =
      `<option value="all">Postcode 전체</option>` +
      postcodes.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    routeSel.innerHTML =
      `<option value="all">Route 전체</option>
       <option value="unassigned">미배정</option>
       <option value="review">확인 필요</option>` +
      state.routes.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
    suburbSel.value = state.filter.suburb;
    pcSel.value = state.filter.postcode;
    routeSel.value = state.filter.routeId;
  }

  function cardHtml(order, stopNumber, routeId) {
    const note = order.notes
      ? `<div class="dr-card-note">⚠️ ${esc(order.notes)}</div>`
      : "";
    const summary = esc(String(order.orderSummary || "").replace(/\n/g, " · "));
    return `
      <article class="dr-card${state.selectedId === order.id ? " is-selected" : ""}"
        draggable="true"
        data-order-id="${esc(order.id)}"
        data-from-route="${esc(routeId || "")}">
        <div class="dr-card-top">
          <strong class="dr-card-name">${stopNumber != null ? `${stopNumber}. ` : ""}${esc(order.name || "(이름 없음)")}</strong>
          <span class="dr-card-meta">${money(order.total)} · ${order.boxCount || 0} boxes</span>
        </div>
        <div class="dr-card-addr">${esc(order.address)}${order.suburb ? `, ${esc(order.suburb)}` : ""}${order.postcode ? ` NSW ${esc(order.postcode)}` : ""}</div>
        <div class="dr-card-order">${summary || "—"}</div>
        <div class="dr-card-phone">${esc(order.phone || "—")}</div>
        ${note}
      </article>`;
  }

  function routeStatsHtml(route) {
    const byId = ordersById();
    const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
    const boxes = stops.reduce((a, o) => a + (Number(o.boxCount) || 0), 0);
    const total = stops.reduce((a, o) => a + (Number(o.total) || 0), 0);
    const st = route.stats || {};
    const full = stops.length >= MAX_STOPS;
    return `
      <div class="dr-route-stats">
        <span class="${full ? "is-full" : ""}">${stops.length} / ${MAX_STOPS}곳</span>
        <span>${boxes} boxes</span>
        <span>${money(total)}</span>
        <span>~${st.distanceKm ?? "—"} km</span>
        <span>${st.durationLabel || "—"}</span>
      </div>`;
  }

  function destroySortables() {
    sortableInstances.forEach((s) => s.destroy?.());
    sortableInstances = [];
  }

  function bindSortables() {
    destroySortables();
    if (!window.Sortable) return;

    const lists = $$(".dr-drop-list");
    lists.forEach((el) => {
      const inst = Sortable.create(el, {
        group: "kh-routes",
        animation: 140,
        draggable: ".dr-card",
        ghostClass: "dr-card-ghost",
        chosenClass: "dr-card-chosen",
        onAdd(evt) {
          handleDrop(evt);
        },
        onUpdate(evt) {
          handleReorder(evt);
        },
      });
      sortableInstances.push(inst);
    });
  }

  function handleDrop(evt) {
    const orderId = evt.item?.dataset?.orderId;
    if (!orderId) return;
    const toKey = evt.to?.dataset?.drop;
    const fromKey = evt.from?.dataset?.drop;
    if (!toKey || toKey === fromKey) {
      handleReorder(evt);
      return;
    }

    // Remove from previous
    state.routes.forEach((r) => {
      r.stopIds = r.stopIds.filter((id) => id !== orderId);
    });
    state.unassignedIds = state.unassignedIds.filter((id) => id !== orderId);

    if (toKey === "unassigned") {
      state.unassignedIds.push(orderId);
    } else if (toKey === "review") {
      const o = orderOf(orderId);
      if (o) {
        o.status = "needs_review";
        o.reviewReason = o.reviewReason || "수동으로 확인 필요로 이동";
      }
    } else {
      const route = state.routes.find((r) => r.id === toKey);
      if (!route) return;
      if (route.locked) {
        alert("잠긴 Route에는 주문을 추가할 수 없습니다.");
        renderAll();
        return;
      }
      const newIndex = evt.newIndex ?? route.stopIds.length;
      if (route.stopIds.length >= MAX_STOPS) {
        const ok = confirm(`이 Route는 이미 ${MAX_STOPS}곳입니다. 그래도 추가할까요?`);
        if (!ok) {
          renderAll();
          return;
        }
      }
      route.stopIds.splice(newIndex, 0, orderId);
      const o = orderOf(orderId);
      if (o && o.status === "needs_review") {
        // keep review unless geocoded
        if (o.lat != null) o.status = "ok";
      }
    }
    refreshRouteStats();
    persist();
    renderAll();
  }

  function handleReorder(evt) {
    const listKey = evt.to?.dataset?.drop;
    if (!listKey || listKey === "unassigned" || listKey === "review") {
      if (listKey === "unassigned") {
        state.unassignedIds = $$(".dr-card", evt.to).map((c) => c.dataset.orderId);
        persist();
      }
      return;
    }
    const route = state.routes.find((r) => r.id === listKey);
    if (!route || route.locked) {
      if (route?.locked) alert("잠긴 Route는 순서를 변경할 수 없습니다. 잠금을 해제해 주세요.");
      renderAll();
      return;
    }
    route.stopIds = $$(".dr-card", evt.to).map((c) => c.dataset.orderId);
    refreshRouteStats(route);
    persist();
    renderAll();
  }

  function refreshRouteStats(onlyRoute) {
    if (!router || !state.start) return;
    const targets = onlyRoute ? [onlyRoute] : state.routes;
    const byId = ordersById();
    targets.forEach((route) => {
      const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
      route.stats = window.KHRouting.pathStats(state.start, stops.filter((s) => s.lat != null));
    });
  }

  function renderRoutes() {
    const root = $("#dr-routes");
    const byId = ordersById();
    root.innerHTML = state.routes
      .map((route, rIdx) => {
        const color = window.KHMap.ROUTE_COLORS[rIdx % window.KHMap.ROUTE_COLORS.length];
        const cards = route.stopIds
          .map((id, i) => {
            const o = byId.get(id);
            if (!o || !matchesFilter(o)) return "";
            return cardHtml(o, i + 1, route.id);
          })
          .join("");
        return `
          <section class="dr-route${route.locked ? " is-locked" : ""}" data-route-id="${esc(route.id)}" style="--route-color:${color}">
            <header class="dr-route-head">
              <div>
                <h3 class="dr-route-title">${esc(route.name)}${route.locked ? " 🔒" : ""}</h3>
                ${routeStatsHtml(route)}
              </div>
              <div class="dr-route-actions">
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="rename" data-route="${esc(route.id)}">이름</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="optimize" data-route="${esc(route.id)}">순서 정렬</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="lock" data-route="${esc(route.id)}">${route.locked ? "잠금 해제" : "잠금"}</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="export" data-route="${esc(route.id)}">CSV</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="print" data-route="${esc(route.id)}">인쇄</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="delete" data-route="${esc(route.id)}">삭제</button>
              </div>
            </header>
            <div class="dr-drop-list" data-drop="${esc(route.id)}">${cards || '<p class="dr-empty">주문을 여기로 드래그하세요</p>'}</div>
          </section>`;
      })
      .join("");
  }

  function renderSideLists() {
    const unRoot = $("#dr-unassigned-list");
    const revRoot = $("#dr-review-list");
    const byId = ordersById();

    const unCards = state.unassignedIds
      .map((id) => byId.get(id))
      .filter((o) => o && o.status === "ok" && matchesFilter(o))
      .map((o) => cardHtml(o, null, ""))
      .join("");
    unRoot.innerHTML = unCards || '<p class="dr-empty">미배정 주문 없음</p>';
    unRoot.dataset.drop = "unassigned";

    const reviewOrders = state.orders.filter((o) => o.status === "needs_review" && matchesFilter(o));
    revRoot.innerHTML =
      reviewOrders
        .map(
          (o) => `
        <article class="dr-card dr-card-review" data-order-id="${esc(o.id)}">
          <div class="dr-card-top">
            <strong>${esc(o.name || "(이름 없음)")}</strong>
            <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-act="edit-address" data-order="${esc(o.id)}">주소 수정</button>
          </div>
          <div class="dr-card-addr">${esc(o.address || "—")} ${esc(o.suburb || "")} ${esc(o.postcode || "")}</div>
          <div class="dr-review-reason">${esc(o.reviewReason || "확인 필요")}</div>
          <div class="dr-card-phone">${esc(o.phone || "—")}</div>
        </article>`
        )
        .join("") || '<p class="dr-empty">확인 필요 항목 없음</p>';
  }

  function popupHtml(order, route, stopNumber) {
    return `
      <div class="dr-popup">
        <strong>${esc(order.name)}</strong>
        <div>${esc(order.address)}, ${esc(order.suburb)} ${esc(order.postcode)}</div>
        <div>${esc(order.phone)}</div>
        <div style="margin-top:6px;white-space:pre-line">${esc(order.orderSummary)}</div>
        <div>${money(order.total)} · ${order.boxCount || 0} boxes</div>
        ${order.notes ? `<div>⚠️ ${esc(order.notes)}</div>` : ""}
        <div style="margin-top:6px">${route ? esc(route.name) : "미배정"}${stopNumber ? ` · #${stopNumber}` : ""}</div>
      </div>`;
  }

  function renderMap() {
    if (!mapProvider) return;
    const pins = [];
    state.routes.forEach((route, rIdx) => {
      route.stopIds.forEach((id, i) => {
        const o = orderOf(id);
        if (!o || o.lat == null || !matchesFilter(o)) return;
        pins.push({
          id: o.id,
          lat: o.lat,
          lng: o.lng,
          routeIndex: rIdx,
          stopNumber: i + 1,
          dimmed: false,
          popupHtml: popupHtml(o, route, i + 1),
        });
      });
    });
    state.unassignedIds.forEach((id) => {
      const o = orderOf(id);
      if (!o || o.lat == null || !matchesFilter(o)) return;
      pins.push({
        id: o.id,
        lat: o.lat,
        lng: o.lng,
        routeIndex: null,
        stopNumber: null,
        label: "·",
        dimmed: false,
        popupHtml: popupHtml(o, null, null),
      });
    });
    mapProvider.setStart(state.start, state.start?.label || "출발지");
    mapProvider.setPins(pins);
  }

  function renderAll() {
    renderHeader();
    fillFilterOptions();
    renderRoutes();
    renderSideLists();
    renderMap();
    bindSortables();
    requestAnimationFrame(() => mapProvider?.invalidate());
  }

  /* ---------- Actions ---------- */
  async function autoGroup() {
    const lockedIds = new Set(
      state.routes.filter((r) => r.locked).flatMap((r) => r.stopIds)
    );
    const lockedRoutes = state.routes.filter((r) => r.locked);
    const movable = state.orders.filter(
      (o) => o.status === "ok" && o.lat != null && !lockedIds.has(o.id)
    );
    if (!movable.length) {
      alert("자동 그룹핑할 유효 주문이 없습니다. (확인 필요·좌표 없음·잠긴 Route 제외)");
      return;
    }
    const generated = window.KHRouting.autoGroupStops(movable, {
      maxPerRoute: MAX_STOPS,
      origin: state.start,
    });
    // Re-number after locked
    let n = lockedRoutes.length;
    generated.forEach((g) => {
      n += 1;
      g.name = `Route ${n}`;
      g.id = `route-${Date.now()}-${n}`;
    });
    state.routes = [...lockedRoutes, ...generated];
    const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
    state.unassignedIds = state.orders
      .filter((o) => o.status === "ok" && !assigned.has(o.id))
      .map((o) => o.id);
    refreshRouteStats();
    persist();
    renderAll();
  }

  async function optimizeRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    if (route.locked) return alert("잠긴 Route입니다.");
    const byId = ordersById();
    const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
    const result = await router.optimizeRoute(state.start, stops);
    route.stopIds = result.stops.map((s) => s.id);
    route.stats = {
      distanceKm: result.distanceKm,
      durationMin: result.durationMin,
      durationLabel: result.durationLabel,
      approximate: true,
    };
    persist();
    renderAll();
  }

  function addRoute() {
    const n = state.routes.length + 1;
    state.routes.push({
      id: `route-${Date.now()}`,
      name: `Route ${n}`,
      stopIds: [],
      locked: false,
      stats: { distanceKm: 0, durationMin: 0, durationLabel: "—", approximate: true },
    });
    persist();
    renderAll();
  }

  function deleteRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    if (route.locked) return alert("잠긴 Route는 삭제할 수 없습니다.");
    if (!confirm(`「${route.name}」을(를) 삭제하고 주문은 미배정으로 옮길까요?`)) return;
    state.unassignedIds.push(...route.stopIds);
    state.routes = state.routes.filter((r) => r.id !== routeId);
    persist();
    renderAll();
  }

  function toggleLock(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    route.locked = !route.locked;
    persist();
    renderAll();
  }

  function renameRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    const name = prompt("Route 이름", route.name);
    if (!name) return;
    route.name = name.trim();
    persist();
    renderAll();
  }

  function printRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    const byId = ordersById();
    const rows = route.stopIds
      .map((id, i) => {
        const o = byId.get(id);
        if (!o) return "";
        return `<tr>
          <td>${i + 1}</td>
          <td>${esc(o.name)}<br><small>${esc(o.phone)}</small></td>
          <td>${esc(o.address)}, ${esc(o.suburb)} ${esc(o.postcode)}</td>
          <td style="white-space:pre-line">${esc(o.orderSummary)}</td>
          <td>${o.boxCount || 0}</td>
          <td>${esc(o.notes || "")}</td>
        </tr>`;
      })
      .join("");
    const w = window.open("", "_blank");
    w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/><title>${esc(route.name)}</title>
      <style>
        body{font-family:"Noto Sans KR",sans-serif;padding:24px;color:#222}
        h1{font-size:20px;margin:0 0 4px}
        .meta{color:#555;margin-bottom:16px;font-size:13px}
        table{width:100%;border-collapse:collapse;font-size:12px}
        th,td{border:1px solid #ccc;padding:6px 8px;vertical-align:top;text-align:left}
        th{background:#f4f8f5}
        @media print{body{padding:0}}
      </style></head><body>
      <h1>Kimchi House AU · ${esc(route.name)}</h1>
      <div class="meta">배송일 ${esc(state.deliveryDate)} · ${route.stopIds.length}곳</div>
      <table><thead><tr><th>#</th><th>고객</th><th>주소</th><th>주문</th><th>박스</th><th>메모</th></tr></thead>
      <tbody>${rows}</tbody></table>
      <script>window.onload=()=>window.print()<\/script>
      </body></html>`);
    w.document.close();
  }

  function editAddress(orderId) {
    const o = orderOf(orderId);
    if (!o) return;
    const address = prompt("배송주소", o.address || "");
    if (address == null) return;
    const suburb = prompt("Suburb", o.suburb || "");
    if (suburb == null) return;
    const postcode = prompt("Postcode", o.postcode || "");
    if (postcode == null) return;
    o.address = address.trim();
    o.suburb = suburb.trim();
    o.postcode = postcode.trim();
    revalidateAndGeocode(o).then(() => {
      persist();
      renderAll();
    });
  }

  async function revalidateAndGeocode(order) {
    const reasons = window.KHSpreadsheet.validateOrder(order);
    if (reasons.length) {
      order.status = "needs_review";
      order.reviewReason = reasons.join(" · ");
      order.lat = null;
      order.lng = null;
      state.unassignedIds = state.unassignedIds.filter((id) => id !== order.id);
      state.routes.forEach((r) => {
        r.stopIds = r.stopIds.filter((id) => id !== order.id);
      });
      return;
    }
    const geo = await geocoder.geocode(order);
    if (!geo) {
      order.status = "needs_review";
      order.reviewReason = "주소를 지도에서 찾지 못했습니다";
      order.lat = null;
      order.lng = null;
      return;
    }
    order.lat = geo.lat;
    order.lng = geo.lng;
    order.status = "ok";
    order.reviewReason = null;
    if (!findRouteOfOrder(order.id) && !state.unassignedIds.includes(order.id)) {
      state.unassignedIds.push(order.id);
    }
  }

  /* ---------- Upload / mapping ---------- */
  async function onFileSelected(file) {
    const buf = await file.arrayBuffer();
    const { headers, rows } = window.KHSpreadsheet.parseWorkbook(buf);
    state.pendingHeaders = headers;
    state.pendingRows = rows;
    state.mapping = window.KHSpreadsheet.suggestMapping(headers);
    openMappingModal();
  }

  function openMappingModal() {
    const modal = $("#dr-mapping-modal");
    const body = $("#dr-mapping-fields");
    body.innerHTML = window.KHSpreadsheet.FIELD_DEFS.map((f) => {
      const opts = [`<option value="">— 선택 안 함 —</option>`]
        .concat(
          state.pendingHeaders.map(
            (h) =>
              `<option value="${esc(h)}"${state.mapping[f.key] === h ? " selected" : ""}>${esc(h)}</option>`
          )
        )
        .join("");
      return `<label class="dr-map-field"><span>${esc(f.label)}</span><select data-map-key="${esc(f.key)}">${opts}</select></label>`;
    }).join("");
    modal.hidden = false;
  }

  async function applyMapping() {
    $$("#dr-mapping-fields select").forEach((sel) => {
      state.mapping[sel.dataset.mapKey] = sel.value;
    });
    if (!state.mapping.name || !state.mapping.address) {
      alert("고객명과 배송주소는 필수입니다.");
      return;
    }
    const orders = window.KHSpreadsheet.applyMapping(state.pendingRows, state.mapping);
    $("#dr-mapping-modal").hidden = true;
    $("#dr-upload-progress").hidden = false;
    $("#dr-upload-progress").textContent = "주소 확인 중…";

    const ready = [];
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      $("#dr-upload-progress").textContent = `주소 확인 중… ${i + 1}/${orders.length}`;
      const reasons = window.KHSpreadsheet.validateOrder(o);
      if (reasons.length) {
        o.status = "needs_review";
        o.reviewReason = reasons.join(" · ");
      } else {
        const geo = await geocoder.geocode(o);
        if (!geo) {
          o.status = "needs_review";
          o.reviewReason = "주소를 지도에서 찾지 못했습니다";
        } else {
          o.lat = geo.lat;
          o.lng = geo.lng;
          o.status = "ok";
        }
      }
      ready.push(o);
    }

    state.orders = ready;
    state.routes = [];
    state.unassignedIds = ready.filter((o) => o.status === "ok").map((o) => o.id);
    $("#dr-upload-progress").hidden = true;
    persist();
    renderAll();
    alert(`업로드 완료: 전체 ${ready.length}건 / 확인 필요 ${ready.filter((o) => o.status === "needs_review").length}건`);
  }

  /* ---------- Events ---------- */
  function bindEvents() {
    $("#dr-login-btn")?.addEventListener("click", tryLogin);
    $("#dr-password")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryLogin();
    });
    $("#dr-logout")?.addEventListener("click", logout);
    $("#dr-date")?.addEventListener("change", (e) => {
      state.deliveryDate = e.target.value;
      persist();
    });
    $("#btn-load-demo")?.addEventListener("click", () => {
      if (!confirm("데모 샘플 주문으로 바꿀까요? 현재 작업은 덮어씁니다.")) return;
      loadDemo();
      renderAll();
    });
    $("#btn-refresh-orders")?.addEventListener("click", async () => {
      try {
        const n = await loadLiveOrders();
        renderAll();
        alert(`이번 차수 주문 ${n}건을 불러왔습니다.`);
      } catch (err) {
        alert(err.message || "주문 불러오기 실패");
      }
    });
    $("#btn-clear")?.addEventListener("click", () => {
      if (!confirm("저장된 배송루트 작업을 모두 지울까요?")) return;
      window.KHRouteStorage.clear();
      state.orders = [];
      state.routes = [];
      state.unassignedIds = [];
      renderAll();
    });
    $("#btn-auto-group")?.addEventListener("click", autoGroup);
    $("#btn-add-route")?.addEventListener("click", addRoute);
    $("#btn-export-all")?.addEventListener("click", () => {
      window.KHRouteExport.exportRoutesCsv(ordersById(), state.routes, state.deliveryDate);
    });
    $("#file-upload")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) onFileSelected(file);
      e.target.value = "";
    });
    $("#dr-mapping-cancel")?.addEventListener("click", () => {
      $("#dr-mapping-modal").hidden = true;
    });
    $("#dr-mapping-apply")?.addEventListener("click", applyMapping);

    $("#filter-q")?.addEventListener("input", (e) => {
      state.filter.q = e.target.value;
      renderAll();
    });
    $("#filter-suburb")?.addEventListener("change", (e) => {
      state.filter.suburb = e.target.value;
      renderAll();
    });
    $("#filter-postcode")?.addEventListener("change", (e) => {
      state.filter.postcode = e.target.value;
      renderAll();
    });
    $("#filter-route")?.addEventListener("change", (e) => {
      state.filter.routeId = e.target.value;
      renderAll();
    });

    $$("[data-view-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.viewMode = btn.dataset.viewMode;
        document.body.dataset.drView = state.viewMode;
        $$("[data-view-mode]").forEach((b) => b.classList.toggle("active", b === btn));
        requestAnimationFrame(() => mapProvider?.invalidate());
      });
    });

    $("#dr-panel")?.addEventListener("click", (e) => {
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        const act = actBtn.dataset.act;
        const routeId = actBtn.dataset.route;
        const orderId = actBtn.dataset.order;
        if (act === "rename") renameRoute(routeId);
        if (act === "optimize") optimizeRoute(routeId);
        if (act === "lock") toggleLock(routeId);
        if (act === "delete") deleteRoute(routeId);
        if (act === "export") {
          const route = state.routes.find((r) => r.id === routeId);
          if (route) window.KHRouteExport.exportSingleRouteCsv(ordersById(), route, state.deliveryDate);
        }
        if (act === "print") printRoute(routeId);
        if (act === "edit-address") editAddress(orderId);
        return;
      }
      const card = e.target.closest(".dr-card[data-order-id]");
      if (card) {
        state.selectedId = card.dataset.orderId;
        mapProvider?.highlight(state.selectedId);
        renderAll();
      }
    });

    $("#btn-edit-start")?.addEventListener("click", () => {
      const label = prompt("출발지 이름", state.start?.label || "");
      if (label == null) return;
      const address = prompt("출발지 주소/Suburb", state.start?.address || "");
      if (address == null) return;
      const geo = window.KHGeocode.lookupLocal({ suburb: address, address, id: "start" });
      state.start = {
        label: label.trim() || "출발지",
        address: address.trim(),
        lat: geo?.lat ?? state.start?.lat ?? -33.79,
        lng: geo?.lng ?? state.start?.lng ?? 151.082,
      };
      refreshRouteStats();
      persist();
      renderAll();
    });
  }

  async function initApp() {
    if (document.body.dataset.drInited === "1") {
      // already initialized — just refresh orders
      try {
        await loadLiveOrders({ quiet: true });
        renderAll();
      } catch (err) {
        console.warn(err);
      }
      return;
    }
    document.body.dataset.drInited = "1";

    geocoder = new window.KHGeocode.LocalGeocodeProvider({ useNominatim: false });
    router = new window.KHRouting.LocalRoutingProvider();
    state.start = state.start || { ...window.KHDeliverySample.DEFAULT_START };

    loadPersisted();
    if (!state.start) state.start = { ...window.KHDeliverySample.DEFAULT_START };

    bindEvents();
    document.body.dataset.drView = "split";

    try {
      const mapEl = $("#dr-map");
      mapProvider = new window.KHMap.LeafletMapProvider(mapEl, {
        onPinClick: (id) => {
          state.selectedId = id;
          renderAll();
          const el = document.querySelector(`.dr-card[data-order-id="${CSS.escape(id)}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        },
      });
      mapProvider.init();
    } catch (err) {
      console.error("map init failed", err);
      alert("지도 초기화에 실패했습니다. 목록 기능은 계속 사용할 수 있습니다.\n" + (err.message || ""));
    }

    renderAll();
    requestAnimationFrame(() => mapProvider?.invalidate());

    try {
      const n = await loadLiveOrders({ quiet: true });
      renderAll();
      requestAnimationFrame(() => mapProvider?.invalidate());
      const bar = $("#dr-upload-progress");
      if (bar && n >= 0) {
        bar.hidden = false;
        bar.textContent = `이번 차수 주문 ${n}건을 불러왔습니다.`;
        setTimeout(() => {
          bar.hidden = true;
        }, 2500);
      }
    } catch (err) {
      console.warn("live orders load failed", err);
      if (!state.orders.length) {
        loadDemo();
        renderAll();
        alert("주문 DB를 불러오지 못해 데모 데이터로 시작합니다.\n" + (err.message || ""));
      } else {
        alert("주문 새로고침 실패: " + (err.message || "오류"));
      }
    }
  }

  function boot() {
    const key = sessionStorage.getItem("kh_admin_key");
    const login = $("#dr-login");
    const app = $("#dr-app");
    if (key) {
      if (login) login.hidden = true;
      if (app) app.hidden = false;
      showApp();
    } else {
      if (login) login.hidden = false;
      if (app) app.hidden = true;
      $("#dr-login-btn")?.addEventListener("click", tryLogin);
      $("#dr-password")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") tryLogin();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
