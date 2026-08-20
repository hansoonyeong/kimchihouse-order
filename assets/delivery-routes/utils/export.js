/** Route export — 상차용 배송일정표 xlsx + legacy CSV helpers. */
(function (global) {
  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function downloadText(filename, text, mime = "text/csv;charset=utf-8") {
    const blob = new Blob(["\uFEFF" + text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function orderPayloadFromPlanner(o) {
    if (!o) return null;
    const src = o.sourceOrder || {};
    const rawItems = Array.isArray(o.items) && o.items.length ? o.items : src.items;
    const items =
      Array.isArray(rawItems) && rawItems.length
        ? rawItems.map((i) => ({
            name: i.name || "",
            qty: Number(i.qty) || 1,
            productId: i.productId || i.id || "",
            sku: i.sku || "",
            variantKey: i.variantKey || "",
            componentsIncluded: i.componentsIncluded,
            bundleComponentsIncluded: i.bundleComponentsIncluded,
            price: i.price,
          }))
        : String(o.orderSummary || "")
            .split(/\n/)
            .map((line) => String(line || "").trim())
            .filter(Boolean)
            .map((line) => {
              const m = line.match(/^(.*?)(?:\s*[×x]\s*|\s+)(\d+(?:\.\d+)?)\s*$/i);
              return m
                ? { name: m[1].trim(), qty: Number(m[2]) || 1 }
                : { name: line, qty: 1 };
            });
    return {
      name: o.name || "",
      phone: o.phone || "",
      address: o.originalAddress || o.address || "",
      originalAddress: o.originalAddress || o.address || "",
      unitOrShop: o.unitOrShop || "",
      suburb: o.suburb || "",
      postcode: o.postcode || "",
      orderSummary: o.orderSummary || "",
      notes: o.notes || "",
      total: o.total ?? src.total ?? 0,
      productTotal: src.subtotal ?? src.productTotal,
      shippingFee: src.shippingFee ?? src.deliveryFee ?? 0,
      paymentLabel:
        o.paymentLabel ||
        src.paymentLabel ||
        (src.payment === "cash" ? "현장 결제 (현금)" : src.payment ? "계좌이체" : ""),
      items,
    };
  }

  /** 이번 차수 상차용 품목 헤더 (새벽팜4차 - 워커힐 3차) */
  const LOADING_PRINT_PRODUCTS = [
    "워커힐 포기",
    "워커힐 총각",
    "서울 7kg",
    "남도 7kg",
    "자연 7kg",
    "서울 3.5kg",
    "남도 3.5kg",
    "자연 3.5kg",
    "총각",
    "열무",
    "쪽파",
    "갓",
    "간장게장",
    "백명란",
    "만두 세트",
    "충무 김밥",
    "재첩",
    "진미채",
    "명태 커틀렛",
    "생 청국장",
    "된장",
    "김 24팩",
  ];

  function buildRouteExportPayload(ordersById, routes, deliveryDate) {
    const reservationOrders = {};
    const orders = {};
    const payloadRoutes = routes.map((route) => ({
      name: route.name,
      departureTime: route.departureTime || "",
      orderIds: (route.stopIds || []).filter((id) => {
        const o = ordersById.get(id);
        if (!o) return false;
        orders[id] = orderPayloadFromPlanner(o);
        if (o.reservationExport) reservationOrders[id] = o.reservationExport;
        return true;
      }),
    }));
    return {
      mode: "loading",
      deliveryDate: deliveryDate || "",
      routes: payloadRoutes,
      orders,
      reservationOrders,
      minsPerStop: 15,
    };
  }

  async function exportRoutesReservation(ordersById, routes, deliveryDate, adminKey) {
    if (!routes?.length) throw new Error("내보낼 Route가 없습니다.");
    const totalStops = routes.reduce((n, r) => n + (r.stopIds?.length || 0), 0);
    if (!totalStops) throw new Error("Route에 배정된 주문이 없습니다.");
    if (!adminKey) throw new Error("로그인이 필요합니다.");

    const res = await fetch("/api/order-template-export", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildRouteExportPayload(ordersById, routes, deliveryDate)),
    });

    if (!res.ok) {
      let message = "상차용 Export 실패";
      try {
        const data = await res.json();
        message = data.error || message;
      } catch (_) {
        /* binary body */
      }
      throw new Error(message);
    }

    const blob = await res.blob();
    const date = deliveryDate || new Date().toISOString().slice(0, 10);
    downloadBlob(`김치하우스_상차용_${date}.xlsx`, blob);
  }

  async function exportSingleRouteReservation(ordersById, route, deliveryDate, adminKey) {
    return exportRoutesReservation(ordersById, [route], deliveryDate, adminKey);
  }

  function addMinutesToTime(hhmm, minutes) {
    const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    let total = Number(m[1]) * 60 + Number(m[2]) + Number(minutes || 0);
    if (total < 0) total = 0;
    const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  function formatPrintDate(iso) {
    const raw = String(iso || "").trim();
    if (!raw) return "";
    const d = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
    if (Number.isNaN(d.getTime())) return raw;
    const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${d.getMonth() + 1}/${d.getDate()} (${week})`;
  }

  /** 상차용 양식 HTML (인쇄용) — 이번 차수 품목 열 */
  function buildLoadingSheetPrintHtml(route, ordersById, deliveryDate, { esc } = {}) {
    const escape =
      esc ||
      ((s) =>
        String(s ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"));
    const departure = route.departureTime || "";
    const dateLabel = formatPrintDate(deliveryDate);
    const productHeaders = LOADING_PRINT_PRODUCTS.map((h) => `<th>${escape(h)}</th>`).join("");
    const colCount = 16 + LOADING_PRINT_PRODUCTS.length;

    const stops = (route.stopIds || [])
      .map((id, i) => {
        const o = ordersById.get(id);
        if (!o) return "";
        const address = [o.unitOrShop, o.originalAddress || o.address, o.suburb, o.postcode]
          .filter(Boolean)
          .join(", ");
        const time = departure ? addMinutesToTime(departure, i * 15) : "";
        const src = o.sourceOrder || {};
        const shipping = Number(src.shippingFee || src.deliveryFee || 0) || 0;
        const total = Number(o.total) || 0;
        const productAmount = Math.max(0, total - shipping);
        const payStatus =
          o.paymentLabel ||
          src.paymentLabel ||
          (src.payment === "cash" ? "현장 결제 (현금)" : src.payment ? "계좌이체" : "");
        const collect = src.payment === "cash" ? total : 0;
        const productCells = LOADING_PRINT_PRODUCTS.map(() => `<td class="c"></td>`).join("");
        return `<tr>
          <td class="c">${i + 1}</td>
          <td class="c">${escape(time)}</td>
          <td class="c">${escape(o.name || "")}</td>
          <td class="c">${escape(o.phone || "")}</td>
          <td>${escape(address)}</td>
          <td class="c">${productAmount || ""}</td>
          <td class="c">${shipping}</td>
          <td class="c">${total || ""}</td>
          <td class="c">${escape(payStatus)}</td>
          <td class="c"></td>
          <td class="c"></td>
          <td class="c"></td>
          <td class="c">${collect || ""}</td>
          <td class="c"></td>
          <td class="detail">${escape(o.orderSummary || "").replace(/\n/g, "<br/>")}</td>
          ${productCells}
          <td>${escape(o.notes || "")}</td>
        </tr>`;
      })
      .join("");

    const zone = `━━━ ${route.name || "Route"} (${route.stopIds?.length || 0}건)${
      dateLabel ? ` · 배송일 ${dateLabel}` : ""
    }${departure ? ` · 출발 ${departure}` : ""} ━━━`;

    return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"/>
<title>${escape(route.name)} 상차용</title>
<style>
  @page { size: A4 landscape; margin: 6mm; }
  body { font-family: "Noto Sans KR", "Apple SD Gothic Neo", sans-serif; margin: 0; color: #111; }
  h1 { font-size: 15px; margin: 0 0 6px; }
  .meta { font-size: 11px; margin-bottom: 8px; color: #333; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 9px; }
  th, td { border: 1px solid #999; padding: 3px 4px; vertical-align: middle; }
  th { background: #9dc3e6; font-weight: 700; text-align: center; }
  .zone td { background: #e2f0d9; font-weight: 700; text-align: left; }
  td.c { text-align: center; }
  td.detail { white-space: normal; line-height: 1.3; }
</style></head><body>
  <h1>Kimchi House AU · 상차용 (새벽팜4차 / 워커힐3차)</h1>
  <div class="meta">${escape(zone)}</div>
  <table>
    <thead>
      <tr>
        <th>순번</th><th>배송시간</th><th>이름</th><th>전화번호</th><th>배송주소</th>
        <th>품목금액</th><th>배송료</th><th>결제금액</th><th>결제상태</th>
        <th>AG%</th><th>본인부담</th><th>회사청구</th><th>수금</th><th>사은품</th>
        <th>주문내역</th>
        ${productHeaders}
        <th>특이사항 및 메모</th>
      </tr>
    </thead>
    <tbody>
      <tr class="zone"><td colspan="${colCount}">${escape(zone)}</td></tr>
      ${stops}
    </tbody>
  </table>
  <script>window.onload=()=>window.print()<\/script>
</body></html>`;
  }

  function exportRoutesCsv(ordersById, routes, deliveryDate) {
    const header = [
      "Route",
      "Stop Number",
      "Customer Name",
      "Phone",
      "Address",
      "Suburb",
      "Postcode",
      "Order",
      "Total",
      "Delivery Notes",
      "Order ID",
    ];
    const lines = [header.map(csvCell).join(",")];
    for (const route of routes) {
      route.stopIds.forEach((id, idx) => {
        const o = ordersById.get(id);
        if (!o) return;
        lines.push(
          [
            route.name,
            idx + 1,
            o.name,
            o.phone,
            o.address,
            o.suburb,
            o.postcode,
            String(o.orderSummary || "").replace(/\n/g, " / "),
            o.total,
            o.notes,
            o.id,
          ]
            .map(csvCell)
            .join(",")
        );
      });
    }
    const date = deliveryDate || "undated";
    downloadText(`KimchiHouse_Routes_${date}.csv`, lines.join("\n"));
  }

  function exportSingleRouteCsv(ordersById, route, deliveryDate) {
    exportRoutesCsv(ordersById, [route], `${deliveryDate || "undated"}_${route.name.replace(/\s+/g, "_")}`);
  }

  global.KHRouteExport = {
    exportRoutesReservation,
    exportSingleRouteReservation,
    exportRoutesCsv,
    exportSingleRouteCsv,
    buildLoadingSheetPrintHtml,
    downloadText,
    downloadBlob,
  };
})(typeof window !== "undefined" ? window : globalThis);
