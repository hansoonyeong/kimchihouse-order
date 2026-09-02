/**
 * Kimchi House Admin — dashboard / customers / reports / notices / settings
 * Uses live orderList when available; notices & extra settings in localStorage.
 */
(function (global) {
  const NOTICE_KEY = "kh_admin_notices_v1";
  const TEMPLATE_KEY = "kh_admin_msg_templates_v1";
  const SETTINGS_KEY = "kh_admin_settings_extra_v1";
  const DEFAULT_TEMPLATES = [
    {
      id: "confirm",
      name: "예약 확인",
      body: "안녕하세요 {customerName}님, 김치하우스 주문이 확인되었습니다. 주문번호 {orderNumber}, 배송일 {deliveryDate} 예정입니다.",
    },
    {
      id: "ship_soon",
      name: "배송 예정",
      body: "{customerName}님, {deliveryDate} 배송 예정입니다. 문의는 언제든 연락 주세요.",
    },
    {
      id: "date_change",
      name: "배송일 변경",
      body: "{customerName}님, 배송일이 {deliveryDate}로 변경되었습니다. 주문번호 {orderNumber}",
    },
    {
      id: "ship_day",
      name: "배송 당일",
      body: "{customerName}님, 오늘({deliveryDate}) 배송 예정입니다. 예상 도착 {estimatedTime}",
    },
    {
      id: "eta",
      name: "ETA 안내",
      body: "{customerName}님, 약 {estimatedTime} 도착 예정입니다.",
    },
    {
      id: "done",
      name: "배송 완료",
      body: "{customerName}님, 주문이 배송 완료되었습니다. 맛있게 드세요!",
    },
    {
      id: "deadline",
      name: "주문 마감",
      body: "김치하우스 이번 차수 주문이 마감되었습니다. 다음 예약에 만나요!",
    },
  ];

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function money(n) {
    const v = Number(n) || 0;
    return `$${v.toFixed(2)}`;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (_) {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function getOrders() {
    return Array.isArray(global.__KH_ADMIN_ORDERS__) ? global.__KH_ADMIN_ORDERS__ : [];
  }

  function orderStatus(o) {
    return o.status || o.deliveryStatus || o.delivery?.status || "예약 접수";
  }

  function deliveryDateOf(o) {
    return o.deliveryDate || o.delivery?.date || "";
  }

  function customerKey(o) {
    const phone = String(o.customer?.phone || "").replace(/\D/g, "");
    const name = String(o.customer?.name || "").trim().toLowerCase();
    return phone || name || o.id;
  }

  function itemSummary(o) {
    const items = o.items || [];
    if (!items.length) return "—";
    const first = items[0]?.name || "상품";
    if (items.length === 1) return first;
    return `${first} 외 ${items.length - 1}개`;
  }

  function statusBadge(status) {
    const s = String(status || "");
    let cls = "ad-badge-muted";
    if (s.includes("완료") && s.includes("배송")) cls = "ad-badge-ok";
    else if (s.includes("준비") || s.includes("안내")) cls = "ad-badge-info";
    else if (s.includes("확인")) cls = "ad-badge-warn";
    else if (s.includes("취소")) cls = "ad-badge-danger";
    else if (s.includes("접수") || s.includes("신규")) cls = "ad-badge-new";
    return `<span class="ad-badge ${cls}">${esc(s)}</span>`;
  }

  function isCurrentRound(o, util) {
    if (!util?.isCurrentRoundDeliveryDate) return true;
    return util.isCurrentRoundDeliveryDate(deliveryDateOf(o));
  }

  /* ---------- Customers from orders ---------- */
  function buildCustomers(orders) {
    const map = new Map();
    for (const o of orders) {
      const key = customerKey(o);
      if (!key) continue;
      let c = map.get(key);
      if (!c) {
        c = {
          id: key,
          name: o.customer?.name || "(이름 없음)",
          phone: o.customer?.phone || "",
          address: o.customer?.address || "",
          suburb: o.customer?.suburb || "",
          postcode: "",
          notes: "",
          gateNote: "",
          orderCount: 0,
          totalSpend: 0,
          lastOrderAt: null,
          lastOrderId: "",
          orders: [],
        };
        map.set(key, c);
      }
      c.orderCount += 1;
      c.totalSpend += Number(o.total) || 0;
      c.orders.push(o);
      const addr = o.customer?.address || "";
      const pc = (addr.match(/\b(\d{4})\b/) || [])[1];
      if (pc) c.postcode = pc;
      if (o.customer?.postcode) c.postcode = String(o.customer.postcode).replace(/\D/g, "").slice(0, 4) || c.postcode;
      if (o.customer?.suburb) c.suburb = o.customer.suburb;
      if (o.customer?.address) c.address = o.customer.address;
      if (o.customer?.name) c.name = o.customer.name;
      if (o.customer?.phone) c.phone = o.customer.phone;
      const ts = o.createdAt || o.updatedAt || "";
      if (!c.lastOrderAt || String(ts) > String(c.lastOrderAt)) {
        c.lastOrderAt = ts;
        c.lastOrderId = o.id;
      }
    }
    return [...map.values()].sort((a, b) => String(b.lastOrderAt || "").localeCompare(String(a.lastOrderAt || "")));
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard(root, ctx = {}) {
    if (!root) return;
    const orders = getOrders();
    const util = global.KH_DELIVERY;
    const today = new Date().toISOString().slice(0, 10);
    const current = orders.filter((o) => isCurrentRound(o, util));
    const todayOrders = orders.filter((o) => String(o.createdAt || "").slice(0, 10) === today);
    const needAddr = orders.filter((o) => {
      const a = o.customer?.address || "";
      return !a || a.length < 8;
    });
    const unconfirmed = orders.filter((o) => !o.confirmMessageSent && orderStatus(o) === "예약 접수");
    const preparing = orders.filter((o) => {
      const s = orderStatus(o);
      return s.includes("준비") || s.includes("확인 완료");
    });
    const done = orders.filter((o) => orderStatus(o).includes("배송 완료"));
    const totalAmt = current.reduce((a, o) => a + (Number(o.total) || 0), 0);

    const recent = [...orders]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 10);

    const productMap = new Map();
    for (const o of current) {
      for (const it of o.items || []) {
        const name = it.name || "상품";
        const prev = productMap.get(name) || { name, qty: 0, sales: 0 };
        prev.qty += Number(it.qty) || 0;
        prev.sales += (Number(it.price) || 0) * (Number(it.qty) || 0);
        productMap.set(name, prev);
      }
    }
    const topProducts = [...productMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 6);

    root.innerHTML = `
      <div class="ad-page-stack">
        <div class="ad-kpi-row">
          <div class="ad-kpi"><span class="ad-kpi-ico">📄</span><div><label>오늘 주문</label><strong>${todayOrders.length}</strong></div></div>
          <div class="ad-kpi is-ok"><span class="ad-kpi-ico">✓</span><div><label>이번 배송 주문</label><strong>${current.length}</strong></div></div>
          <div class="ad-kpi is-info"><span class="ad-kpi-ico">$</span><div><label>총 주문금액</label><strong>${esc(money(totalAmt))}</strong></div></div>
          <div class="ad-kpi is-warn"><span class="ad-kpi-ico">!</span><div><label>미확인 주문</label><strong>${unconfirmed.length}</strong></div></div>
          <div class="ad-kpi"><span class="ad-kpi-ico">▣</span><div><label>배송 준비</label><strong>${preparing.length}</strong></div></div>
          <div class="ad-kpi is-ok"><span class="ad-kpi-ico">✔</span><div><label>배송 완료</label><strong>${done.length}</strong></div></div>
          <div class="ad-kpi is-danger"><span class="ad-kpi-ico">⚠</span><div><label>주소 확인 필요</label><strong>${needAddr.length}</strong></div></div>
        </div>

        <div class="ad-grid-2">
          <section class="ad-panel-card">
            <div class="ad-panel-card-head">
              <h2>이번 배송 현황</h2>
              <button type="button" class="shop-btn shop-btn-primary shop-btn-sm" data-ad-nav="delivery">배송 작업</button>
            </div>
            <div class="ad-kpi-row">
              <div class="ad-kpi"><div><label>총 주문</label><strong>${current.length}</strong></div></div>
              <div class="ad-kpi is-ok"><div><label>배정 가능</label><strong>${current.filter((o) => (o.customer?.address || "").length >= 8).length}</strong></div></div>
              <div class="ad-kpi is-warn"><div><label>미확인</label><strong>${unconfirmed.length}</strong></div></div>
              <div class="ad-kpi is-danger"><div><label>주소 이슈</label><strong>${needAddr.length}</strong></div></div>
            </div>
          </section>

          <section class="ad-panel-card">
            <h2>주의가 필요한 항목</h2>
            <div class="ad-alert-list">
              <button type="button" class="ad-alert-item" data-ad-nav="orders">
                <div><strong>주소 확인 필요 ${needAddr.length}건</strong><span>배송주소가 짧거나 비어 있는 주문</span></div>
                <span class="ad-badge ad-badge-danger">확인</span>
              </button>
              <button type="button" class="ad-alert-item" data-ad-nav="orders">
                <div><strong>예약 확인 메시지 미발송 ${unconfirmed.length}건</strong><span>예약 접수 상태 · 확인 메시지 미발송</span></div>
                <span class="ad-badge ad-badge-warn">대기</span>
              </button>
              <button type="button" class="ad-alert-item" data-ad-nav="delivery">
                <div><strong>배송 관련 작업</strong><span>회차 현황 · 배송 예약표 Export</span></div>
                <span class="ad-badge ad-badge-info">이동</span>
              </button>
            </div>
          </section>
        </div>

        <div class="ad-grid-2">
          <section class="ad-panel-card">
            <div class="ad-panel-card-head">
              <h2>최근 주문</h2>
              <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-ad-nav="orders">전체 보기</button>
            </div>
            ${
              recent.length
                ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr>
                    <th>주문번호</th><th>고객명</th><th>지역</th><th>금액</th><th>상태</th><th>일시</th>
                  </tr></thead><tbody>
                  ${recent
                    .map(
                      (o) => `<tr class="is-clickable" data-ad-nav="orders">
                      <td class="ad-mono">${esc(o.id)}</td>
                      <td>${esc(o.customer?.name || "—")}</td>
                      <td>${esc(o.customer?.suburb || "—")}</td>
                      <td class="ad-mono">${esc(money(o.total))}</td>
                      <td>${statusBadge(orderStatus(o))}</td>
                      <td>${esc(String(o.createdAt || "").replace("T", " ").slice(0, 16))}</td>
                    </tr>`
                    )
                    .join("")}
                  </tbody></table></div>`
                : `<div class="ad-empty"><strong>주문이 없습니다</strong>아직 수집된 주문이 없습니다.</div>`
            }
          </section>

          <section class="ad-panel-card">
            <h2>인기 상품 (이번 차수)</h2>
            ${
              topProducts.length
                ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr>
                    <th>상품</th><th>수량</th><th>매출</th>
                  </tr></thead><tbody>
                  ${topProducts
                    .map(
                      (p) => `<tr>
                      <td>${esc(p.name)}</td>
                      <td class="ad-mono">${p.qty}</td>
                      <td class="ad-mono">${esc(money(p.sales))}</td>
                    </tr>`
                    )
                    .join("")}
                  </tbody></table></div>`
                : `<div class="ad-empty"><strong>상품 데이터가 없습니다</strong></div>`
            }
          </section>
        </div>
      </div>`;

    root.querySelectorAll("[data-ad-nav]").forEach((el) => {
      el.addEventListener("click", () => {
        const view = el.getAttribute("data-ad-nav");
        if (view && typeof ctx.onNavigate === "function") ctx.onNavigate(view);
      });
    });
  }

  /* ---------- Customers ---------- */
  function renderCustomers(root, ctx = {}) {
    if (!root) return;
    const orders = getOrders();
    let customers = buildCustomers(orders);
    const q = String(ctx.query || "")
      .trim()
      .toLowerCase();
    if (q) {
      customers = customers.filter((c) =>
        [c.name, c.phone, c.address, c.suburb, c.postcode].join(" ").toLowerCase().includes(q)
      );
    }
    const recentCut = Date.now() - 1000 * 60 * 60 * 24 * 45;
    const recentN = customers.filter((c) => c.lastOrderAt && new Date(c.lastOrderAt).getTime() > recentCut).length;
    const newN = customers.filter((c) => c.orderCount === 1).length;

    root.innerHTML = `
      <div class="ad-page-stack">
        <div class="ad-kpi-row">
          <div class="ad-kpi"><span class="ad-kpi-ico">👤</span><div><label>전체 고객</label><strong>${customers.length}</strong></div></div>
          <div class="ad-kpi is-ok"><span class="ad-kpi-ico">↻</span><div><label>최근 주문 고객</label><strong>${recentN}</strong></div></div>
          <div class="ad-kpi is-info"><span class="ad-kpi-ico">+</span><div><label>신규 고객</label><strong>${newN}</strong></div></div>
          <div class="ad-kpi"><span class="ad-kpi-ico">Σ</span><div><label>누적 주문 고객</label><strong>${customers.filter((c) => c.orderCount > 1).length}</strong></div></div>
        </div>
        <div class="ad-filterbar">
          <input type="search" id="ad-customer-search" placeholder="이름, 전화번호, 주소, Suburb, Postcode" value="${esc(ctx.query || "")}" />
        </div>
        ${
          customers.length
            ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr>
                <th>고객명</th><th>전화번호</th><th>Suburb</th><th>최근 주문일</th><th>주문횟수</th><th>누적 금액</th><th>최근 주문</th>
              </tr></thead><tbody>
              ${customers
                .map(
                  (c) => `<tr class="is-clickable" data-customer-id="${esc(c.id)}">
                  <td><strong>${esc(c.name)}</strong></td>
                  <td>${esc(c.phone || "—")}</td>
                  <td>${esc(c.suburb || "—")}</td>
                  <td>${esc(String(c.lastOrderAt || "").replace("T", " ").slice(0, 16) || "—")}</td>
                  <td class="ad-mono">${c.orderCount}</td>
                  <td class="ad-mono">${esc(money(c.totalSpend))}</td>
                  <td class="ad-mono">${esc(c.lastOrderId || "—")}</td>
                </tr>`
                )
                .join("")}
              </tbody></table></div>`
            : `<div class="ad-empty"><strong>등록된 고객이 없습니다</strong>주문 데이터에서 고객이 집계됩니다.</div>`
        }
      </div>`;

    const search = root.querySelector("#ad-customer-search");
    search?.addEventListener("input", (e) => {
      renderCustomers(root, { ...ctx, query: e.target.value });
    });

    root.querySelectorAll("[data-customer-id]").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-customer-id");
        const customer = buildCustomers(getOrders()).find((c) => c.id === id);
        if (customer && typeof ctx.onOpenCustomer === "function") ctx.onOpenCustomer(customer);
      });
    });
  }

  function customerDrawerHtml(c) {
    const hist = [...(c.orders || [])]
      .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
      .slice(0, 12);
    return `
      <div class="ad-drawer-head">
        <div>
          <h2>${esc(c.name)}</h2>
          <p style="margin:4px 0 0;color:var(--ad-muted);font-weight:600">${esc(c.phone || "")}</p>
        </div>
        <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-ad-drawer-close>닫기</button>
      </div>
      <div class="ad-drawer-body">
        <h3 style="margin:0 0 8px;font-size:13px">기본정보</h3>
        <dl class="ad-kv">
          <dt>이름</dt><dd>${esc(c.name)}</dd>
          <dt>전화</dt><dd>${esc(c.phone || "—")}</dd>
          <dt>주소</dt><dd>${esc(c.address || "—")}</dd>
          <dt>Suburb</dt><dd>${esc(c.suburb || "—")}</dd>
          <dt>Postcode</dt><dd>${esc(c.postcode || "—")}</dd>
        </dl>
        <h3 style="margin:16px 0 8px;font-size:13px">주문 통계</h3>
        <dl class="ad-kv">
          <dt>총 주문</dt><dd>${c.orderCount}회</dd>
          <dt>누적 금액</dt><dd>${esc(money(c.totalSpend))}</dd>
          <dt>최근 주문</dt><dd>${esc(String(c.lastOrderAt || "").replace("T", " ").slice(0, 16) || "—")}</dd>
        </dl>
        <h3 style="margin:16px 0 8px;font-size:13px">주문 이력</h3>
        ${
          hist.length
            ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>주문</th><th>금액</th><th>상태</th></tr></thead><tbody>
              ${hist
                .map(
                  (o) => `<tr><td>${esc(o.id)}</td><td>${esc(money(o.total))}</td><td>${statusBadge(orderStatus(o))}</td></tr>`
                )
                .join("")}
            </tbody></table></div>`
            : `<div class="ad-empty">이력이 없습니다</div>`
        }
        <h3 style="margin:16px 0 8px;font-size:13px">배송 · 내부 메모</h3>
        <p style="margin:0;color:var(--ad-muted);font-size:12px;font-weight:600">고객별 메모는 주문 메모를 참고하세요. 전용 CRM 메모 API는 추후 연결됩니다.</p>
      </div>`;
  }

  /* ---------- Reports ---------- */
  function renderReports(root) {
    if (!root) return;
    const orders = getOrders();
    const util = global.KH_DELIVERY;
    const current = orders.filter((o) => isCurrentRound(o, util));
    const total = current.reduce((a, o) => a + (Number(o.total) || 0), 0);
    const avg = current.length ? total / current.length : 0;
    const freeShip = current.filter((o) => Number(o.shippingFee) === 0).length;
    const shipRev = current.reduce((a, o) => a + (Number(o.shippingFee) || 0), 0);
    const customers = buildCustomers(current);

    const byProduct = new Map();
    const bySuburb = new Map();
    for (const o of current) {
      const sub = o.customer?.suburb || "(미상)";
      const s = bySuburb.get(sub) || { suburb: sub, count: 0, sales: 0 };
      s.count += 1;
      s.sales += Number(o.total) || 0;
      bySuburb.set(sub, s);
      for (const it of o.items || []) {
        const name = it.name || "상품";
        const p = byProduct.get(name) || { name, qty: 0, sales: 0 };
        p.qty += Number(it.qty) || 0;
        p.sales += (Number(it.price) || 0) * (Number(it.qty) || 0);
        byProduct.set(name, p);
      }
    }
    const products = [...byProduct.values()].sort((a, b) => b.sales - a.sales).slice(0, 20);
    const suburbs = [...bySuburb.values()].sort((a, b) => b.count - a.count).slice(0, 20);
    const newC = customers.filter((c) => c.orderCount === 1).length;
    const returning = customers.filter((c) => c.orderCount > 1).length;

    root.innerHTML = `
      <div class="ad-page-stack">
        <div class="ad-filterbar">
          <strong style="font-size:13px">기간: 이번 예약(배송) 차수</strong>
          <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" id="ad-report-csv">CSV 다운로드</button>
        </div>
        <div class="ad-kpi-row">
          <div class="ad-kpi is-info"><div><label>총 매출</label><strong>${esc(money(total))}</strong></div></div>
          <div class="ad-kpi"><div><label>총 주문</label><strong>${current.length}</strong></div></div>
          <div class="ad-kpi"><div><label>평균 주문금액</label><strong>${esc(money(avg))}</strong></div></div>
          <div class="ad-kpi is-ok"><div><label>무료배송 주문</label><strong>${freeShip}</strong></div></div>
          <div class="ad-kpi"><div><label>배송비 매출</label><strong>${esc(money(shipRev))}</strong></div></div>
          <div class="ad-kpi"><div><label>주문 고객수</label><strong>${customers.length}</strong></div></div>
        </div>
        <div class="ad-grid-2">
          <section class="ad-panel-card">
            <h2>상품별 판매</h2>
            ${
              products.length
                ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>상품</th><th>수량</th><th>매출</th></tr></thead><tbody>
                ${products.map((p) => `<tr><td>${esc(p.name)}</td><td>${p.qty}</td><td>${esc(money(p.sales))}</td></tr>`).join("")}
                </tbody></table></div>`
                : `<div class="ad-empty">데이터가 없습니다</div>`
            }
          </section>
          <section class="ad-panel-card">
            <h2>지역별 주문</h2>
            ${
              suburbs.length
                ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr><th>Suburb</th><th>주문수</th><th>매출</th></tr></thead><tbody>
                ${suburbs.map((s) => `<tr><td>${esc(s.suburb)}</td><td>${s.count}</td><td>${esc(money(s.sales))}</td></tr>`).join("")}
                </tbody></table></div>`
                : `<div class="ad-empty">데이터가 없습니다</div>`
            }
          </section>
        </div>
        <section class="ad-panel-card">
          <h2>고객</h2>
          <div class="ad-kpi-row">
            <div class="ad-kpi is-info"><div><label>신규 고객</label><strong>${newC}</strong></div></div>
            <div class="ad-kpi is-ok"><div><label>재주문 고객</label><strong>${returning}</strong></div></div>
          </div>
        </section>
      </div>`;

    root.querySelector("#ad-report-csv")?.addEventListener("click", () => {
      const lines = [["상품", "수량", "매출"], ...products.map((p) => [p.name, p.qty, p.sales])];
      const csv = lines.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(",")).join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `kimchi-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  }

  /* ---------- Notices + templates ---------- */
  function getNotices() {
    return loadJson(NOTICE_KEY, []);
  }

  function getTemplates() {
    const saved = loadJson(TEMPLATE_KEY, null);
    return Array.isArray(saved) && saved.length ? saved : DEFAULT_TEMPLATES;
  }

  function renderNotices(root) {
    if (!root) return;
    const notices = getNotices();
    const templates = getTemplates();
    root.innerHTML = `
      <div class="ad-page-stack">
        <div class="ad-tabs">
          <button type="button" class="ad-tab active" data-notice-tab="list">공지 목록</button>
          <button type="button" class="ad-tab" data-notice-tab="templates">메시지 템플릿</button>
        </div>
        <div id="ad-notice-list-panel">
          <div class="ad-filterbar">
            <button type="button" class="shop-btn shop-btn-primary shop-btn-sm" id="ad-notice-new">새 안내문 작성</button>
          </div>
          ${
            notices.length
              ? `<div class="ad-table-wrap"><table class="ad-table"><thead><tr>
                  <th>제목</th><th>유형</th><th>작성일</th><th>상태</th><th></th>
                </tr></thead><tbody>
                ${notices
                  .map(
                    (n) => `<tr>
                    <td><strong>${esc(n.title)}</strong></td>
                    <td>${esc(n.type || "기타")}</td>
                    <td>${esc(String(n.createdAt || "").slice(0, 10))}</td>
                    <td><span class="ad-badge ad-badge-muted">${esc(n.status || "초안")}</span></td>
                    <td><button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-copy-notice="${esc(n.id)}">내용 복사</button></td>
                  </tr>`
                  )
                  .join("")}
                </tbody></table></div>`
              : `<div class="ad-empty"><strong>작성된 안내문이 없습니다</strong>고객 안내용 문구를 저장해 두세요.</div>`
          }
          <section class="ad-panel-card" id="ad-notice-editor" hidden style="margin-top:14px">
            <h2>안내문 작성</h2>
            <div class="ad-settings-card">
              <label>제목<input type="text" id="ad-notice-title" /></label>
              <label>유형
                <select id="ad-notice-type">
                  <option>배송 안내</option><option>예약 마감</option><option>상품 안내</option>
                  <option>신상품</option><option>배송 일정 변경</option><option>기타</option>
                </select>
              </label>
              <label>본문<textarea id="ad-notice-body"></textarea></label>
              <label>발송 대상 메모<input type="text" id="ad-notice-audience" placeholder="예: 이번 차수 전체 고객" /></label>
              <div class="ad-filterbar">
                <button type="button" class="shop-btn shop-btn-primary shop-btn-sm" id="ad-notice-save">저장</button>
                <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" id="ad-notice-cancel">취소</button>
              </div>
            </div>
          </section>
        </div>
        <div id="ad-notice-tpl-panel" hidden>
          <p style="margin:0 0 10px;color:var(--ad-muted);font-size:13px;font-weight:600">변수: {customerName} {deliveryDate} {estimatedTime} {orderNumber}</p>
          <div class="ad-settings-grid">
            ${templates
              .map(
                (t) => `<section class="ad-panel-card ad-settings-card">
                <h2 style="margin:0 0 8px;font-size:14px">${esc(t.name)}</h2>
                <textarea data-tpl-id="${esc(t.id)}" rows="5">${esc(t.body)}</textarea>
                <div class="ad-filterbar" style="margin-top:8px">
                  <button type="button" class="shop-btn shop-btn-outline shop-btn-sm" data-copy-tpl="${esc(t.id)}">내용 복사</button>
                </div>
              </section>`
              )
              .join("")}
          </div>
          <div class="ad-filterbar" style="margin-top:12px">
            <button type="button" class="shop-btn shop-btn-primary shop-btn-sm" id="ad-tpl-save">템플릿 저장</button>
          </div>
        </div>
      </div>`;

    const listPanel = root.querySelector("#ad-notice-list-panel");
    const tplPanel = root.querySelector("#ad-notice-tpl-panel");
    root.querySelectorAll("[data-notice-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        root.querySelectorAll("[data-notice-tab]").forEach((b) => b.classList.toggle("active", b === btn));
        const tab = btn.getAttribute("data-notice-tab");
        listPanel.hidden = tab !== "list";
        tplPanel.hidden = tab !== "templates";
      });
    });

    const editor = root.querySelector("#ad-notice-editor");
    root.querySelector("#ad-notice-new")?.addEventListener("click", () => {
      editor.hidden = false;
    });
    root.querySelector("#ad-notice-cancel")?.addEventListener("click", () => {
      editor.hidden = true;
    });
    root.querySelector("#ad-notice-save")?.addEventListener("click", () => {
      const title = root.querySelector("#ad-notice-title")?.value?.trim();
      const body = root.querySelector("#ad-notice-body")?.value?.trim();
      if (!title || !body) return alert("제목과 본문을 입력해 주세요.");
      const next = getNotices();
      next.unshift({
        id: `n-${Date.now()}`,
        title,
        body,
        type: root.querySelector("#ad-notice-type")?.value || "기타",
        audience: root.querySelector("#ad-notice-audience")?.value || "",
        status: "초안",
        createdAt: new Date().toISOString(),
      });
      saveJson(NOTICE_KEY, next);
      renderNotices(root);
    });

    root.querySelectorAll("[data-copy-notice]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-notice");
        const n = getNotices().find((x) => x.id === id);
        if (!n) return;
        await navigator.clipboard.writeText(`${n.title}\n\n${n.body}`);
        btn.textContent = "복사됨";
      });
    });

    root.querySelector("#ad-tpl-save")?.addEventListener("click", () => {
      const next = getTemplates().map((t) => {
        const ta = root.querySelector(`textarea[data-tpl-id="${t.id}"]`);
        return { ...t, body: ta ? ta.value : t.body };
      });
      saveJson(TEMPLATE_KEY, next);
      alert("템플릿을 저장했습니다.");
    });

    root.querySelectorAll("[data-copy-tpl]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-copy-tpl");
        const ta = root.querySelector(`textarea[data-tpl-id="${id}"]`);
        if (!ta) return;
        await navigator.clipboard.writeText(ta.value);
        btn.textContent = "복사됨";
      });
    });
  }

  /* ---------- Settings ---------- */
  function getExtraSettings() {
    return loadJson(SETTINGS_KEY, {
      businessName: "Kimchi House AU",
      phone: "",
      email: "",
      origin: "36 Mid Dural Rd, Galston NSW 2159",
      shippingFee: "10",
      freeShippingFrom: "80",
      smsProvider: "미연결",
      smsEnabled: false,
    });
  }

  function renderSettings(root, ctx = {}) {
    if (!root) return;
    const s = getExtraSettings();
    const preorderOn = !!ctx.preorderOpen;
    root.innerHTML = `
      <div class="ad-settings-grid">
        <section class="ad-panel-card ad-settings-card">
          <h2>사업장 설정</h2>
          <label>사업명<input id="ad-set-businessName" value="${esc(s.businessName)}" /></label>
          <label>전화번호<input id="ad-set-phone" value="${esc(s.phone)}" /></label>
          <label>이메일<input id="ad-set-email" value="${esc(s.email)}" /></label>
          <label>기본 출발지<input id="ad-set-origin" value="${esc(s.origin)}" /></label>
          <label>기본 배송비 ($)<input id="ad-set-shippingFee" value="${esc(s.shippingFee)}" /></label>
          <label>무료배송 기준 ($)<input id="ad-set-freeShippingFrom" value="${esc(s.freeShippingFrom)}" /></label>
        </section>
        <section class="ad-panel-card ad-settings-card">
          <h2>SMS 설정 (준비)</h2>
          <label>Provider
            <select id="ad-set-smsProvider">
              <option ${s.smsProvider === "미연결" ? "selected" : ""}>미연결</option>
              <option>Twilio</option>
              <option>ClickSend</option>
              <option>MessageMedia</option>
            </select>
          </label>
          <label>Sender ID<input id="ad-set-smsSender" value="${esc(s.smsSender || "")}" placeholder="예: KimchiHouse" /></label>
          <p style="margin:0;color:var(--ad-muted);font-size:12px;font-weight:600">실제 발송 연동은 추후 provider adapter로 연결합니다.</p>
        </section>
        <section class="ad-panel-card ad-settings-card">
          <h2>운영</h2>
          <p style="margin:0;color:var(--ad-muted);font-size:12px;font-weight:600">사전 주문 스위치는 상단 헤더에서 제어합니다. 현재: <strong>${preorderOn ? "ON" : "OFF"}</strong></p>
        </section>
        <section class="ad-panel-card ad-settings-card">
          <h2>관리자</h2>
          <label>사용자명<input value="관리자" readonly /></label>
          <label>권한<input value="Staff / Admin" readonly /></label>
          <p style="margin:0;color:var(--ad-muted);font-size:12px;font-weight:600">비밀번호는 서버 ADMIN_PASSWORD 환경변수로 관리됩니다.</p>
        </section>
      </div>
      <div class="ad-filterbar" style="margin-top:14px">
        <button type="button" class="shop-btn shop-btn-primary" id="ad-settings-save">설정 저장</button>
      </div>`;

    root.querySelector("#ad-settings-save")?.addEventListener("click", () => {
      const next = {
        businessName: root.querySelector("#ad-set-businessName")?.value || "",
        phone: root.querySelector("#ad-set-phone")?.value || "",
        email: root.querySelector("#ad-set-email")?.value || "",
        origin: root.querySelector("#ad-set-origin")?.value || "",
        shippingFee: root.querySelector("#ad-set-shippingFee")?.value || "10",
        freeShippingFrom: root.querySelector("#ad-set-freeShippingFrom")?.value || "80",
        smsProvider: root.querySelector("#ad-set-smsProvider")?.value || "미연결",
        smsSender: root.querySelector("#ad-set-smsSender")?.value || "",
      };
      saveJson(SETTINGS_KEY, next);
      alert("설정을 저장했습니다. (로컬 저장 · 서버 설정과 별도)");
    });
  }

  global.KHAdminFeatures = {
    setOrders(orders) {
      global.__KH_ADMIN_ORDERS__ = Array.isArray(orders) ? orders : [];
    },
    renderDashboard,
    renderCustomers,
    renderReports,
    renderNotices,
    renderSettings,
    customerDrawerHtml,
    buildCustomers,
    statusBadge,
    itemSummary,
    money,
  };
})(typeof window !== "undefined" ? window : globalThis);
