(function () {
  const API = "/api/lookup";

  const STATUS_META = {
    "예약 접수": { emoji: "🟡", cls: "received" },
    "주문 확인 완료": { emoji: "🔵", cls: "confirmed" },
    "배송 준비 중": { emoji: "🟢", cls: "preparing" },
    "배송 안내 완료": { emoji: "🟠", cls: "notified" },
    "배송 완료": { emoji: "✅", cls: "done" },
  };

  function money(n) {
    return "$" + Number(n || 0).toFixed(0);
  }

  function statusBadge(status) {
    const meta = STATUS_META[status] || STATUS_META["예약 접수"];
    return `<span class="lookup-status lookup-status-${meta.cls}">${meta.emoji} ${status}</span>`;
  }

  function renderOrderCard(order) {
    const address = [order.customer.address, order.customer.suburb].filter(Boolean).join(", ");
    const itemsHtml = order.items
      .map((item) => `<li>${item.name} × ${item.qty} — ${money(item.price)}</li>`)
      .join("");

    return `<article class="lookup-card">
      <div class="lookup-card-head">
        <div>
          <div class="lookup-order-id">${order.id}</div>
          <div class="lookup-order-date">주문일 ${order.orderDate}</div>
        </div>
      </div>
      <div class="lookup-status-block">
        <div class="lookup-status-label">배송 상태</div>
        ${statusBadge(order.status)}
      </div>
      <dl class="lookup-details">
        <div class="lookup-row"><dt>주문자</dt><dd>${order.customer.name}</dd></div>
        <div class="lookup-row"><dt>연락처</dt><dd>${order.customer.phone}</dd></div>
        <div class="lookup-row"><dt>배송 주소</dt><dd>${address}</dd></div>
        <div class="lookup-row"><dt>결제 방법</dt><dd>${order.paymentLabel}</dd></div>
      </dl>
      <div class="lookup-items">
        <div class="lookup-items-title">주문 상품</div>
        <ul>${itemsHtml}</ul>
      </div>
      <div class="lookup-total">총 주문금액 <strong>${money(order.total)}</strong></div>
    </article>`;
  }

  function renderResults(orders) {
    const sec = document.getElementById("lookup-results-sec");
    const root = document.getElementById("lookup-results");
    sec.classList.remove("hidden");

    if (!orders.length) {
      root.innerHTML = `<p class="lookup-empty">입력하신 연락처로 접수된 주문이 없습니다.</p>`;
      return;
    }

    root.innerHTML = orders.map(renderOrderCard).join("");
  }

  async function lookupOrders() {
    const phone = document.getElementById("lookup-phone").value.trim();
    if (!phone) {
      alert("연락처를 입력해 주세요.");
      return;
    }

    const btn = document.getElementById("lookup-btn");
    btn.disabled = true;
    btn.textContent = "조회 중...";

    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "조회에 실패했습니다.");

      renderResults(data.orders || []);
      document.getElementById("lookup-results-sec").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert(err.message || "주문 조회 중 오류가 발생했습니다.");
    } finally {
      btn.disabled = false;
      btn.textContent = "주문 조회";
    }
  }

  document.getElementById("lookup-btn").addEventListener("click", lookupOrders);
  document.getElementById("lookup-phone").addEventListener("keydown", (e) => {
    if (e.key === "Enter") lookupOrders();
  });
})();
