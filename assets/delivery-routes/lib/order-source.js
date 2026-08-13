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
    let suburb = cleanSuburb(suburbRaw);
    // suburb 필드에 "Eastwood NSW 2122" 형태가 오는 경우
    if (!suburb && suburbRaw) suburb = cleanSuburb(suburbRaw);
    // address 마지막 토큰이 suburb인 경우
    if (!suburb && address.includes(",")) {
      suburb = cleanSuburb(address.split(",").slice(-1)[0] || "");
    }
    const postcode = extractPostcode(address, suburbRaw) || extractPostcode(suburbRaw, "");
    const items = o.items || [];
    const D = global.KH_DELIVERY;
    const resolved = D?.resolveDeliveryDate?.(o) || o.deliveryDate || o.delivery?.date || null;
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
      sourceDeliveryDate: D?.canonicalDeliveryDate?.(resolved) || resolved || null,
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
      if (!Array.isArray(data.orders)) throw new Error("주문 목록 형식이 올바르지 않습니다.");
      return data.orders;
    }

    /**
     * 이번 차수 우선. 0건이면 전체 주문으로 폴백 (필터 오판 방지).
     * @returns {{ orders: object[], scope: 'current'|'all', rawCount: number, currentCount: number }}
     */
    async getOrdersForPlanner() {
      const D = global.KH_DELIVERY;
      const raw = await this.fetchRaw();
      const current = D?.isCurrentRoundOrder
        ? raw.filter((o) => {
            try {
              return D.isCurrentRoundOrder(o);
            } catch {
              return true;
            }
          })
        : raw.slice();

      const chosen = current.length ? current : raw;
      return {
        orders: chosen.map(mapApiOrder),
        scope: current.length ? "current" : "all",
        rawCount: raw.length,
        currentCount: current.length,
      };
    }

    /** @deprecated use getOrdersForPlanner */
    async getCurrentRoundOrders() {
      const result = await this.getOrdersForPlanner();
      return result.orders;
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
