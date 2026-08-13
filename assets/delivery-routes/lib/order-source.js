/**
 * Order source abstraction.
 *
 * SpreadsheetOrderSource      — CSV/XLSX upload
 * KimchiHouseApiOrderSource   — live admin /api/orders
 */
(function (global) {
  function extractPostcode(address, suburb) {
    const fromAddr = String(address || "").match(/\b(\d{4})\b/);
    if (fromAddr) return fromAddr[1];
    const fromSub = String(suburb || "").match(/\b(\d{4})\b/);
    return fromSub ? fromSub[1] : "";
  }

  function cleanSuburb(suburb) {
    return String(suburb || "")
      .replace(/\bNSW\b/gi, "")
      .replace(/\b\d{4}\b/g, "")
      .replace(/,\s*$/, "")
      .trim();
  }

  function mapApiOrder(o) {
    const c = o.customer || {};
    const address = String(c.address || "").trim();
    const suburbRaw = String(c.suburb || "").trim();
    const suburb = cleanSuburb(suburbRaw) || cleanSuburb(address.split(",").slice(-1)[0] || "");
    const postcode = extractPostcode(address, suburbRaw) || extractPostcode(suburbRaw, "");
    const items = o.items || [];
    return {
      id: o.id,
      name: c.name || "",
      phone: c.phone || "",
      address,
      suburb,
      postcode,
      orderSummary: items.map((i) => `${i.name} × ${i.qty}`).join("\n"),
      total: Number(o.total) || 0,
      boxCount: items.reduce((a, i) => a + (Number(i.qty) || 0), 0) || 1,
      notes: o.note || "",
      lat: null,
      lng: null,
      isDemo: false,
      status: "pending",
      reviewReason: null,
      sourceDeliveryDate: null,
      etaStart: null,
      etaEnd: null,
      actualDeliveredAt: null,
      smsStatus: "none",
      lastSmsAt: null,
      etaSmsStatus: "none",
    };
  }

  class SpreadsheetOrderSource {
    async getOrders() {
      throw new Error("use KHSpreadsheet.parseWorkbook + applyMapping");
    }
  }

  class KimchiHouseApiOrderSource {
    constructor({ adminKey, endpoint = "/api/orders" } = {}) {
      this.adminKey = adminKey;
      this.endpoint = endpoint;
    }

    async fetchRaw() {
      const res = await fetch(this.endpoint, {
        headers: { Authorization: `Bearer ${this.adminKey}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "주문 조회 실패");
      return data.orders || [];
    }

    /** 이번 차수(일괄 배송) 주문만 DeliveryOrder로 변환 */
    async getCurrentRoundOrders() {
      const D = global.KH_DELIVERY;
      const raw = await this.fetchRaw();
      const filtered = D?.isCurrentRoundOrder
        ? raw.filter((o) => D.isCurrentRoundOrder(o))
        : raw;

      return filtered.map((o) => {
        const mapped = mapApiOrder(o);
        if (D) {
          const resolved = D.resolveDeliveryDate?.(o);
          mapped.sourceDeliveryDate =
            D.canonicalDeliveryDate?.(resolved) || resolved || null;
        }
        return mapped;
      });
    }
  }

  global.KHOrderSource = {
    SpreadsheetOrderSource,
    KimchiHouseApiOrderSource,
    mapApiOrder,
    extractPostcode,
    cleanSuburb,
  };
})(typeof window !== "undefined" ? window : globalThis);
