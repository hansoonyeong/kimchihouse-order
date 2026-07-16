(function () {
  const STATUS_OPTIONS = [
    { value: "active", label: "판매 ON" },
    { value: "sold_out", label: "품절" },
    { value: "coming_soon", label: "판매 예정" },
    { value: "hidden", label: "숨김" },
  ];

  const DEFAULT_CATEGORIES = [
    { id: "walkerhill", label: "워커힐 프리미엄" },
    { id: "pogi", label: "포기김치" },
    { id: "special", label: "별미김치" },
    { id: "seafood", label: "프리미엄 수산·반찬" },
    { id: "frozen", label: "냉동·간편식" },
    { id: "jang", label: "전통 장류·김" },
  ];

  window.KHAdminSales = {
    create(ctx) {
      const state = {
        rows: [],
        categories: DEFAULT_CATEGORIES,
        settings: { autoSoldOutOnZero: true },
        presets: [],
        logs: [],
        importantIds: new Set(["w1", "w2", "b1", "b2", "b3", "b4", "a1", "a2", "a3"]),
        selected: new Set(),
        filters: {
          q: "",
          category: "all",
          status: "all",
          lowStock: false,
          soldOutOnly: false,
        },
      };

      function money(n) {
        if (n == null || Number.isNaN(Number(n))) return "-";
        return "$" + Number(n).toFixed(0);
      }

      function statusLabel(status) {
        return STATUS_OPTIONS.find((o) => o.value === status)?.label || status;
      }

      function authHeaders() {
        return {
          Authorization: `Bearer ${ctx.getAdminKey()}`,
          "Content-Type": "application/json",
        };
      }

      async function fetchSales() {
        const res = await fetch(ctx.salesApi, { headers: { Authorization: `Bearer ${ctx.getAdminKey()}` } });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "판매 품목 조회 실패");
        state.rows = data.rows || [];
        state.categories = data.categories?.length ? data.categories : DEFAULT_CATEGORIES;
        state.settings = data.settings || state.settings;
        state.presets = data.presets || [];
        state.logs = data.logs || [];
        if (Array.isArray(data.importantIds)) state.importantIds = new Set(data.importantIds);
        if (data.store) ctx.setStore?.(data.store);
        return data;
      }

      function filteredRows() {
        const q = state.filters.q.trim().toLowerCase();
        return state.rows.filter((r) => {
          if (state.filters.category !== "all" && r.saleCategory !== state.filters.category) return false;
          if (state.filters.status !== "all" && r.saleStatus !== state.filters.status) return false;
          if (state.filters.soldOutOnly && r.saleStatus !== "sold_out") return false;
          if (state.filters.lowStock) {
            const prepared = Number(r.prepared || 0);
            const remaining = Number(r.remaining || 0);
            if (!(prepared > 0 && remaining <= 5)) return false;
          }
          if (q) {
            const hay = `${r.name} ${r.saleCategoryLabel || ""} ${r.id}`.toLowerCase();
            if (!hay.includes(q)) return false;
          }
          return true;
        });
      }

      function groupedRows(rows) {
        const groups = [];
        for (const cat of state.categories) {
          const items = rows.filter((r) => r.saleCategory === cat.id);
          if (items.length) groups.push({ ...cat, items });
        }
        const known = new Set(state.categories.map((c) => c.id));
        const other = rows.filter((r) => !known.has(r.saleCategory));
        if (other.length) groups.push({ id: "other", label: "기타", items: other });
        return groups;
      }

      function renderStatusSelect(row) {
        return `<select class="admin-sale-status" data-sale-id="${row.id}" aria-label="${row.name} 판매 상태">
          ${STATUS_OPTIONS.map(
            (o) => `<option value="${o.value}"${row.saleStatus === o.value ? " selected" : ""}>${o.label}</option>`
          ).join("")}
        </select>`;
      }

      function render() {
        const root = document.getElementById("sales-list");
        if (!root) return;
        const rows = filteredRows();
        const groups = groupedRows(rows);

        document.getElementById("sales-auto-soldout")?.classList.toggle("on", state.settings.autoSoldOutOnZero !== false);
        document.getElementById("sales-auto-soldout")?.classList.toggle("off", state.settings.autoSoldOutOnZero === false);
        const autoText = document.querySelector("#sales-auto-soldout .preorder-switch-text");
        if (autoText) autoText.textContent = state.settings.autoSoldOutOnZero !== false ? "ON" : "OFF";

        const presetSel = document.getElementById("sales-preset-select");
        if (presetSel) {
          const cur = presetSel.value;
          presetSel.innerHTML =
            `<option value="">프리셋 선택</option>` +
            state.presets.map((p) => `<option value="${p.id}">${p.name}</option>`).join("");
          if (cur) presetSel.value = cur;
        }

        const catTabs = document.getElementById("sales-cat-tabs");
        if (catTabs) {
          catTabs.innerHTML =
            `<button type="button" class="filter-tab${state.filters.category === "all" ? " active" : ""}" data-sales-cat="all">전체</button>` +
            state.categories
              .map(
                (c) =>
                  `<button type="button" class="filter-tab${state.filters.category === c.id ? " active" : ""}" data-sales-cat="${c.id}">${c.label}</button>`
              )
              .join("");
        }

        const logEl = document.getElementById("sales-log-list");
        if (logEl) {
          logEl.innerHTML = (state.logs || [])
            .slice(0, 12)
            .map(
              (l) =>
                `<li><strong>${l.name || l.productId}</strong> ${l.from} → ${l.to} <span>${new Date(l.at).toLocaleString("ko-KR")} · ${l.admin || ""}</span></li>`
            )
            .join("") || "<li>변경 로그가 없습니다.</li>";
        }

        if (!groups.length) {
          root.innerHTML = `<p class="admin-empty">조건에 맞는 상품이 없습니다.</p>`;
          return;
        }

        root.innerHTML = groups
          .map((g) => {
            const allOn = g.items.every((i) => i.saleStatus === "active");
            return `<div class="admin-sales-group" data-sales-group="${g.id}">
              <div class="admin-sales-group-head">
                <h3>${g.label} <span class="admin-sales-count">${g.items.length}</span></h3>
                <div class="admin-sales-group-actions">
                  <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-cat-bulk="${g.id}" data-cat-status="active">${g.label} 전체 판매 ON</button>
                  <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-cat-bulk="${g.id}" data-cat-status="hidden">${g.label} 전체 숨김</button>
                  <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-cat-bulk="${g.id}" data-cat-status="sold_out">${g.label} 전체 품절</button>
                </div>
              </div>
              <div class="admin-table-wrap">
                <table class="admin-table admin-sales-table">
                  <thead>
                    <tr>
                      <th><input type="checkbox" data-sales-select-group="${g.id}" ${g.items.every((i) => state.selected.has(i.id)) ? "checked" : ""} /></th>
                      <th>상품</th>
                      <th>카테고리</th>
                      <th>가격</th>
                      <th>입고</th>
                      <th>주문</th>
                      <th>잔여</th>
                      <th>판매 상태</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${g.items
                      .map((r) => {
                        const remCls = r.remaining < 0 ? "neg" : r.remaining === 0 && r.prepared > 0 ? "zero" : "";
                        const img = r.image
                          ? `<img src="${r.image}" alt="" class="admin-sales-thumb" loading="lazy" />`
                          : `<span class="admin-sales-thumb placeholder"></span>`;
                        return `<tr data-sales-row="${r.id}">
                          <td><input type="checkbox" data-sales-select="${r.id}" ${state.selected.has(r.id) ? "checked" : ""} /></td>
                          <td class="admin-sales-product">
                            ${img}
                            <div>
                              <strong>${r.name}</strong>
                              <div class="admin-stock-id">${r.id}${allOn ? "" : ""}</div>
                            </div>
                          </td>
                          <td>${r.saleCategoryLabel || r.categoryLabel || ""}</td>
                          <td>${money(r.displayPrice ?? r.price)}</td>
                          <td>${r.prepared}</td>
                          <td>${r.reserved}</td>
                          <td class="admin-stock-remaining ${remCls}">${r.remaining}</td>
                          <td>${renderStatusSelect(r)}</td>
                        </tr>`;
                      })
                      .join("")}
                  </tbody>
                </table>
              </div>
            </div>`;
          })
          .join("");
      }

      async function patchStatuses(updates, { skipConfirm } = {}) {
        const entries = Object.entries(updates);
        if (!entries.length) return;
        if (!skipConfirm) {
          for (const [id, status] of entries) {
            const row = state.rows.find((r) => r.id === id);
            const next = typeof status === "object" ? status.saleStatus : status;
            if (row && state.importantIds.has(id) && next !== "active" && row.saleStatus === "active") {
              const ok = confirm(`${row.name}을(를) 판매 중지하시겠습니까?\n(변경: ${statusLabel(next)})`);
              if (!ok) return;
            }
          }
        }
        const res = await fetch(ctx.salesApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ updates }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "판매 상태 저장 실패");
        if (data.rows) state.rows = data.rows;
        if (data.logsAll) state.logs = data.logsAll;
        else if (data.logs?.length) state.logs = [...data.logs, ...state.logs].slice(0, 100);
        render();
        ctx.showToast?.("판매 상태가 저장되었습니다.");
      }

      async function setSelectedStatus(status) {
        if (!state.selected.size) {
          alert("상품을 선택해 주세요.");
          return;
        }
        const updates = {};
        for (const id of state.selected) updates[id] = status;
        await patchStatuses(updates);
      }

      async function setCategoryStatus(categoryId, status) {
        const updates = {};
        for (const row of state.rows) {
          if (row.saleCategory === categoryId) updates[row.id] = status;
        }
        const label = state.categories.find((c) => c.id === categoryId)?.label || categoryId;
        if (!confirm(`${label} 카테고리 ${Object.keys(updates).length}개 상품을 「${statusLabel(status)}」로 변경할까요?`)) {
          return;
        }
        await patchStatuses(updates, { skipConfirm: true });
      }

      async function toggleAutoSoldOut() {
        const next = !(state.settings.autoSoldOutOnZero !== false);
        const res = await fetch(ctx.salesApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ action: "settings", autoSoldOutOnZero: next }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "설정 변경 실패");
        state.settings = data.settings || { autoSoldOutOnZero: next };
        if (data.rows) state.rows = data.rows;
        if (data.logs) state.logs = data.logs;
        render();
        ctx.showToast?.(next ? "재고 0 자동 품절 ON" : "재고 0 자동 품절 OFF");
      }

      async function savePreset() {
        const name = prompt("이번 차수 프리셋 이름을 입력하세요.\n예: 7월 4차 판매");
        if (!name?.trim()) return;
        const res = await fetch(ctx.salesApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ action: "save_preset", name: name.trim() }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "프리셋 저장 실패");
        state.presets = data.presets || [];
        render();
        ctx.showToast?.(`프리셋 「${data.preset?.name || name}」 저장됨`);
      }

      async function applyPreset() {
        const id = document.getElementById("sales-preset-select")?.value;
        if (!id) return alert("불러올 프리셋을 선택해 주세요.");
        const preset = state.presets.find((p) => p.id === id);
        const ok = confirm(
          `프리셋 「${preset?.name || id}」을(를) 적용할까요?\n\n상품 판매 상태·가격·재고가 덮어씌워집니다.\n적용 전에 현재 상태를 프리셋으로 저장해 두는 것을 권장합니다.`
        );
        if (!ok) return;
        const res = await fetch(ctx.salesApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ action: "apply_preset", presetId: id, confirm: true }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "프리셋 적용 실패");
        if (data.rows) state.rows = data.rows;
        if (data.presets) state.presets = data.presets;
        if (data.logs) state.logs = data.logs;
        if (data.settings) state.settings = data.settings;
        state.selected.clear();
        render();
        ctx.showToast?.(`프리셋 「${data.applied}」 적용 완료`);
        await ctx.refreshStock?.();
      }

      async function deletePreset() {
        const id = document.getElementById("sales-preset-select")?.value;
        if (!id) return alert("삭제할 프리셋을 선택해 주세요.");
        if (!confirm("선택한 프리셋을 삭제할까요?")) return;
        const res = await fetch(ctx.salesApi, {
          method: "PATCH",
          headers: authHeaders(),
          body: JSON.stringify({ action: "delete_preset", presetId: id }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "프리셋 삭제 실패");
        state.presets = data.presets || [];
        render();
        ctx.showToast?.("프리셋이 삭제되었습니다.");
      }

      function bind() {
        const view = document.getElementById("sales-view");
        if (!view || view.dataset.bound === "1") return;
        view.dataset.bound = "1";

        document.getElementById("sales-search")?.addEventListener("input", (e) => {
          state.filters.q = e.target.value;
          render();
        });
        document.getElementById("sales-status-filter")?.addEventListener("change", (e) => {
          state.filters.status = e.target.value;
          render();
        });
        document.getElementById("sales-low-stock")?.addEventListener("change", (e) => {
          state.filters.lowStock = e.target.checked;
          render();
        });
        document.getElementById("sales-soldout-only")?.addEventListener("change", (e) => {
          state.filters.soldOutOnly = e.target.checked;
          render();
        });
        document.getElementById("sales-cat-tabs")?.addEventListener("click", (e) => {
          const tab = e.target.closest("[data-sales-cat]");
          if (!tab) return;
          state.filters.category = tab.dataset.salesCat;
          render();
        });
        document.getElementById("sales-select-all")?.addEventListener("click", () => {
          const rows = filteredRows();
          const allSelected = rows.length && rows.every((r) => state.selected.has(r.id));
          if (allSelected) rows.forEach((r) => state.selected.delete(r.id));
          else rows.forEach((r) => state.selected.add(r.id));
          render();
        });
        document.getElementById("sales-bulk-active")?.addEventListener("click", () =>
          setSelectedStatus("active").catch((err) => alert(err.message))
        );
        document.getElementById("sales-bulk-soldout")?.addEventListener("click", () =>
          setSelectedStatus("sold_out").catch((err) => alert(err.message))
        );
        document.getElementById("sales-bulk-hidden")?.addEventListener("click", () =>
          setSelectedStatus("hidden").catch((err) => alert(err.message))
        );
        document.getElementById("sales-bulk-soon")?.addEventListener("click", () =>
          setSelectedStatus("coming_soon").catch((err) => alert(err.message))
        );
        document.getElementById("sales-auto-soldout")?.addEventListener("click", () =>
          toggleAutoSoldOut().catch((err) => alert(err.message))
        );
        document.getElementById("sales-refresh-btn")?.addEventListener("click", async () => {
          try {
            await fetchSales();
            render();
            ctx.showToast?.("판매 품목을 새로고침했습니다.");
          } catch (err) {
            alert(err.message || "새로고침 실패");
          }
        });
        document.getElementById("sales-preset-save")?.addEventListener("click", () =>
          savePreset().catch((err) => alert(err.message))
        );
        document.getElementById("sales-preset-apply")?.addEventListener("click", () =>
          applyPreset().catch((err) => alert(err.message))
        );
        document.getElementById("sales-preset-delete")?.addEventListener("click", () =>
          deletePreset().catch((err) => alert(err.message))
        );

        document.getElementById("sales-list")?.addEventListener("change", (e) => {
          const select = e.target.closest("[data-sale-id]");
          if (select) {
            const id = select.dataset.saleId;
            const next = select.value;
            patchStatuses({ [id]: next }).catch((err) => {
              alert(err.message);
              fetchSales().then(render);
            });
            return;
          }
          const one = e.target.closest("[data-sales-select]");
          if (one) {
            if (one.checked) state.selected.add(one.dataset.salesSelect);
            else state.selected.delete(one.dataset.salesSelect);
            return;
          }
          const group = e.target.closest("[data-sales-select-group]");
          if (group) {
            const cat = group.dataset.salesSelectGroup;
            const items = filteredRows().filter((r) => r.saleCategory === cat);
            if (group.checked) items.forEach((r) => state.selected.add(r.id));
            else items.forEach((r) => state.selected.delete(r.id));
            render();
          }
        });

        document.getElementById("sales-list")?.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-cat-bulk]");
          if (!btn) return;
          setCategoryStatus(btn.dataset.catBulk, btn.dataset.catStatus).catch((err) => alert(err.message));
        });
      }

      return {
        bind,
        fetchSales,
        render,
        saleStatusOf(productId) {
          const row = state.rows.find((r) => r.id === productId);
          return row?.saleStatus || "active";
        },
        async refresh() {
          await fetchSales();
          render();
        },
      };
    },
  };
})();
