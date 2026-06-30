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

  function createOrderApp(type) {
    const state = { cart: {}, payment: "transfer", sectionFilters: {} };

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

    function setQty(id, value) {
      if (value <= 0) delete state.cart[id];
      else state.cart[id] = value;
      render();
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
      return catalogTypes(type).reduce((sum, cat) => sum + subtotalFor(cat), 0);
    }

    function shippingFeeFor(cat) {
      const sub = subtotalFor(cat);
      if (sub === 0) return 0;
      return sub >= cfg.freeShippingThreshold ? 0 : cfg.shippingFee;
    }

    function shippingFee() {
      return catalogTypes(type).reduce((sum, cat) => sum + shippingFeeFor(cat), 0);
    }

    function total() {
      return subtotal() + shippingFee();
    }

    function shippingBreakdown() {
      const breakdown = {};
      for (const cat of catalogTypes(type)) {
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

        lines.push({ name: item.name, qty: count, price: itemPrice(item), category: cat });
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
      return catalogTypes(type).flatMap((cat) => buildLineItemsFor(cat));
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
        let price = barPriceFor(item);

        lines.push({ id: item.id, name, qty: count, price, category: cat });
      }
      return lines;
    }

    function buildBarLines() {
      return catalogTypes(type).flatMap((cat) => buildBarLinesFor(cat));
    }

    function tierLayoutClass(count) {
      if (count === 3) return "tier-cols-3";
      if (count === 4) return "tier-cols-2";
      if (count >= 5) return "tier-cols-3";
      if (count === 2) return "tier-cols-2";
      return "";
    }

    function wrapTierTags(tagHtml, count) {
      const layout = tierLayoutClass(count);
      return `<div class="tier-tags${layout ? ` ${layout}` : ""}">${tagHtml}</div>`;
    }

    function sectionGridClass(count) {
      if (count === 1) return "product-grid cols-1";
      if (count === 2) return "product-grid cols-2";
      if (count === 3) return "product-grid cols-3";
      if (count === 4) return "product-grid cols-2";
      return "product-grid cols-3";
    }

    function renderSection(section) {
      const count = section.items.length;
      return `<h3 class="section-title">${section.title}</h3>${sectionNoteHtml(section)}<div class="${sectionGridClass(count)}" data-count="${count}">${section.items.map(renderProduct).join("")}</div>`;
    }

    function renderProduct(item) {
      const thumb = item.image
        ? `<img class="product-thumb" src="${item.image}" alt="" loading="lazy" />`
        : "";

      if (item.soldOut) {
        return `<div class="product-card sold-out">${thumb}<div class="product-card-body"><div class="product-name">${item.name}<span class="badge soldout">품절</span></div></div></div>`;
      }

      const count = qty(item.id);
      let extra = "";
      if (item.tiers) {
        const tierClass = item.saleLabel ? "tier-tag sale-tier" : "tier-tag";
        const tags = item.tiers.map(([n, p]) => {
          const orig = item.id === "b4" && n === 1 ? ` <s>$27</s>` : "";
          return `<span class="${tierClass}">${n}개 ${money(p)}${orig}</span>`;
        });
        extra = wrapTierTags(tags.join(""), tags.length);
      } else if (item.group === "special") {
        const tags = [
          '<span class="tier-tag">1개 $27</span>',
          '<span class="tier-tag">2개 $49</span>',
          '<span class="tier-tag">3개 $71</span>',
        ];
        extra = wrapTierTags(tags.join(""), tags.length);
      } else if (item.group === "pa") {
        const tags = [
          '<span class="tier-tag">1개 $33</span>',
          '<span class="tier-tag">2개 $61</span>',
          '<span class="tier-tag">3개 $89</span>',
        ];
        extra = wrapTierTags(tags.join(""), tags.length);
      } else if (item.variants) {
        extra = `<div class="variant-rows">${item.variants
          .map((v) => {
            const key = `${item.id}:${v.key}`;
            const vQty = qty(key);
            return `<div class="variant-row">
              <span class="variant-label">${v.label} <strong>${money(v.price)}</strong></span>
              <div class="qty-step">
                <button type="button" data-dec="${key}" ${vQty <= 0 ? "disabled" : ""}>−</button>
                <span>${vQty}</span>
                <button type="button" data-inc="${key}">+</button>
              </div>
            </div>`;
          })
          .join("")}</div>`;
      }

      const sale = item.sale
        ? `<span class="badge sale${item.saleLabel ? " big-sale" : ""}">${item.saleLabel || "할인"}</span>`
        : "";
      const callout = item.saleNote ? `<div class="sale-callout">${item.saleNote}</div>` : "";
      const price = item.price ? `<div class="price-text">${money(item.price)}</div>` : "";
      const rowClass = item.saleLabel ? "product-card sale-featured" : "product-card";
      const qtyControl = item.variants
        ? ""
        : `<div class="qty-step">
            <button type="button" data-dec="${item.id}" ${count <= 0 ? "disabled" : ""}>−</button>
            <span>${count}</span>
            <button type="button" data-inc="${item.id}">+</button>
          </div>`;

      return `<div class="${rowClass}">
        ${thumb}
        <div class="product-card-body">
          <div class="product-name">${item.name}${sale}</div>
          ${callout}
          ${extra}
          ${price}
          ${qtyControl}
        </div>
      </div>`;
    }

    function sectionNoteHtml(section) {
      if (!section.note) return "";
      const cls = section.items.some((i) => i.saleLabel) ? "section-note sale-note" : "section-note";
      return `<p class="${cls}">${section.note}</p>`;
    }

    function renderCategoryTabs(cat) {
      const sections = KH_PRODUCTS[cat].sections;
      const active = sectionFilterFor(cat);
      const allCount = sections.reduce((sum, section) => sum + section.items.length, 0);
      const tabs = [
        `<button type="button" class="catalog-tab${active === "all" ? " active" : ""}" data-cat-filter="${cat}" data-section="all">전체 <span class="tab-count">${allCount}</span></button>`,
      ];

      for (const section of sections) {
        tabs.push(
          `<button type="button" class="catalog-tab${active === section.id ? " active" : ""}" data-cat-filter="${cat}" data-section="${section.id}">${section.tab} <span class="tab-count">${section.items.length}</span></button>`
        );
      }

      return `<div class="catalog-tabs">${tabs.join("")}</div>`;
    }

    function renderCatalogBlock(cat) {
      const catalog = KH_PRODUCTS[cat];
      const sections = visibleSections(cat);
      const sectionsHtml = sections.length
        ? sections.map((section) => renderSection(section)).join("")
        : '<p class="catalog-empty">해당 카테고리에 상품이 없습니다.</p>';

      return `<div class="catalog-block">
        <div class="catalog-head">
          <h2 class="catalog-title">${catalog.label}</h2>
          <span class="catalog-delivery">${catalog.delivery}</span>
        </div>
        ${renderCategoryTabs(cat)}
        ${sectionsHtml}
      </div>`;
    }

    function renderCatalog() {
      if (type === "combined") {
        return catalogTypes(type).map((cat) => renderCatalogBlock(cat)).join("");
      }

      return renderCatalogBlock(type);
    }

    function shipLabel(fee) {
      return fee === 0 ? "무료배송" : `배송 ${money(fee)}`;
    }

    function renderBarMeta() {
      if (type !== "combined") {
        const ship = shippingFee();
        const text = `${money(subtotal())} + ${ship === 0 ? "배송비 무료" : `배송비 ${money(ship)}`}`;
        return `<span class="bar-meta-line">${text}</span>`;
      }

      const lines = catalogTypes(type)
        .map((cat) => {
          const sub = subtotalFor(cat);
          if (sub === 0) return "";
          const ship = shippingFeeFor(cat);
          return `${KH_PRODUCTS[cat].label} ${money(sub)} + ${shipLabel(ship)}`;
        })
        .filter(Boolean);

      return lines.map((line) => `<span class="bar-meta-line">${line}</span>`).join("");
    }

    function renderBarItems(lines) {
      if (type !== "combined") {
        return lines
          .map((line) => {
            const priceHtml = `<span class="bar-item-price">${money(line.price)}</span>`;
            return `<li>
              <button type="button" class="bar-remove" data-bar-remove="${line.id}" aria-label="${line.name} 빼기">×</button>
              <span class="bar-item-name">${line.name} × ${line.qty}</span>
              ${priceHtml}
            </li>`;
          })
          .join("");
      }

      return catalogTypes(type)
        .map((cat) => {
          const catLines = lines.filter((line) => line.category === cat);
          if (!catLines.length) return "";
          const header = `<li class="bar-group-title">${KH_PRODUCTS[cat].label} <span>${KH_PRODUCTS[cat].delivery}</span></li>`;
          const items = catLines
            .map((line) => {
              const priceHtml = `<span class="bar-item-price">${money(line.price)}</span>`;
              return `<li>
                <button type="button" class="bar-remove" data-bar-remove="${line.id}" aria-label="${line.name} 빼기">×</button>
                <span class="bar-item-name">${line.name} × ${line.qty}</span>
                ${priceHtml}
              </li>`;
            })
            .join("");
          return header + items;
        })
        .join("");
    }

    function render() {
      document.getElementById("product-root").innerHTML = renderCatalog();

      const lines = buildBarLines();
      const barItems = document.getElementById("bar-items");
      const barMeta = document.getElementById("bar-meta");
      const barTotal = document.getElementById("bar-total");
      const sumbar = document.getElementById("sumbar");
      const formWrap = document.getElementById("order-form-wrap");

      if (formWrap) {
        formWrap.classList.toggle("has-cart-items", lines.length > 0);
      }

      if (!lines.length) {
        barItems.innerHTML = '<li class="bar-empty">품목을 선택해 주세요</li>';
        barMeta.innerHTML = "";
        sumbar.classList.remove("has-items");
      } else {
        barItems.innerHTML = renderBarItems(lines);
        barMeta.innerHTML = renderBarMeta();
        sumbar.classList.add("has-items");
      }
      barTotal.textContent = money(total());

      const bank = cfg.bank;
      document.getElementById("bank-info").innerHTML = `
        은행 <strong>${bank.bank}</strong><br>
        BSB <strong>${bank.bsb}</strong><br>
        계좌번호 <strong>${bank.account}</strong><br>
        예금주 <strong>${bank.holder}</strong><br>
        ※ 입금자명을 <strong>주문자 성함과 동일하게</strong> 해주세요.`;
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
        type,
        customer: { name, phone, address, suburb, kakao },
        items,
        subtotal: subtotal(),
        shippingFee: shippingFee(),
        total: total(),
        payment: state.payment,
        note,
      };

      if (type === "combined") {
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

        document.getElementById("order-form-wrap").classList.add("hidden");
        document.getElementById("success-screen").classList.add("show");
        document.getElementById("order-id").textContent = data.orderId;
        document.querySelector(".sumbar").classList.add("hidden");
      } catch (err) {
        alert(err.message || "주문 접수 중 오류가 발생했습니다.");
        btn.disabled = false;
        btn.textContent = "주문 접수하기";
      }
    }

    document.getElementById("bar-items").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-bar-remove]");
      if (!btn) return;
      const id = btn.dataset.barRemove;
      setQty(id, Math.max(0, qty(id) - 1));
    });

    document.getElementById("product-root").addEventListener("click", (e) => {
      const tab = e.target.closest(".catalog-tab[data-cat-filter][data-section]");
      if (tab) {
        state.sectionFilters[tab.dataset.catFilter] = tab.dataset.section;
        render();
        return;
      }

      const inc = e.target.getAttribute("data-inc");
      const dec = e.target.getAttribute("data-dec");
      if (inc) setQty(inc, qty(inc) + 1);
      if (dec) setQty(dec, Math.max(0, qty(dec) - 1));
    });

    document.querySelectorAll(".pay-opt").forEach((el) => {
      el.addEventListener("click", () => {
        document.querySelectorAll(".pay-opt").forEach((n) => n.classList.remove("sel"));
        el.classList.add("sel");
        state.payment = el.dataset.pay;
        document.getElementById("bank-box").classList.toggle("hidden", state.payment !== "transfer");
      });
    });

    document.getElementById("submit-btn").addEventListener("click", submitOrder);
    render();
  }

  window.initOrderPage = createOrderApp;
})();
