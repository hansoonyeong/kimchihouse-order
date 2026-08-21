(function (global) {
  const DELIVERY_STATUSES = [
    "예약 접수",
    "주문 확인 완료",
    "배송 준비 중",
    "배송 안내 완료",
    "배송 완료",
  ];
  const DEFAULT_DELIVERY_STATUS = "예약 접수";
  const DEFAULT_DELIVERY_DATE = "2026-09-03";
  const CURRENT_ROUND_MIN_DATE = "2026-08-23";
  /**
   * 일괄 배송 회차에서 저장된 날짜가 달라도 같은 배치로 본다.
   * (기존 8/23·8/29~30 예약 → 태풍·해운 지연으로 9/6 전후 일괄)
   */
  const DELIVERY_BATCH_CANONICAL = {
    "2026-08-23": "2026-09-03",
    "2026-08-29": "2026-09-03",
    "2026-08-30": "2026-09-03",
    "2026-09-04": "2026-09-03",
    "2026-09-05": "2026-09-03",
    "2026-09-06": "2026-09-03",
  };
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
    const slash = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (slash) {
      const m = String(Number(slash[1])).padStart(2, "0");
      const d = String(Number(slash[2])).padStart(2, "0");
      return `${fallbackYear}-${m}-${d}`;
    }
    return null;
  }

  function formatDeliveryDateLabel(isoDate) {
    const parsed = parseDeliveryDate(isoDate);
    if (!parsed) return "-";
    const canon = canonicalDeliveryDate(parsed) || parsed;
    if (canon === "2026-09-03") return "9월 6일 전후";
    if (canon === "2026-08-29") return "9월 6일 전후";
    const parts = canon.split("-");
    return `${Number(parts[1])}월 ${Number(parts[2])}일`;
  }

  /** 고객 안내용: 확정일이 아닌 예정일(경) */
  function formatDeliveryDateApproxLabel(isoDate) {
    const label = formatDeliveryDateLabel(isoDate);
    if (!label || label === "-") return label;
    if (/~/.test(label) || /경$/.test(label) || /전후/.test(label)) return label;
    return `${label}경`;
  }

  /**
   * 관리자 필터·통계용: 같은 일괄 배송 배치면 하나의 날짜 키로 합친다.
   */
  function canonicalDeliveryDate(value) {
    const parsed = parseDeliveryDate(value);
    if (!parsed) return value || null;
    return DELIVERY_BATCH_CANONICAL[parsed] || parsed;
  }

  function explicitDeliveryDate(order) {
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
    return null;
  }

  function hasLegacySplitDelivery(order) {
    return Boolean(
      order?.kimchiDeliveryStatus ||
        order?.frozenDeliveryStatus ||
        order?.delivery?.kimchi ||
        order?.delivery?.frozen
    );
  }

  function inferredDeliveryDate(order) {
    const candidates = [
      order?.deliveryDate,
      order?.delivery?.date,
      order?.shippingBreakdown?.kimchi?.delivery,
      order?.shippingBreakdown?.frozen?.delivery,
      order?.shippingBreakdown?.walkerhill?.delivery,
    ];
    const parsed = candidates.map((v) => parseDeliveryDate(v)).filter(Boolean);
    if (parsed.length) return parsed.sort()[0];
    return null;
  }

  function isPreviousRoundOrder(order, minDate = CURRENT_ROUND_MIN_DATE) {
    const inferred = inferredDeliveryDate(order);
    if (inferred && inferred < minDate) return true;
    if (inferred && inferred >= minDate) return false;
    const stored = explicitDeliveryDate(order);
    if (stored && stored < minDate) return true;
    if (stored && stored >= minDate) return false;
    if (hasLegacySplitDelivery(order)) return true;
    const ROUND_OPEN_DATE = "2026-07-16";
    if (stored === minDate && order?.createdAt?.slice(0, 10) < ROUND_OPEN_DATE) return true;
    return false;
  }

  function isCurrentRoundOrder(order, minDate = CURRENT_ROUND_MIN_DATE) {
    return !isPreviousRoundOrder(order, minDate);
  }

  function resolveDeliveryDate(order) {
    const explicit = explicitDeliveryDate(order);
    if (explicit) return canonicalDeliveryDate(explicit) || explicit;
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

  function transferReferenceExample(order) {
    const name = String(order?.customer?.name || "").trim().replace(/\s+/g, "");
    const digits = String(order?.customer?.phone || "").replace(/\D/g, "");
    const last4 = digits.length >= 4 ? digits.slice(-4) : "";
    if (name && last4) return `${name}${last4}`;
    return "홍길동1234";
  }

  function buildConfirmMessage(order) {
    const dateLabel = formatDeliveryDateApproxLabel(resolveDeliveryDate(order));
    const lines = (order.items || [])
      .map((i) => `• ${i.name} × ${i.qty}`)
      .join("\n");
    const transferBlock =
      order.payment === "cash"
        ? ""
        : `

💳 계좌이체를 선택하신 경우

입금 시 반드시 Reference(Description)란에
'주문자 이름 + 연락처 뒤 4자리'를 입력해주세요.

예) ${transferReferenceExample(order)}

입금 후에는 이체 완료 화면을 캡처하여 카카오톡으로 보내주시면 됩니다.`;

    return `[김치하우스 예약 확인]

안녕하세요.
김치하우스를 이용해 주셔서 감사합니다. 😊

고객님의 예약이 정상적으로 접수되었습니다.

━━━━━━━━━━━━━━━

📦 주문번호
${order.id}

🛒 주문상품
${lines || "• -"}

💰 총 주문금액
${money(order.total)}

🚚 배송 예정일
${dateLabel}
📢 김치와 냉동·반찬 상품은 함께 배송됩니다.
해운 사정에 따라 일정이 변동될 수 있으며, 변경 시 미리 안내드립니다.
━━━━━━━━━━━━━━━
${transferBlock}

궁금한 사항은 언제든지 카카오톡 채널로 문의해주세요.

감사합니다.
김치하우스 드림`;
  }

  function buildShipNoticeMessage(order) {
    const dateLabel = formatDeliveryDateApproxLabel(resolveDeliveryDate(order));
    return `[김치하우스 배송 안내]

안녕하세요.
김치하우스입니다. 😊

고객님께서 예약하신 상품의 배송 일정을 안내드립니다.

━━━━━━━━━━━━━━━

📦 주문번호
${order.id}

🚚 배송 예정일
${dateLabel}

🕒 예상 배송시간
배송 당일 순차적으로 배송될 예정입니다.
출발 전 또는 배송이 가까워지면 다시 안내드리겠습니다.

━━━━━━━━━━━━━━━

김치와 냉동·반찬 상품은 함께 배송됩니다.

교통 상황과 당일 배송 순서에 따라 도착 시간이 조금 달라질 수 있는 점 양해 부탁드립니다.

부재 예정이시거나 배송과 관련해 전달하실 내용이 있으시면 미리 카카오톡으로 알려주세요.

상품 수령 후에는 김치와 냉동·냉장 상품을 가능한 한 빠르게 냉장고 또는 냉동고에 보관해 주세요.

정성껏 준비하여 안전하게 배송해드리겠습니다.

감사합니다.
김치하우스 드림`;
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
    CURRENT_ROUND_MIN_DATE,
    CATEGORY_LABELS,
    orderStatus,
    mergeDeliveryStatuses,
    parseDeliveryDate,
    formatDeliveryDateLabel,
    formatDeliveryDateApproxLabel,
    canonicalDeliveryDate,
    explicitDeliveryDate,
    inferredDeliveryDate,
    isPreviousRoundOrder,
    isCurrentRoundOrder,
    resolveDeliveryDate,
    groupItemsByCategory,
    buildConfirmMessage,
    buildShipNoticeMessage,
    findDuplicateHints,
    buildDeliveryRoute,
    defaultDeliveryDateFromProducts,
  };
})(typeof window !== "undefined" ? window : globalThis);
