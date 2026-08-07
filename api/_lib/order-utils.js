export const DELIVERY_STATUSES = [
  "예약 접수",
  "주문 확인 완료",
  "배송 준비 중",
  "배송 안내 완료",
  "배송 완료",
];

export const DEFAULT_DELIVERY_STATUS = "예약 접수";

/** 현재 회차 기본 배송일 (YYYY-MM-DD) — 고객 안내·새 주문 폴백 */
export const DEFAULT_DELIVERY_DATE = "2026-08-29";

/** 이번 차수 주문 판별 하한 (일정 변경 전 예약 포함) */
export const CURRENT_ROUND_MIN_DATE = "2026-08-23";

export const CATEGORY_LABELS = {
  kimchi: "김치",
  frozen: "냉동·반찬",
  walkerhill: "워커힐",
};

export function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

export function phonesMatch(a, b) {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const minLen = Math.min(na.length, nb.length);
  if (minLen < 8) return false;
  return na.endsWith(nb) || nb.endsWith(na);
}

function pickValidStatus(value) {
  return DELIVERY_STATUSES.includes(value) ? value : null;
}

/** 레거시 김치/냉동 분리 상태를 하나의 상태로 병합 */
export function mergeDeliveryStatuses(...statuses) {
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

export function orderStatus(order) {
  const direct =
    pickValidStatus(order?.status) ||
    pickValidStatus(order?.deliveryStatus) ||
    pickValidStatus(order?.delivery?.status);
  if (direct) {
    // confirmMessageSent / shipNoticeSent는 "상태 승격" 근거로 사용합니다.
    // (과거에 상태 값만 누락된 데이터가 있어도, 읽기 시 일관되게 표시되도록 보정)
    if (direct === "예약 접수" && order?.confirmMessageSent) return "주문 확인 완료";
    if (
      (direct === "주문 확인 완료" || direct === "배송 준비 중") &&
      order?.shipNoticeSent
    ) {
      return "배송 안내 완료";
    }
    return direct;
  }
  const legacy = legacyStatuses(order);
  if (legacy.length) return mergeDeliveryStatuses(...legacy);
  return DEFAULT_DELIVERY_STATUS;
}

/** "8월 23일 배송" / "2026-08-23" / "6/26 ~ 6/29" → "2026-08-23" */
export function parseDeliveryDate(value, fallbackYear = 2026) {
  if (!value) return null;
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const md = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (md) {
    const y = fallbackYear;
    const m = String(Number(md[1])).padStart(2, "0");
    const d = String(Number(md[2])).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const slash = raw.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (slash) {
    const m = String(Number(slash[1])).padStart(2, "0");
    const d = String(Number(slash[2])).padStart(2, "0");
    return `${fallbackYear}-${m}-${d}`;
  }
  return null;
}

export function formatDeliveryDateLabel(isoDate) {
  const parsed = parseDeliveryDate(isoDate);
  if (!parsed) return "-";
  const match = parsed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return parsed;
  return `${Number(match[2])}월 ${Number(match[3])}일`;
}

/** 주문에 저장된 배송일만 (기본값으로 추정하지 않음) */
export function explicitDeliveryDate(order) {
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

/** 회차 분류용 — shippingBreakdown 등에서 가장 이른 배송일 */
export function inferredDeliveryDate(order) {
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

/** 이번 차수(8/23~) 이전 배송 회차 주문 */
export function isPreviousRoundOrder(order, minDate = CURRENT_ROUND_MIN_DATE) {
  const inferred = inferredDeliveryDate(order);
  if (inferred && inferred < minDate) return true;
  if (inferred && inferred >= minDate) return false;

  const stored = explicitDeliveryDate(order);
  if (stored && stored < minDate) return true;
  if (stored && stored >= minDate) return false;

  // 마이그레이션 후 deliveryDate만 8/23으로 채워진 이전 차수
  if (hasLegacySplitDelivery(order)) return true;

  const ROUND_OPEN_DATE = "2026-07-16";
  if (stored === minDate && order?.createdAt?.slice(0, 10) < ROUND_OPEN_DATE) return true;

  return false;
}

export function isCurrentRoundOrder(order, minDate = CURRENT_ROUND_MIN_DATE) {
  return !isPreviousRoundOrder(order, minDate);
}

export function resolveDeliveryDate(order) {
  const explicit = explicitDeliveryDate(order);
  if (explicit) return explicit;
  return DEFAULT_DELIVERY_DATE;
}

export function paymentLabel(payment) {
  return payment === "cash" ? "현장 결제 (현금)" : "계좌이체";
}

export function formatOrderDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 읽기용: 기존 필드는 유지하고 통합 필드를 채워 넣음 (원본 손상 없음) */
export function normalizeOrderDelivery(order) {
  if (!order || typeof order !== "object") return order;
  const status = orderStatus(order);
  const deliveryDate = resolveDeliveryDate(order);
  return {
    ...order,
    status,
    deliveryDate,
    deliveryStatus: status,
    delivery: {
      ...(typeof order.delivery === "object" && order.delivery ? order.delivery : {}),
      date: deliveryDate,
      status,
    },
  };
}

export function publicOrderView(order) {
  const normalized = normalizeOrderDelivery(order);
  const c = normalized.customer || {};
  return {
    id: normalized.id,
    createdAt: normalized.createdAt,
    orderDate: formatOrderDate(normalized.createdAt),
    customer: {
      name: c.name || "",
      phone: c.phone || "",
      address: c.address || "",
      suburb: c.suburb || "",
    },
    items: (normalized.items || []).map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
      category: item.category || "",
    })),
    total: normalized.total,
    payment: normalized.payment,
    paymentLabel: paymentLabel(normalized.payment),
    status: orderStatus(normalized),
    deliveryDate: resolveDeliveryDate(normalized),
    deliveryDateLabel: formatDeliveryDateLabel(resolveDeliveryDate(normalized)),
    deliveryNote: "김치와 냉동·반찬 상품은 함께 배송됩니다.",
  };
}
