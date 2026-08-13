/**
 * Order source abstraction.
 *
 * SpreadsheetOrderSource  — CSV/XLSX upload (current)
 * KimchiHouseApiOrderSource — future: pull from /api/orders by delivery date
 *
 * @typedef {Object} DeliveryOrder
 * @property {string} id
 * @property {string} name
 * @property {string} phone
 * @property {string} address
 * @property {string} suburb
 * @property {string} postcode
 * @property {string} orderSummary
 * @property {number} total
 * @property {number} boxCount
 * @property {string} notes
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {'ok'|'needs_review'|'pending'} status
 * @property {string|null} reviewReason
 * @property {string|null} etaStart
 * @property {string|null} etaEnd
 * @property {string|null} actualDeliveredAt
 * @property {'none'|'queued'|'sent'|'failed'} smsStatus
 * @property {string|null} lastSmsAt
 * @property {'none'|'queued'|'sent'|'failed'} etaSmsStatus
 */

(function (global) {
  class SpreadsheetOrderSource {
    async getOrders() {
      throw new Error("use KHSpreadsheet.parseWorkbook + applyMapping");
    }
  }

  /** Future: replace upload flow with admin order DB selection. */
  class KimchiHouseApiOrderSource {
    constructor({ adminKey, endpoint = "/api/orders" } = {}) {
      this.adminKey = adminKey;
      this.endpoint = endpoint;
    }

    async getOrders(deliveryDate) {
      const res = await fetch(this.endpoint, {
        headers: { Authorization: `Bearer ${this.adminKey}` },
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "주문 조회 실패");
      const D = global.KH_DELIVERY;
      return (data.orders || [])
        .filter((o) => {
          if (!deliveryDate || !D) return true;
          const date = D.canonicalDeliveryDate?.(D.resolveDeliveryDate(o)) || D.resolveDeliveryDate(o);
          return date === deliveryDate;
        })
        .map((o) => ({
          id: o.id,
          name: o.customer?.name || "",
          phone: o.customer?.phone || "",
          address: o.customer?.address || "",
          suburb: o.customer?.suburb || "",
          postcode: "",
          orderSummary: (o.items || []).map((i) => `${i.name} × ${i.qty}`).join("\n"),
          total: o.total || 0,
          boxCount: (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0),
          notes: o.note || "",
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
        }));
    }
  }

  global.KHOrderSource = {
    SpreadsheetOrderSource,
    KimchiHouseApiOrderSource,
  };
})(typeof window !== "undefined" ? window : globalThis);
