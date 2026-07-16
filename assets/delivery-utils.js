(function (global) {
  const DELIVERY_STATUSES = [
    "예약 접수",
    "주문 확인 완료",
    "배송 준비 중",
    "배송 안내 완료",
    "배송 완료",
  ];
  const DEFAULT_DELIVERY_STATUS = "예약 접수";
  const DEFAULT_DELIVERY_DATE = "2026-08-23";
  const CATEGORY_LABELS = {
    kimchi: "김치",
    frozen: "냉동·반찬",
    walkerhill: "워커힐",
  };
  const CATEGORY_ORDER = ["walkerhill", "kimchi", "frozen"];

  function pickValidStatus(value) {
    return DELIVERY_STATUSES.includes(value) ? value : null;
  }

  function mergeDeliveryStatuses(...statuses) {
    const valid = statuses.map(pickValidStatus).filter(Boolean);
    if (!valid.length) return DEFAULT_DELIVERY_STATUS;
    if (valid.every((s) => s === "배송 완료")) return "배송 완료";
    if (valid.some((s) => s === "배송 준비 중")) return "배송 준비 중";
    if (valid.some((s) => s === "배송 안내 완료")) return "배송 안내 완료";
    if (valid.some((s) => s === "주문 확인 완료")) return "주문 확인 완료";
    return "예약 접수";
  }

  function legacyStatuses(order) {
    const found = [];
    if (order?.kimchiDeliveryStatus) found.push(order.kimchiDeliveryStatus);
    if (order?.frozenDeliveryStatus) found.push(order.frozenDeliveryStatus);
    if (order?.delivery?.kimchi?.status) found.push(order.delivery.kimchi.status);
    if (order?.delivery?.frozen?.status) found.push(order.delivery.frozen.status);
    if (typeof order?.delivery?.kimchi === "string") found.push(order.delivery.kimchi);
    if (typeof order?.delivery?.frozen === "string") found.push(order.delivery.frozen);
    return found;
  }

  function orderStatus(order) {
    const direct =
      pickValidStatus(order?.status) ||
      pickValidStatus(order?.deliveryStatus) ||
      pickValidStatus(order?.delivery?.status);
    if (direct) return direct;
    const legacy = legacyStatuses(order);
    if (legacy.length) return mergeDeliveryStatuses(...legacy);
    return DEFAULT_DELIVERY_STATUS;
  }

  function parseDeliveryDate(value, fallbackYear = 2026) {
    if (!value) return null;
    const raw = String(value).trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    const md = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    if (md) {
      const m = String(Number(md[1])).padStart(2, "0");
      const d = String(Number(md[2])).padStart(2, "0");
      return `${fallbackYear}-${m}-${d}`;
    }
    return null;
  }

  function formatDeliveryDateLabel(isoDate) {
    const parsed = parseDeliveryDate(isoDate);
    if (!parsed) return "-";
    const parts = parsed.split("-");
    return `${Number(parts[1])}월 ${Number(parts[2])}일`;
  }

  function resolveDeliveryDate(order) {
    const candidates = [
      order?.deliveryDate,
      order?.delivery?.date,
      order?.shippingBreakdown?.kimchi?.delivery,
      order?.shippingBreakdown?.frozen?.delivery,
      order?.shippingBreakdown?.walkerhill?.delivery,
    ];
    for (const value of candidates) {
      const parsed = parseDeliveryDate(value);
      if (parsed) return parsed;
    }
    return DEFAULT_DELIVERY_DATE;
  }

  function itemCategory(item) {
    if (item?.category && CATEGORY_LABELS[item.category]) return item.category;
    return "other";
  }

  function groupItemsByCategory(items) {
    const groups = {};
    for (const item of items || []) {
      const cat = itemCategory(item);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }
    const ordered = [];
    for (const cat of CATEGORY_ORDER) {
      if (groups[cat]?.length) ordered.push({ key: cat, label: CATEGORY_LABELS[cat], items: groups[cat] });
    }
    if (groups.other?.length) ordered.push({ key: "other", label: "기타", items: groups.other });
    return ordered;
  }

  function money(n) {
    return "$" + Number(n || 0).toFixed(0);
  }

  function buildConfirmMessage(order) {
    const dateLabel = formatDeliveryDateLabel(resolveDeliveryDate(order));
    const lines = (order.items || []).map((i) => `- ${i.name} ${i.qty}개`).join("\n");
    return `[김치하우스 예약 확인]

주문번호: ${order.id}

주문 상품:
${lines || "-"}

총 주문금액: ${money(order.total)}
배송 예정일: ${dateLabel}

김치와 냉동·반찬 상품은 함께 배송됩니다.`;
  }

  function buildShipNoticeMessage(order) {
    const dateLabel = formatDeliveryDateLabel(resolveDeliveryDate(order));
    const status = orderStatus(order);
    return `[김치하우스 배송 안내]

주문번호: ${order.id}

주문하신 김치와 냉동·반찬 상품이 함께 배송될 예정입니다.

배송 예정일: ${dateLabel}
배송 상태: ${status}`;
  }

  function normalizeAddressKey(order) {
    const c = order.customer || {};
    return [c.address, c.suburb]
      .filter(Boolean)
      .join(", ")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizeContactKey(order) {
    return String(order.customer?.phone || "").replace(/\D/g, "");
  }

  /** 같은 주소·연락처 중복 후보 (자동 병합 없음) */
  function findDuplicateHints(orders) {
    const byAddress = new Map();
    const byPhone = new Map();
    for (const o of orders || []) {
      const addr = normalizeAddressKey(o);
      const phone = normalizeContactKey(o);
      if (addr) {
        if (!byAddress.has(addr)) byAddress.set(addr, []);
        byAddress.get(addr).push(o);
      }
      if (phone) {
        if (!byPhone.has(phone)) byPhone.set(phone, []);
        byPhone.get(phone).push(o);
      }
    }
    const hints = [];
    for (const [key, list] of byAddress) {
      if (list.length > 1) {
        hints.push({
          type: "address",
          key,
          orderIds: list.map((o) => o.id),
          label: list[0].customer?.address || key,
        });
      }
    }
    for (const [key, list] of byPhone) {
      if (list.length > 1) {
        hints.push({
          type: "phone",
          key,
          orderIds: list.map((o) => o.id),
          label: list[0].customer?.phone || key,
        });
      }
    }
    return hints;
  }

  function buildDeliveryRoute(orders) {
    const seen = new Set();
    const stops = [];
    for (const o of orders || []) {
      const c = o.customer || {};
      const address = [c.address, c.suburb].filter(Boolean).join(", ");
      const key = normalizeAddressKey(o) || o.id;
      if (seen.has(key)) continue;
      seen.add(key);
      stops.push({
        orderId: o.id,
        name: c.name || "-",
        phone: c.phone || "-",
        suburb: c.suburb || "",
        address,
      });
    }
    stops.sort((a, b) => String(a.suburb).localeCompare(String(b.suburb), "en") || String(a.address).localeCompare(String(b.address), "en"));
    return stops;
  }

  function defaultDeliveryDateFromProducts() {
    const products = global.KH_PRODUCTS;
    if (!products) return DEFAULT_DELIVERY_DATE;
    for (const cat of ["kimchi", "frozen", "walkerhill"]) {
      const parsed = parseDeliveryDate(products[cat]?.delivery);
      if (parsed) return parsed;
    }
    return DEFAULT_DELIVERY_DATE;
  }

  global.KH_DELIVERY = {
    DELIVERY_STATUSES,
    DEFAULT_DELIVERY_STATUS,
    DEFAULT_DELIVERY_DATE,
    CATEGORY_LABELS,
    orderStatus,
    mergeDeliveryStatuses,
    parseDeliveryDate,
    formatDeliveryDateLabel,
    resolveDeliveryDate,
    groupItemsByCategory,
    buildConfirmMessage,
    buildShipNoticeMessage,
    findDuplicateHints,
    buildDeliveryRoute,
    defaultDeliveryDateFromProducts,
  };
})(typeof window !== "undefined" ? window : globalThis);
