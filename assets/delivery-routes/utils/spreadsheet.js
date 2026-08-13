/** Spreadsheet parse + column mapping helpers (SheetJS / XLSX global). */
(function (global) {
  const FIELD_DEFS = [
    { key: "name", label: "고객명", aliases: ["name", "customer", "customer name", "고객명", "성함", "이름"] },
    { key: "phone", label: "전화번호", aliases: ["phone", "mobile", "tel", "contact", "전화번호", "연락처", "휴대폰"] },
    { key: "address", label: "배송주소", aliases: ["address", "delivery address", "street", "배송주소", "주소", "street address"] },
    { key: "suburb", label: "Suburb", aliases: ["suburb", "city", "town", "지역", "suburb/city"] },
    { key: "postcode", label: "Postcode", aliases: ["postcode", "post code", "zip", "우편번호", "postal"] },
    { key: "orderSummary", label: "주문상품", aliases: ["order", "items", "products", "주문상품", "상품", "order summary", "item"] },
    { key: "total", label: "주문금액", aliases: ["total", "amount", "price", "주문금액", "금액", "order total"] },
    { key: "boxCount", label: "박스수", aliases: ["box", "boxes", "box count", "박스", "박스수", "carton"] },
    { key: "notes", label: "배송메모", aliases: ["note", "notes", "memo", "delivery note", "배송메모", "요청사항", "remark"] },
    { key: "id", label: "주문번호", aliases: ["order id", "order no", "id", "주문번호", "orderno"] },
  ];

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
    return { headers, rows, sheetName };
  }

  function applyMapping(rows, mapping) {
    return rows.map((row, idx) => {
      const get = (key) => {
        const col = mapping[key];
        if (!col) return "";
        return row[col] == null ? "" : String(row[col]).trim();
      };
      const totalRaw = get("total").replace(/[^0-9.]/g, "");
      const boxRaw = get("boxCount").replace(/[^0-9]/g, "");
      return {
        id: get("id") || `UP-${String(idx + 1).padStart(3, "0")}`,
        name: get("name"),
        phone: get("phone"),
        address: get("address"),
        suburb: get("suburb"),
        postcode: get("postcode"),
        orderSummary: get("orderSummary"),
        total: totalRaw ? Number(totalRaw) : 0,
        boxCount: boxRaw ? Number(boxRaw) : 1,
        notes: get("notes"),
        lat: null,
        lng: null,
        isDemo: false,
        status: "pending",
        reviewReason: null,
        etaStart: null,
        etaEnd: null,
        actualDeliveredAt: null,
        smsStatus: "none",
        lastSmsAt: null,
        etaSmsStatus: "none",
      };
    });
  }

  function validateOrder(order) {
    const reasons = [];
    if (!order.name) reasons.push("고객명 누락");
    if (!order.address || order.address.length < 5) reasons.push("배송주소 누락/불완전");
    if (!order.suburb && !order.postcode) reasons.push("Suburb / Postcode 누락");
    if (order.address && /^(unit|apt|아파트)\b/i.test(order.address) && order.address.split(/\s+/).length < 3) {
      reasons.push("도로명 주소가 불완전합니다");
    }
    return reasons;
  }

  global.KHSpreadsheet = {
    FIELD_DEFS,
    suggestMapping,
    parseWorkbook,
    applyMapping,
    validateOrder,
  };
})(typeof window !== "undefined" ? window : globalThis);
