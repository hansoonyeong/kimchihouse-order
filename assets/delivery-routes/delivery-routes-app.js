/**
 * Kimchi House AU — Delivery Route Planner
 */
(function () {
  const MAX_STOPS = 30;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    deliveryDate: "2026-09-03",
    /** 'api' | 'reservation' | 'demo' | 'upload' | null */
    dataSource: null,
    orders: [],
    routes: [],
    unassignedIds: [],
    start: null,
    filter: { q: "", routeId: "all", suburb: "all", postcode: "all" },
    selectedId: null,
    focusedRouteId: null,
    expandedIds: new Set(),
    openRouteIds: new Set(),
    viewMode: "split",
    mapping: null,
    pendingRows: null,
    pendingHeaders: null,
    geocodingInProgress: false,
    geocodingDone: 0,
    geocodingTotal: 0,
  };

  let mapProvider = null;
  let geocodeService = null;
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

  function coordsOf(o) {
    return window.KHRouting.coordsOf(o);
  }

  function hasCoords(o) {
    return window.KHRouting.hasCoords(o);
  }

  function isGeocodingFinished() {
    if (!state.orders.length) return false;
    if (state.geocodingInProgress) return false;
    return state.orders.every((o) => {
      const g = o.geocodingStatus || o.status;
      return g === "ok" || g === "needs_review";
    });
  }

  function isVerifiedOrder(o) {
    if (!o) return false;
    const v = o.verificationStatus;
    if (v === "verified" || v === "manual_override") return hasCoords(o);
    return (o.geocodingStatus === "ok" || o.status === "ok") && hasCoords(o);
  }

  function updateAutoGroupButton() {
    const btn = $("#btn-auto-group");
    if (!btn) return;
    const ready = isGeocodingFinished() && !state.geocodingInProgress;
    btn.disabled = !ready;
    btn.title = ready
      ? "좌표가 확인된 주문으로 Route를 만듭니다"
      : "모든 주소 확인이 끝난 뒤에 사용할 수 있습니다";
  }

  function setProgress(text, { hidden = false } = {}) {
    const el = $("#dr-upload-progress");
    if (!el) return;
    el.hidden = hidden;
    if (text) el.textContent = text;
  }

  function persist() {
    window.KHRouteStorage.save({
      deliveryDate: state.deliveryDate,
      dataSource: state.dataSource,
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
    state.dataSource = data.dataSource || null;
    state.orders = (data.orders || []).map(migrateOrder);
    state.routes = (data.routes || []).map((r) => ({
      ...r,
      departureTime: r.departureTime || "",
    }));
    state.unassignedIds = data.unassignedIds || [];
    state.start = data.start || window.KHDeliverySample.DEFAULT_START;
    const addr = String(state.start?.address || "").toLowerCase();
    if (!state.start?.lat || addr.includes("eastwood")) {
      state.start = { ...window.KHDeliverySample.DEFAULT_START };
    }
    // 예약표로 올린 주문은 id가 RES- 로 시작
    if (!state.dataSource && state.orders.some((o) => String(o.id || "").startsWith("RES-"))) {
      state.dataSource = "reservation";
    }
    return true;
  }

  function shouldSkipLiveReload() {
    return (
      state.geocodingInProgress ||
      state.dataSource === "reservation" ||
      state.dataSource === "upload" ||
      state.dataSource === "demo"
    );
  }

  function migrateOrder(o) {
    const original = o.originalAddress || o.address || "";
    const verificationStatus =
      o.verificationStatus ||
      (o.geocodingStatus === "ok" || o.status === "ok"
        ? "verified"
        : o.geocodingStatus === "needs_review"
          ? "partial_match"
          : "pending");
    return {
      ...o,
      address: original,
      originalAddress: original,
      normalizedAddress: o.normalizedAddress || "",
      unitOrShop: o.unitOrShop || "",
      suggestedAddress: o.suggestedAddress || "",
      suggestedLat: o.suggestedLat ?? null,
      suggestedLng: o.suggestedLng ?? null,
      verificationStatus,
      latitude: o.latitude ?? o.lat ?? null,
      longitude: o.longitude ?? o.lng ?? null,
      lat: o.lat ?? o.latitude ?? null,
      lng: o.lng ?? o.longitude ?? null,
      geocodingStatus:
        o.geocodingStatus ||
        (o.status === "ok" ? "ok" : o.status === "needs_review" ? "needs_review" : "pending"),
      geocodingConfidence: o.geocodingConfidence || 0,
      geocodeLowConfidence: !!o.geocodeLowConfidence,
      addressConfirmMode: o.addressConfirmMode || "",
      addressConfirmLog: o.addressConfirmLog || "",
      geocodingProvider: o.geocodingProvider || o.geocodeSource || "",
      placeId: o.placeId || "",
      geocodeScore: o.geocodeScore ?? null,
    };
  }

  function ensureGeocodeService() {
    if (!geocodeService) {
      geocodeService = new window.KHGeocode.PipelineGeocodeService({
        gnaf: new window.KHGeocode.GnafGeocodingProvider(),
        nominatim: new window.KHGeocode.NominatimGeocodingProvider(),
      });
    }
    return geocodeService;
  }

  async function geocodeOrder(order, { force = false } = {}) {
    if (
      !force &&
      isVerifiedOrder(order) &&
      (order.geocodingConfidence || 0) >= 0.55
    ) {
      return order;
    }
    return ensureGeocodeService().geocodeOrder(order, { force });
  }

  async function probeGnafReady() {
    try {
      const res = await fetch("/api/gnaf-geocode?stats=1", { headers: { Accept: "application/json" } });
      if (!res.ok) return false;
      const data = await res.json();
      return !!(data.ready && (data.count || 0) > 0);
    } catch {
      return false;
    }
  }

  async function geocodeAll(orders, { reusePrev = true, concurrency } = {}) {
    // G-NAF local index → parallel OK. Nominatim-only → sequential (~1req/s).
    let workers = concurrency;
    if (workers == null) {
      const gnafReady = await probeGnafReady();
      workers = gnafReady ? Math.min(12, Math.max(4, orders.length > 80 ? 10 : 6)) : 1;
    }
    state.geocodingInProgress = true;
    state.geocodingTotal = orders.length;
    state.geocodingDone = 0;
    updateAutoGroupButton();

    let done = 0;
    let cursor = 0;
    workers = Math.max(1, Math.min(workers, orders.length || 1));
    setProgress(`주소 확인 중 0 / ${orders.length} (G-NAF${workers > 1 ? ` · ${workers}병렬` : ""})`);

    async function processOne(live) {
      try {
        const prev = reusePrev ? orderOf(live.id) : null;
        const sameAddr =
          prev &&
          (prev.originalAddress || prev.address) === (live.originalAddress || live.address) &&
          prev.suburb === live.suburb &&
          prev.postcode === live.postcode;

        if (
          sameAddr &&
          isVerifiedOrder(prev) &&
          (prev.geocodingConfidence || 0) >= 0.55
        ) {
          live.lat = prev.lat;
          live.lng = prev.lng;
          live.latitude = prev.latitude ?? prev.lat;
          live.longitude = prev.longitude ?? prev.lng;
          live.geocodingStatus = "ok";
          live.verificationStatus = prev.verificationStatus || "verified";
          live.geocodingConfidence = prev.geocodingConfidence;
          live.normalizedAddress = prev.normalizedAddress;
          live.unitOrShop = prev.unitOrShop;
          live.suggestedAddress = prev.suggestedAddress;
          live.parsedAddress = prev.parsedAddress;
          live.status = "ok";
          live.reviewReason = null;
          live.addressConfirmMode = prev.addressConfirmMode || "auto";
          live.addressConfirmLog = prev.addressConfirmLog || "";
          live.geocodeLowConfidence = !!prev.geocodeLowConfidence;
          live.geocodingProvider = prev.geocodingProvider || prev.geocodeSource || "";
          live.placeId = prev.placeId || "";
          live.geocodeScore = prev.geocodeScore ?? null;
        } else {
          await geocodeOrder(live, { force: true });
        }
      } catch (err) {
        live.status = "needs_review";
        live.geocodingStatus = "needs_review";
        live.verificationStatus = "not_found";
        live.reviewReason = "주소 처리 중 오류: " + (err.message || "unknown");
        live.addressConfirmMode = "needs_review";
        live.addressConfirmLog = `${live.originalAddress || live.address || ""} → 오류 → 수동 확인 필요`;
        live.lat = live.lng = live.latitude = live.longitude = null;
      }
      done += 1;
      state.geocodingDone = done;
      setProgress(`주소 확인 중 ${done} / ${orders.length}`);
      if (done % 5 === 0 || done === orders.length) {
        state.unassignedIds = orders
          .filter((o) => isVerifiedOrder(o))
          .map((o) => o.id)
          .filter((id) => !state.routes.some((r) => r.stopIds.includes(id)));
        persist();
        renderHeader();
        renderSideLists();
        renderMap();
      }
    }

    async function worker() {
      while (cursor < orders.length) {
        const i = cursor++;
        await processOne(orders[i]);
      }
    }

    await Promise.all(Array.from({ length: workers }, () => worker()));

    state.geocodingInProgress = false;
    updateAutoGroupButton();
    return orders;
  }

  function loadDemo() {
    state.orders = window.KHDeliverySample.buildSampleOrders(64).map(migrateOrder);
    state.routes = [];
    state.unassignedIds = [];
    state.start = { ...window.KHDeliverySample.DEFAULT_START };
    state.deliveryDate = "2026-09-03";
    persist();
  }

  /* ---------- Auth ---------- */
  function getAdminKey() {
    return sessionStorage.getItem("kh_admin_key") || localStorage.getItem("kh_admin_key") || "";
  }
  function setAdminKey(key) {
    sessionStorage.setItem("kh_admin_key", key);
    localStorage.setItem("kh_admin_key", key);
  }
  function clearAdminKey() {
    sessionStorage.removeItem("kh_admin_key");
    localStorage.removeItem("kh_admin_key");
  }

  async function loadLiveOrders({ quiet = false, force = false } = {}) {
    if (!force && shouldSkipLiveReload()) {
      console.info("[delivery-routes] skip live reload (source=%s)", state.dataSource);
      return state.orders.length;
    }
    const key = getAdminKey();
    if (!key) throw new Error("로그인이 필요합니다.");
    ensureGeocodeService();
    if (!window.KHOrderSource?.KimchiHouseApiOrderSource) {
      throw new Error("주문 연동 모듈을 불러오지 못했습니다.");
    }

    setProgress("이번 차수 주문 불러오는 중…");
    const source = new window.KHOrderSource.KimchiHouseApiOrderSource({ adminKey: key });
    const fetched = await source.getOrdersForPlanner();
    let live = (fetched.orders || []).map(migrateOrder);
    if (!live.length) {
      setProgress("", { hidden: true });
      throw new Error(
        `불러온 주문이 0건입니다. (API 전체 ${fetched.rawCount || 0}건 / 이번 차수 ${fetched.currentCount || 0}건)`
      );
    }

    live = await geocodeAll(live);

    const prevRoutes = (state.routes || []).map((r) => ({
      ...r,
      stopIds: (r.stopIds || []).slice(),
    }));
    const liveIds = new Set(live.map((o) => o.id));
    const nextRoutes = prevRoutes
      .map((r) => ({
        ...r,
        stopIds: r.stopIds.filter((id) => liveIds.has(id) && isVerifiedOrder(live.find((o) => o.id === id))),
      }))
      .filter((r) => r.locked || r.stopIds.length > 0);

    const assigned = new Set(nextRoutes.flatMap((r) => r.stopIds));
    const unassignedIds = live
      .filter((o) => isVerifiedOrder(o) && !assigned.has(o.id))
      .map((o) => o.id);

    const dates = live.map((o) => o.sourceDeliveryDate).filter(Boolean);
    const dateCounts = {};
    dates.forEach((d) => {
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });
    const topDate =
      Object.entries(dateCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
      window.KH_DELIVERY?.DEFAULT_DELIVERY_DATE ||
      state.deliveryDate;

    state.dataSource = "api";
    state.orders = live;
    state.routes = nextRoutes;
    state.unassignedIds = unassignedIds;
    state.deliveryDate = topDate;
    if (!state.start) state.start = { ...window.KHDeliverySample.DEFAULT_START };

    refreshRouteStats();
    persist();

    const okN = live.filter((o) => isVerifiedOrder(o)).length;
    const reviewN = live.filter((o) => o.geocodingStatus === "needs_review").length;
    const autoN = live.filter(
      (o) =>
        isVerifiedOrder(o) &&
        o.addressConfirmMode !== "manual" &&
        o.verificationStatus !== "manual_override"
    ).length;
    const msg = `자동 확인 ${autoN} · 확인 필요 ${reviewN} · 전체 ${live.length}`;
    setProgress(msg);
    setTimeout(() => {
      const el = $("#dr-upload-progress");
      if (el && el.textContent === msg) el.hidden = true;
    }, 6000);

    if (!nextRoutes.length && okN > 0) {
      setProgress(`배송루트 자동 생성 중… (${okN}건)`);
      try {
        await autoGroup();
        setProgress(
          `자동 확인 ${autoN} · 확인 필요 ${reviewN} · Route ${state.routes.length}개`
        );
      } catch (err) {
        console.warn("[delivery-routes] autoGroup after load failed", err);
      }
    }

    if (!quiet) alert(msg);
    updateAutoGroupButton();
    return live.length;
  }

  async function tryLogin() {
    const key = $("#dr-password").value.trim();
    if (!key) return alert("비밀번호를 입력해 주세요.");
    try {
      const res = await fetch("/api/orders", { headers: { Authorization: `Bearer ${key}` } });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "로그인 실패");
      setAdminKey(key);
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
    clearAdminKey();
    location.href = "/admin.html";
  }

  function applyEmbedMode() {
    const params = new URLSearchParams(location.search);
    if (params.get("embed") !== "1") return false;
    document.body.classList.add("dr-embed");
    return true;
  }

  function listenParentSync() {
    window.addEventListener("message", (event) => {
      if (event.origin !== location.origin) return;
      const data = event.data;
      if (!data || data.type !== "kh-delivery-routes-sync") return;
      if (data.adminKey) setAdminKey(String(data.adminKey));
      const login = $("#dr-login");
      const app = $("#dr-app");
      if (login) login.hidden = true;
      if (app) app.hidden = false;
      // 이미 플래너가 떠 있으면 로그인만 동기화 (예약표 덮어쓰기 방지)
      if (document.body.dataset.drInited === "1") {
        renderAll();
        return;
      }
      showApp();
    });
  }

  /* ---------- Stats / filters ---------- */
  function stats() {
    const review = state.orders.filter(
      (o) => o.geocodingStatus === "needs_review" || o.status === "needs_review"
    );
    const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
    return {
      total: state.orders.length,
      grouped: assigned.size,
      unassigned: state.unassignedIds.length,
      review: review.length,
      routes: state.routes.length,
    };
  }

  function matchesFilter(o) {
    const q = state.filter.q.trim().toLowerCase();
    if (q) {
      const blob = [
        o.name,
        o.phone,
        o.originalAddress || o.address,
        o.suburb,
        o.postcode,
        o.notes,
        o.orderSummary,
      ]
        .join(" ")
        .toLowerCase();
      if (!blob.includes(q)) return false;
    }
    if (state.filter.suburb !== "all" && o.suburb !== state.filter.suburb) return false;
    if (state.filter.postcode !== "all" && o.postcode !== state.filter.postcode) return false;
    if (state.filter.routeId !== "all") {
      if (state.filter.routeId === "unassigned") return state.unassignedIds.includes(o.id);
      if (state.filter.routeId === "review")
        return o.geocodingStatus === "needs_review" || o.status === "needs_review";
      const route = state.routes.find((r) => r.id === state.filter.routeId);
      if (!route?.stopIds.includes(o.id)) return false;
    }
    return true;
  }

  function shortSummary(order) {
    const lines = String(order.orderSummary || "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return "—";
    if (lines.length === 1) return lines[0];
    return `${lines[0]} 외 ${lines.length - 1}`;
  }

  function cardHtml(order, stopNumber, routeId) {
    const expanded = state.expandedIds.has(order.id);
    const suburbLine = [order.suburb, order.postcode].filter(Boolean).join(" ");
    const original = order.originalAddress || order.address || "—";
    const orderNo = order.orderNumber || order.id || "";
    const noteHtml = order.notes
      ? `<div class="dr-card-note dr-card-note-inline">⚠ ${esc(order.notes)}</div>`
      : "";
    return `
      <article class="dr-card${state.selectedId === order.id ? " is-selected" : ""}${
        expanded ? " is-expanded" : ""
      }"
        draggable="true"
        data-order-id="${esc(order.id)}"
        data-from-route="${esc(routeId || "")}">
        <div class="dr-card-compact">
          <div class="dr-card-top">
            <strong class="dr-card-name">${
              stopNumber != null ? `<span class="dr-stop-no">${stopNumber}</span>` : ""
            }${esc(order.name || "(이름 없음)")}</strong>
          </div>
          <div class="dr-card-sub">${esc(orderNo ? `#${orderNo}` : "")}${
            orderNo && suburbLine ? " · " : ""
          }${esc(suburbLine || "Suburb 없음")}</div>
          <div class="dr-card-order">${esc(shortSummary(order))}</div>
          ${noteHtml}
          <button type="button" class="dr-card-toggle" data-act="toggle-detail" data-order="${esc(
            order.id
          )}">${expanded ? "접기" : "상세"}</button>
        </div>
        <div class="dr-card-detail" ${expanded ? "" : "hidden"}>
          <div class="dr-card-addr">${esc(original)}${
            order.unitOrShop ? ` · ${esc(order.unitOrShop)}` : ""
          }</div>
          <div class="dr-card-phone">${esc(order.phone || "—")}</div>
          ${
            order.normalizedAddress
              ? `<div class="dr-card-norm">검색: ${esc(order.normalizedAddress)}</div>`
              : ""
          }
          <div class="dr-card-order-full">${esc(
            String(order.orderSummary || "").replace(/\n/g, " · ")
          )}</div>
          <div class="dr-card-meta-full">${money(order.total)}</div>
          ${order.notes ? `<div class="dr-card-note">⚠ ${esc(order.notes)}</div>` : ""}
        </div>
      </article>`;
  }

  function routeStatsHtml(route) {
    const byId = ordersById();
    const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
    const st = route.stats || {};
    const full = stops.length >= MAX_STOPS;
    return `
      <div class="dr-route-stats">
        <span class="${full ? "is-full" : ""}">${stops.length}/${MAX_STOPS}</span>
        <span>~${st.distanceKm ?? "—"} km</span>
        <span>${st.durationLabel || "—"}</span>
        ${route.spreadKm != null ? `<span>범위 ${route.spreadKm}km</span>` : ""}
      </div>`;
  }

  function renderHeader() {
    const s = stats();
    const dateEl = $("#dr-date");
    if (dateEl) dateEl.value = state.deliveryDate;
    $("#stat-total").textContent = s.total;
    $("#stat-grouped").textContent = s.grouped;
    $("#stat-unassigned").textContent = s.unassigned;
    $("#stat-review").textContent = s.review;
    $("#stat-routes").textContent = s.routes;
    const stopsEl = $("#stat-stops");
    if (stopsEl) stopsEl.textContent = String(s.grouped);
    const startName = $("#dr-start-name");
    if (startName && state.start) {
      startName.textContent = state.start.label || "Kimchi House AU (본사)";
    }
    const startLabel = $("#dr-start-label");
    if (startLabel && state.start) {
      startLabel.textContent = state.start.address || "";
    }
    updateAutoGroupButton();
  }

  function fillFilterOptions() {
    const suburbs = [...new Set(state.orders.map((o) => o.suburb).filter(Boolean))].sort();
    const postcodes = [...new Set(state.orders.map((o) => o.postcode).filter(Boolean))].sort();
    const suburbSel = $("#filter-suburb");
    const pcSel = $("#filter-postcode");
    const routeSel = $("#filter-route");
    if (!suburbSel || !pcSel || !routeSel) return;
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

  function destroySortables() {
    sortableInstances.forEach((s) => s.destroy?.());
    sortableInstances = [];
  }

  function bindSortables() {
    destroySortables();
    if (!window.Sortable) return;
    $$(".dr-drop-list").forEach((el) => {
      sortableInstances.push(
        Sortable.create(el, {
          group: "kh-routes",
          animation: 120,
          draggable: ".dr-card",
          ghostClass: "dr-card-ghost",
          chosenClass: "dr-card-chosen",
          onAdd: handleDrop,
          onUpdate: handleReorder,
        })
      );
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
        o.geocodingStatus = "needs_review";
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
      const o = orderOf(orderId);
      if (!hasCoords(o)) {
        alert("좌표가 없는 주문은 Route에 넣을 수 없습니다. 주소를 먼저 확인하세요.");
        renderAll();
        return;
      }
      const newIndex = evt.newIndex ?? route.stopIds.length;
      if (route.stopIds.length >= MAX_STOPS) {
        if (!confirm(`이 Route는 이미 ${MAX_STOPS}곳입니다. 그래도 추가할까요?`)) {
          renderAll();
          return;
        }
      }
      route.stopIds.splice(newIndex, 0, orderId);
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
      if (route?.locked) alert("잠긴 Route는 순서를 변경할 수 없습니다.");
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
    const grouping = window.KHRouting?.getGroupingSettings?.() || {};
    const warnKm = grouping.warnSpreadKm || 16;
    targets.forEach((route) => {
      const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
      const withCoords = stops.filter((s) => hasCoords(s));
      route.stats = window.KHRouting.pathStats(state.start, withCoords);
      const quality =
        window.KHRouting.routeQuality?.(withCoords, warnKm) || {
          spreadKm: window.KHRouting.geographicSpreadKm(withCoords),
          radiusKm: window.KHRouting.maxRadiusFromCentroidKm?.(withCoords) || 0,
          suburbs: [],
        };
      route.spreadKm = quality.spreadKm;
      route.radiusKm = quality.radiusKm;
      route.suburbs = quality.suburbs || [];
      route.centroid = quality.centroid || null;
      route.warning =
        route.spreadKm >= warnKm
          ? `Route 범위가 너무 넓습니다 (최대 ${route.spreadKm}km · 반경 ${route.radiusKm}km).`
          : null;
    });
  }

  function renderRoutes() {
    const root = $("#dr-routes");
    const byId = ordersById();
    if (!state.orders.length) {
      root.innerHTML = `<p class="dr-empty-routes">업로드된 주문이 없습니다.<br />상단 <strong>주문 업로드</strong>로 예약표를 가져와 주세요.</p>`;
      return;
    }
    if (!state.routes.length) {
      root.innerHTML = `<p class="dr-empty-routes">배송루트를 생성해 주세요.<br />주소 확인이 끝나면 <strong>배송루트 자동 생성</strong>을 눌러 주세요.</p>`;
      return;
    }
    if (!state.openRouteIds.size && state.routes[0]) {
      state.openRouteIds.add(state.focusedRouteId || state.routes[0].id);
    }
    root.innerHTML = state.routes
      .map((route, rIdx) => {
        const color = window.KHMap.ROUTE_COLORS[rIdx % window.KHMap.ROUTE_COLORS.length];
        const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
        const suburbSummary = [...new Set(stops.map((o) => o.suburb).filter(Boolean))]
          .slice(0, 4)
          .join(" · ");
        const focused = state.focusedRouteId === route.id;
        const open = state.openRouteIds.has(route.id) || focused;
        const cards = open
          ? route.stopIds
              .map((id, i) => {
                const o = byId.get(id);
                if (!o || !matchesFilter(o)) return "";
                return cardHtml(o, i + 1, route.id);
              })
              .join("")
          : "";
        const st = route.stats || {};
        return `
          <section class="dr-route${route.locked ? " is-locked" : ""}${
            focused ? " is-focused" : ""
          }${state.focusedRouteId && !focused ? " is-dimmed-route" : ""}${
            open ? "" : " is-collapsed"
          }" data-route-id="${esc(route.id)}" style="--route-color:${color}">
            <header class="dr-route-head" data-act="focus-route" data-route="${esc(route.id)}">
              <div class="dr-route-head-main">
                <span class="dr-route-badge" style="background:${color}">${rIdx + 1}</span>
                <div class="dr-route-head-text">
                  <h3 class="dr-route-title">${esc(route.name)}${route.locked ? " · 잠금" : ""}</h3>
                  <p class="dr-route-summary-line">
                    ${stops.length} stops
                    ${st.distanceKm != null ? ` · ~${st.distanceKm} km` : ""}
                    ${st.durationLabel ? ` · ${esc(st.durationLabel)}` : ""}
                    ${
                      route.spreadKm != null
                        ? ` · 범위 ${route.spreadKm}km`
                        : ""
                    }
                    ${suburbSummary ? ` · ${esc(suburbSummary)}` : ""}
                  </p>
                  <label class="dr-route-departure" onclick="event.stopPropagation()">
                    <span>출발</span>
                    <input type="time" value="${esc(route.departureTime || "")}" data-route-departure="${esc(route.id)}" aria-label="${esc(route.name)} 출발 시간" />
                  </label>
                  ${route.warning ? `<p class="dr-route-warn">${esc(route.warning)}</p>` : ""}
                </div>
              </div>
              <div class="dr-route-actions">
                <button type="button" class="dr-icon-btn" data-act="optimize" data-route="${esc(
                  route.id
                )}">정렬</button>
                <button type="button" class="dr-icon-btn" data-act="lock" data-route="${esc(
                  route.id
                )}">${route.locked ? "해제" : "잠금"}</button>
                <button type="button" class="dr-icon-btn" data-act="export" data-route="${esc(
                  route.id
                )}">상차표</button>
                <button type="button" class="dr-icon-btn" data-act="print" data-route="${esc(
                  route.id
                )}">인쇄</button>
                <button type="button" class="dr-icon-btn" data-act="toggle-route" data-route="${esc(
                  route.id
                )}">${open ? "접기" : "펼치기"}</button>
                <button type="button" class="dr-icon-btn is-danger" data-act="delete" data-route="${esc(
                  route.id
                )}">삭제</button>
              </div>
            </header>
            <div class="dr-route-body">
              ${
                open
                  ? `<div class="dr-drop-list" data-drop="${esc(route.id)}">${
                      cards || '<p class="dr-empty">주문을 여기로 드래그</p>'
                    }</div>`
                  : ""
              }
            </div>
          </section>`;
      })
      .join("");
  }

  function renderSideLists() {
    const unRoot = $("#dr-unassigned-list");
    const revRoot = $("#dr-review-list");
    const byId = ordersById();

    const unOrders = state.unassignedIds
      .map((id) => byId.get(id))
      .filter((o) => o && isVerifiedOrder(o) && matchesFilter(o));
    unRoot.innerHTML = unOrders.map((o) => cardHtml(o, null, "")).join("") ||
      '<p class="dr-empty">미배정 주문이 없습니다</p>';
    unRoot.dataset.drop = "unassigned";
    const unCount = $("#dr-unassigned-count");
    if (unCount) unCount.textContent = String(unOrders.length);

    const reviewOrders = state.orders.filter(
      (o) =>
        (o.geocodingStatus === "needs_review" || o.status === "needs_review") && matchesFilter(o)
    );
    revRoot.innerHTML =
      reviewOrders
        .map((o) => {
          const suggested = o.suggestedAddress || o.normalizedAddress || "";
          const hasSuggestion = o.suggestedLat != null && o.suggestedLng != null;
          const reason = o.reviewReason || "주소 확인 필요";
          const scoreLabel =
            o.suggestedScore != null || o.geocodeScore != null
              ? ` · score ${o.suggestedScore ?? o.geocodeScore}`
              : "";
          return `
        <article class="dr-card dr-card-review" data-order-id="${esc(o.id)}">
          <div class="dr-card-top">
            <strong>${esc(o.name || "(이름 없음)")}</strong>
          </div>
          <div class="dr-card-sub">${esc(
            o.orderNumber || o.id ? `#${o.orderNumber || o.id}` : ""
          )}${
            (o.orderNumber || o.id) && (o.suburb || o.postcode) ? " · " : ""
          }${esc([o.suburb, o.postcode].filter(Boolean).join(" "))}</div>
          ${o.notes ? `<div class="dr-card-note dr-card-note-inline">⚠ ${esc(o.notes)}</div>` : ""}
          <div class="dr-card-top" style="margin-top:4px">
            <span class="dr-verify-badge">${esc(reason)}${esc(scoreLabel)}</span>
          </div>
          <div class="dr-card-addr"><strong>원본</strong> ${esc(
            o.originalAddress || o.address || "—"
          )}</div>
          ${
            o.unitOrShop
              ? `<div class="dr-card-addr"><strong>Unit/Shop</strong> ${esc(o.unitOrShop)}</div>`
              : ""
          }
          ${
            o.normalizedAddress
              ? `<div class="dr-card-addr"><strong>검색용</strong> ${esc(o.normalizedAddress)}</div>`
              : ""
          }
          ${
            suggested
              ? `<div class="dr-card-suggest"><strong>유력 후보</strong> ${esc(suggested)}</div>`
              : ""
          }
          ${
            o.addressConfirmLog
              ? `<div class="dr-card-log">${esc(o.addressConfirmLog)}</div>`
              : ""
          }
          <div class="dr-review-actions">
            <button type="button" class="dr-btn dr-btn-outline dr-btn-sm" data-act="toggle-edit" data-order="${esc(
              o.id
            )}">주소 수정</button>
            <button type="button" class="dr-btn dr-btn-outline dr-btn-sm" data-act="view-map" data-order="${esc(
              o.id
            )}" ${hasSuggestion ? "" : "disabled"} title="${
              hasSuggestion ? "유력 후보 위치로 지도 이동" : "후보 좌표 없음"
            }">지도 보기</button>
          </div>
          <div class="dr-review-edit-wrap" data-edit-wrap="${esc(o.id)}" hidden>
            <label class="dr-review-edit">
              <span>주소 수정</span>
              <input type="text" data-review-address="${esc(o.id)}" value="${esc(
                o.originalAddress || o.address || ""
              )}" />
            </label>
            <label class="dr-review-edit">
              <span>Suburb</span>
              <input type="text" data-review-suburb="${esc(o.id)}" value="${esc(o.suburb || "")}" />
            </label>
            <label class="dr-review-edit">
              <span>Postcode</span>
              <input type="text" data-review-postcode="${esc(o.id)}" value="${esc(
                o.postcode || ""
              )}" />
            </label>
            <div class="dr-review-actions">
              <button type="button" class="dr-btn dr-btn-primary dr-btn-sm" data-act="research" data-order="${esc(
                o.id
              )}">다시 검색</button>
              ${
                hasSuggestion
                  ? `<button type="button" class="dr-btn dr-btn-ghost dr-btn-sm" data-act="accept-suggest" data-order="${esc(
                      o.id
                    )}">예외: 후보 좌표 확정</button>`
                  : ""
              }
            </div>
          </div>
        </article>`;
        })
        .join("") || '<p class="dr-empty">확인이 필요한 주문이 없습니다</p>';
    const revCount = $("#dr-review-count");
    if (revCount) revCount.textContent = String(reviewOrders.length);

    const hint = $("#dr-routes-hint");
    if (hint) hint.textContent = state.routes.length ? String(state.routes.length) : "0";
  }

  function popupHtml(order, route, stopNumber) {
    const noteLine = order.notes
      ? `<div class="dr-popup-note">⚠ ${esc(order.notes)}</div>`
      : "";
    return `
      <div class="dr-popup">
        <strong>${stopNumber != null ? `${stopNumber}. ` : ""}${esc(order.name || "")}</strong>
        <span class="dr-popup-badge">${route ? "배정됨" : "미배정"}</span>
        <div class="dr-popup-row">${esc(order.originalAddress || order.address || "")}</div>
        <div class="dr-popup-row">${esc(order.phone || "—")}</div>
        <div class="dr-popup-row">${esc(shortSummary(order))}</div>
        ${noteLine}
        <div class="dr-popup-meta">${money(order.total)}</div>
        <div class="dr-popup-meta">${esc(order.orderNumber || order.id || "")}${
          route ? ` · ${esc(route.name)}` : ""
        }</div>
        <button type="button" class="dr-popup-detail" data-act="toggle-detail" data-order="${esc(
          order.id
        )}">상세 보기</button>
      </div>`;
  }

  function renderMap() {
    if (!mapProvider) return;
    const pins = [];
    const byId = ordersById();
    const routePaths = [];
    const legend = [];

    state.routes.forEach((route, rIdx) => {
      const stopCoords = [];
      route.stopIds.forEach((id, i) => {
        const o = byId.get(id);
        if (!o || !hasCoords(o)) return;
        if (state.filter.q && !matchesFilter(o)) return;
        const c = coordsOf(o);
        pins.push({
          id: o.id,
          lat: c.lat,
          lng: c.lng,
          routeIndex: rIdx,
          stopNumber: i + 1,
          popupHtml: popupHtml(o, route, i + 1),
        });
        stopCoords.push(c);
      });

      if (stopCoords.length) {
        const path = state.start?.lat != null ? [state.start, ...stopCoords] : stopCoords;
        routePaths.push({ routeIndex: rIdx, path, name: route.name });
      }

      const stops = route.stopIds.map((id) => byId.get(id)).filter(Boolean);
      const st = route.stats || {};
      legend.push({
        routeIndex: rIdx,
        name: route.name,
        stops: stops.length,
        distanceKm: st.distanceKm,
        durationLabel: st.durationLabel,
        departureTime: route.departureTime || "",
      });
    });

    // unassigned only in overview
    if (!state.focusedRouteId) {
      state.unassignedIds.forEach((id) => {
        const o = orderOf(id);
        if (!o || !hasCoords(o) || !matchesFilter(o)) return;
        const c = coordsOf(o);
        pins.push({
          id: o.id,
          lat: c.lat,
          lng: c.lng,
          routeIndex: null,
          stopNumber: null,
          popupHtml: popupHtml(o, null, null),
        });
      });
    }

    const focusRouteIndex = state.focusedRouteId
      ? routeIndexOf(state.focusedRouteId)
      : null;

    mapProvider.setStart(state.start, state.start?.label || "출발지");
    mapProvider.setPins(pins, {
      start: state.start,
      focusRouteIndex: focusRouteIndex >= 0 ? focusRouteIndex : null,
      routePaths,
      legend,
      fit: !state.selectedId,
    });

    const clearBtn = $("#btn-clear-focus");
    if (clearBtn) clearBtn.hidden = !state.focusedRouteId;
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
    if (!isGeocodingFinished()) {
      alert("모든 주소 확인이 끝난 뒤에 Route를 생성할 수 있습니다.");
      return;
    }
    const lockedIds = new Set(state.routes.filter((r) => r.locked).flatMap((r) => r.stopIds));
    const lockedRoutes = state.routes.filter((r) => r.locked);
    const eligibleFn = window.KHRouting?.isGroupingEligible || isVerifiedOrder;
    const movable = state.orders.filter((o) => eligibleFn(o) && !lockedIds.has(o.id));
    if (!movable.length) {
      alert(
        "자동 그룹핑할 확정 좌표 주문이 없습니다.\nNeeds Review / 부분 일치 주소는 제외됩니다."
      );
      return;
    }
    const grouping = window.KHRouting?.getGroupingSettings?.() || {};
    const generated = window.KHRouting.autoGroupStops(movable, {
      maxPerRoute: grouping.maxStopsPerRoute || MAX_STOPS,
      maxStopsPerRoute: grouping.maxStopsPerRoute || MAX_STOPS,
      maxRouteSpreadKm: grouping.maxRouteSpreadKm || 14,
      warnSpreadKm: grouping.warnSpreadKm || 16,
      origin: state.start,
    });
    let n = lockedRoutes.length;
    generated.forEach((g) => {
      n += 1;
      g.name = `Route ${n}`;
      g.id = `route-${Date.now()}-${n}`;
    });
    state.routes = [...lockedRoutes, ...generated];
    const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
    state.unassignedIds = state.orders
      .filter((o) => eligibleFn(o) && !assigned.has(o.id))
      .map((o) => o.id);
    state.focusedRouteId = state.routes[0]?.id || null;
    if (state.focusedRouteId) state.openRouteIds.add(state.focusedRouteId);
    refreshRouteStats();
    persist();
    renderAll();
    const warns = state.routes.filter((r) => r.warning);
    const sizes = state.routes.map((r) => r.stopIds.length).join(" / ");
    alert(
      `Route ${state.routes.length}개 생성 (${sizes}).\n가까운 지역 우선 · 최대 ${
        grouping.maxRouteSpreadKm || 14
      }km 범위.\n${
        warns.length ? `범위 경고 ${warns.length}개.` : "범위 경고 없음."
      }`
    );
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
      departureTime: "",
      stats: { distanceKm: 0, durationMin: 0, durationLabel: "—", approximate: true },
    });
    persist();
    renderAll();
  }

  async function exportRoutesXlsx(routes) {
    const key = getAdminKey();
    if (!key) throw new Error("로그인이 필요합니다.");
    if (!window.KHRouteExport?.exportRoutesReservation) {
      throw new Error("Export 모듈을 불러오지 못했습니다. 페이지를 새로고침 해 주세요.");
    }
    await window.KHRouteExport.exportRoutesReservation(
      ordersById(),
      routes,
      state.deliveryDate,
      key
    );
  }

  function deleteRoute(routeId) {
    const route = state.routes.find((r) => r.id === routeId);
    if (!route) return;
    if (!confirm(`「${route.name}」을(를) 삭제하고 주문은 미배정으로 옮길까요?`)) return;
    state.unassignedIds.push(...route.stopIds);
    state.routes = state.routes.filter((r) => r.id !== routeId);
    if (state.focusedRouteId === routeId) state.focusedRouteId = null;
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
    const html =
      window.KHRouteExport?.buildLoadingSheetPrintHtml?.(route, byId, state.deliveryDate, {
        esc,
      }) || "";
    if (!html) {
      alert("인쇄 양식을 불러오지 못했습니다.");
      return;
    }
    const w = window.open("", "_blank");
    if (!w) {
      alert("팝업이 차단되었습니다. 팝업을 허용해 주세요.");
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  async function researchAddress(orderId) {
    const o = orderOf(orderId);
    if (!o) return;
    const addrInput = $(`[data-review-address="${CSS.escape(orderId)}"]`);
    const subInput = $(`[data-review-suburb="${CSS.escape(orderId)}"]`);
    const pcInput = $(`[data-review-postcode="${CSS.escape(orderId)}"]`);
    const address = (addrInput?.value || o.originalAddress || "").trim();
    const suburb = (subInput?.value || o.suburb || "").trim();
    const postcode = (pcInput?.value || o.postcode || "").trim();
    if (!address) return alert("주소를 입력해 주세요.");

    o.originalAddress = address;
    o.address = address;
    o.suburb = suburb;
    o.postcode = postcode;
    setProgress(`다시 검색 중… ${o.name || orderId}`);
    await geocodeOrder(o, { force: true });

    // remove from all routes while reviewing
    state.routes.forEach((r) => {
      r.stopIds = r.stopIds.filter((id) => id !== orderId);
    });
    state.unassignedIds = state.unassignedIds.filter((id) => id !== orderId);

    if (isVerifiedOrder(o)) {
      state.unassignedIds.push(orderId);
      setProgress(`주소 확인됨: ${o.name || orderId}`);
    } else {
      setProgress(`여전히 확인 필요: ${o.reviewReason || ""}`);
    }
    setTimeout(() => setProgress("", { hidden: true }), 2500);
    persist();
    renderAll();
  }

  function viewSuggestedOnMap(orderId) {
    const o = orderOf(orderId);
    if (!o) return;
    state.selectedId = orderId;
    const lat = o.suggestedLat ?? o.lat ?? o.latitude;
    const lng = o.suggestedLng ?? o.lng ?? o.longitude;
    if (lat == null || lng == null) {
      setProgress("지도에 표시할 후보 좌표가 없습니다");
      setTimeout(() => setProgress("", { hidden: true }), 2000);
      return;
    }
    document.body.dataset.drView = state.viewMode === "list" ? "split" : state.viewMode;
    if (state.viewMode === "list") {
      state.viewMode = "split";
      $$("[data-view-mode]").forEach((b) =>
        b.classList.toggle("active", b.dataset.viewMode === "split")
      );
    }
    requestAnimationFrame(() => {
      mapProvider?.invalidate();
      if (typeof mapProvider?.flyTo === "function") {
        mapProvider.flyTo(lat, lng, 16);
      } else {
        mapProvider?.highlight?.(orderId);
      }
    });
    setProgress(`지도: ${o.suggestedAddress || o.normalizedAddress || o.name || orderId}`);
    setTimeout(() => setProgress("", { hidden: true }), 2500);
  }

  function acceptSuggestedLocation(orderId) {
    const o = orderOf(orderId);
    if (!o) return;
    try {
      ensureGeocodeService().applyManualOverride(o);
      state.routes.forEach((r) => {
        r.stopIds = r.stopIds.filter((id) => id !== orderId);
      });
      state.unassignedIds = state.unassignedIds.filter((id) => id !== orderId);
      state.unassignedIds.push(orderId);
      persist();
      renderAll();
      setProgress(`위치 확정: ${o.name || orderId}`);
      setTimeout(() => setProgress("", { hidden: true }), 2000);
    } catch (err) {
      alert(err.message || "위치 확정 실패");
    }
  }

  function focusRoute(routeId) {
    if (state.focusedRouteId === routeId) {
      state.focusedRouteId = null;
    } else {
      state.focusedRouteId = routeId;
      state.openRouteIds.add(routeId);
    }
    state.selectedId = null; // allow map fitBounds on focused route
    renderAll();
  }

  function toggleRouteOpen(routeId) {
    if (state.openRouteIds.has(routeId)) state.openRouteIds.delete(routeId);
    else state.openRouteIds.add(routeId);
    renderAll();
  }

  function resetPlannerState() {
    state.orders = [];
    state.routes = [];
    state.unassignedIds = [];
    state.selectedId = null;
    state.focusedRouteId = null;
    state.expandedIds = new Set();
    state.openRouteIds = new Set();
    state.filter = { q: "", routeId: "all", suburb: "all", postcode: "all" };
    state.geocodingInProgress = false;
    state.geocodingDone = 0;
    state.geocodingTotal = 0;
    state.pendingRows = null;
    state.pendingHeaders = null;
    state.mapping = null;
    state.dataSource = null;
    try {
      window.KHRouteStorage.clear();
    } catch (_) {
      /* ignore */
    }
  }

  /* ---------- Upload ---------- */
  async function ingestOrdersFromUpload(
    orders,
    { label = "업로드", freshStart = false, dataSource = "upload" } = {}
  ) {
    if (freshStart) {
      resetPlannerState();
      setProgress(`${label} · 기존 작업 초기화 후 0건부터 시작`);
    }

    const ready = orders.map(migrateOrder).map((o) => ({
      ...o,
      geocodingStatus: o.geocodingStatus || "pending",
      status: o.status || "pending",
    }));
    state.dataSource = dataSource;
    state.orders = ready;
    state.routes = [];
    state.focusedRouteId = null;
    state.selectedId = null;
    state.unassignedIds = [];
    persist();
    renderAll();

    await geocodeAll(ready, { reusePrev: false, concurrency: 1 });
    state.orders = ready;
    state.unassignedIds = ready.filter((o) => isVerifiedOrder(o)).map((o) => o.id);

    const okN = state.unassignedIds.length;
    const reviewN = ready.length - okN;
    const autoN = ready.filter(
      (o) =>
        isVerifiedOrder(o) &&
        o.addressConfirmMode !== "manual" &&
        o.verificationStatus !== "manual_override"
    ).length;
    setProgress(`${label} 완료 · 자동 확인 ${autoN} · 확인 필요 ${reviewN}`);
    persist();
    renderAll();

    if (okN > 0) {
      setProgress(`배송루트 자동 생성 중… (${okN}건)`);
      try {
        await autoGroup();
        setProgress(
          `${label} → Route ${state.routes.length}개 · 자동 확인 ${autoN} · 확인 필요 ${reviewN}`
        );
      } catch (err) {
        alert("루트 자동 생성 실패: " + (err.message || err));
      }
    } else {
      alert(
        `${label} 완료.\n자동 확인 ${autoN}건 / 확인 필요 ${reviewN}건\n애매한 주소만 수정한 뒤 배송루트 자동 생성을 눌러 주세요.`
      );
    }
    setTimeout(() => {
      const el = $("#dr-upload-progress");
      if (el && String(el.textContent || "").includes(label)) el.hidden = true;
    }, 8000);
  }

  async function onFileSelected(file) {
    try {
      const buf = await file.arrayBuffer();
      setProgress("예약표 파일 읽는 중…");

      // 김치하우스 주문 예약표 → 매핑 없이 바로 반영 + 루트 자동 생성
      const reservation = window.KHSpreadsheet.parseKimchiReservationWorkbook?.(buf);
      if (reservation?.orders?.length) {
        const sheetLabel = reservation.sheets.join(", ");
        if (
          !confirm(
            `예약표 ${reservation.orders.length}건을 불러옵니다.\n(${sheetLabel})\n\n기존 주문·루트는 모두 지우고 0건부터 시작합니다. 계속할까요?`
          )
        ) {
          setProgress("", { hidden: true });
          return;
        }
        await ingestOrdersFromUpload(reservation.orders, {
          label: `예약표 ${reservation.orders.length}건`,
          freshStart: true,
          dataSource: "reservation",
        });
        return;
      }

      const { headers, rows } = window.KHSpreadsheet.parseWorkbook(buf);
      state.pendingHeaders = headers;
      state.pendingRows = rows;
      state.mapping = window.KHSpreadsheet.suggestMapping(headers);
      setProgress("", { hidden: true });
      openMappingModal();
    } catch (err) {
      setProgress("", { hidden: true });
      alert(err.message || "파일 읽기 실패");
    }
  }

  function openMappingModal() {
    const modal = $("#dr-mapping-modal");
    const body = $("#dr-mapping-fields");
    body.innerHTML = window.KHSpreadsheet.FIELD_DEFS.map((f) => {
      const opts = [`<option value="">— 선택 안 함 —</option>`]
        .concat(
          state.pendingHeaders.map(
            (h) =>
              `<option value="${esc(h)}"${state.mapping[f.key] === h ? " selected" : ""}>${esc(
                h
              )}</option>`
          )
        )
        .join("");
      return `<label class="dr-map-field"><span>${esc(f.label)}</span><select data-map-key="${esc(
        f.key
      )}">${opts}</select></label>`;
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
    const orders = window.KHSpreadsheet.applyMapping(state.pendingRows, state.mapping).map(
      migrateOrder
    );
    $("#dr-mapping-modal").hidden = true;
    await ingestOrdersFromUpload(orders, { label: "업로드" });
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

    $("#btn-more")?.addEventListener("click", () => {
      const menu = $("#dr-more-menu");
      const btn = $("#btn-more");
      if (!menu) return;
      menu.hidden = !menu.hidden;
      btn?.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
    });
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".dr-more")) {
        const menu = $("#dr-more-menu");
        if (menu) menu.hidden = true;
      }
    });

    $("#btn-load-demo")?.addEventListener("click", async () => {
      if (!confirm("데모 샘플 주문으로 바꿀까요?")) return;
      loadDemo();
      state.dataSource = "demo";
      await geocodeAll(state.orders, { reusePrev: false });
      state.unassignedIds = state.orders
        .filter((o) => isVerifiedOrder(o))
        .map((o) => o.id);
      persist();
      renderAll();
    });

    async function refreshOrders() {
      try {
        if (state.dataSource === "reservation" || state.dataSource === "upload") {
          if (
            !confirm(
              "지금 화면은 업로드한 예약표입니다.\n온라인 주문으로 바꾸면 예약표 작업이 사라집니다. 계속할까요?"
            )
          ) {
            return;
          }
        }
        await loadLiveOrders({ quiet: false, force: true });
        renderAll();
      } catch (err) {
        alert(err.message || "새로고침 실패");
      }
    }
    $("#btn-refresh-orders")?.addEventListener("click", refreshOrders);
    $("#btn-refresh-orders-more")?.addEventListener("click", () => {
      $("#dr-more-menu").hidden = true;
      refreshOrders();
    });

    $("#btn-auto-group")?.addEventListener("click", autoGroup);
    $("#btn-add-route")?.addEventListener("click", addRoute);
    $("#btn-add-route-more")?.addEventListener("click", () => {
      $("#dr-more-menu").hidden = true;
      addRoute();
    });
    $("#btn-export-all")?.addEventListener("click", async () => {
      try {
        setProgress("상차표 Export 생성 중…");
        await exportRoutesXlsx(state.routes);
        setProgress("상차표 Export 완료");
        setTimeout(() => setProgress("", { hidden: true }), 2500);
      } catch (err) {
        setProgress("", { hidden: true });
        alert(err.message || "Export 실패");
      }
    });
    $("#btn-clear")?.addEventListener("click", () => {
      if (!confirm("배송루트 작업 내용을 모두 지울까요?")) return;
      window.KHRouteStorage.clear();
      state.orders = [];
      state.routes = [];
      state.unassignedIds = [];
      state.focusedRouteId = null;
      state.dataSource = null;
      renderAll();
    });

    function renderGeocodeDebugPanel() {
      const panel = $("#dr-geocode-debug");
      const logEl = $("#dr-geocode-debug-log");
      if (!panel || !logEl || panel.hidden) return;
      const entries = window.KHGeocode?.getDebugLog?.() || [];
      logEl.textContent = entries
        .slice()
        .reverse()
        .slice(0, 40)
        .map((e) => {
          return [
            `── ${e.at || ""} · ${e.phase || ""}`,
            `original: ${e.originalAddress || ""}`,
            `normalized: ${e.normalizedAddress || ""}`,
            e.structuredQuery ? `query: ${JSON.stringify(e.structuredQuery)}` : null,
            e.candidateResults
              ? `candidates: ${JSON.stringify(
                  e.candidateResults.map((c) => ({
                    score: c.score,
                    name: c.displayName,
                    lat: c.lat,
                    lng: c.lng,
                  }))
                )}`
              : null,
            e.finalSelectedCoordinate
              ? `selected: ${JSON.stringify(e.finalSelectedCoordinate)}`
              : null,
            e.failureReason ? `failure: ${e.failureReason}` : null,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n");
    }

    $("#btn-geocode-debug")?.addEventListener("click", () => {
      const panel = $("#dr-geocode-debug");
      if (!panel) return;
      const next = panel.hidden;
      panel.hidden = !next;
      window.KHGeocode?.setDebugEnabled?.(next);
      if (next) renderGeocodeDebugPanel();
      const menu = $("#dr-more-menu");
      if (menu) menu.hidden = true;
    });
    $("#btn-debug-close")?.addEventListener("click", () => {
      const panel = $("#dr-geocode-debug");
      if (panel) panel.hidden = true;
    });
    $("#btn-debug-clear")?.addEventListener("click", () => {
      window.KHGeocode?.clearDebugLog?.();
      renderGeocodeDebugPanel();
    });
    window.addEventListener("kh-geocode-debug", () => renderGeocodeDebugPanel());

    if (window.KHGeocode?.isDebugEnabled?.()) {
      const panel = $("#dr-geocode-debug");
      if (panel) panel.hidden = false;
    }
    $("#btn-clear-focus")?.addEventListener("click", () => {
      state.focusedRouteId = null;
      renderAll();
    });

    $("#file-upload")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) onFileSelected(file);
      e.target.value = "";
    });
    $("#file-upload-more")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      $("#dr-more-menu").hidden = true;
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
    $("#filter-route")?.addEventListener("change", (e) => {
      state.filter.routeId = e.target.value;
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

    $("#btn-filter-reset")?.addEventListener("click", () => {
      state.filter = { q: "", routeId: "all", suburb: "all", postcode: "all" };
      const q = $("#filter-q");
      if (q) q.value = "";
      const route = $("#filter-route");
      if (route) route.value = "all";
      const suburb = $("#filter-suburb");
      if (suburb) suburb.value = "all";
      const postcode = $("#filter-postcode");
      if (postcode) postcode.value = "all";
      renderAll();
    });

    $("#btn-fit-map")?.addEventListener("click", () => {
      state.focusedRouteId = null;
      renderMap();
      mapProvider?.invalidate();
    });

    $$("[data-view-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.viewMode = btn.dataset.viewMode;
        document.body.dataset.drView = state.viewMode;
        $$("[data-view-mode]").forEach((b) =>
          b.classList.toggle("active", b.dataset.viewMode === state.viewMode)
        );
        requestAnimationFrame(() => mapProvider?.invalidate());
      });
    });

    $("#dr-panel")?.addEventListener("change", (e) => {
      const input = e.target.closest("[data-route-departure]");
      if (!input) return;
      const route = state.routes.find((r) => r.id === input.dataset.routeDeparture);
      if (!route) return;
      route.departureTime = input.value || "";
      persist();
      renderMap();
    });

    $("#dr-panel")?.addEventListener("click", (e) => {
      const actBtn = e.target.closest("[data-act]");
      if (actBtn) {
        e.preventDefault();
        e.stopPropagation();
        const act = actBtn.dataset.act;
        const routeId = actBtn.dataset.route;
        const orderId = actBtn.dataset.order;
        if (act === "focus-route") {
          // Ignore header focus when interacting with nested controls
          if (e.target.closest("input, button, label, select, textarea")) return;
          focusRoute(routeId);
          return;
        }
        if (act === "toggle-route") toggleRouteOpen(routeId);
        if (act === "rename") renameRoute(routeId);
        if (act === "optimize") optimizeRoute(routeId);
        if (act === "lock") toggleLock(routeId);
        if (act === "delete") deleteRoute(routeId);
        if (act === "export") {
          const route = state.routes.find((r) => r.id === routeId);
          if (route) {
            exportRoutesXlsx([route]).catch((err) => alert(err.message || "Export 실패"));
          }
        }
        if (act === "print") printRoute(routeId);
        if (act === "research") researchAddress(orderId);
        if (act === "accept-suggest") acceptSuggestedLocation(orderId);
        if (act === "view-map") viewSuggestedOnMap(orderId);
        if (act === "toggle-edit") {
          const wrap = $(`[data-edit-wrap="${CSS.escape(orderId)}"]`);
          if (wrap) wrap.hidden = !wrap.hidden;
        }
        if (act === "toggle-detail") {
          if (state.expandedIds.has(orderId)) state.expandedIds.delete(orderId);
          else state.expandedIds.add(orderId);
          renderAll();
        }
        return;
      }
      const card = e.target.closest(".dr-card[data-order-id]");
      if (card && !e.target.closest("input,button,label")) {
        state.selectedId = card.dataset.orderId;
        mapProvider?.highlight(state.selectedId);
        renderAll();
      }
    });

    $("#btn-edit-start")?.addEventListener("click", async () => {
      const label = prompt("출발지 이름", state.start?.label || "김치하우스 출발지");
      if (label == null) return;
      const address = prompt(
        "출발지 주소",
        state.start?.address || "36 Mid Dural Rd, Galston NSW 2159"
      );
      if (address == null) return;
      let lat = state.start?.lat;
      let lng = state.start?.lng;
      try {
        const tmp = { originalAddress: address.trim(), address: address.trim() };
        await geocodeOrder(tmp, { force: true });
        if (hasCoords(tmp)) {
          lat = tmp.lat;
          lng = tmp.lng;
        }
      } catch (_) {
        /* keep */
      }
      state.start = {
        label: label.trim() || "출발지",
        address: address.trim(),
        lat: lat ?? -33.649215,
        lng: lng ?? 151.034199,
      };
      refreshRouteStats();
      persist();
      renderAll();
    });
  }

  async function initApp() {
    if (document.body.dataset.drInited === "1") {
      // 탭 재진입/부모 sync — 예약표·업로드 작업은 절대 덮어쓰지 않음
      if (shouldSkipLiveReload()) {
        renderAll();
        return;
      }
      try {
        await loadLiveOrders({ quiet: true });
        renderAll();
      } catch (err) {
        console.warn(err);
      }
      return;
    }
    document.body.dataset.drInited = "1";

    ensureGeocodeService();
    router = new window.KHRouting.LocalRoutingProvider();
    state.start = state.start || { ...window.KHDeliverySample.DEFAULT_START };

    loadPersisted();
    if (!state.start) state.start = { ...window.KHDeliverySample.DEFAULT_START };

    bindEvents();
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    state.viewMode = narrow ? "list" : "split";
    document.body.dataset.drView = state.viewMode;
    $$("[data-view-mode]").forEach((b) =>
      b.classList.toggle("active", b.dataset.viewMode === state.viewMode)
    );
    document.body.classList.add("dr-app-active");

    try {
      const mapEl = $("#dr-map");
      const start = state.start || window.KHDeliverySample.DEFAULT_START;
      mapProvider = new window.KHMap.LeafletMapProvider(mapEl, {
        center: { lat: start.lat, lng: start.lng },
        zoom: 11,
        onPinClick: (id) => {
          state.selectedId = id;
          renderAll();
          const el = document.querySelector(`.dr-card[data-order-id="${CSS.escape(id)}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        },
        onLegendClick: (routeIndex) => {
          const route = state.routes[routeIndex];
          if (!route) return;
          focusRoute(route.id);
        },
      });
      mapProvider.init();
    } catch (err) {
      console.error("map init failed", err);
      const fallback = $("#dr-map-fallback");
      if (fallback) fallback.hidden = false;
      alert("지도 초기화에 실패했습니다.\n" + (err.message || ""));
    }

    renderAll();
    requestAnimationFrame(() => mapProvider?.invalidate());

    // 저장된 예약표/업로드가 있으면 API로 덮어쓰지 않음
    if (shouldSkipLiveReload() && state.orders.length) {
      updateAutoGroupButton();
      const need = state.orders.some(
        (o) =>
          !o.geocodingStatus ||
          o.geocodingStatus === "pending" ||
          (!hasCoords(o) && o.status === "ok")
      );
      if (need) {
        await geocodeAll(state.orders, { reusePrev: false });
        const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
        state.unassignedIds = state.orders
          .filter((o) => isVerifiedOrder(o) && !assigned.has(o.id))
          .map((o) => o.id);
        persist();
        renderAll();
        if (state.routes.length === 0 && state.unassignedIds.length > 0) {
          await autoGroup();
        }
      } else if (state.routes.length === 0 && state.unassignedIds.length > 0) {
        await autoGroup();
      }
      return;
    }

    try {
      await loadLiveOrders({ quiet: true });
      renderAll();
      requestAnimationFrame(() => mapProvider?.invalidate());
    } catch (err) {
      console.warn("live orders load failed", err);
      if (!state.orders.length) {
        loadDemo();
        state.dataSource = "demo";
        await geocodeAll(state.orders, { reusePrev: false });
        state.unassignedIds = state.orders
          .filter((o) => isVerifiedOrder(o))
          .map((o) => o.id);
        persist();
        renderAll();
        alert("주문 DB를 불러오지 못해 데모 데이터로 시작합니다.\n" + (err.message || ""));
      } else {
        const need = state.orders.some(
          (o) =>
            !o.geocodingStatus ||
            o.geocodingStatus === "pending" ||
            (!hasCoords(o) && o.status === "ok")
        );
        if (need) {
          await geocodeAll(state.orders, { reusePrev: false });
          const assigned = new Set(state.routes.flatMap((r) => r.stopIds));
          state.unassignedIds = state.orders
            .filter((o) => isVerifiedOrder(o) && !assigned.has(o.id))
            .map((o) => o.id);
          persist();
          renderAll();
        }
        updateAutoGroupButton();
      }
    }
  }

  function boot() {
    const isEmbed = applyEmbedMode();
    listenParentSync();
    const key = getAdminKey();
    if (key) setAdminKey(key);
    const login = $("#dr-login");
    const app = $("#dr-app");
    if (key) {
      if (login) login.hidden = true;
      if (app) app.hidden = false;
      showApp();
      return;
    }
    if (isEmbed) {
      if (login) login.hidden = true;
      if (app) app.hidden = true;
      setTimeout(() => {
        if (getAdminKey()) return;
        if (login) login.hidden = false;
        $("#dr-login-btn")?.addEventListener("click", tryLogin);
        $("#dr-password")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") tryLogin();
        });
      }, 1200);
      return;
    }
    if (login) login.hidden = false;
    if (app) app.hidden = true;
    $("#dr-login-btn")?.addEventListener("click", tryLogin);
    $("#dr-password")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") tryLogin();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
