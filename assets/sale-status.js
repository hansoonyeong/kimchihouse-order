(function () {
  const SALE_STATUSES = ["active", "sold_out", "coming_soon", "hidden"];

  function normalizeStatus(value, fallbackSoldOut) {
    if (SALE_STATUSES.includes(value)) return value;
    if (value === true || value === "on") return "active";
    if (value === false || value === "off") return "hidden";
    if (fallbackSoldOut) return "sold_out";
    return "active";
  }

  const KHSale = {
    ready: false,
    statuses: {},
    details: {},
    settings: { autoSoldOutOnZero: true },

    status(itemOrId) {
      const id = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
      if (!id) return "active";
      if (this.statuses[id]) return normalizeStatus(this.statuses[id]);
      const item = typeof itemOrId === "object" ? itemOrId : null;
      if (item?.saleStatus) return normalizeStatus(item.saleStatus, item.soldOut);
      return item?.soldOut ? "sold_out" : "active";
    },

    isVisible(itemOrId) {
      return this.status(itemOrId) !== "hidden";
    },

    isPurchasable(itemOrId) {
      return this.status(itemOrId) === "active";
    },

    isUnavailable(itemOrId) {
      const s = this.status(itemOrId);
      return s === "sold_out" || s === "coming_soon";
    },

    label(itemOrId) {
      const s = this.status(itemOrId);
      if (s === "sold_out") return "품절";
      if (s === "coming_soon") return "판매 예정";
      if (s === "hidden") return "숨김";
      return "판매중";
    },

    badgeHtml(itemOrId) {
      const s = this.status(itemOrId);
      if (s === "sold_out") return `<span class="shop-badge shop-badge-soldout">품절</span>`;
      if (s === "coming_soon") return `<span class="shop-badge shop-badge-soon">판매 예정</span>`;
      return "";
    },

    applyFromPayload(data) {
      if (!data) return;
      this.statuses = data.saleStatuses || data.statuses || this.statuses || {};
      this.details = data.saleDetails || data.details || this.details || {};
      if (data.salesSettings) this.settings = { ...this.settings, ...data.salesSettings };
      if (data.settings) this.settings = { ...this.settings, ...data.settings };
      this.applyToCatalog();
      this.ready = true;
    },

    applyToCatalog() {
      const products = window.KH_PRODUCTS;
      if (!products) return;
      for (const block of Object.values(products)) {
        for (const section of block.sections || []) {
          const items = section.items || [];
          for (const item of items) {
            const detail = this.details[item.id];
            const status = normalizeStatus(
              this.statuses[item.id] ?? detail?.saleStatus,
              item._catalogSoldOut ?? item.soldOut
            );
            if (item._catalogSoldOut == null) item._catalogSoldOut = Boolean(item.soldOut);
            item.saleStatus = status;
            item.soldOut = status === "sold_out" || status === "coming_soon";
            if (detail?.price != null && Number.isFinite(Number(detail.price))) {
              if (item._catalogPrice == null && item.price != null) item._catalogPrice = item.price;
              item.price = Number(detail.price);
            } else if (item._catalogPrice != null) {
              item.price = item._catalogPrice;
            }
            if (detail?.sortOrder != null) item.sortOrder = Number(detail.sortOrder);
          }
          items.sort((a, b) => {
            const ao = a.sortOrder != null ? a.sortOrder : 9999;
            const bo = b.sortOrder != null ? b.sortOrder : 9999;
            if (ao !== bo) return ao - bo;
            return 0;
          });
        }
      }
    },

    async load() {
      try {
        const res = await fetch("/api/sales");
        const data = await res.json();
        if (data?.ok) this.applyFromPayload(data);
      } catch (_) {
        this.applyToCatalog();
        this.ready = true;
      }
      return this;
    },
  };

  window.KHSale = KHSale;
})();
