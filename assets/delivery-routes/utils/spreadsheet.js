/** Spreadsheet parse + Kimchi House 예약표 전용 파서 (SheetJS / XLSX global). */
(function (global) {
  const FIELD_DEFS = [
    { key: "name", label: "고객명", aliases: ["name", "customer", "customer name", "고객명", "성함", "이름"] },
    { key: "phone", label: "전화번호", aliases: ["phone", "mobile", "tel", "contact", "전화번호", "연락처", "휴대폰"] },
    { key: "address", label: "배송주소", aliases: ["address", "delivery address", "street", "배송주소", "주소", "street address"] },
    { key: "suburb", label: "Suburb", aliases: ["suburb", "city", "town", "지역", "suburb/city"] },
    { key: "postcode", label: "Postcode", aliases: ["postcode", "post code", "zip", "우편번호", "postal"] },
    { key: "orderSummary", label: "주문상품", aliases: ["order", "items", "products", "주문상품", "상품", "order summary", "item"] },
    { key: "total", label: "주문금액", aliases: ["total", "amount", "price", "주문금액", "금액", "order total", "가격"] },
    { key: "boxCount", label: "박스수", aliases: ["box", "boxes", "box count", "박스", "박스수", "carton"] },
    { key: "notes", label: "배송메모", aliases: ["note", "notes", "memo", "delivery note", "배송메모", "요청사항", "remark", "비고"] },
    { key: "id", label: "주문번호", aliases: ["order id", "order no", "id", "주문번호", "orderno"] },
  ];

  const SKIP_PRODUCT_HEADER =
    /^(비고|고개\s*부담|회사\s*부담|수금액|가격|지역|이름|주소|연락처|전화|주문번호)?$/i;

  function normHeader(h) {
    return String(h || "")
      .trim()
      .toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ");
  }

  function suggestMapping(headers) {
    const mapping = {};
    const used = new Set();
    for (const field of FIELD_DEFS) {
      let found = null;
      for (const h of headers) {
        const nh = normHeader(h);
        if (used.has(h)) continue;
        if (field.aliases.some((a) => nh === a || nh.includes(a))) {
          found = h;
          break;
        }
      }
      if (found) {
        mapping[field.key] = found;
        used.add(found);
      } else {
        mapping[field.key] = "";
      }
    }
    return mapping;
  }

  function parseWorkbook(arrayBuffer) {
    if (!global.XLSX) throw new Error("SheetJS(XLSX)가 로드되지 않았습니다.");
    const wb = global.XLSX.read(arrayBuffer, { type: "array" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const rows = global.XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
    if (!rows.length) throw new Error("시트가 비어 있습니다.");
    const headers = Object.keys(rows[0]);
    return { headers, rows, sheetName, workbook: wb };
  }

  function blankOrder(extra = {}) {
    return {
      id: "",
      name: "",
      phone: "",
      address: "",
      originalAddress: "",
      normalizedAddress: "",
      unitOrShop: "",
      suburb: "",
      postcode: "",
      orderSummary: "",
      total: 0,
      boxCount: 1,
      notes: "",
      lat: null,
      lng: null,
      latitude: null,
      longitude: null,
      isDemo: false,
      status: "pending",
      geocodingStatus: "pending",
      geocodingConfidence: 0,
      reviewReason: null,
      etaStart: null,
      etaEnd: null,
      actualDeliveredAt: null,
      smsStatus: "none",
      lastSmsAt: null,
      etaSmsStatus: "none",
      sourceSheet: "",
      reservationExport: null,
      sourceOrder: null,
      ...extra,
    };
  }

  function applyMapping(rows, mapping) {
    return rows.map((row, idx) => {
      const get = (key) => {
        const col = mapping[key];
        if (!col) return "";
        return row[col] == null ? "" : String(row[col]).trim();
      };
      const address = get("address");
      const totalRaw = get("total").replace(/[^0-9.]/g, "");
      const boxRaw = get("boxCount").replace(/[^0-9]/g, "");
      return blankOrder({
        id: get("id") || `UP-${String(idx + 1).padStart(3, "0")}`,
        name: get("name"),
        phone: get("phone"),
        address,
        originalAddress: address,
        suburb: get("suburb"),
        postcode: get("postcode"),
        orderSummary: get("orderSummary"),
        total: totalRaw ? Number(totalRaw) : 0,
        boxCount: boxRaw ? Number(boxRaw) : 1,
        notes: get("notes"),
      });
    });
  }

  function findReservationHeaderIndex(aoa) {
    for (let i = 0; i < Math.min(25, aoa.length); i++) {
      const row = (aoa[i] || []).map((c) => String(c || "").trim());
      const hasName = row.includes("이름");
      const hasAddr = row.includes("주소");
      const hasPhone = row.includes("연락처") || row.includes("전화");
      if (hasName && hasAddr && hasPhone) return i;
    }
    return -1;
  }

  function isSkipName(name) {
    return /^(합계|총계|소계|재고|주문|수량|상품명|비고|지역)$/i.test(String(name || "").trim());
  }

  function isProductHeader(h) {
    const t = String(h || "").trim();
    if (!t) return false;
    if (SKIP_PRODUCT_HEADER.test(t)) return false;
    if (/부담/.test(t)) return false;
    return true;
  }

  function extractPostcodeFromText(text) {
    const m = String(text || "").match(/\b(\d{4})\b/);
    return m ? m[1] : "";
  }

  /**
   * 김치하우스 주문 예약표 (지역/이름/주소/연락처 + 품목 수량 열)
   * 새벽팜/워커힐 시트가 있으면 해당 시트만 사용 (이킴 9월 등과 혼입 방지).
   * @returns {{ orders: object[], sheets: string[], format: 'reservation' } | null}
   */
  function parseKimchiReservationWorkbook(arrayBuffer) {
    if (!global.XLSX) throw new Error("SheetJS(XLSX)가 로드되지 않았습니다.");
    const wb = global.XLSX.read(arrayBuffer, { type: "array" });

    const PREFERRED_SHEET = /새벽팜|워커힐/i;
    const sheetNames = wb.SheetNames.slice();
    const preferredNames = sheetNames.filter((n) => PREFERRED_SHEET.test(n));
    const targetNames = preferredNames.length ? preferredNames : sheetNames;

    const allOrders = [];
    const usedSheets = [];

    targetNames.forEach((sheetName) => {
      const sheetIdx = sheetNames.indexOf(sheetName);
      const sheet = wb.Sheets[sheetName];
      const aoa = global.XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        defval: "",
        raw: false,
      });
      const headerIdx = findReservationHeaderIndex(aoa);
      if (headerIdx < 0) return;

      const headers = (aoa[headerIdx] || []).map((c) => String(c || "").trim());
      const nameI = headers.indexOf("이름");
      const addrI = headers.indexOf("주소");
      const phoneI = headers.includes("연락처")
        ? headers.indexOf("연락처")
        : headers.indexOf("전화");
      const suburbI = headers.indexOf("지역");
      const priceI = headers.indexOf("가격");
      const noteI = headers.indexOf("비고");

      const productCols = [];
      headers.forEach((h, c) => {
        if (c === nameI || c === addrI || c === phoneI || c === suburbI || c === priceI || c === noteI)
          return;
        if (isProductHeader(h)) productCols.push(c);
      });

      let sheetCount = 0;
      for (let r = headerIdx + 1; r < aoa.length; r++) {
        const row = aoa[r] || [];
        const name = String(row[nameI] || "").trim();
        const address = String(row[addrI] || "").trim();
        if (!name || !address) continue;
        if (isSkipName(name)) continue;

        const suburb = suburbI >= 0 ? String(row[suburbI] || "").trim() : "";
        const phone = phoneI >= 0 ? String(row[phoneI] || "").trim() : "";
        const priceRaw = priceI >= 0 ? String(row[priceI] || "").replace(/[^0-9.]/g, "") : "";
        const note = noteI >= 0 ? String(row[noteI] || "").trim() : "";

        const items = [];
        const exportProductCols = [];
        let boxes = 0;
        productCols.forEach((c) => {
          const qty = Number(String(row[c] || "").replace(/[^0-9.]/g, ""));
          if (!qty || qty <= 0) return;
          const label = headers[c] || `품목${c}`;
          items.push(`${label} × ${qty}`);
          exportProductCols.push({ col: c, qty, header: label });
          boxes += qty;
        });

        const postcode = extractPostcodeFromText(address) || extractPostcodeFromText(suburb);
        const id = `RES-${sheetIdx + 1}-${String(sheetCount + 1).padStart(3, "0")}`;
        allOrders.push(
          blankOrder({
            id,
            name,
            phone,
            address,
            originalAddress: address,
            suburb: suburb.replace(/\([^)]*\)/g, "").trim() || suburb,
            postcode,
            orderSummary: items.join("\n"),
            total: priceRaw ? Number(priceRaw) : 0,
            boxCount: boxes || 1,
            notes: note,
            sourceSheet: sheetName,
            reservationExport: {
              region: suburb,
              name,
              address,
              phone,
              productCols: exportProductCols,
              note,
            },
          })
        );
        sheetCount += 1;
      }

      if (sheetCount > 0) usedSheets.push(`${sheetName} (${sheetCount})`);
    });

    if (!allOrders.length) return null;
    return {
      format: "reservation",
      orders: allOrders,
      sheets: usedSheets,
    };
  }

  function validateOrder(order) {
    const reasons = [];
    const addr = order.originalAddress || order.address || "";
    if (!order.name) reasons.push("고객명 누락");
    if (!addr || addr.length < 5) reasons.push("배송주소 누락/불완전");
    if (addr && /^(unit|apt|아파트)\b/i.test(addr) && addr.split(/\s+/).length < 3) {
      reasons.push("도로명 주소가 불완전합니다");
    }
    return reasons;
  }

  global.KHSpreadsheet = {
    FIELD_DEFS,
    suggestMapping,
    parseWorkbook,
    applyMapping,
    parseKimchiReservationWorkbook,
    validateOrder,
  };
})(typeof window !== "undefined" ? window : globalThis);
