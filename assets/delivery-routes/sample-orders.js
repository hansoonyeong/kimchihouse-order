/**
 * DEMO sample orders for Kimchi House AU delivery route planner.
 * Easy to clear via "데모 데이터 초기화".
 */
(function (global) {
  const PRODUCTS = [
    ["서울식 포기김치 7kg", 85],
    ["서울식 포기김치 3.5kg", 45],
    ["전통남도식 포기김치 7kg", 85],
    ["자연김치 3.5kg", 48],
    ["워커힐호텔 포기김치 4kg", 98],
    ["워커힐호텔 총각김치 2kg", 72],
    ["비건만두 세트", 55],
    ["통살 명태 생선까스", 42],
    ["충무김밥 파티팩", 68],
    ["진미채 200g×3", 28],
    ["청국장 120g", 12],
    ["전통 된장 1kg", 22],
    ["도시락김 72봉", 35],
    ["재첩국 500g", 18],
  ];

  const AREAS = [
    { suburb: "Hornsby", postcode: "2077", lat: -33.7045, lng: 151.0993, streets: ["Pacific Hwy", "Edgeworth David Ave", "Station St"] },
    { suburb: "Wahroonga", postcode: "2076", lat: -33.718, lng: 151.117, streets: ["Railway Ave", "Coonanbarra Rd"] },
    { suburb: "Chatswood", postcode: "2067", lat: -33.7969, lng: 151.1832, streets: ["Victoria Ave", "Help St", "Anderson St"] },
    { suburb: "Willoughby", postcode: "2068", lat: -33.807, lng: 151.2, streets: ["Penshurst St", "Mowbray Rd"] },
    { suburb: "Ryde", postcode: "2112", lat: -33.8148, lng: 151.1017, streets: ["Blaxland Rd", "Church St", "Victoria Rd"] },
    { suburb: "Eastwood", postcode: "2122", lat: -33.79, lng: 151.082, streets: ["Rowe St", "First Ave"] },
    { suburb: "Macquarie Park", postcode: "2113", lat: -33.777, lng: 151.1248, streets: ["Waterloo Rd", "Talavera Rd"] },
    { suburb: "Rhodes", postcode: "2138", lat: -33.8292, lng: 151.0864, streets: ["Walker St", "Shoreline Dr", "Mary St"] },
    { suburb: "Strathfield", postcode: "2135", lat: -33.8773, lng: 151.0839, streets: ["The Boulevarde", "Albert Rd"] },
    { suburb: "Burwood", postcode: "2134", lat: -33.8771, lng: 151.1038, streets: ["Burwood Rd", "Railway Pde"] },
    { suburb: "Parramatta", postcode: "2150", lat: -33.8151, lng: 151.0011, streets: ["Church St", "George St", "Macquarie St"] },
    { suburb: "Bankstown", postcode: "2200", lat: -33.9173, lng: 151.0344, streets: ["Restwell St", "Chapel Rd"] },
    { suburb: "Blacktown", postcode: "2148", lat: -33.7689, lng: 150.9054, streets: ["Main St", "Flushcombe Rd"] },
    { suburb: "Sydney", postcode: "2000", lat: -33.8688, lng: 151.2093, streets: ["George St", "Kent St", "Sussex St"] },
    { suburb: "Surry Hills", postcode: "2010", lat: -33.883, lng: 151.214, streets: ["Crown St", "Foveaux St"] },
    { suburb: "Bondi", postcode: "2026", lat: -33.8915, lng: 151.2767, streets: ["Campbell Pde", "Hall St"] },
    { suburb: "Randwick", postcode: "2031", lat: -33.913, lng: 151.241, streets: ["Belmore Rd", "Alison Rd"] },
    { suburb: "Sutherland", postcode: "2232", lat: -34.0312, lng: 151.0999, streets: ["Flora St", "Eton St"] },
    { suburb: "Caringbah", postcode: "2229", lat: -34.043, lng: 151.122, streets: ["President Ave", "Port Hacking Rd"] },
    { suburb: "Epping", postcode: "2121", lat: -33.772, lng: 151.082, streets: ["Beecroft Rd", "Rawson St"] },
  ];

  const NAMES = [
    "김민지", "이서연", "박지훈", "최수아", "정하늘", "한예진", "오준서", "윤서아",
    "강민호", "조예린", "신동욱", "임수빈", "배지안", "송하은", "권도윤", "황서준",
    "문채원", "류지아", "안현우", "유나영", "서진우", "노은서", "홍다은", "구태양",
    "차소희", "표성민", "석지우", "방예나", "심재혁", "하윤아", "도현석", "나경민",
    "Jane Kim", "Tom Lee", "Sarah Park", "Chris Han", "Amy Choi", "David Jung",
    "Grace Oh", "Kevin Yoon", "Lisa Kang", "James Cho", "Rachel Shin", "Daniel Lim",
  ];

  const NOTES = [
    "",
    "Gate code 1234",
    "Leave at front door if unavailable",
    "아파트 로비에 맡겨 주세요",
    "Please call on arrival",
    "개 있음 — 벨 누르지 마세요",
    "Unit intercom: 12",
    "주차는 방문 주차 이용",
    "",
    "",
  ];

  function phone(i) {
    const n = 400000000 + ((i * 7919) % 99999999);
    const s = String(n).padStart(9, "0");
    return `04${s.slice(0, 2)} ${s.slice(2, 5)} ${s.slice(5, 8)}`;
  }

  function pickProducts(i) {
    const count = 1 + (i % 3);
    const lines = [];
    let total = 0;
    let boxes = 0;
    for (let k = 0; k < count; k++) {
      const [name, price] = PRODUCTS[(i + k * 3) % PRODUCTS.length];
      const qty = 1 + ((i + k) % 2);
      lines.push(`${name} × ${qty}`);
      total += price * qty;
      boxes += qty;
    }
    return { summary: lines.join("\n"), total, boxes };
  }

  function buildSampleOrders(count = 64) {
    const orders = [];
    for (let i = 0; i < count; i++) {
      const area = AREAS[i % AREAS.length];
      const street = area.streets[i % area.streets.length];
      const num = 10 + ((i * 7) % 180);
      const { summary, total, boxes } = pickProducts(i);
      const jLat = ((i % 9) - 4) * 0.002;
      const jLng = ((i % 7) - 3) * 0.0025;
      orders.push({
        id: `DEMO-${String(i + 1).padStart(3, "0")}`,
        name: NAMES[i % NAMES.length],
        phone: phone(i),
        address: `${num} ${street}`,
        suburb: area.suburb,
        postcode: area.postcode,
        orderSummary: summary,
        total,
        boxCount: boxes,
        notes: NOTES[i % NOTES.length],
        lat: area.lat + jLat,
        lng: area.lng + jLng,
        isDemo: true,
        status: "ok",
        reviewReason: null,
        // Future fields
        etaStart: null,
        etaEnd: null,
        actualDeliveredAt: null,
        smsStatus: "none",
        lastSmsAt: null,
        etaSmsStatus: "none",
      });
    }

    // Intentional Needs Review cases
    orders.push({
      id: "DEMO-NR-01",
      name: "주소누락고객",
      phone: "0411 000 001",
      address: "",
      suburb: "Chatswood",
      postcode: "2067",
      orderSummary: "서울식 포기김치 7kg × 1",
      total: 85,
      boxCount: 1,
      notes: "",
      lat: null,
      lng: null,
      isDemo: true,
      status: "needs_review",
      reviewReason: "배송주소 누락",
      etaStart: null,
      etaEnd: null,
      actualDeliveredAt: null,
      smsStatus: "none",
      lastSmsAt: null,
      etaSmsStatus: "none",
    });
    orders.push({
      id: "DEMO-NR-02",
      name: "우편번호없음",
      phone: "0411 000 002",
      address: "Somewhere Street",
      suburb: "",
      postcode: "",
      orderSummary: "비건만두 세트 × 2",
      total: 110,
      boxCount: 2,
      notes: "주소 확인 필요",
      lat: null,
      lng: null,
      isDemo: true,
      status: "needs_review",
      reviewReason: "Suburb / Postcode 누락",
      etaStart: null,
      etaEnd: null,
      actualDeliveredAt: null,
      smsStatus: "none",
      lastSmsAt: null,
      etaSmsStatus: "none",
    });
    orders.push({
      id: "DEMO-NR-03",
      name: "불완전주소",
      phone: "0411 000 003",
      address: "Unit only",
      suburb: "Parramatta",
      postcode: "2150",
      orderSummary: "워커힐호텔 포기김치 4kg × 1",
      total: 98,
      boxCount: 1,
      notes: "",
      lat: null,
      lng: null,
      isDemo: true,
      status: "needs_review",
      reviewReason: "도로명 주소가 불완전합니다",
      etaStart: null,
      etaEnd: null,
      actualDeliveredAt: null,
      smsStatus: "none",
      lastSmsAt: null,
      etaSmsStatus: "none",
    });

    return orders;
  }

  /** Default Kimchi House dispatch / start point — Galston depot. */
  const DEFAULT_START = {
    label: "김치하우스 출발지",
    address: "36 Mid Dural Rd, Galston NSW 2159",
    lat: -33.649215,
    lng: 151.034199,
  };

  global.KHDeliverySample = {
    buildSampleOrders,
    DEFAULT_START,
    isDemoId: (id) => String(id || "").startsWith("DEMO-"),
  };
})(typeof window !== "undefined" ? window : globalThis);
