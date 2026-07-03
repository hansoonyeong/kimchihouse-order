export const DELIVERY_STATUSES = [
  "예약 접수",
  "주문 확인 완료",
  "배송 준비 중",
  "배송 안내 완료",
  "배송 완료",
];

export const DEFAULT_DELIVERY_STATUS = "예약 접수";

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

export function orderStatus(order) {
  const status = order?.status;
  return DELIVERY_STATUSES.includes(status) ? status : DEFAULT_DELIVERY_STATUS;
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

export function publicOrderView(order) {
  const c = order.customer || {};
  return {
    id: order.id,
    createdAt: order.createdAt,
    orderDate: formatOrderDate(order.createdAt),
    customer: {
      name: c.name || "",
      phone: c.phone || "",
      address: c.address || "",
      suburb: c.suburb || "",
    },
    items: (order.items || []).map((item) => ({
      name: item.name,
      qty: item.qty,
      price: item.price,
    })),
    total: order.total,
    payment: order.payment,
    paymentLabel: paymentLabel(order.payment),
    status: orderStatus(order),
  };
}
