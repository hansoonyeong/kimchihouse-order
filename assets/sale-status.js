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

    status(itemOrId, variantKey) {
      const raw = typeof itemOrId === "string" ? itemOrId : itemOrId?.id;
      if (!raw) return "active";
      const vKey = variantKey || (typeof itemOrId === "object" ? itemOrId?.variantKey : "");
      const fullId = String(raw).includes(":")
        ? String(raw)
        : vKey
          ? `${raw}:${vKey}`
          : String(raw);
      if (this.statuses[fullId]) return normalizeStatus(this.statuses[fullId]);
      const baseId = fullId.split(":")[0];
      if (baseId !== fullId && this.statuses[baseId]) return normalizeStatus(this.statuses[baseId]);
      const item = typeof itemOrId === "object" ? itemOrId : null;
      if (item?.variants && vKey) {
        const variant = item.variants.find((v) => v.key === vKey);
        if (variant?.saleStatus) return normalizeStatus(variant.saleStatus, variant.soldOut);
      }
      if (item?.saleStatus) return normalizeStatus(item.saleStatus, item.soldOut);
      return item?.soldOut ? "sold_out" : "active";
    },

    isVisible(itemOrId, variantKey) {
      return this.status(itemOrId, variantKey) !== "hidden";
    },

    isPurchasable(itemOrId, variantKey) {
      return this.status(itemOrId, variantKey) === "active";
    },

    isUnavailable(itemOrId, variantKey) {
      const s = this.status(itemOrId, variantKey);
      return s === "sold_out" || s === "coming_soon";
    },

    label(itemOrId, variantKey) {
      const s = this.status(itemOrId, variantKey);
      if (s === "sold_out") return "품절";
      if (s === "coming_soon") return "판매 예정";
      if (s === "hidden") return "숨김";
      return "판매중";
    },

    badgeHtml(itemOrId, variantKey) {
      const s = this.status(itemOrId, variantKey);
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
            if (item._catalogSoldOut == null) item._catalogSoldOut = Boolean(item.soldOut);
            if (item._catalogSaleStatus == null && item.saleStatus) {
              item._catalogSaleStatus = item.saleStatus;
            }
            const status = normalizeStatus(
              this.statuses[item.id] ?? detail?.saleStatus ?? item._catalogSaleStatus,
              item._catalogSoldOut
            );
            item.saleStatus = status;
            item.soldOut = status === "sold_out" || status === "coming_soon";
            if (item.variants?.length) {
              let anyActive = false;
              for (const v of item.variants) {
                const vid = `${item.id}:${v.key}`;
                const vStatus = normalizeStatus(
                  this.statuses[vid] ?? this.statuses[item.id] ?? detail?.saleStatus ?? item._catalogSaleStatus,
                  item._catalogSoldOut
                );
                v.saleStatus = vStatus;
                v.soldOut = vStatus === "sold_out" || vStatus === "coming_soon";
                if (vStatus === "active") anyActive = true;
              }
              // 기본 상품 카드: 모든 용량이 품절이면 품절 표시
              if (!anyActive && item.variants.every((v) => v.saleStatus === "sold_out" || v.saleStatus === "coming_soon")) {
                item.saleStatus = item.variants[0].saleStatus;
                item.soldOut = true;
              } else if (anyActive && item.saleStatus === "sold_out") {
                item.saleStatus = "active";
                item.soldOut = false;
              }
            }
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
