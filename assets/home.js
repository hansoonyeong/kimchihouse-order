(function () {
  const BRANDS = {
    "kimchi-house": { label: "김치하우스", heroIndex: 0 },
    walkerhill: { label: "워커힐 호텔 김치", heroIndex: 1 },
  };

  const WALKERHILL_SET_IDS = [
    "w_set2a", "w_set2b", "w_set2c",
    "w_set3a", "w_set3b", "w_set3c", "w_set3d",
    "w_set5a", "w_set5b", "w_set5c", "w_set5d",
  ];
  const WALKERHILL_ITEM_IDS = new Set(["w1", "w2", ...WALKERHILL_SET_IDS]);
  const POPULAR_IDS = ["b4", "b1", "a4", "b8", "a9", "b12", "a3", "b6"];
  const WALKERHILL_POPULAR_IDS = ["w1", "w2", "w_set2b", "w_set3a", "w_set5a", "w_set3b", "w_set5b", "w_set2a"];

  const CATEGORIES = {
    "kimchi-house": [
      { id: "all", label: "전체", href: "order.html" },
      { id: "pogi", label: "새벽김치", image: "assets/images/products/b1.png", href: "order.html", itemIds: ["b1", "b2", "b3"] },
      { id: "special", label: "별미김치", image: "assets/images/products/b4.png", href: "order.html", itemIds: ["b4", "b5", "b6", "b7"] },
      { id: "frozen", label: "반찬", image: "assets/images/products/a14.png", href: "order.html", itemIds: ["a1","a2","a3","a4","a5","a6","a7","a8","a14","a15","a16","a17","a18"] },
      { id: "jeotgal", label: "젓갈", image: "assets/images/products/a9.png", href: "order.html", itemIds: ["a9","a10","a12"] },
      { id: "jang", label: "장류", image: "assets/images/products/b12.png", href: "order.html", itemIds: ["b11","b12","b13","b14"] },
      { id: "event", label: "이벤트", image: "assets/images/products/b4.png", href: "order.html", itemIds: ["b4","b8","b9"] },
    ],
    walkerhill: [
      { id: "all", label: "전체", href: "order.html" },
      { id: "pogi", label: "배추김치", image: "assets/images/walkerhill/pogi.jpg", href: "order.html", itemIds: ["w1"] },
      { id: "chonggak", label: "총각김치", image: "assets/images/walkerhill/chonggak.png", href: "order.html", itemIds: ["w2"] },
      { id: "set", label: "세트", image: "assets/images/walkerhill/set.jpg", href: "order.html", itemIds: WALKERHILL_SET_IDS },
    ],
  };

  let currentBrand = "kimchi-house";
  let activeHomeCategory = "all";
  let heroIndex = 0;
  let heroTimer = null;
  let preorderOpen = true;

  function money(n) {
    return "$" + Number(n || 0).toFixed(0);
  }

  function lowestPrice(item) {
    if (item.soldOut) return null;
    if (item.variants?.length) return Math.min(...item.variants.map((v) => v.price));
    if (item.tiers?.length) return item.tiers[0][1];
    if (item.group === "special") return window.KH_SPECIAL_TIERS?.[0]?.[1] ?? null;
    if (item.group === "pa") return window.KH_PA_TIERS?.[0]?.[1] ?? null;
    if (item.price != null) return item.price;
    return null;
  }

  function itemDesc(item, section) {
    if (item.desc) return item.desc;
    if (item.saleNote) return item.saleNote;
    if (section.note) return section.note;
    if (item.variants?.length) return item.variants.map((v) => v.label).join(" · ");
    return section.tab || "사전예약 주문";
  }

  function itemBadge(item) {
    if (item.sale || item.saleLabel) return { cls: "sale", text: item.saleLabel || "SALE" };
    if (item.id === "b8" || item.id === "b1" || item.id === "w1") return { cls: "best", text: "BEST" };
    if (item.id === "w_set2b") return { cls: "best", text: "⭐ 인기" };
    if (item.id.startsWith("w_set")) return { cls: "premium", text: "SET" };
    if (item.id === "b2" || item.id === "b3") return { cls: "premium", text: "PREMIUM" };
    return null;
  }

  function collectProducts(brand) {
    const list = [];
    const cats = brand === "walkerhill" ? ["walkerhill"] : ["frozen", "kimchi"];

    for (const catKey of cats) {
      const cat = window.KH_PRODUCTS[catKey];
      if (!cat) continue;
      for (const section of cat.sections) {
        for (const item of section.items) {
          if (brand === "walkerhill" && !WALKERHILL_ITEM_IDS.has(item.id)) continue;
          const price = lowestPrice(item);
          if (price == null && !item.soldOut) continue;
          list.push({
            ...item,
            catKey,
            sectionId: section.id,
            sectionTab: section.tab,
            displayPrice: price,
            desc: itemDesc(item, section),
            badge: itemBadge(item),
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
      if (item && !seen.has(id)) {
        picked.push(item);
        seen.add(id);
      }
      if (picked.length >= 8) break;
    }

    if (picked.length < 4) {
      for (const item of pool) {
        if (seen.has(item.id) || item.soldOut) continue;
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
    event: "event",
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

  function buildOrderUrl({ brand = currentBrand, cat, item } = {}) {
    const params = new URLSearchParams();
    if (brand && brand !== "kimchi-house") params.set("brand", brand);
    const resolvedCat = cat || (item ? categoryForItem(brand, item) : null);
    if (resolvedCat) params.set("cat", resolvedCat);
    else if (!item) params.set("cat", "all");
    if (item) params.set("item", item);
    const qs = params.toString();
    return qs ? `?${qs}#shop` : "?cat=all#shop";
  }

  function syncOrderLinks() {
    const urlFor = (b, cat, item) => buildOrderUrl({ brand: b, cat, item });

    document.querySelectorAll(".shop-hero-slide").forEach((slide, idx) => {
      const b = idx === 1 ? "walkerhill" : "kimchi-house";
      slide.querySelectorAll("[data-order-link]").forEach((a) => {
        a.href = urlFor(b);
      });
    });

    const schedKh = document.querySelectorAll(".shop-schedule-card.brand-kimchi-house-only");
    if (schedKh[0]) schedKh[0].href = urlFor("kimchi-house", "pogi");
    if (schedKh[1]) schedKh[1].href = urlFor("kimchi-house", "banchan");

    const schedWh = document.querySelectorAll(".shop-schedule-card.brand-walkerhill-only");
    if (schedWh[0]) schedWh[0].href = urlFor("walkerhill", "pogi", "w1");
    if (schedWh[1]) schedWh[1].href = urlFor("walkerhill", "chonggak", "w2");

    document.querySelector("#popular .shop-section-more")?.setAttribute("href", urlFor(currentBrand));
    document.getElementById("popular-view-all")?.setAttribute("href", urlFor(currentBrand));
    document.querySelector("#order-steps .shop-btn-primary")?.setAttribute("href", urlFor(currentBrand));
    document.querySelector(".shop-fixed-cta .shop-btn-primary")?.setAttribute("href", urlFor(currentBrand));

    const events = document.querySelectorAll(".shop-event-card");
    if (events[0]) events[0].href = urlFor("kimchi-house", "special", "b4");
    if (events[1]) events[1].href = urlFor(currentBrand);
    if (events[2]) events[2].href = urlFor(currentBrand);

    document.querySelector('.shop-mobile-nav a[href="#shop"]')?.setAttribute("href", urlFor(currentBrand));
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
    if (item.soldOut) return `<span style="color:var(--text-muted)">품절</span>`;
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
    if (!BRANDS[brand]) return;
    currentBrand = brand;
    document.body.dataset.brand = brand;
    renderPopular(brand);
    syncOrderLinks();
    if (brand === "walkerhill") goHero(1);
    else goHero(0);
    syncHeroDots();
    startHeroAutoplay();
  }

  function setBrand(brand) {
    onShopBrandChange(brand);
    window.shopApi?.setBrand(brand);
  }

  function setHomeCategory(catId) {
    activeHomeCategory = catId;
    refreshCategoryTabs();
    renderPopular(currentBrand);
    document.getElementById("popular")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function visibleHeroSlides() {
    return [...document.querySelectorAll(".shop-hero-slide")].filter(
      (slide) => getComputedStyle(slide).display !== "none"
    );
  }

  function syncHeroDots() {
    const slides = [...document.querySelectorAll(".shop-hero-slide")];
    const visible = visibleHeroSlides();
    document.querySelectorAll(".shop-hero-dot").forEach((dot, i) => {
      const hidden = !visible.includes(slides[i]);
      dot.classList.toggle("hidden", hidden);
      dot.disabled = hidden;
    });
    const dotsWrap = document.querySelector(".shop-hero-dots");
    if (dotsWrap) dotsWrap.classList.toggle("hidden", visible.length < 2);
    document.querySelectorAll(".shop-hero-arrow").forEach((btn) => {
      btn.classList.toggle("hidden", visible.length < 2);
    });
  }

  function stepHero(delta) {
    const visible = visibleHeroSlides();
    const slides = [...document.querySelectorAll(".shop-hero-slide")];
    if (visible.length < 2) return;
    const current = visible.indexOf(slides[heroIndex]);
    const next = (current + delta + visible.length) % visible.length;
    goHero(slides.indexOf(visible[next]));
  }

  function heroSlideWidth() {
    const track = document.getElementById("hero-track");
    const slider = track?.closest(".shop-hero-slider");
    return slider?.clientWidth || 0;
  }

  function goHero(index) {
    const slides = [...document.querySelectorAll(".shop-hero-slide")];
    const dots = document.querySelectorAll(".shop-hero-dot");
    const track = document.getElementById("hero-track");
    if (!slides.length || !track) return;

    const target = slides[((index % slides.length) + slides.length) % slides.length];
    const visible = visibleHeroSlides();
    if (!visible.length) return;

    const resolved = visible.includes(target) ? target : visible[0];
    heroIndex = slides.indexOf(resolved);
    const visibleOffset = visible.indexOf(resolved);
    const slideWidth = heroSlideWidth();

    track.style.transform = slideWidth
      ? `translateX(-${visibleOffset * slideWidth}px)`
      : "";
    dots.forEach((dot, i) => dot.classList.toggle("active", i === heroIndex));
    syncHeroDots();
  }

  function startHeroAutoplay() {
    clearInterval(heroTimer);
    heroTimer = setInterval(() => {
      const visible = visibleHeroSlides();
      if (visible.length < 2) return;
      const slides = [...document.querySelectorAll(".shop-hero-slide")];
      const currentVisible = visible.indexOf(slides[heroIndex]);
      const nextVisible = (currentVisible + 1) % visible.length;
      goHero(slides.indexOf(visible[nextVisible]));
    }, 5000);
  }

  function bindHero() {
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
    goHero(heroIndex);
    syncHeroDots();
    startHeroAutoplay();
    window.addEventListener("resize", () => goHero(heroIndex));
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
      a.addEventListener("click", () => nav.classList.remove("open"));
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
      if (data.ok) preorderOpen = data.preorderOpen !== false;
    } catch (_) {}
    applyPreorderState();
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
    renderPopular(currentBrand);
    syncOrderLinks();
    bindHero();
    bindPopularSlider();
    bindMobileNav();
    fetchConfig();

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
        const el = document.getElementById(id);
        if (el) {
          e.preventDefault();
          el.scrollIntoView({ behavior: "smooth", block: "start" });
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
