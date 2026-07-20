/**
 * Delivery Center (배송관리) — independent from Orders CRUD.
 * Reads orders via ctx; writes only to /api/delivery-ops (never mutates order documents).
 */
(function () {
  const OPS_STATUSES = ["배송준비", "배송중", "배송완료"];
  const DEFAULT_OPS_STATUS = "배송준비";

  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  window.KHAdminDelivery = {
    create(ctx) {
      const D = ctx.deliveryUtils || window.KH_DELIVERY;
      const state = {
        opsById: {},
        selected: new Set(),
        dateFilter: "all",
        opsStatusFilter: "all",
        roundScope: "current",
        search: "",
        routeOpen: false,
        routeStops: [],
      };

      function authHeaders() {
        return {
          Authorization: `Bearer ${ctx.getAdminKey()}`,
          "Content-Type": "application/json",
        };
      }

      function opsOf(orderId) {
        const raw = state.opsById[orderId];
        if (!raw || typeof raw !== "object") {
          return { status: DEFAULT_OPS_STATUS, routeIndex: null, note: "" };
        }
        return {
          status: OPS_STATUSES.includes(raw.status) ? raw.status : DEFAULT_OPS_STATUS,
          routeIndex: raw.routeIndex == null ? null : Number(raw.routeIndex),
          note: String(raw.note || ""),
        };
      }

      function deliveryDate(o) {
        return D.resolveDeliveryDate(o);
      }

      function suburbKey(o) {
        const suburb = String(o?.customer?.suburb || "").trim();
        return suburb || "Suburb 미입력";
      }

      /** Extract 4-digit AU postcode from address when present (no dedicated field). */
      function postcodeOf(o) {
        const address = String(o?.customer?.address || "");
        const m = address.match(/\b(\d{4})\b/);
        return m ? m[1] : "";
      }

      function regionSortKey(o) {
        const suburb = suburbKey(o).toLowerCase();
        const postcode = postcodeOf(o);
        const address = String(o?.customer?.address || "").toLowerCase();
        return `${suburb}\u0000${postcode}\u0000${address}\u0000${o.id}`;
      }

      function isInRoundScope(o) {
        if (state.roundScope === "previous") return D.isPreviousRoundOrder(o);
        return D.isCurrentRoundOrder(o);
      }

      function allOrders() {
        return typeof ctx.getOrders === "function" ? ctx.getOrders() || [] : [];
      }

      function filteredOrders() {
        const q = state.search.trim().toLowerCase();
        return allOrders().filter((o) => {
          if (!isInRoundScope(o)) return false;
          if (state.dateFilter !== "all" && deliveryDate(o) !== state.dateFilter) return false;
          if (state.opsStatusFilter !== "all" && opsOf(o.id).status !== state.opsStatusFilter) return false;
          if (!q) return true;
          const c = o.customer || {};
          const hay = [o.id, c.name, c.phone, c.kakao, c.address, c.suburb, o.note]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return hay.includes(q);
        });
      }

      function uniqueDates(list) {
        const set = new Set(list.map(deliveryDate));
        const dates = Array.from(set).sort();
        return state.roundScope === "previous" ? dates.reverse() : dates;
      }

      /**
       * Google Maps–ready stop shape (lat/lng reserved for future geocoding).
       */
      function toRouteStop(o, index) {
        const c = o.customer || {};
        return {
          sequence: index + 1,
          orderId: o.id,
          name: c.name || "",
          phone: c.phone || "",
          address: c.address || "",
          suburb: c.suburb || "",
          postcode: postcodeOf(o),
          deliveryDate: deliveryDate(o),
          itemsSummary: (o.items || []).map((i) => `${i.name}×${i.qty}`).join(" / "),
          note: o.note || "",
          lat: null,
          lng: null,
        };
      }

      function buildGroupedSorted(list) {
        const sorted = list.slice().sort((a, b) => regionSortKey(a).localeCompare(regionSortKey(b), "en"));
        const groups = [];
        const map = new Map();
        for (const o of sorted) {
          const key = suburbKey(o);
          if (!map.has(key)) {
            const g = { suburb: key, orders: [] };
            map.set(key, g);
            groups.push(g);
          }
          map.get(key).orders.push(o);
        }
        return { sorted, groups };
      }

      function buildRouteFromSelection() {
        const source = state.selected.size
          ? allOrders().filter((o) => state.selected.has(o.id))
          : filteredOrders();
        const { sorted } = buildGroupedSorted(source);
        state.routeStops = sorted.map((o, i) => toRouteStop(o, i));
        return state.routeStops;
      }

      async function fetchOps() {
        const res = await fetch(ctx.deliveryOpsApi, { headers: { Authorization: `Bearer ${ctx.getAdminKey()}` } });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "배송 작업 조회 실패");
        state.opsById = data.ops?.byOrderId || {};
        if (data.store) ctx.setStore?.(data.store);
        return data;
      }

      async function patchOps(updates) {
        const res = await fetch(ctx.deliveryOpsApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "배송 작업 저장 실패");
        state.opsById = data.ops?.byOrderId || state.opsById;
        return data;
      }

      async function copyText(text) {
        if (typeof ctx.copyText === "function") return ctx.copyText(text);
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      }

      function syncSelectedCount() {
        const el = document.getElementById("dc-selected-count");
        if (el) el.textContent = `선택 ${state.selected.size}건`;
      }

      function renderDateTabs(list) {
        const root = document.getElementById("dc-date-tabs");
        if (!root) return;
        const dates = uniqueDates(list.length ? list : allOrders().filter(isInRoundScope));
        const scopeList = allOrders().filter(isInRoundScope);
        root.innerHTML = `
          <button type="button" class="filter-tab${state.dateFilter === "all" ? " active" : ""}" data-dc-date="all">전체 (${scopeList.length})</button>
          ${dates
            .map((date) => {
              const count = scopeList.filter((o) => deliveryDate(o) === date).length;
              return `<button type="button" class="filter-tab${state.dateFilter === date ? " active" : ""}" data-dc-date="${esc(date)}">${esc(D.formatDeliveryDateLabel(date))} (${count})</button>`;
            })
            .join("")}`;
      }

      function renderOpsStatusTabs() {
        const root = document.getElementById("dc-ops-status-tabs");
        if (!root) return;
        root.innerHTML = `
          <button type="button" class="filter-tab${state.opsStatusFilter === "all" ? " active" : ""}" data-dc-ops-status="all">전체</button>
          ${OPS_STATUSES.map(
            (s) =>
              `<button type="button" class="filter-tab${state.opsStatusFilter === s ? " active" : ""}" data-dc-ops-status="${esc(s)}">${esc(s)}</button>`
          ).join("")}`;
      }

      function renderRoutePanel() {
        const panel = document.getElementById("dc-route-panel");
        if (!panel) return;
        if (!state.routeOpen) {
          panel.hidden = true;
          return;
        }
        const stops = state.routeStops.length ? state.routeStops : buildRouteFromSelection();
        panel.hidden = false;
        panel.innerHTML = `
          <div class="admin-route-title">배송 순서 · ${stops.length}곳
            <span class="admin-route-scope">${state.selected.size ? `선택 ${state.selected.size}건` : "현재 목록"} · suburb 정렬 (Maps 연동 준비)</span>
          </div>
          <ol class="admin-route-list">
            ${stops
              .map(
                (s) =>
                  `<li data-lat="${s.lat ?? ""}" data-lng="${s.lng ?? ""}" data-order-id="${esc(s.orderId)}">
                    <strong>${s.sequence}. ${esc(s.suburb || "Suburb 미입력")}${s.postcode ? ` (${esc(s.postcode)})` : ""}</strong><br>
                    ${esc(s.address)}<br>${esc(s.name)} · ${esc(s.phone)} · ${esc(s.orderId)}
                  </li>`
              )
              .join("")}
          </ol>
          <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" id="dc-copy-route-btn">루트 텍스트 복사</button>`;
      }

      function renderList() {
        const root = document.getElementById("dc-order-list");
        if (!root) return;
        const list = filteredOrders();
        const { groups } = buildGroupedSorted(list);
        renderDateTabs(allOrders().filter(isInRoundScope));
        renderOpsStatusTabs();
        syncSelectedCount();

        const meta = document.getElementById("dc-list-meta");
        if (meta) meta.textContent = `${list.length}건 · 지역 ${groups.length}곳`;

        if (!list.length) {
          root.innerHTML = `<p class="admin-empty">조건에 맞는 배송 주문이 없습니다.</p>`;
          renderRoutePanel();
          return;
        }

        root.innerHTML = groups
          .map((group) => {
            const rows = group.orders
              .map((o) => {
                const c = o.customer || {};
                const ops = opsOf(o.id);
                const checked = state.selected.has(o.id) ? " checked" : "";
                const postcode = postcodeOf(o);
                const items = (o.items || []).map((i) => `${esc(i.name)} ${i.qty}`).join(", ");
                return `<article class="dc-order-card${state.selected.has(o.id) ? " selected" : ""}" data-dc-order="${esc(o.id)}">
                  <div class="dc-order-main">
                    <label class="admin-delivery-check">
                      <input type="checkbox" data-dc-select="${esc(o.id)}"${checked} />
                    </label>
                    <div class="dc-order-body">
                      <div class="dc-order-top">
                        <strong class="dc-order-id">${esc(o.id)}</strong>
                        <span class="dc-order-date">${esc(D.formatDeliveryDateLabel(deliveryDate(o)))}</span>
                        <select class="admin-status-select dc-ops-select" data-dc-ops-status-set="${esc(o.id)}" aria-label="배송 작업 상태">
                          ${OPS_STATUSES.map(
                            (s) => `<option value="${esc(s)}"${ops.status === s ? " selected" : ""}>${esc(s)}</option>`
                          ).join("")}
                        </select>
                      </div>
                      <p class="dc-order-customer"><strong>${esc(c.name || "-")}</strong> · ${esc(c.phone || "-")}</p>
                      <p class="dc-order-address">${esc(c.address || "-")}${postcode ? ` · ${esc(postcode)}` : ""}${c.suburb ? ` · ${esc(c.suburb)}` : ""}</p>
                      <p class="dc-order-items">${items || "-"}</p>
                    </div>
                  </div>
                  <div class="dc-order-actions">
                    <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-dc-copy-phone="${esc(o.id)}">전화번호 복사</button>
                    <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-dc-copy-confirm="${esc(o.id)}">예약확인 메시지 복사</button>
                  </div>
                </article>`;
              })
              .join("");
            return `<section class="dc-region-group">
              <div class="dc-region-head">
                <h3>${esc(group.suburb)}</h3>
                <span>${group.orders.length}건</span>
              </div>
              <div class="dc-region-list">${rows}</div>
            </section>`;
          })
          .join("");

        renderRoutePanel();
      }

      function exportCsv() {
        const source = state.selected.size
          ? allOrders().filter((o) => state.selected.has(o.id))
          : filteredOrders();
        const { sorted } = buildGroupedSorted(source);
        if (!sorted.length) {
          alert("내보낼 주문이 없습니다.");
          return;
        }
        const header = [
          "순서",
          "배송예정일",
          "주문번호",
          "성함",
          "연락처",
          "주소",
          "Suburb",
          "Postcode",
          "품목",
          "합계",
          "결제",
          "배송작업상태",
          "요청사항",
          "lat",
          "lng",
        ];
        const rows = [header.map(csvCell).join(",")];
        sorted.forEach((o, i) => {
          const c = o.customer || {};
          const stop = toRouteStop(o, i);
          const ops = opsOf(o.id);
          rows.push(
            [
              stop.sequence,
              stop.deliveryDate,
              o.id,
              c.name || "",
              c.phone || "",
              c.address || "",
              c.suburb || "",
              stop.postcode,
              stop.itemsSummary,
              o.total ?? "",
              o.payment || "",
              ops.status,
              o.note || "",
              "",
              "",
            ]
              .map(csvCell)
              .join(",")
          );
        });
        const blob = new Blob(["\uFEFF" + rows.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `kimchi-house-delivery-${Date.now()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        ctx.showToast?.(`배송 CSV ${sorted.length}건을 내려받았습니다.`);
      }

      async function onCopyPhone(orderId) {
        const order = allOrders().find((o) => o.id === orderId);
        if (!order) return;
        const phone = String(order.customer?.phone || "").trim();
        if (!phone) {
          alert("연락처가 없습니다.");
          return;
        }
        const ok = await copyText(phone);
        ctx.showToast?.(ok ? "전화번호를 복사했습니다." : "복사에 실패했습니다.");
      }

      async function onCopyConfirm(orderId) {
        const order = allOrders().find((o) => o.id === orderId);
        if (!order) return;
        const text = D.buildConfirmMessage(order);
        const ok = await copyText(text);
        if (!ok) {
          alert("메시지 복사에 실패했습니다.\n\n" + text);
          return;
        }
        ctx.showToast?.("예약확인 메시지를 복사했습니다. 카카오톡에 붙여넣어 주세요.");
      }

      async function onOpsStatusChange(orderId, status) {
        try {
          await patchOps([{ orderId, status }]);
          ctx.showToast?.(`배송 작업 상태를 「${status}」(으)로 저장했습니다.`);
          renderList();
        } catch (err) {
          alert(err.message || "저장 실패");
          renderList();
        }
      }

      async function bulkSetOpsStatus(status) {
        const ids = [...state.selected];
        if (!ids.length) {
          alert("주문을 선택해 주세요.");
          return;
        }
        if (!confirm(`선택한 ${ids.length}건을 「${status}」(으)로 변경할까요?\n(주문 원본 데이터는 변경되지 않습니다.)`)) {
          return;
        }
        try {
          await patchOps(ids.map((orderId) => ({ orderId, status })));
          ctx.showToast?.(`${ids.length}건 배송 작업 상태를 저장했습니다.`);
          renderList();
        } catch (err) {
          alert(err.message || "저장 실패");
        }
      }

      function selectAllVisible() {
        filteredOrders().forEach((o) => state.selected.add(o.id));
        renderList();
      }

      function clearSelection() {
        state.selected.clear();
        renderList();
      }

      function toggleRoute() {
        state.routeOpen = !state.routeOpen;
        const btn = document.getElementById("dc-route-btn");
        if (btn) btn.textContent = state.routeOpen ? "배송 순서 닫기" : "배송 순서 생성";
        if (state.routeOpen) buildRouteFromSelection();
        renderRoutePanel();
      }

      async function copyRoute() {
        const stops = state.routeStops.length ? state.routeStops : buildRouteFromSelection();
        const text = stops
          .map(
            (s) =>
              `${s.sequence}. ${s.suburb || "-"}${s.postcode ? ` (${s.postcode})` : ""}\n${s.address}\n${s.name} · ${s.phone} · ${s.orderId}`
          )
          .join("\n\n");
        const ok = await copyText(text);
        ctx.showToast?.(ok ? "배송 순서 텍스트를 복사했습니다." : "복사에 실패했습니다.");
      }

      function bind() {
        const root = document.getElementById("delivery-center-view");
        if (!root || root.dataset.dcBound === "1") return;
        root.dataset.dcBound = "1";

        root.addEventListener("click", async (e) => {
          const dateBtn = e.target.closest("[data-dc-date]");
          if (dateBtn) {
            state.dateFilter = dateBtn.dataset.dcDate;
            renderList();
            return;
          }
          const opsFilterBtn = e.target.closest("[data-dc-ops-status]");
          if (opsFilterBtn && !opsFilterBtn.matches("select")) {
            state.opsStatusFilter = opsFilterBtn.dataset.dcOpsStatus;
            renderList();
            return;
          }
          const scopeBtn = e.target.closest("[data-dc-round-scope]");
          if (scopeBtn) {
            state.roundScope = scopeBtn.dataset.dcRoundScope;
            root.querySelectorAll("[data-dc-round-scope]").forEach((btn) => {
              btn.classList.toggle("active", btn.dataset.dcRoundScope === state.roundScope);
            });
            state.dateFilter = "all";
            renderList();
            return;
          }
          if (e.target.closest("#dc-select-all-btn")) {
            selectAllVisible();
            return;
          }
          if (e.target.closest("#dc-clear-selection-btn")) {
            clearSelection();
            return;
          }
          if (e.target.closest("#dc-route-btn")) {
            toggleRoute();
            return;
          }
          if (e.target.closest("#dc-copy-route-btn")) {
            await copyRoute();
            return;
          }
          if (e.target.closest("#dc-csv-btn")) {
            exportCsv();
            return;
          }
          if (e.target.closest("#dc-bulk-ready-btn")) {
            await bulkSetOpsStatus("배송준비");
            return;
          }
          if (e.target.closest("#dc-bulk-shipping-btn")) {
            await bulkSetOpsStatus("배송중");
            return;
          }
          if (e.target.closest("#dc-bulk-done-btn")) {
            await bulkSetOpsStatus("배송완료");
            return;
          }
          if (e.target.closest("#dc-refresh-btn")) {
            try {
              await ctx.refreshOrders?.();
              await fetchOps();
              renderList();
              ctx.showToast?.("배송관리를 새로고침했습니다.");
            } catch (err) {
              alert(err.message || "새로고침 실패");
            }
            return;
          }
          const phoneBtn = e.target.closest("[data-dc-copy-phone]");
          if (phoneBtn) {
            await onCopyPhone(phoneBtn.dataset.dcCopyPhone);
            return;
          }
          const confirmBtn = e.target.closest("[data-dc-copy-confirm]");
          if (confirmBtn) {
            await onCopyConfirm(confirmBtn.dataset.dcCopyConfirm);
          }
        });

        root.addEventListener("change", async (e) => {
          const check = e.target.closest("[data-dc-select]");
          if (check) {
            const id = check.dataset.dcSelect;
            if (check.checked) state.selected.add(id);
            else state.selected.delete(id);
            syncSelectedCount();
            check.closest(".dc-order-card")?.classList.toggle("selected", check.checked);
            if (state.routeOpen) {
              buildRouteFromSelection();
              renderRoutePanel();
            }
            return;
          }
          const statusSelect = e.target.closest("[data-dc-ops-status-set]");
          if (statusSelect) {
            await onOpsStatusChange(statusSelect.dataset.dcOpsStatusSet, statusSelect.value);
          }
        });

        root.addEventListener("input", (e) => {
          if (e.target.id !== "dc-search") return;
          state.search = e.target.value;
          renderList();
        });
      }

      async function load() {
        await fetchOps();
        renderList();
      }

      function render() {
        renderList();
      }

      return {
        bind,
        load,
        render,
        fetchOps,
      };
    },
  };
})();
