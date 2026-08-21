(function () {
  const BRANDS = {
    "kimchi-house": { label: "김치하우스", heroIndex: 1 },
    walkerhill: { label: "워커힐 호텔 김치", heroIndex: 0 },
  };

  const WALKERHILL_SET_IDS = [
    "w_set2a", "w_set2b", "w_set2c",
    "w_set3a", "w_set3b", "w_set3c", "w_set3d",
    "w_set5a", "w_set5b", "w_set5c", "w_set5d",
  ];
  const WALKERHILL_ITEM_IDS = new Set(["w1", "w2", ...WALKERHILL_SET_IDS]);
  const POPULAR_IDS = ["b1", "b2", "b3", "b4", "b5", "a9", "a3", "b8"];
  const WALKERHILL_POPULAR_IDS = ["w1", "w2", "w_set2b", "w_set3a", "w_set5a", "w_set3b", "w_set5b", "w_set2a"];

  const BROWSE_CATEGORIES = [
    {
      id: "all",
      label: "ALL",
      brand: "kimchi-house",
      orderCat: "all",
      linkBrand: "kimchihouse",
      linkCategory: "all",
      itemIds: POPULAR_IDS,
      theme: "kh",
      isAll: true,
    },
    {
      id: "pogi",
      label: "포기김치",
      image: "assets/images/products/b1.png",
      brand: "kimchi-house",
      orderCat: "pogi",
      linkBrand: "kimchihouse",
      linkCategory: "kimchi",
      itemIds: ["b1", "b2", "b3"],
      theme: "kh",
    },
    {
      id: "special",
      label: "별미김치",
      image: "assets/images/browse/special.png",
      brand: "kimchi-house",
      orderCat: "special",
      linkBrand: "kimchihouse",
      linkCategory: "special-kimchi",
      itemIds: ["b4", "b5", "b6", "b7"],
      theme: "kh",
    },
    {
      id: "premium",
      label: "워커힐 프리미엄",
      image: "assets/images/walkerhill/pogi.jpg",
      brand: "kimchi-house",
      orderCat: "premium",
      linkBrand: "kimchihouse",
      linkCategory: "premium",
      itemIds: ["w1", "w2", "w_set2b", "w_set3a"],
      theme: "wh",
    },
    {
      id: "seafood",
      label: "프리미엄 수산·반찬",
      image: "assets/images/browse/jeotgal.png",
      brand: "kimchi-house",
      orderCat: "seafood",
      linkBrand: "kimchihouse",
      linkCategory: "seafood",
      itemIds: ["a9", "a10", "b10"],
      theme: "kh",
    },
    {
      id: "frozen",
      label: "냉동·간편식",
      image: "assets/images/browse/frozen.png",
      brand: "kimchi-house",
      orderCat: "frozen",
      linkBrand: "kimchihouse",
      linkCategory: "frozen",
      itemIds: ["a3", "a4", "extra-jaecheop", "extra-myeongtaecho"],
      theme: "kh",
    },
    {
      id: "jang",
      label: "전통 장류·김",
      image: "assets/images/browse/jang.png",
      brand: "kimchi-house",
      orderCat: "jang",
      linkBrand: "kimchihouse",
      linkCategory: "pantry",
      itemIds: ["b11", "b12", "b8"],
      theme: "kh",
    },
  ];

  const CATEGORIES = {
    "kimchi-house": [
      { id: "all", label: "전체", href: "#shop" },
      { id: "pogi", label: "포기김치", image: "assets/images/products/b1.png", href: "#shop", itemIds: ["b1", "b2", "b3"] },
      { id: "special", label: "별미김치", image: "assets/images/browse/special.png", href: "#shop", itemIds: ["b4", "b5", "b6", "b7"] },
      { id: "premium", label: "워커힐 프리미엄", image: "assets/images/walkerhill/pogi.jpg", href: "#shop", itemIds: ["w1", "w2", ...WALKERHILL_SET_IDS] },
      { id: "seafood", label: "프리미엄 수산·반찬", image: "assets/images/browse/jeotgal.png", href: "#shop", itemIds: ["a9", "a10", "b10"] },
      { id: "frozen", label: "냉동·간편식", image: "assets/images/browse/frozen.png", href: "#shop", itemIds: ["a3", "a4", "extra-jaecheop", "extra-myeongtaecho"] },
      { id: "jang", label: "전통 장류·김", image: "assets/images/browse/jang.png", href: "#shop", itemIds: ["b11", "b12", "b8"] },
    ],
    walkerhill: [
      { id: "all", label: "전체", href: "#shop" },
      { id: "premium", label: "워커힐 프리미엄", image: "assets/images/walkerhill/pogi.jpg", href: "#shop", itemIds: ["w1", "w2", ...WALKERHILL_SET_IDS] },
    ],
  };

  let currentBrand = "kimchi-house";
  let activeHomeCategory = "all";
  let activeBrowseCategory = "all";
  let heroIndex = 0;
  let heroTimer = null;
  let preorderOpen = true;

  function money(n) {
    return "$" + Number(n || 0).toFixed(0);
  }

  function lowestPrice(item) {
    if (window.KHSale && !window.KHSale.isVisible(item)) return null;
    if (item.variants?.length) return Math.min(...item.variants.map((v) => v.price));
    if (item.tiers?.length) return item.tiers[0][1];
    if (item.group === "special") return window.KH_SPECIAL_TIERS?.[0]?.[1] ?? null;
    if (item.group === "pa") return window.KH_PA_TIERS?.[0]?.[1] ?? null;
    if (item.price != null) return item.price;
    return null;
  }

  function itemSaleStatus(item) {
    return window.KHSale?.status(item) || (item.soldOut ? "sold_out" : "active");
  }

  function itemDesc(item, section) {
    if (item.desc) return item.desc;
    if (item.saleNote) return item.saleNote;
    if (section.note) return section.note;
    if (item.variants?.length) return item.variants.map((v) => v.label).join(" · ");
    return section.tab || "사전예약 주문";
  }

  function itemBadge(item) {
    const saleStatus = itemSaleStatus(item);
    if (saleStatus === "sold_out") return { cls: "soldout", text: "품절" };
    if (saleStatus === "coming_soon") return { cls: "soon", text: "판매 예정" };
    if (item.premium || item.id === "w1" || item.id === "w2" || item.id?.startsWith("w_set")) {
      return { cls: "premium", text: "PREMIUM" };
    }
    if (item.isNew || item.badge === "NEW") return { cls: "new", text: "NEW" };
    if (item.vegan) return { cls: "vegan", text: "VEGAN" };
    if (item.sale || item.saleLabel) return { cls: "sale", text: item.saleLabel || "SALE" };
    if (item.id === "b8" || item.id === "b1") return { cls: "best", text: "BEST" };
    if (item.id === "w_set2b") return { cls: "best", text: "⭐ 인기" };
    return null;
  }

  function collectProducts(brand) {
    const list = [];
    const cats = ["walkerhill", "kimchi", "frozen"];

    for (const catKey of cats) {
      const cat = window.KH_PRODUCTS[catKey];
      if (!cat) continue;
      for (const section of cat.sections) {
        for (const item of section.items) {
          if (itemSaleStatus(item) === "hidden") continue;
          if (brand === "walkerhill" && !WALKERHILL_ITEM_IDS.has(item.id)) continue;
          const price = lowestPrice(item);
          if (price == null && itemSaleStatus(item) === "active") continue;
          list.push({
            ...item,
            catKey,
            sectionId: section.id,
            sectionTab: section.tab,
            displayPrice: price,
            desc: itemDesc(item, section),
            badge: itemBadge(item),
            saleStatus: itemSaleStatus(item),
          });
        }
      }
    }
    return list;
  }

  function popularProducts(brand) {
    const all = collectProducts(brand);
    const cats = CATEGORIES[brand] || CATEGORIES["kimchi-house"];
    const catDef = cats.find((c) => c.id === activeHomeCategory);

    let pool = all;
    if (catDef?.itemIds) {
      pool = all.filter((p) => catDef.itemIds.includes(p.id));
    }

    const picked = [];
    const seen = new Set();
    const ids = catDef?.itemIds || (brand === "walkerhill" ? WALKERHILL_POPULAR_IDS : POPULAR_IDS);

    for (const id of ids) {
      const item = pool.find((p) => p.id === id);
      if (item && !seen.has(id) && itemSaleStatus(item) === "active") {
        picked.push(item);
        seen.add(id);
      }
      if (picked.length >= 8) break;
    }

    if (picked.length < 4) {
      for (const item of pool) {
        if (seen.has(item.id) || itemSaleStatus(item) !== "active") continue;
        picked.push(item);
        seen.add(item.id);
        if (picked.length >= 8) break;
      }
    }

    return brand === "walkerhill"
      ? picked.filter((p) => WALKERHILL_ITEM_IDS.has(p.id)).slice(0, 8)
      : picked;
  }

  function renderCategoryTabs(brand) {
    const cats = (CATEGORIES[brand] || CATEGORIES["kimchi-house"]).filter((c) => c.id !== "all" && c.image);
    return cats.map((c) =>
      `<button type="button" class="shop-cat-icon${activeHomeCategory === c.id ? " active" : ""}" data-home-cat="${c.id}">
        <span class="shop-cat-icon-img"><img src="${c.image}" alt="${c.label}" loading="lazy" decoding="async" /></span>
        <span class="shop-cat-icon-label">${c.label}</span>
      </button>`
    ).join("");
  }

  function refreshCategoryTabs() {
    const tabsRoot = document.getElementById("home-cat-tabs");
    const tabsWh = document.getElementById("home-cat-tabs-wh");
    if (tabsRoot) tabsRoot.innerHTML = renderCategoryTabs("kimchi-house");
    if (tabsWh) tabsWh.innerHTML = renderCategoryTabs("walkerhill");
  }
  const HOME_TO_ORDER_CAT = {
    pogi: "pogi",
    special: "special",
    frozen: "banchan",
    jeotgal: "jeotgal",
    jang: "jang",
    event: "jang",
    chonggak: "chonggak",
    set: "set2",
  };

  function categoryForItem(brand, itemId) {
    if (!itemId) return null;
    if (brand === "walkerhill") {
      if (itemId === "w1") return "pogi";
      if (itemId === "w2") return "chonggak";
      if (itemId.startsWith("w_set2")) return "set2";
      if (itemId.startsWith("w_set3")) return "set3";
      if (itemId.startsWith("w_set5")) return "set5";
      return "pogi";
    }
    for (const c of CATEGORIES["kimchi-house"]) {
      if (c.itemIds?.includes(itemId)) return HOME_TO_ORDER_CAT[c.id] || "pogi";
    }
    return "pogi";
  }

  function buildOrderUrl({ brand = currentBrand, cat, item, category } = {}) {
    const params = new URLSearchParams();
    const linkBrand = brand === "walkerhill" ? "walkerhill" : brand === "kimchi-house" ? "kimchihouse" : brand;
    if (linkBrand && linkBrand !== "kimchihouse") params.set("brand", linkBrand);
    else if (linkBrand === "kimchihouse" && (category || cat || item)) params.set("brand", "kimchihouse");

    if (category) params.set("category", category);
    else {
      const resolvedCat = cat || (item ? categoryForItem(brand === "kimchihouse" ? "kimchi-house" : brand, item) : null);
      if (resolvedCat) params.set("cat", resolvedCat);
      else if (!item) params.set("cat", "all");
    }
    if (item) params.set("item", item);
    const qs = params.toString();
    return `order.html${qs ? `?${qs}` : ""}#shop`;
  }

  function browseCategoryHref(cat) {
    return `#shop`;
  }

  function renderBrowseCategories() {
    const rail = document.getElementById("browse-category-rail");
    if (!rail) return;

    rail.innerHTML = BROWSE_CATEGORIES.map((cat) => {
      const active = cat.id === activeBrowseCategory ? " is-active" : "";
      const theme = cat.theme === "wh" ? " is-wh" : "";
      const thumb = cat.isAll
        ? `<span class="browse-category-thumb browse-category-thumb-all"><span>ALL</span></span>`
        : `<span class="browse-category-thumb"><img src="${cat.image}" alt="" loading="lazy" decoding="async" /></span>`;
      return `<a class="browse-category-item${active}${theme}" href="${browseCategoryHref(cat)}" data-browse-cat="${cat.id}" role="listitem">
        ${thumb}
        <span class="browse-category-label">${cat.label}</span>
      </a>`;
    }).join("");
  }

  function setBrowseCategoryActive(catId) {
    activeBrowseCategory = catId;
    document.querySelectorAll("[data-browse-cat]").forEach((el) => {
      el.classList.toggle("is-active", el.dataset.browseCat === catId);
    });
  }

  function bindBrowseCategories() {
    const rail = document.getElementById("browse-category-rail");
    if (!rail) return;

    rail.addEventListener("click", (e) => {
      const item = e.target.closest("[data-browse-cat]");
      if (!item) return;
      e.preventDefault();
      const cat = BROWSE_CATEGORIES.find((c) => c.id === item.dataset.browseCat);
      setBrowseCategoryActive(item.dataset.browseCat);
      if (cat?.orderCat) window.shopApi?.setCategory(cat.orderCat);
      document.getElementById("shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function syncOrderLinks() {
    document.querySelectorAll(".shop-hero-slide").forEach((slide) => {
      const cat =
        slide.id === "premium" || slide.dataset.heroBrand === "walkerhill"
          ? "premium"
          : "pogi";
      slide.querySelectorAll("[data-order-link], a[data-order-cat]").forEach((a) => {
        a.href = "#shop";
        if (!a.dataset.orderCat) a.dataset.orderCat = cat;
      });
    });

    const browseViewAll = document.getElementById("browse-view-all");
    if (browseViewAll) {
      browseViewAll.setAttribute("href", "#shop");
      browseViewAll.dataset.orderCat = "all";
    }
    document.querySelector("#order-steps .shop-btn-primary")?.setAttribute("href", "#shop");
    document.querySelector(".shop-fixed-cta .shop-btn-primary")?.setAttribute("href", "#shop");
  }

  function originalPrice(item) {
    return window.getSaleOriginalPrice?.(item) ?? null;
  }

  function getTierList(item) {
    if (item.tiers?.length) return item.tiers;
    if (item.group === "special") return window.KH_SPECIAL_TIERS;
    if (item.group === "pa") return window.KH_PA_TIERS;
    return null;
  }

  function renderPriceHtml(item) {
    const status = itemSaleStatus(item);
    if (status === "sold_out") return `<span style="color:var(--text-muted)">품절</span>`;
    if (status === "coming_soon") return `<span style="color:var(--text-muted)">판매 예정</span>`;
    const tiers = getTierList(item);
    if (tiers?.length) {
      const salePrice = tiers[0][1];
      const was = window.getSaleOriginalPrice?.(item, tiers[0][0]);
      if ((item.sale || item.saleLabel) && was != null && was > salePrice) {
        return `<span class="was">${money(was)}</span><span class="now sale">${money(salePrice)}</span>`;
      }
      return `<span class="now">${money(salePrice)}</span>`;
    }
    const orig = originalPrice(item);
    const isSale = item.sale || item.saleLabel;
    if (isSale && orig != null && item.displayPrice < orig) {
      return `<span class="was">${money(orig)}</span><span class="now sale">${money(item.displayPrice)}</span>`;
    }
    return `<span class="now">${money(item.displayPrice)}</span>`;
  }

  function tierWasPrice(item, qtyN) {
    return window.getSaleOriginalPrice?.(item, qtyN) ?? null;
  }

  function renderHomeTierPicks(item) {
    const tiers = getTierList(item);
    if (!tiers) return "";
    return `<button type="button" class="shop-product-cta" data-home-modal="${item.id}">수량 선택 · 담기</button>`;
  }

  function renderProductAction(item) {
    const status = itemSaleStatus(item);
    if (status !== "active") {
      return `<button type="button" class="shop-product-cta" disabled>${status === "coming_soon" ? "판매 예정" : "품절"}</button>`;
    }
    if (getTierList(item)) return renderHomeTierPicks(item);
    if (item.variants?.length) {
      return `<button type="button" class="shop-product-cta" data-home-modal="${item.id}">옵션 선택 · 담기</button>`;
    }
    if (item.id?.startsWith("w_set")) {
      return `<button type="button" class="shop-product-cta" data-home-wh-set="${item.id}">담기</button>`;
    }
    return `<button type="button" class="shop-product-cta" data-home-add="${item.id}">담기</button>`;
  }

  function renderProductCard(item) {
    const badge = item.badge
      ? `<span class="shop-badge shop-badge-${item.badge.cls}">${item.badge.text}</span>`
      : "";

    return `<article class="shop-product">
      <button type="button" class="shop-product-thumb" data-home-modal="${item.id}">
        <img src="${item.image}" alt="${item.name}" loading="lazy" decoding="async" />
        ${badge}
      </button>
      <div class="shop-product-body">
        <div class="shop-product-name">${item.name}</div>
        <div class="shop-product-desc">${item.desc}</div>
        <div class="shop-product-price">${renderPriceHtml(item)}</div>
        ${renderProductAction(item)}
      </div>
    </article>`;
  }

  function renderPopular(brand) {
    const products = popularProducts(brand);
    const root = document.getElementById("popular-products");
    if (!root) return;
    popularSlideIndex = 0;
    root.innerHTML = products.map(renderProductCard).join("");
    requestAnimationFrame(() => updatePopularSlider());
  }

  let popularSlideIndex = 0;

  function popularPerView() {
    if (window.matchMedia("(min-width: 1024px)").matches) return 4;
    if (window.matchMedia("(min-width: 640px)").matches) return 3;
    return 2;
  }

  function updatePopularSlider() {
    const track = document.getElementById("popular-products");
    const prev = document.getElementById("popular-prev");
    const next = document.getElementById("popular-next");
    if (!track) return;

    const cards = track.querySelectorAll(".shop-product");
    const perView = popularPerView();
    const maxIndex = Math.max(0, cards.length - perView);

    popularSlideIndex = Math.min(popularSlideIndex, maxIndex);

    const showArrows = cards.length > perView;
    prev?.classList.toggle("hidden", !showArrows || popularSlideIndex <= 0);
    next?.classList.toggle("hidden", !showArrows || popularSlideIndex >= maxIndex);

    if (!cards.length) {
      track.style.transform = "";
      return;
    }

    const gap = parseFloat(getComputedStyle(track).gap) || 14;
    const cardWidth = cards[0].offsetWidth;
    track.style.transform = `translateX(-${popularSlideIndex * (cardWidth + gap)}px)`;
  }

  function bindPopularSlider() {
    const viewport = document.querySelector(".popular-slider-viewport");
    const prev = document.getElementById("popular-prev");
    const next = document.getElementById("popular-next");

    prev?.addEventListener("click", () => {
      popularSlideIndex = Math.max(0, popularSlideIndex - 1);
      updatePopularSlider();
    });

    next?.addEventListener("click", () => {
      const track = document.getElementById("popular-products");
      const cards = track?.querySelectorAll(".shop-product") || [];
      const maxIndex = Math.max(0, cards.length - popularPerView());
      popularSlideIndex = Math.min(maxIndex, popularSlideIndex + 1);
      updatePopularSlider();
    });

    let touchStartX = 0;
    viewport?.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });

    viewport?.addEventListener("touchend", (e) => {
      const diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) < 40) return;
      const track = document.getElementById("popular-products");
      const cards = track?.querySelectorAll(".shop-product") || [];
      const maxIndex = Math.max(0, cards.length - popularPerView());
      if (diff < 0) popularSlideIndex = Math.min(maxIndex, popularSlideIndex + 1);
      else popularSlideIndex = Math.max(0, popularSlideIndex - 1);
      updatePopularSlider();
    }, { passive: true });

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        popularSlideIndex = 0;
        updatePopularSlider();
      }, 120);
    });
  }

  function onShopBrandChange(brand) {
    currentBrand = "kimchi-house";
    document.body.dataset.brand = "kimchi-house";
    syncOrderLinks();
    renderPopular("kimchi-house");
    startHeroAutoplay();
  }

  function setBrand(brand) {
    onShopBrandChange("kimchi-house");
    if (brand === "walkerhill") window.shopApi?.setCategory("premium");
    else window.shopApi?.setBrand("kimchi-house");
  }

  function setHomeCategory(catId) {
    activeHomeCategory = catId;
    refreshCategoryTabs();
  }

  function heroSlides() {
    return [...document.querySelectorAll(".shop-hero-slide")];
  }

  function syncHeroDots() {
    const slides = heroSlides();
    const multi = slides.length >= 2;
    document.querySelectorAll(".shop-hero-dot").forEach((dot, i) => {
      const hidden = i >= slides.length;
      dot.classList.toggle("hidden", hidden);
      dot.disabled = hidden;
    });
    document.querySelector(".shop-hero-dots")?.classList.toggle("hidden", !multi);
    document.querySelectorAll(".shop-hero-arrow").forEach((btn) => {
      btn.classList.toggle("hidden", !multi);
    });
  }

  function stepHero(delta) {
    const slides = heroSlides();
    if (slides.length < 2) return;
    goHero(heroIndex + delta);
  }

  function heroSlideWidth() {
    const track = document.getElementById("hero-track");
    const slider = track?.closest(".shop-hero-slider");
    return slider?.clientWidth || 0;
  }

  function heroVideoIcons() {
    return {
      mute: `<svg class="shop-hero-vicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9.5v5h3.2L12 18.5v-13l-4.8 4H4zm11.2 1.3 1.4-1.4 1.5 1.4 1.4-1.4 1.4 1.4-1.4 1.5 1.4 1.4-1.4 1.4-1.4-1.4-1.5 1.4-1.4-1.4 1.4-1.4-1.4-1.5z"/></svg>`,
      sound: `<svg class="shop-hero-vicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M4 9.5v5h3.2L12 18.5v-13l-4.8 4H4zm10.7 1.1c.8.7 1.3 1.7 1.3 2.9s-.5 2.2-1.3 2.9l1.4 1.5c1.3-1.1 2.1-2.7 2.1-4.4s-.8-3.3-2.1-4.4l-1.4 1.5zm2.7-3C19.4 9 20.5 11.1 20.5 13.5s-1.1 4.5-3.1 5.9l1.4 1.5c2.6-1.8 4.2-4.5 4.2-7.4s-1.6-5.6-4.2-7.4l-1.4 1.5z"/></svg>`,
      play: `<svg class="shop-hero-vicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M8 5.8v12.4l10-6.2-10-6.2z"/></svg>`,
      pause: `<svg class="shop-hero-vicon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M7 6h3.2v12H7V6zm6.8 0H17v12h-3.2V6z"/></svg>`,
    };
  }

  function syncHeroVideoButtons() {
    const video = document.getElementById("hero-wh-video");
    const muteBtn = document.getElementById("hero-video-mute");
    const pauseBtn = document.getElementById("hero-video-pause");
    if (!video || !muteBtn || !pauseBtn) return;
    const icons = heroVideoIcons();
    const isMuted = video.muted || video.volume === 0;
    muteBtn.setAttribute("aria-pressed", isMuted ? "true" : "false");
    muteBtn.setAttribute("aria-label", isMuted ? "소리 켜기" : "음소거");
    muteBtn.title = isMuted ? "소리 켜기" : "음소거";
    muteBtn.innerHTML = isMuted ? icons.mute : icons.sound;
    const isPaused = video.paused;
    pauseBtn.setAttribute("aria-label", isPaused ? "재생" : "정지");
    pauseBtn.title = isPaused ? "재생" : "정지";
    pauseBtn.innerHTML = isPaused ? icons.play : icons.pause;
  }

  function bindHeroVideoControls() {
    const video = document.getElementById("hero-wh-video");
    const muteBtn = document.getElementById("hero-video-mute");
    const pauseBtn = document.getElementById("hero-video-pause");
    if (!video || !muteBtn || !pauseBtn || muteBtn.dataset.bound === "1") return;
    muteBtn.dataset.bound = "1";

    muteBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      video.muted = !video.muted;
      if (!video.muted && video.volume === 0) video.volume = 1;
      syncHeroVideoButtons();
    });

    pauseBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (video.paused) {
        video.play().catch(() => {});
        startHeroAutoplay();
      } else {
        video.pause();
        clearInterval(heroTimer);
      }
      syncHeroVideoButtons();
    });

    video.addEventListener("play", syncHeroVideoButtons);
    video.addEventListener("pause", syncHeroVideoButtons);
    video.addEventListener("volumechange", syncHeroVideoButtons);
    syncHeroVideoButtons();
  }

  function syncHeroVideo() {
    const slides = heroSlides();
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    slides.forEach((slide, i) => {
      const video = slide.querySelector("video.shop-hero-video");
      if (!video) return;
      if (i === heroIndex && !reduceMotion) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    });
    syncHeroVideoButtons();
  }

  function goHero(index) {
    const slides = heroSlides();
    const dots = document.querySelectorAll(".shop-hero-dot");
    const track = document.getElementById("hero-track");
    if (!slides.length || !track) return;

    heroIndex = ((index % slides.length) + slides.length) % slides.length;
    const slideWidth = heroSlideWidth();

    track.style.transform = slideWidth
      ? `translateX(-${heroIndex * slideWidth}px)`
      : "";
    dots.forEach((dot, i) => dot.classList.toggle("active", i === heroIndex));
    syncHeroDots();
    syncHeroVideo();
  }

  function startHeroAutoplay() {
    clearInterval(heroTimer);
    const active = heroSlides()[heroIndex];
    const videoOnly = active?.querySelector("#hero-wh-video");
    if (videoOnly?.paused) return;
    const bannerVideo = active?.querySelector("video.shop-hero-video:not(#hero-wh-video)");
    let delay = 5000;
    if (videoOnly) {
      const durationMs = Number.isFinite(videoOnly.duration) && videoOnly.duration > 0
        ? Math.round(videoOnly.duration * 1000)
        : 30000;
      delay = Math.max(durationMs, 12000);
    } else if (bannerVideo) {
      delay = 12000;
    }
    heroTimer = setInterval(() => {
      if (heroSlides().length < 2) return;
      goHero(heroIndex + 1);
      startHeroAutoplay();
    }, delay);
  }

  function bindHero() {
    if (!document.querySelector(".shop-hero-slider")) return;
    document.getElementById("hero-prev")?.addEventListener("click", () => {
      stepHero(-1);
      startHeroAutoplay();
    });
    document.getElementById("hero-next")?.addEventListener("click", () => {
      stepHero(1);
      startHeroAutoplay();
    });
    document.querySelectorAll(".shop-hero-dot").forEach((dot) => {
      dot.addEventListener("click", () => {
        goHero(Number(dot.dataset.index));
        startHeroAutoplay();
      });
    });

    const slider = document.querySelector(".shop-hero-slider");
    let touchStartX = 0;
    slider?.addEventListener("touchstart", (e) => {
      touchStartX = e.changedTouches[0].clientX;
    }, { passive: true });
    slider?.addEventListener("touchend", (e) => {
      const diff = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(diff) < 40) return;
      stepHero(diff < 0 ? 1 : -1);
      startHeroAutoplay();
    }, { passive: true });

    bindHeroVideoControls();
    goHero(heroIndex);
    syncHeroDots();
    startHeroAutoplay();
    window.addEventListener("resize", () => goHero(heroIndex));
  }

  function syncNavCategoryLinks() {
    /* desktop brand dropdowns are static in HTML */
  }

  function closeBrandMenus(except) {
    document.querySelectorAll(".shop-brand-menu").forEach((menu) => {
      if (except && menu === except) return;
      menu.classList.remove("open");
      const toggle = menu.querySelector(".shop-brand-tab");
      const dropdown = menu.querySelector(".shop-brand-dropdown");
      toggle?.setAttribute("aria-expanded", "false");
      if (dropdown) dropdown.hidden = true;
    });
  }

  function openBrandMenu(menu) {
    if (!menu) return;
    closeBrandMenus(menu);
    menu.classList.add("open");
    const toggle = menu.querySelector(".shop-brand-tab");
    const dropdown = menu.querySelector(".shop-brand-dropdown");
    toggle?.setAttribute("aria-expanded", "true");
    if (dropdown) dropdown.hidden = false;
  }

  function goToBrandCategory(brand, catId) {
    const category = catId || (brand === "walkerhill" ? "premium" : "all");
    window.shopApi?.setCategory(category);
    document.getElementById("shop")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function bindBrandMenus() {
    document.querySelectorAll(".shop-brand-menu").forEach((menu) => {
      const toggle = menu.querySelector(".shop-brand-tab");
      const dropdown = menu.querySelector(".shop-brand-dropdown");
      if (!toggle || !dropdown) return;

      let hoverTimer = null;
      const canHover = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;

      menu.addEventListener("mouseenter", () => {
        if (!canHover()) return;
        clearTimeout(hoverTimer);
        openBrandMenu(menu);
      });
      menu.addEventListener("mouseleave", () => {
        if (!canHover()) return;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => closeBrandMenus(), 140);
      });

      toggle.addEventListener("click", () => {
        if (canHover()) openBrandMenu(menu);
        else closeBrandMenus();
      });

      dropdown.querySelectorAll("a[data-order-cat]").forEach((link) => {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          closeBrandMenus();
          goToBrandCategory(link.dataset.brand, link.dataset.orderCat);
        });
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest(".shop-brand-menu")) closeBrandMenus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeBrandMenus();
    });
  }

  function bindMainNav() {
    bindBrandMenus();
  }

  function bindMobileNav() {
    const nav = document.getElementById("mobile-nav");
    const openBtn = document.getElementById("menu-open");
    const closeBtn = document.getElementById("menu-close");
    openBtn?.addEventListener("click", () => nav?.classList.add("open"));
    closeBtn?.addEventListener("click", () => nav?.classList.remove("open"));
    nav?.addEventListener("click", (e) => {
      if (e.target === nav) nav.classList.remove("open");
    });
    nav?.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        nav.classList.remove("open");
        if (a.dataset.orderCat) {
          e.preventDefault();
          goToBrandCategory(a.dataset.brand, a.dataset.orderCat);
        }
      });
    });
  }

  function applyShopPreorderClosed(closed) {
    document.body.classList.toggle("shop-preorder-off", closed);
    document.getElementById("shop-preorder-closed")?.classList.toggle("hidden", !closed);
    document.querySelectorAll("[data-order-link]").forEach((el) => {
      el.classList.toggle("hidden", closed);
    });
  }

  function applyPreorderState() {
    applyShopPreorderClosed(!preorderOpen);
  }

  async function fetchConfig() {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      if (data.ok) {
        preorderOpen = data.preorderOpen !== false;
        window.KHSale?.applyFromPayload?.(data);
      }
    } catch (_) {}
    applyPreorderState();
  }

  async function loadSalesAndRefresh() {
    if (window.KHSale) await window.KHSale.load();
    renderPopular(currentBrand);
  }

  const STATUS_META = {
    "예약 접수": { emoji: "🟡", cls: "received" },
    "주문 확인 완료": { emoji: "🔵", cls: "confirmed" },
    "배송 준비 중": { emoji: "🟢", cls: "preparing" },
    "배송 안내 완료": { emoji: "🟠", cls: "notified" },
    "배송 완료": { emoji: "✅", cls: "done" },
  };

  function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META["예약 접수"];
    return `<span class="lookup-status lookup-status-${meta.cls}">${meta.emoji} ${status}</span>`;
  }

  function renderLookupCard(order) {
    const address = [order.customer.address, order.customer.suburb].filter(Boolean).join(", ");
    const itemsHtml = order.items.map((item) => `<li>${item.name} × ${item.qty}</li>`).join("");
    return `<article class="lookup-card" style="padding:14px;margin-top:10px">
      <div class="lookup-status-block" style="margin-bottom:10px">
        <div class="lookup-status-label">배송 상태</div>
        ${statusBadge(order.status)}
      </div>
      <p style="font-size:14px;font-weight:700;color:var(--primary)">${order.id}</p>
      <p style="font-size:13px;color:var(--text-muted);margin:4px 0 8px">${order.orderDate} · ${order.customer.name}</p>
      <ul style="font-size:13px;color:var(--text-muted);list-style:none">${itemsHtml}</ul>
      <p style="font-size:14px;font-weight:800;margin-top:8px">$${order.total}</p>
      <div class="lookup-edit-help" style="margin-top:12px">
        <p class="lookup-edit-help-title">주문 변경·취소</p>
        <p class="lookup-edit-help-desc">주문번호 <strong>${order.id}</strong>를 알려주시면 확인해 드립니다.</p>
        <div class="lookup-edit-help-actions">
          <a class="shop-btn shop-btn-kakao shop-btn-block" href="https://pf.kakao.com/_alkDxb/chat" target="_blank" rel="noopener">카카오톡 채팅으로 문의하기</a>
        </div>
      </div>
    </article>`;
  }

  async function homeLookup() {
    const phone = document.getElementById("home-lookup-phone")?.value.trim();
    if (!phone) {
      alert("연락처를 입력해 주세요.");
      return;
    }
    const btn = document.getElementById("home-lookup-btn");
    const root = document.getElementById("home-lookup-results");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "조회 중...";
    }
    try {
      const res = await fetch("/api/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "조회 실패");
      if (!data.orders?.length) {
        root.innerHTML = `<p style="font-size:14px;color:var(--text-muted);padding:12px 0">입력하신 연락처로 접수된 주문이 없습니다.</p>`;
      } else {
        root.innerHTML = data.orders.map(renderLookupCard).join("");
      }
      root.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (err) {
      alert(err.message || "주문 조회 중 오류가 발생했습니다.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "조회하기";
      }
    }
  }

  function bindFaq() {
    const root = document.getElementById("faq");
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";

    root.querySelectorAll(".shop-faq-q").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = btn.closest(".shop-faq-item");
        const panel = item?.querySelector(".shop-faq-panel");
        if (!item || !panel) return;

        const willOpen = !item.classList.contains("is-open");
        item.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
        panel.setAttribute("aria-hidden", willOpen ? "false" : "true");
      });
    });
  }

  /* 공지 버전 바꾸면 다시 노출 (localStorage 키 변경) */
  const SITE_NOTICE_KEY = "kh-notice-dismissed:delivery-sep6-approx-2026";

  function bindSiteNotice() {
    const overlay = document.getElementById("site-notice-overlay");
    if (!overlay || overlay.dataset.bound === "1") return;
    overlay.dataset.bound = "1";

    const closeBtn = document.getElementById("site-notice-close");

    const close = () => {
      overlay.classList.remove("open");
      overlay.hidden = true;
      document.body.classList.remove("site-notice-open");
      try {
        localStorage.setItem(SITE_NOTICE_KEY, "1");
      } catch (_) {}
    };

    const open = () => {
      overlay.hidden = false;
      overlay.classList.add("open");
      document.body.classList.add("site-notice-open");
      closeBtn?.focus();
    };

    closeBtn?.addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("open")) close();
    });

    let dismissed = false;
    try {
      dismissed = localStorage.getItem(SITE_NOTICE_KEY) === "1";
    } catch (_) {}
    if (!dismissed) {
      window.setTimeout(open, 400);
    }
  }

  function init() {
    if (!window.KH_PRODUCTS) {
      console.error("KH_PRODUCTS를 불러오지 못했습니다. npm start로 서버를 실행했는지 확인해 주세요.");
      return;
    }
    const unified = document.body.classList.contains("shop-unified");
    currentBrand = document.body.dataset.brand || currentBrand;
    if (!unified) {
      refreshCategoryTabs();
    }
    renderBrowseCategories();
    bindBrowseCategories();
    syncNavCategoryLinks();
    syncOrderLinks();
    bindHero();
    bindFaq();
    bindSiteNotice();
    bindMainNav();
    bindMobileNav();
    Promise.all([fetchConfig(), loadSalesAndRefresh()]);

    if (!unified) {
      document.getElementById("home-cat-tabs")?.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-home-cat]");
        if (tab) setHomeCategory(tab.dataset.homeCat);
      });
      document.getElementById("home-cat-tabs-wh")?.addEventListener("click", (e) => {
        const tab = e.target.closest("[data-home-cat]");
        if (tab) setHomeCategory(tab.dataset.homeCat);
      });
      document.querySelectorAll(".shop-brand-tab").forEach((tab) => {
        tab.addEventListener("click", () => setBrand(tab.dataset.brand));
      });
    } else {
      window.onShopBrandChange = onShopBrandChange;
      onShopBrandChange(document.body.dataset.brand || currentBrand);
    }

    document.getElementById("home-lookup-btn")?.addEventListener("click", homeLookup);
    document.getElementById("home-lookup-phone")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") homeLookup();
    });

    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener("click", (e) => {
        const href = a.getAttribute("href");
        if (!href || href.length < 2) return;
        const hash = href.split("?")[0];
        const id = hash.slice(1);
        if (id === "hero" || id === "top") {
          e.preventDefault();
          window.scrollTo({ top: 0, behavior: "smooth" });
          history.replaceState(null, "", location.pathname + location.search);
          return;
        }
        const el = document.getElementById(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: "smooth", block: "start" });
          history.replaceState(null, "", location.pathname + location.search);
        }
      });
    });
  }

  window.initHomePage = init;
  window.applyShopPreorderClosed = applyShopPreorderClosed;
  if (!document.body.classList.contains("shop-unified")) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  }
})();
