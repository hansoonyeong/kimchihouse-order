(function () {
  const cfg = window.KH_CONFIG;

  function money(n) {
    return "$" + Number(n || 0).toFixed(0);
  }

  function calcTierTotal(qty, tiers) {
    if (qty <= 0) return 0;
    let remaining = qty;
    let total = 0;
    const sorted = [...tiers].sort((a, b) => b[0] - a[0]);
    for (const [n, p] of sorted) {
      const packs = Math.floor(remaining / n);
      total += packs * p;
      remaining -= packs * n;
    }
    if (remaining > 0) total += remaining * tiers[0][1];
    return total;
  }

  function catalogTypes(type) {
    if (type === "combined") return ["kimchi", "frozen"];
    return [type];
  }

  function getAllItems(type) {
    if (type === "combined") {
      return [...getAllItems("frozen"), ...getAllItems("kimchi")];
    }
    return KH_PRODUCTS[type].sections.flatMap((s) => s.items);
  }

  function createOrderApp(type, options = {}) {
    const cartOnly = options.cartOnly ?? !document.getElementById("product-root");
    const CART_STORAGE_KEY = "kh_shop_cart_v1";
    const state = {
      cart: {},
      payment: "transfer",
      sectionFilters: {},
      brand: "kimchi-house",
      activeCategory: "pogi",
      selectedVariant: {},
      detail: null,
    };

    function sectionFilterFor(cat) {
      return state.sectionFilters[cat] || "all";
    }

    function visibleSections(cat) {
      const filter = sectionFilterFor(cat);
      const sections = KH_PRODUCTS[cat].sections;
      if (filter === "all") return sections;
      return sections.filter((section) => section.id === filter);
    }

    function qty(id) {
      return state.cart[id] || 0;
    }

    function persistCart() {
      try {
        localStorage.setItem(
          CART_STORAGE_KEY,
          JSON.stringify({
            cart: state.cart,
            brand: state.brand,
            payment: state.payment,
            selectedVariant: state.selectedVariant,
            activeCategory: state.activeCategory,
          })
        );
      } catch (_) {}
    }

    function restoreCart() {
      try {
        const raw = localStorage.getItem(CART_STORAGE_KEY);
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.cart && typeof data.cart === "object") state.cart = data.cart;
        if (data.brand === "walkerhill" || data.brand === "kimchi-house") {
          state.brand = data.brand;
          document.body.dataset.brand = state.brand;
          document.querySelectorAll(".shop-brand-tab").forEach((t) => {
            t.classList.toggle("active", t.dataset.brand === state.brand);
          });
        }
        if (data.payment === "cash" || data.payment === "transfer") state.payment = data.payment;
        if (data.selectedVariant && typeof data.selectedVariant === "object") {
          state.selectedVariant = data.selectedVariant;
        }
        if (data.activeCategory) state.activeCategory = data.activeCategory;
        document.querySelectorAll(".pay-opt-shop").forEach((el) => {
          el.classList.toggle("sel", el.dataset.pay === state.payment);
        });
        document.getElementById("bank-box")?.classList.toggle("hidden", state.payment !== "transfer");
      } catch (_) {}
    }

    function clearPersistedCart() {
      try {
        localStorage.removeItem(CART_STORAGE_KEY);
      } catch (_) {}
    }

    function notifyBrandChange(brand) {
      window.onShopBrandChange?.(brand);
    }

    function setQty(id, value) {
      if (value <= 0) delete state.cart[id];
      else state.cart[id] = value;
      render();
      persistCart();
    }

    function calcSpecialKimchiPrice() {
      const b5 = qty("b5");
      const b7 = qty("b7");
      const totalQty = b5 + b7;
      if (totalQty === 0) return 0;
      return calcTierTotal(totalQty, KH_SPECIAL_TIERS);
    }

    function allocateSpecialPrices() {
      const b5Count = qty("b5");
      const b7Count = qty("b7");
      const total = calcSpecialKimchiPrice();
      if (total === 0) return { b5: 0, b7: 0 };

      if (b5Count > 0 && b7Count === 0) return { b5: total, b7: 0 };
      if (b7Count > 0 && b5Count === 0) return { b5: 0, b7: total };

      const b5Price = Math.round((total * b5Count) / (b5Count + b7Count));
      return { b5: b5Price, b7: total - b5Price };
    }

    function barPriceFor(item) {
      const count = qty(item.id);
      if (count <= 0) return 0;
      if (item.group === "special") return allocateSpecialPrices()[item.id] || 0;
      if (item.group === "pa") return calcTierTotal(count, KH_PA_TIERS);
      if (item.tiers) return calcTierTotal(count, item.tiers);
      return itemPrice(item);
    }

    function itemSubtotal(item) {
      if (item.soldOut) return 0;
      if (item.group === "special" || item.group === "pa") return 0;
      if (item.variants) {
        return item.variants.reduce((sum, v) => {
          const count = qty(`${item.id}:${v.key}`);
          return sum + count * v.price;
        }, 0);
      }
      const count = qty(item.id);
      if (count <= 0) return 0;
      if (item.tiers) return calcTierTotal(count, item.tiers);
      return count * item.price;
    }

    function itemPrice(item) {
      return itemSubtotal(item);
    }

    function subtotalFor(cat) {
      let total = 0;
      for (const item of getAllItems(cat)) {
        if (item.group === "special" || item.group === "pa") continue;
        total += itemPrice(item);
      }
      if (cat === "kimchi") {
        total += calcSpecialKimchiPrice();
        total += calcTierTotal(qty("b6"), KH_PA_TIERS);
      }
      return total;
    }

    function subtotal() {
      return orderCatalogs().reduce((sum, cat) => sum + subtotalFor(cat), 0);
    }

    function shippingFeeFor(cat) {
      const sub = subtotalFor(cat);
      if (sub === 0) return 0;
      if (cat === "walkerhill") {
        const hasSet = getAllItems(cat).some((item) => item.tier && qty(item.id) > 0);
        if (hasSet) return 0;
      }
      return sub >= cfg.freeShippingThreshold ? 0 : cfg.shippingFee;
    }

    function orderCatalogs() {
      return state.brand === "walkerhill" ? ["walkerhill"] : catalogTypes(type);
    }

    function shippingFee() {
      return orderCatalogs().reduce((sum, cat) => sum + shippingFeeFor(cat), 0);
    }

    function total() {
      return subtotal() + shippingFee();
    }

    function shippingBreakdown() {
      const breakdown = {};
      for (const cat of orderCatalogs()) {
        breakdown[cat] = {
          subtotal: subtotalFor(cat),
          shippingFee: shippingFeeFor(cat),
          delivery: KH_PRODUCTS[cat].delivery,
        };
      }
      return breakdown;
    }

    function buildLineItemsFor(cat) {
      const lines = [];
      for (const item of getAllItems(cat)) {
        if (item.variants) {
          for (const v of item.variants) {
            const count = qty(`${item.id}:${v.key}`);
            if (count <= 0) continue;
            lines.push({
              name: `${item.name} (${v.label})`,
              qty: count,
              price: count * v.price,
              category: cat,
            });
          }
          continue;
        }

        const count = qty(item.id);
        if (count <= 0) continue;
        if (item.group === "special" || item.group === "pa") continue;

        const lineName = item.desc ? `${item.name} · ${item.desc}` : item.name;
        lines.push({ name: lineName, qty: count, price: itemPrice(item), category: cat });
      }

      if (cat === "kimchi") {
        const specialPrices = allocateSpecialPrices();
        if (qty("b5") > 0) {
          lines.push({
            name: "열무김치 (1KG)",
            qty: qty("b5"),
            price: specialPrices.b5,
            category: cat,
          });
        }
        if (qty("b7") > 0) {
          lines.push({
            name: "돌산 갓김치 (1KG)",
            qty: qty("b7"),
            price: specialPrices.b7,
            category: cat,
          });
        }
        if (qty("b6") > 0) {
          lines.push({
            name: "쪽파김치 (1KG)",
            qty: qty("b6"),
            price: calcTierTotal(qty("b6"), KH_PA_TIERS),
            category: cat,
          });
        }
      }
      return lines;
    }

    function buildLineItems() {
      return orderCatalogs().flatMap((cat) => buildLineItemsFor(cat));
    }

    function buildBarLinesFor(cat) {
      const lines = [];
      for (const item of getAllItems(cat)) {
        if (item.variants) {
          for (const v of item.variants) {
            const key = `${item.id}:${v.key}`;
            const count = qty(key);
            if (count <= 0) continue;
            lines.push({
              id: key,
              name: `${item.name} (${v.label})`,
              qty: count,
              price: count * v.price,
              category: cat,
            });
          }
          continue;
        }

        const count = qty(item.id);
        if (count <= 0) continue;

        let name = item.name;
        if (item.desc) name = `${item.name} · ${item.desc}`;
        let price = barPriceFor(item);

        lines.push({ id: item.id, name, qty: count, price, category: cat });
      }
      return lines;
    }

    function buildBarLines() {
      return orderCatalogs().flatMap((cat) => buildBarLinesFor(cat));
    }

    function getSelectedVariant(item) {
      if (!item.variants?.length) return null;
      const sel = state.selectedVariant[item.id];
      if (sel) return item.variants.find((v) => v.key === sel) || item.variants[0];
      return item.variants[0];
    }

    const KH_CATEGORIES = [
      { id: "pogi", label: "새벽김치", sections: [{ cat: "kimchi", sid: "pogi" }] },
      { id: "special", label: "별미김치", sections: [{ cat: "kimchi", sid: "special" }] },
      { id: "banchan", label: "반찬", sections: [
        { cat: "frozen", sid: "mandu" }, { cat: "frozen", sid: "kimbap" },
        { cat: "frozen", sid: "fish" }, { cat: "frozen", sid: "namul" },
      ]},
      { id: "jeotgal", label: "젓갈", sections: [{ cat: "frozen", sid: "jeotgal" }] },
      { id: "jang", label: "장류·한국식품", sections: [{ cat: "kimchi", sid: "jang" }] },
    ];


    const WH_SET_TIERS = [
      { id: "set2", label: "2 SET", note: "무료배송 + 약 5% 추가할인 (총 $15 혜택)" },
      { id: "set3", label: "3 SET", note: "무료배송 + 10% 할인" },
      { id: "set5", label: "5 SET", note: "무료배송 + 15% 할인" },
    ];

    const KH_CAT_IMAGES = {
      pogi: "assets/images/products/b1.png",
      special: "assets/images/browse/special.png",
      banchan: "assets/images/browse/banchan.png",
      jeotgal: "assets/images/browse/jeotgal.png",
      jang: "assets/images/browse/jang.png",
    };

    const WH_CAT_IMAGES = {
      pogi: "assets/images/walkerhill/pogi.jpg",
      chonggak: "assets/images/walkerhill/chonggak.png",
      set2: "assets/images/walkerhill/set.jpg",
      set3: "assets/images/walkerhill/set.jpg",
      set5: "assets/images/walkerhill/set.jpg",
    };

    function findItemById(id) {
      const cats = ["frozen", "kimchi", "walkerhill"];
      for (const cat of cats) {
        const catalog = KH_PRODUCTS[cat];
        if (!catalog) continue;
        for (const section of catalog.sections) {
          const item = section.items.find((i) => i.id === id);
          if (item) return { item, section, cat };
        }
      }
      return null;
    }

    function itemBadgeHtml(item) {
      if (item.soldOut) return "";
      if (item.sale || item.saleLabel) {
        return `<span class="shop-badge shop-badge-sale">${item.saleLabel || "SALE"}</span>`;
      }
      if (item.featured) return `<span class="shop-badge shop-badge-best">⭐ 인기</span>`;
      if (item.id === "b8" || item.id === "b1" || item.id === "w1") {
        return `<span class="shop-badge shop-badge-best">BEST</span>`;
      }
      return "";
    }

    function cardDesc(item, section) {
      if (item.tier?.startsWith("set")) return "";
      if (item.saleNote) return item.saleNote;
      if (item.desc) return item.desc;
      if (section.note && !item.tier) return section.note;
      if (item.group === "special" || item.group === "pa") return "수량별 할인 적용";
      if (item.tiers) return "수량별 할인 적용";
      return section.tab || "";
    }

    function getTierList(item) {
      if (item.tiers?.length) return item.tiers;
      if (item.group === "special") return window.KH_SPECIAL_TIERS;
      if (item.group === "pa") return window.KH_PA_TIERS;
      return null;
    }

    function hasTierPricing(item) {
      return Boolean(getTierList(item));
    }

    function tierWasPrice(item, qtyN) {
      return window.getSaleOriginalPrice?.(item, qtyN) ?? null;
    }

    function renderSalePriceHtml(item, price) {
      const orig = window.getSaleOriginalPrice?.(item);
      if ((item.sale || item.saleLabel) && orig != null && price < orig) {
        return `<div class="kurly-card-price"><span class="was">${money(orig)}</span><span class="sale-now">${money(price)}</span></div>`;
      }
      return `<div class="kurly-card-price">${money(price)}</div>`;
    }

    function renderTierPicksHtml(item) {
      const tiers = getTierList(item);
      if (!tiers) return "";
      return `<div class="kurly-tier-picks">${tiers.map(([n, p]) => {
        const was = tierWasPrice(item, n);
        const wasHtml = was ? `<s class="tier-was">${money(was)}</s>` : "";
        return `<button type="button" class="kurly-tier-pick" data-tier-set="${item.id}" data-tier-qty="${n}">
          <span class="tier-qty">${n}개</span>
          <span class="tier-price">${wasHtml}<strong>${money(p)}</strong></span>
        </button>`;
      }).join("")}</div>`;
    }

    function displayPriceFor(item) {
      if (item.variants?.length) {
        const selected = getSelectedVariant(item);
        return selected ? money(selected.price) : "";
      }
      if (item.price != null) return money(item.price);
      return "";
    }

    function addKeyFor(item) {
      if (item.variants?.length) {
        const selected = getSelectedVariant(item);
        return `${item.id}:${selected.key}`;
      }
      return item.id;
    }

    function renderKurlyProduct(item, section, cat) {
      const badge = itemBadgeHtml(item);
      const isSet = item.tier?.startsWith("set");
      const displayName = isSet && item.desc ? item.desc : item.name;
      const thumbInner = item.image
        ? `<img src="${item.image}" alt="${displayName}" loading="lazy" decoding="async" />`
        : "";

      if (item.soldOut) {
        return `<article class="kurly-card sold-out">
          <button type="button" class="kurly-card-thumb" disabled>
            ${thumbInner}
          </button>
          <div class="kurly-card-body">
            <div class="kurly-card-name">${item.name}</div>
            <div class="kurly-card-desc">품절</div>
          </div>
        </article>`;
      }

      const desc = cardDesc(item, section);
      let variantHtml = "";
      let priceHtml = "";
      let addBtn = "";

      if (item.variants) {
        const selected = getSelectedVariant(item);
        variantHtml = `<div class="kurly-option-list">${item.variants.map((v) => {
          const active = selected?.key === v.key ? " active" : "";
          return `<button type="button" class="kurly-option${active}" data-variant-pick="${item.id}" data-variant-key="${v.key}">
            <span class="kurly-option-radio"></span>
            <span class="kurly-option-label">${v.label}</span>
            <span class="kurly-option-price">${money(v.price)}</span>
          </button>`;
        }).join("")}</div>`;
        priceHtml = renderSalePriceHtml(item, selected.price);
      } else if (hasTierPricing(item)) {
        const tiers = getTierList(item);
        const salePrice = tiers[0][1];
        const was = tierWasPrice(item, tiers[0][0]);
        if ((item.sale || item.saleLabel) && was != null && was > salePrice) {
          priceHtml = `<div class="kurly-card-price"><span class="was">${money(was)}</span><span class="sale-now">${money(salePrice)}</span></div>`;
        } else {
          priceHtml = `<div class="kurly-card-price">${money(salePrice)}</div>`;
        }
        addBtn = `<button type="button" class="kurly-add-btn" data-product-open="${item.id}">수량 선택 · 담기</button>`;
      } else if (item.price != null) {
        priceHtml = renderSalePriceHtml(item, item.price);
      } else {
        priceHtml = `<div class="kurly-card-price">${displayPriceFor(item)}</div>`;
      }

      const addKey = addKeyFor(item);
      if (!addBtn) {
        addBtn = isSet
          ? `<button type="button" class="kurly-add-btn" data-wh-set="${item.id}">담기</button>`
          : `<button type="button" class="kurly-add-btn" data-add="${addKey}">담기</button>`;
      }

      return `<article class="kurly-card" data-product-id="${item.id}">
        <button type="button" class="kurly-card-thumb" data-product-open="${item.id}">
          ${badge}
          ${thumbInner}
        </button>
        <div class="kurly-card-body">
          <button type="button" class="kurly-card-name" data-product-open="${item.id}">${displayName}</button>
          ${desc ? `<div class="kurly-card-desc">${desc}</div>` : ""}
          ${variantHtml}
          ${priceHtml}
          ${addBtn}
        </div>
      </article>`;
    }

    function sectionsForCategory(catDef) {
      const result = [];
      for (const ref of catDef.sections) {
        const catalog = KH_PRODUCTS[ref.cat];
        if (!catalog) continue;
        const section = catalog.sections.find((s) => s.id === ref.sid);
        if (section) result.push({ section, cat: ref.cat });
      }
      return result;
    }

    const WH_CATEGORIES = ["pogi", "chonggak", "set2", "set3", "set5"];
    const KH_CATEGORY_IDS = KH_CATEGORIES.map((c) => c.id);

    function isWalkerhillItem(itemId) {
      return itemId === "w1" || itemId === "w2" || itemId?.startsWith("w_set");
    }

    function categoryForItemId(brand, itemId) {
      if (!itemId) return null;
      if (brand === "walkerhill" || isWalkerhillItem(itemId)) {
        if (itemId === "w1") return "pogi";
        if (itemId === "w2") return "chonggak";
        if (itemId.startsWith("w_set2")) return "set2";
        if (itemId.startsWith("w_set3")) return "set3";
        if (itemId.startsWith("w_set5")) return "set5";
        return "pogi";
      }
      for (const catDef of KH_CATEGORIES) {
        const sections = sectionsForCategory(catDef);
        for (const { section } of sections) {
          if (section.items.some((i) => i.id === itemId)) return catDef.id;
        }
      }
      return null;
    }

    function validCategory(brand, cat) {
      if (cat === "all") return "all";
      const list = brand === "walkerhill" ? WH_CATEGORIES : KH_CATEGORY_IDS;
      return list.includes(cat) ? cat : null;
    }

    function normalizeBrandParam(value) {
      if (!value) return null;
      const key = String(value).toLowerCase().replace(/_/g, "-");
      if (key === "walkerhill") return "walkerhill";
      if (key === "kimchi-house" || key === "kimchihouse" || key === "kimchi") return "kimchi-house";
      return null;
    }

    function normalizeCategoryParam(brand, value) {
      if (!value) return null;
      const key = String(value).toLowerCase();
      const aliasMap = {
        kimchi: "pogi",
        "special-kimchi": "special",
        special: "special",
        frozen: "banchan",
        banchan: "banchan",
        seafood: "jeotgal",
        jeotgal: "jeotgal",
        pantry: "jang",
        jang: "jang",
        walkerhill: brand === "walkerhill" ? "all" : "pogi",
        pogi: "pogi",
        chonggak: "chonggak",
        set2: "set2",
        set3: "set3",
        set5: "set5",
        all: "all",
        event: "jang",
        best: "jang",
      };
      return aliasMap[key] || null;
    }

    function isWalkerhillPath() {
      const path = (location.pathname || "").replace(/\/+$/, "");
      return /(^|\/)walkerhill(\.html)?$/i.test(path);
    }

    function cleanDeepLinkUrl() {
      if (isWalkerhillPath()) {
        history.replaceState(null, "", location.pathname);
        return;
      }
      if (document.body.dataset.brand === "walkerhill") {
        history.replaceState(null, "", location.pathname + "?brand=walkerhill");
        return;
      }
      history.replaceState(null, "", location.pathname);
    }

    function applyOrderParams() {
      const params = new URLSearchParams(window.location.search);
      const itemParam = params.get("item");
      let brandParam = normalizeBrandParam(params.get("brand"));

      if (isWalkerhillPath() && !brandParam) brandParam = "walkerhill";

      if (itemParam) {
        if (isWalkerhillItem(itemParam)) brandParam = "walkerhill";
        else if (!brandParam) brandParam = "kimchi-house";
      }

      if (brandParam === "walkerhill" || brandParam === "kimchi-house") {
        state.brand = brandParam;
        document.body.dataset.brand = state.brand;
        document.querySelectorAll(".shop-brand-tab").forEach((t) => {
          t.classList.toggle("active", t.dataset.brand === state.brand);
        });
        if (state.brand === "walkerhill") {
          document.title = "워커힐 호텔 김치 | 김치하우스";
        }
      }

      let catParam = params.get("cat");
      const categoryAlias = normalizeCategoryParam(state.brand, params.get("category"));
      if (categoryAlias) catParam = categoryAlias;

      if (itemParam) {
        const fromItem = categoryForItemId(state.brand, itemParam);
        if (fromItem) catParam = fromItem;
      }

      if (isWalkerhillPath() && !catParam && !itemParam) catParam = "all";

      const valid = validCategory(state.brand, catParam);
      state.activeCategory = valid || (state.brand === "walkerhill" ? "all" : "pogi");
      state.pendingScrollItem = itemParam || null;
    }

    function scrollToShopIfNeeded() {
      const params = new URLSearchParams(window.location.search);
      const hasDeepLink = !!(params.get("cat") || params.get("category") || params.get("item"));
      const hashShop = location.hash === "#shop";
      const walkerhillLanding = isWalkerhillPath();

      if (hasDeepLink || walkerhillLanding) {
        requestAnimationFrame(() => {
          if (hasDeepLink || hashShop) {
            document.getElementById("shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }
          cleanDeepLinkUrl();
        });
        return;
      }

      // leftover #shop should not keep pulling the page down on refresh
      if (hashShop) {
        cleanDeepLinkUrl();
        window.scrollTo(0, 0);
      }
    }

    function scrollToPendingItem() {
      const id = state.pendingScrollItem;
      if (!id) return;
      state.pendingScrollItem = null;

      requestAnimationFrame(() => {
        const card = document.querySelector(`[data-product-id="${id}"]`);
        if (card) {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
          card.classList.add("order-item-highlight");
          setTimeout(() => card.classList.remove("order-item-highlight"), 2200);
          return;
        }
        document.getElementById("product-root")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    function renderKimchiHouseCatalog() {
      if (state.activeCategory === "all") {
        const cards = KH_CATEGORIES.flatMap((catDef) => {
          const sections = sectionsForCategory(catDef);
          return sections.flatMap(({ section, cat }) =>
            section.items.map((item) => renderKurlyProduct(item, section, cat))
          );
        });
        return `<div class="kurly-product-grid">${cards.join("")}</div>`;
      }

      const catDef = KH_CATEGORIES.find((c) => c.id === state.activeCategory) || KH_CATEGORIES[0];
      const sections = sectionsForCategory(catDef);
      const cards = sections.flatMap(({ section, cat }) =>
        section.items.map((item) => renderKurlyProduct(item, section, cat))
      );
      return `<div class="kurly-product-grid">${cards.join("")}</div>`;
    }

    function renderWalkerhillSetOptions(tierId) {
      const tier = WH_SET_TIERS.find((t) => t.id === tierId);
      const section = KH_PRODUCTS.walkerhill?.sections.find((s) => s.id === "sets");
      const options = (section?.items || []).filter((item) => item.tier === tierId);
      if (!tier || !options.length) return "";

      const cards = options.map((item) => renderKurlyProduct(item, section, "walkerhill")).join("");

      return `<div class="wh-set-tier">
        <div class="wh-set-tier-head">
          <h3>${tier.label}</h3>
          <p>${tier.note}</p>
        </div>
        <div class="kurly-product-grid">${cards}</div>
      </div>`;
    }

    function renderWalkerhillAllSets() {
      return WH_SET_TIERS.map((tier) => renderWalkerhillSetOptions(tier.id)).join("");
    }

    function walkerhillSectionCards(sectionId) {
      const section = KH_PRODUCTS.walkerhill?.sections.find((s) => s.id === sectionId);
      if (!section) return [];
      return section.items.map((item) => renderKurlyProduct(item, section, "walkerhill"));
    }

    function renderWalkerhillCatalog() {
      if (state.activeCategory === "all") {
        const pogiCards = walkerhillSectionCards("pogi");
        const chonggakCards = walkerhillSectionCards("chonggak");
        return `<h3 class="wh-section-title">단품</h3>
        <div class="kurly-product-grid">${pogiCards.join("")}${chonggakCards.join("")}</div>
        <h3 class="wh-section-title">세트 상품</h3>
        ${renderWalkerhillAllSets()}`;
      }

      if (state.activeCategory === "set2" || state.activeCategory === "set3" || state.activeCategory === "set5") {
        return renderWalkerhillSetOptions(state.activeCategory);
      }

      if (state.activeCategory === "pogi") {
        const cards = walkerhillSectionCards("pogi");
        return `<div class="kurly-product-grid">${cards.join("")}</div>`;
      }

      if (state.activeCategory === "chonggak") {
        const cards = walkerhillSectionCards("chonggak");
        return `<div class="kurly-product-grid">${cards.join("")}</div>`;
      }

      const pogiCards = walkerhillSectionCards("pogi");
      const chonggakCards = walkerhillSectionCards("chonggak");
      return `<h3 class="wh-section-title">단품</h3>
        <div class="kurly-product-grid">${pogiCards.join("")}${chonggakCards.join("")}</div>
        <h3 class="wh-section-title">세트 상품</h3>
        ${renderWalkerhillAllSets()}`;
    }

    function renderCategoryNav() {
      const cats = state.brand === "walkerhill"
        ? [
            { id: "pogi", label: "배추김치" },
            { id: "chonggak", label: "총각김치" },
            { id: "set2", label: "2SET" },
            { id: "set3", label: "3SET" },
            { id: "set5", label: "5SET" },
          ]
        : KH_CATEGORIES;

      const images = state.brand === "walkerhill" ? WH_CAT_IMAGES : KH_CAT_IMAGES;

      const allTab = `<button type="button" class="shop-cat-icon${state.activeCategory === "all" ? " active" : ""}" data-order-cat="all">
        <span class="shop-cat-icon-img shop-cat-icon-all"><span>ALL</span></span>
        <span class="shop-cat-icon-label">전체보기</span>
      </button>`;

      const catTabs = cats.map((c) => {
        const img = images[c.id] || "assets/images/products/b1.png";
        return `<button type="button" class="shop-cat-icon${state.activeCategory === c.id ? " active" : ""}" data-order-cat="${c.id}">
          <span class="shop-cat-icon-img"><img src="${img}" alt="" loading="lazy" decoding="async" /></span>
          <span class="shop-cat-icon-label">${c.label}</span>
        </button>`;
      }).join("");

      return allTab + catTabs;
    }

    function renderDeliveryNote() {
      if (state.brand === "walkerhill") {
        return "워커힐 호텔 김치 · 7/5일부터 배송";
      }
      return "냉동 반찬 6/26~29 · 김치·장류 7/5부터 · 회차별 별도 배송";
    }

    function renderCatalog() {
      if (state.brand === "walkerhill") return renderWalkerhillCatalog();
      return renderKimchiHouseCatalog();
    }

    function shipLabel(fee) {
      return fee === 0 ? "무료" : money(fee);
    }

    function renderBarMeta() {
      if (type !== "combined") {
        const ship = shippingFee();
        return ship === 0 ? "배송비 무료" : `배송비 ${money(ship)}`;
      }
      return orderCatalogs()
        .map((cat) => {
          const sub = subtotalFor(cat);
          if (sub === 0) return "";
          return `${KH_PRODUCTS[cat].label} 배송 ${shipLabel(shippingFeeFor(cat))}`;
        })
        .filter(Boolean)
        .join(" · ") || "배송비 —";
    }

    function renderBarItems(lines) {
      const renderLine = (line) => `<li class="cart-line" data-cart-id="${line.id}">
        <div class="cart-line-top">
          <span class="cart-line-name">${line.name}</span>
          <button type="button" class="cart-line-delete" data-cart-delete="${line.id}" aria-label="삭제">삭제</button>
        </div>
        <div class="cart-line-bottom">
          <div class="cart-qty">
            <button type="button" data-cart-dec="${line.id}" ${line.qty <= 1 ? "disabled" : ""}>−</button>
            <span>${line.qty}</span>
            <button type="button" data-cart-inc="${line.id}">+</button>
          </div>
          <span class="cart-line-price">${money(line.price)}</span>
        </div>
      </li>`;

      if (state.brand === "walkerhill") {
        return lines.map(renderLine).join("");
      }

      if (type !== "combined") {
        return lines.map(renderLine).join("");
      }

      return orderCatalogs()
        .map((cat) => {
          const catLines = lines.filter((line) => line.category === cat);
          if (!catLines.length) return "";
          const header = `<li class="bar-group-title">${KH_PRODUCTS[cat].label}</li>`;
          return header + catLines.map(renderLine).join("");
        })
        .join("");
    }

    function cartItemCount() {
      return buildBarLines().reduce((sum, line) => sum + line.qty, 0);
    }

    function updateCartBadge(count) {
      ["cart-badge", "cart-badge-mobile"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (count > 0) {
          el.textContent = String(count);
          el.classList.remove("hidden");
        } else {
          el.classList.add("hidden");
        }
      });
      const cartInner = document.getElementById("order-cart-inner");
      if (cartInner) cartInner.classList.toggle("has-items", count > 0);
    }

    function renderProductModal() {
      const root = document.getElementById("product-modal");
      const overlay = document.getElementById("product-modal-overlay");
      if (!root || !overlay) return;

      if (!state.detail) {
        overlay.classList.remove("open");
        root.innerHTML = "";
        document.body.style.overflow = "";
        return;
      }

      const { item, section, cat } = state.detail;
      const catalog = KH_PRODUCTS[cat];
      const badge = itemBadgeHtml(item);
      let variantHtml = "";
      let tierHtml = "";
      let priceHtml = `<div class="product-modal-price">${displayPriceFor(item)}</div>`;
      let addKey = addKeyFor(item);

      if (item.variants) {
        const selected = getSelectedVariant(item);
        variantHtml = `<div class="kurly-option-list modal-options">${item.variants.map((v) => {
          const active = selected?.key === v.key ? " active" : "";
          return `<button type="button" class="kurly-option${active}" data-modal-variant="${item.id}" data-variant-key="${v.key}">
            <span class="kurly-option-radio"></span>
            <span class="kurly-option-label">${v.label}</span>
            <span class="kurly-option-price">${money(v.price)}</span>
          </button>`;
        }).join("")}</div>`;
        priceHtml = `<div class="product-modal-price">${money(selected.price)}</div>`;
        addKey = `${item.id}:${selected.key}`;
      }

      if (item.tiers) {
        tierHtml = `<div class="kurly-tier-picks modal-tier-picks">${item.tiers.map(([n, p]) => {
          const was = tierWasPrice(item, n);
          const wasHtml = was ? `<s class="tier-was">${money(was)}</s>` : "";
          return `<button type="button" class="kurly-tier-pick" data-tier-set="${item.id}" data-tier-qty="${n}">
            <span class="tier-qty">${n}개</span>
            <span class="tier-price">${wasHtml}<strong>${money(p)}</strong></span>
          </button>`;
        }).join("")}</div>`;
      } else if (item.group === "special") {
        tierHtml = `<div class="kurly-tier-picks modal-tier-picks">${window.KH_SPECIAL_TIERS.map(([n, p]) =>
          `<button type="button" class="kurly-tier-pick" data-tier-set="${item.id}" data-tier-qty="${n}">
            <span class="tier-qty">${n}개</span><span class="tier-price"><strong>${money(p)}</strong></span>
          </button>`
        ).join("")}</div>`;
      } else if (item.group === "pa") {
        tierHtml = `<div class="kurly-tier-picks modal-tier-picks">${window.KH_PA_TIERS.map(([n, p]) =>
          `<button type="button" class="kurly-tier-pick" data-tier-set="${item.id}" data-tier-qty="${n}">
            <span class="tier-qty">${n}개</span><span class="tier-price"><strong>${money(p)}</strong></span>
          </button>`
        ).join("")}</div>`;
      }

      const meta = [
        section.tab && `<li>${section.tab}</li>`,
        catalog?.delivery && `<li>배송: ${catalog.delivery}</li>`,
        section.note && `<li>${section.note}</li>`,
        item.desc && `<li>${item.desc}</li>`,
      ].filter(Boolean).join("");

      const detailSrcs = Array.isArray(item.detailImages) && item.detailImages.length
        ? item.detailImages
        : (item.detailImage ? [item.detailImage] : []);
      const detailHtml = detailSrcs.length
        ? `<div class="product-modal-detail">${detailSrcs.map((src, i) =>
            `<img src="${src}" alt="${item.name} 상세 안내 ${i + 1}" loading="lazy" decoding="async" />`
          ).join("")}</div>`
        : "";

      root.innerHTML = `
        <button type="button" class="product-modal-close" id="product-modal-close" aria-label="닫기">×</button>
        <div class="product-modal-img">
          ${badge}
          ${item.image ? `<img src="${item.image}" alt="${item.name}" />` : ""}
        </div>
        <div class="product-modal-body">
          <h2>${item.name}</h2>
          ${cardDesc(item, section) ? `<p class="product-modal-desc">${cardDesc(item, section)}</p>` : ""}
          ${meta ? `<ul class="product-modal-meta">${meta}</ul>` : ""}
          ${variantHtml}
          ${tierHtml}
          ${priceHtml}
          ${item.soldOut
            ? '<p class="product-modal-soldout">품절</p>'
            : (hasTierPricing(item)
              ? ""
              : `<button type="button" class="shop-btn shop-btn-primary shop-btn-block" data-modal-add="${addKey}">담기</button>`)}
          ${detailHtml}
        </div>`;
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
    }

    function openProductModal(itemId) {
      const found = findItemById(itemId);
      if (!found) return;
      state.detail = found;
      renderProductModal();
    }

    function closeProductModal() {
      state.detail = null;
      renderProductModal();
    }

    function openCartSheet() {
      document.getElementById("cart-sheet-overlay")?.classList.add("open");
      document.body.style.overflow = "hidden";
    }

    function closeCartSheet() {
      document.getElementById("cart-sheet-overlay")?.classList.remove("open");
      if (!state.detail && !document.getElementById("product-search-overlay")?.classList.contains("open")) {
        document.body.style.overflow = "";
      }
    }

    function searchItemImage(item, cat) {
      if (item.image) return item.image;
      if (cat === "walkerhill") {
        if (item.id === "w1") return WH_CAT_IMAGES.pogi;
        if (item.id === "w2") return WH_CAT_IMAGES.chonggak;
        if (item.tier?.startsWith("set")) return WH_CAT_IMAGES[item.tier] || WH_CAT_IMAGES.set2;
      }
      return "";
    }

    function searchItemDisplayName(item) {
      const isSet = item.tier?.startsWith("set");
      return isSet && item.desc ? item.desc : item.name;
    }

    function searchItemPriceLabel(item) {
      if (item.soldOut) return "품절";
      if (item.variants?.length) {
        const min = Math.min(...item.variants.map((v) => v.price));
        return `${money(min)}~`;
      }
      if (item.tiers?.length) {
        return money(item.tiers[0][1]);
      }
      if (item.price != null) return money(item.price);
      return "";
    }

    function getAllSearchableProducts() {
      const results = [];
      for (const cat of ["frozen", "kimchi", "walkerhill"]) {
        const catalog = KH_PRODUCTS[cat];
        if (!catalog) continue;
        for (const section of catalog.sections) {
          for (const item of section.items) {
            results.push({ item, section, cat, brand: cat === "walkerhill" ? "walkerhill" : "kimchi-house" });
          }
        }
      }
      return results;
    }

    function searchProducts(query) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const terms = q.split(/\s+/).filter(Boolean);
      return getAllSearchableProducts().filter(({ item, section, cat }) => {
        const catalog = KH_PRODUCTS[cat];
        const haystack = [
          item.name,
          item.desc,
          item.saleNote,
          section.tab,
          section.title,
          catalog.label,
          cat === "walkerhill" ? "워커힐" : "",
        ].filter(Boolean).join(" ").toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
    }

    function renderSearchResults(query) {
      const listEl = document.getElementById("product-search-results");
      const hintEl = document.getElementById("product-search-hint");
      const clearBtn = document.getElementById("product-search-clear");
      if (!listEl) return;

      const trimmed = query.trim();
      clearBtn?.classList.toggle("hidden", !trimmed);

      if (!trimmed) {
        hintEl.textContent = "김치, 만두, 워커힐 등 키워드로 검색할 수 있습니다.";
        listEl.innerHTML = "";
        return;
      }

      const matches = searchProducts(trimmed);
      if (!matches.length) {
        hintEl.textContent = "";
        listEl.innerHTML = `<li class="product-search-empty">「${trimmed}」에 맞는 상품이 없습니다.</li>`;
        return;
      }

      hintEl.textContent = `검색 결과 ${matches.length}건`;
      listEl.innerHTML = matches.map(({ item, section, cat }) => {
        const catalog = KH_PRODUCTS[cat];
        const brandLabel = cat === "walkerhill" ? "워커힐 호텔 김치" : catalog.label;
        const thumb = searchItemImage(item, cat);
        const price = searchItemPriceLabel(item);
        const priceClass = item.soldOut ? "product-search-price sold-out" : "product-search-price";
        return `<li>
          <button type="button" class="product-search-item" data-search-item="${item.id}">
            <div class="product-search-thumb">${thumb ? `<img src="${thumb}" alt="" loading="lazy" decoding="async" />` : ""}</div>
            <div class="product-search-info">
              <div class="product-search-cat">${brandLabel} · ${section.tab}</div>
              <div class="product-search-name">${searchItemDisplayName(item)}</div>
            </div>
            <span class="${priceClass}">${price}</span>
          </button>
        </li>`;
      }).join("");
    }

    function openSearchOverlay() {
      const overlay = document.getElementById("product-search-overlay");
      if (!overlay) return;
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
      const input = document.getElementById("product-search-input");
      if (input) {
        input.value = "";
        renderSearchResults("");
        requestAnimationFrame(() => input.focus());
      }
    }

    function closeSearchOverlay() {
      document.getElementById("product-search-overlay")?.classList.remove("open");
      if (!state.detail && !document.getElementById("cart-sheet-overlay")?.classList.contains("open")) {
        document.body.style.overflow = "";
      }
    }

    function goToProductFromSearch(itemId) {
      const found = findItemById(itemId);
      if (!found) return;
      const brand = found.cat === "walkerhill" ? "walkerhill" : "kimchi-house";
      closeSearchOverlay();

      if (state.brand !== brand) {
        setBrandExternal(brand);
      }

      const cat = categoryForItemId(brand, itemId);
      if (cat) {
        state.activeCategory = cat;
        render();
        persistCart();
      }

      document.getElementById("shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
      requestAnimationFrame(() => openProductModal(itemId));
    }

    function fillCartPanel(itemsEl, metaEl, totalEl, lines, totalStr, metaStr, hasItems) {
      if (!itemsEl) return;
      if (!hasItems) {
        itemsEl.innerHTML = `<li class="bar-empty"><strong>장바구니가 비어 있습니다.</strong><span>원하는 상품을 담아주세요.</span></li>`;
        if (metaEl) metaEl.textContent = "";
      } else {
        itemsEl.innerHTML = renderBarItems(lines);
        if (metaEl) metaEl.textContent = metaStr;
      }
      if (totalEl) totalEl.textContent = totalStr;
    }

    function updateCheckoutButtons(hasItems) {
      ["open-checkout-btn", "open-checkout-mobile", "open-checkout-sheet"].forEach((id) => {
        const btn = document.getElementById(id);
        if (btn) btn.disabled = !hasItems;
      });
    }

    function updateMobileCartBar(hasItems) {
      const fixed = document.querySelector(".shop-fixed-cta");
      const mobile = document.getElementById("order-mobile-cart");
      const keepCartPadding = cartOnly || document.body.classList.contains("shop-unified");
      document.body.classList.toggle("has-cart", Boolean(hasItems && keepCartPadding));
      if (!mobile) return;
      if (hasItems) {
        fixed?.classList.add("hidden");
        mobile.classList.remove("hidden");
      } else if (keepCartPadding) {
        fixed?.classList.remove("hidden");
        mobile.classList.add("hidden");
      }
    }

    function showCartToast(message) {
      let toast = document.getElementById("shop-cart-toast");
      if (!toast) {
        toast = document.createElement("div");
        toast.id = "shop-cart-toast";
        toast.className = "shop-cart-toast";
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.classList.add("show");
      clearTimeout(showCartToast._timer);
      showCartToast._timer = setTimeout(() => toast.classList.remove("show"), 2200);
    }

    function bumpCartSheet() {
      const count = buildBarLines().length;
      if (!count) return;
      showCartToast("장바구니에 담겼습니다.");
    }

    function render() {
      if (!cartOnly) {
        const catTabs = document.getElementById("order-cat-tabs");
        if (catTabs) catTabs.innerHTML = renderCategoryNav();

        const deliveryNote = document.getElementById("order-delivery-note");
        if (deliveryNote) deliveryNote.textContent = renderDeliveryNote();

        const productRoot = document.getElementById("product-root");
        if (productRoot) productRoot.innerHTML = renderCatalog();
      }

      const lines = buildBarLines();
      const totalStr = money(total());
      const metaStr = renderBarMeta();
      const hasItems = lines.length > 0;
      const count = cartItemCount();

      fillCartPanel(
        document.getElementById("bar-items"),
        document.getElementById("bar-meta"),
        document.getElementById("bar-total"),
        lines,
        totalStr,
        metaStr,
        hasItems
      );
      fillCartPanel(
        document.getElementById("bar-items-sheet"),
        document.getElementById("bar-meta-sheet"),
        document.getElementById("bar-total-sheet"),
        lines,
        totalStr,
        metaStr,
        hasItems
      );

      const barTotalMobile = document.getElementById("bar-total-mobile");
      if (barTotalMobile) barTotalMobile.textContent = totalStr;

      updateCheckoutButtons(hasItems);
      updateCartBadge(count);
      updateMobileCartBar(hasItems);
      renderProductModal();

      const bankInfo = document.getElementById("bank-info");
      if (bankInfo) {
        const bank = cfg.bank;
        bankInfo.innerHTML = `
        은행 <strong>${bank.bank}</strong> · BSB <strong>${bank.bsb}</strong><br>
        계좌 <strong>${bank.account}</strong> · ${bank.holder}<br>
        ※ 입금자명을 <strong>주문자 성함과 동일하게</strong> 해주세요.`;
      }
    }

    function openCheckout() {
      if (!buildBarLines().length) {
        alert("품목을 1개 이상 선택해 주세요.");
        return;
      }
      closeCartSheet();
      document.getElementById("checkout-overlay").classList.add("open");
      document.body.style.overflow = "hidden";
    }

    function closeCheckout() {
      document.getElementById("checkout-overlay").classList.remove("open");
      document.body.style.overflow = "";
    }

    function addWalkerhillSet(productId) {
      if (!productId?.startsWith("w_set")) return;
      setQty(productId, qty(productId) + 1);
    }

    async function submitOrder() {
      const name = document.getElementById("customer-name").value.trim();
      const phone = document.getElementById("customer-phone").value.trim();
      const address = document.getElementById("customer-address").value.trim();
      const suburb = document.getElementById("customer-suburb").value.trim();
      const kakao = document.getElementById("customer-kakao").value.trim();
      const note = document.getElementById("customer-note").value.trim();

      if (!name || !phone || !address || !suburb) {
        alert("필수 정보를 모두 입력해 주세요.");
        return;
      }

      const items = buildLineItems();
      if (!items.length) {
        alert("품목을 1개 이상 선택해 주세요.");
        return;
      }

      const payload = {
        secret: cfg.orderSecret,
        type: state.brand === "walkerhill" ? "walkerhill" : type,
        customer: { name, phone, address, suburb, kakao },
        items,
        subtotal: subtotal(),
        shippingFee: shippingFee(),
        total: total(),
        payment: state.payment,
        note,
      };

      if (type === "combined" || state.brand === "walkerhill") {
        payload.shippingBreakdown = shippingBreakdown();
      }

      const btn = document.getElementById("submit-btn");
      btn.disabled = true;
      btn.textContent = "접수 중...";

      try {
        const res = await fetch(cfg.orderEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || "주문 접수 실패");

        document.getElementById("order-form-wrap")?.classList.add("hidden");
        document.getElementById("shop-main")?.classList.add("hidden");
        document.querySelector(".shop-site-header")?.classList.add("hidden");
        document.querySelector(".shop-footer")?.classList.add("hidden");
        document.querySelector(".shop-fixed-cta")?.classList.add("hidden");
        document.getElementById("order-mobile-cart")?.classList.add("hidden");
        document.getElementById("success-screen")?.classList.add("show");
        document.getElementById("order-id").textContent = data.orderId;
        state.cart = {};
        clearPersistedCart();
        closeCheckout();
      } catch (err) {
        alert(err.message || "주문 접수 중 오류가 발생했습니다.");
        btn.disabled = false;
        btn.textContent = "주문 접수하기";
      }
    }

    function bindCartClicks(root) {
      if (!root) return;
      root.addEventListener("click", (e) => {
        const del = e.target.closest("[data-cart-delete]");
        if (del) {
          setQty(del.dataset.cartDelete, 0);
          return;
        }
        const inc = e.target.closest("[data-cart-inc]");
        if (inc) {
          const id = inc.dataset.cartInc;
          setQty(id, qty(id) + 1);
          return;
        }
        const dec = e.target.closest("[data-cart-dec]");
        if (dec) {
          const id = dec.dataset.cartDec;
          setQty(id, Math.max(0, qty(id) - 1));
        }
      });
    }

    bindCartClicks(document.getElementById("bar-items"));
    bindCartClicks(document.getElementById("bar-items-sheet"));

    const catTabsEl = document.getElementById("order-cat-tabs");
    if (catTabsEl) {
      catTabsEl.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-order-cat]");
        if (!tab) return;
        state.activeCategory = tab.dataset.orderCat;
        render();
        persistCart();
        document.getElementById("shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    if (!cartOnly) {
      document.querySelectorAll(".shop-brand-tab").forEach((tab) => {
        tab.addEventListener("click", () => {
          setBrandExternal(tab.dataset.brand);
        });
      });
    }

    const productRoot = document.getElementById("product-root");
    if (productRoot) {
      productRoot.addEventListener("click", (e) => {
        const openBtn = e.target.closest("[data-product-open]");
        if (openBtn) {
          openProductModal(openBtn.dataset.productOpen);
          return;
        }

        const variantBtn = e.target.closest("[data-variant-pick]");
        if (variantBtn) {
          state.selectedVariant[variantBtn.dataset.variantPick] = variantBtn.dataset.variantKey;
          render();
          return;
        }

        const setBtn = e.target.closest("[data-wh-set]");
        if (setBtn) {
          addWalkerhillSet(setBtn.dataset.whSet);
          bumpCartSheet();
          return;
        }

        const addBtn = e.target.closest("[data-add]");
        if (addBtn) {
          const key = addBtn.dataset.add;
          setQty(key, qty(key) + 1);
          bumpCartSheet();
        }
      });
    }

    document.addEventListener("click", (e) => {
      const tierBtn = e.target.closest("[data-tier-set]");
      if (tierBtn) {
        setQty(tierBtn.dataset.tierSet, Number(tierBtn.dataset.tierQty));
        closeProductModal();
        bumpCartSheet();
        return;
      }

      const homeAdd = e.target.closest("[data-home-add]");
      if (homeAdd) {
        const key = homeAdd.dataset.homeAdd;
        setQty(key, qty(key) + 1);
        bumpCartSheet();
        return;
      }

      const homeSet = e.target.closest("[data-home-wh-set]");
      if (homeSet) {
        addWalkerhillSet(homeSet.dataset.homeWhSet);
        bumpCartSheet();
        return;
      }

      const homeModal = e.target.closest("[data-home-modal]");
      if (homeModal) {
        openProductModal(homeModal.dataset.homeModal);
      }
    });

    document.getElementById("product-modal-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "product-modal-overlay") closeProductModal();
    });

    document.addEventListener("click", (e) => {
      if (e.target.id === "product-modal-close" || e.target.closest("#product-modal-close")) {
        closeProductModal();
        return;
      }
      const modalVariant = e.target.closest("[data-modal-variant]");
      if (modalVariant && state.detail) {
        state.selectedVariant[modalVariant.dataset.modalVariant] = modalVariant.dataset.variantKey;
        renderProductModal();
        return;
      }
      const modalAdd = e.target.closest("[data-modal-add]");
      if (modalAdd) {
        setQty(modalAdd.dataset.modalAdd, qty(modalAdd.dataset.modalAdd) + 1);
        closeProductModal();
        bumpCartSheet();
      }
    });

    ["open-cart-sheet", "open-cart-sheet-mobile"].forEach((id) => {
      document.getElementById(id)?.addEventListener("click", openCartSheet);
    });
    document.getElementById("cart-sheet-close")?.addEventListener("click", closeCartSheet);
    document.getElementById("cart-sheet-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "cart-sheet-overlay") closeCartSheet();
    });

    document.getElementById("open-product-search")?.addEventListener("click", openSearchOverlay);
    document.getElementById("product-search-close")?.addEventListener("click", closeSearchOverlay);
    document.getElementById("product-search-clear")?.addEventListener("click", () => {
      const input = document.getElementById("product-search-input");
      if (input) {
        input.value = "";
        renderSearchResults("");
        input.focus();
      }
    });
    document.getElementById("product-search-input")?.addEventListener("input", (e) => {
      renderSearchResults(e.target.value);
    });
    document.getElementById("product-search-results")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-search-item]");
      if (btn) goToProductFromSearch(btn.dataset.searchItem);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (document.getElementById("product-search-overlay")?.classList.contains("open")) {
        closeSearchOverlay();
      }
    });

    document.getElementById("menu-open")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.add("open");
    });
    document.getElementById("menu-close")?.addEventListener("click", () => {
      document.getElementById("mobile-nav")?.classList.remove("open");
    });
    document.getElementById("mobile-nav")?.addEventListener("click", (e) => {
      if (e.target.id === "mobile-nav") document.getElementById("mobile-nav").classList.remove("open");
    });

    document.querySelectorAll(".pay-opt-shop").forEach((el) => {
      el.addEventListener("click", () => {
        document.querySelectorAll(".pay-opt-shop").forEach((n) => n.classList.remove("sel"));
        el.classList.add("sel");
        state.payment = el.dataset.pay;
        document.getElementById("bank-box")?.classList.toggle("hidden", state.payment !== "transfer");
        persistCart();
      });
    });

    document.getElementById("open-checkout-btn")?.addEventListener("click", openCheckout);
    document.getElementById("open-checkout-mobile")?.addEventListener("click", openCheckout);
    document.getElementById("open-checkout-sheet")?.addEventListener("click", openCheckout);
    document.getElementById("checkout-close")?.addEventListener("click", closeCheckout);
    document.getElementById("checkout-overlay")?.addEventListener("click", (e) => {
      if (e.target.id === "checkout-overlay") closeCheckout();
    });

    document.getElementById("submit-btn")?.addEventListener("click", submitOrder);
    restoreCart();
    applyOrderParams();
    render();
    scrollToPendingItem();
    scrollToShopIfNeeded();

    function setBrandExternal(brand) {
      if (brand === "kimchi-house" && isWalkerhillPath()) {
        location.href = "index.html";
        return;
      }
      if (brand === "walkerhill" && !isWalkerhillPath()) {
        const path = location.pathname.endsWith(".html") ? "walkerhill.html" : "walkerhill";
        location.href = path;
        return;
      }
      if (brand !== state.brand) state.cart = {};
      state.brand = brand;
      document.body.dataset.brand = brand;
      if (!cartOnly) state.activeCategory = brand === "walkerhill" ? "all" : "pogi";
      document.querySelectorAll(".shop-brand-tab").forEach((t) => {
        t.classList.toggle("active", t.dataset.brand === brand);
      });
      render();
      persistCart();
      notifyBrandChange(brand);
    }

    function setCategoryExternal(catId) {
      if (!catId) return;
      const next = normalizeCategoryParam(state.brand, catId) || catId;
      state.activeCategory = next;
      render();
      persistCart();
    }

    return {
      setBrand: setBrandExternal,
      setCategory: setCategoryExternal,
      openModal: openProductModal,
      openCart: openCartSheet,
      openSearch: openSearchOverlay,
      addItem(id) {
        setQty(id, qty(id) + 1);
        bumpCartSheet();
      },
      setTierQty(id, amount) {
        setQty(id, amount);
        bumpCartSheet();
      },
    };
  }

  window.initOrderPage = function (type, options) {
    return createOrderApp(type, options || {});
  };
})();
