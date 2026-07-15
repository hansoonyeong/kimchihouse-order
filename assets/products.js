window.KH_CONFIG = {
  orderEndpoint: "/api/orders",
  orderSecret: "CHANGE_ME_ORDER_SECRET",
  freeShippingThreshold: 100,
  shippingFee: 10,
  bank: {
    bank: "ANZ",
    bsb: "012 266",
    account: "4397 12186",
    holder: "Eastern Food Line Pty Ltd",
  },
};

window.KH_PRODUCTS = {
  frozen: {
    label: "냉동 반찬",
    delivery: "6/26 ~ 6/29 배송",
    sections: [
      {
        id: "mandu",
        tab: "만두",
        title: "최고급 만두 2종",
        note: "한국 파르팜 비건 인증 · 학교급식 전용",
        items: [
          {
            id: "a1",
            name: "고기만두 (1KG)",
            price: 15,
            image: "assets/images/products/a1.jpg",
            detailImages: [
              "assets/images/products/detail-mandu-meat/01.jpg",
              "assets/images/products/detail-mandu-meat/02.gif",
              "assets/images/products/detail-mandu-meat/03.jpg",
              "assets/images/products/detail-mandu-meat/04.jpg",
              "assets/images/products/detail-mandu-meat/05.gif",
              "assets/images/products/detail-mandu-meat/06.jpg",
              "assets/images/products/detail-mandu-meat/07.gif",
              "assets/images/products/detail-mandu-meat/08.jpg",
              "assets/images/products/detail-mandu-meat/09.gif",
              "assets/images/products/detail-mandu-meat/10.jpg",
              "assets/images/products/detail-mandu-meat/11.jpg",
              "assets/images/products/detail-mandu-meat/12.jpg",
              "assets/images/products/detail-mandu-meat/13.jpg",
            ],
          },
          {
            id: "a2",
            name: "김치만두 (1KG)",
            price: 15,
            image: "assets/images/products/a2.jpg",
            detailImages: [
              "assets/images/products/detail-mandu/01.jpg",
              "assets/images/products/detail-mandu/02.gif",
              "assets/images/products/detail-mandu/03.jpg",
              "assets/images/products/detail-mandu/04.jpg",
              "assets/images/products/detail-mandu/05.jpg",
              "assets/images/products/detail-mandu/06.jpg",
              "assets/images/products/detail-mandu/07.gif",
              "assets/images/products/detail-mandu/08.jpg",
              "assets/images/products/detail-mandu/09.gif",
              "assets/images/products/detail-mandu/10.jpg",
              "assets/images/products/detail-mandu/11.jpg",
              "assets/images/products/detail-mandu/12.jpg",
              "assets/images/products/detail-mandu/13.jpg",
            ],
          },
          { id: "a3", name: "[세트] 고기 1KG + 김치 1KG", price: 25, wasPrice: 30, sale: true, image: "assets/images/products/a3.jpg" },
        ],
      },
      {
        id: "kimbap",
        tab: "김밥·간편식",
        title: "충무김밥 파티 팩 (3~5인분)",
        note: "전자레인지 해동으로 간편하게",
        items: [
          { id: "a4", name: "충무김밥 세트 (김밥 20개 + 꼬들매콤 오징어무침 500g)", price: 45, image: "assets/images/products/a4.png" },
        ],
      },
      {
        id: "fish",
        tab: "생선",
        title: "완벽 손질 생선 3종",
        note: "해동 후 바로 조리 가능",
        items: [
          { id: "a5", name: "손질 가자미 (미국산 / 850g)", price: 15, image: "assets/images/products/a5.png" },
          { id: "a6", name: "손질 갈치 (오만산 / 850g)", price: 25, image: "assets/images/products/a6.png" },
          { id: "a7", name: "손질 고등어 (한국산 / 500g)", price: 15, image: "assets/images/products/a7.png" },
          { id: "a8", name: "[모듬 세트] 가자미 + 갈치 + 고등어", price: 40, wasPrice: 55, sale: true, image: "assets/images/products/a8.png" },
        ],
      },
      {
        id: "jeotgal",
        tab: "젓갈",
        title: "최고급 젓갈류",
        items: [
          { id: "a9", name: "간장게장 (650g)", tiers: [[1, 25], [3, 70], [5, 110], [10, 220]], image: "assets/images/products/a9.jpg", detailImage: "assets/images/products/detail-gejang/01.jpg" },
          { id: "a10", name: "명품 참 백명란 (500g)", tiers: [[1, 45], [2, 85], [3, 125]], image: "assets/images/products/a10.png" },
          { id: "a11", name: "최고급 낙지젓", soldOut: true, image: "assets/images/products/a11.png" },
          { id: "a12", name: "씨앗비빔 오징어젓 (500g)", price: 20, image: "assets/images/products/a12.png" },
        ],
      },
      {
        id: "namul",
        tab: "나물·반찬",
        title: "100% 국산 나물 & 반찬",
        note: "급속 냉동으로 풍미 유지",
        items: [
          { id: "a13", name: "맛 취나물 (500g)", soldOut: true, image: "assets/images/products/a13.png" },
          { id: "a14", name: "애호박꼬지 나물 (500g)", price: 25, image: "assets/images/products/a14.png" },
          { id: "a15", name: "맛도라지 나물 (500g)", price: 23, image: "assets/images/products/a15.png" },
          { id: "a16", name: "맛된장 시래기볶음 (500g)", price: 18, image: "assets/images/products/a16.png" },
          { id: "a17", name: "깻잎 들기름볶음 (500g)", price: 20, image: "assets/images/products/a17.png" },
          { id: "a18", name: "매콤 진미채 볶음 (500g)", price: 30, image: "assets/images/products/a18.png" },
        ],
      },
    ],
  },
  kimchi: {
    label: "김치·장류",
    delivery: "7/5일부터 배송 시작",
    sections: [
      {
        id: "pogi",
        tab: "포기김치",
        title: "새벽 3차 포기김치 3종",
        items: [
          { id: "b1", name: "서울식 포기김치", variants: [{ key: "7kg", label: "7Kg", price: 85 }, { key: "3.5kg", label: "3.5Kg", price: 45 }], image: "assets/images/products/b1.png" },
          { id: "b2", name: "전통 남도식 포기김치", variants: [{ key: "7kg", label: "7Kg", price: 85 }, { key: "3.5kg", label: "3.5Kg", price: 45 }], image: "assets/images/products/b2.png" },
          { id: "b3", name: "무설탕·무조미료 자연 김치", variants: [{ key: "7kg", label: "7Kg", price: 85 }, { key: "3.5kg", label: "3.5Kg", price: 45 }], image: "assets/images/products/b3.png" },
        ],
      },
      {
        id: "special",
        tab: "특수김치",
        title: "특수 김치 (1KG)",
        note: "총각김치 30% 빅세일 · 열무·갓김치 합산 할인 · 쪽파김치 별도",
        items: [
          { id: "b4", name: "총각김치 (1KG)", tiers: [[1, 19], [2, 33], [3, 47]], wasTiers: [[1, 27], [2, 49], [3, 71]], sale: true, saleLabel: "30% 빅세일", saleNote: "이번 회차 한정 · 정가 $27 → 세일 $19", image: "assets/images/products/b4.png" },
          { id: "b5", name: "열무김치 (1KG)", group: "special", desc: "열무 합산 할인 · 1개 $27", image: "assets/images/products/b5.png" },
          { id: "b6", name: "쪽파김치 (1KG)", group: "pa", desc: "쪽파김치 별도 가격 · 1개 $33", image: "assets/images/products/b6.png" },
          { id: "b7", name: "돌산 갓김치 (1KG)", group: "special", desc: "갓김치 합산 할인 · 1개 $27", image: "assets/images/products/b7.png" },
        ],
      },
      {
        id: "jang",
        tab: "장류·한국식품",
        title: "장류·한국식품",
        items: [
          { id: "b11", name: "항아골 생청국장 (120g)", tiers: [[4, 25], [8, 45]], image: "assets/images/products/b11.png?v=2", detailImage: "assets/images/products/detail-cheonggukjang/01.jpg" },
          { id: "b12", name: "순정원 전통된장 (1Kg)", price: 38, image: "assets/images/products/b12.png?v=3" },
          { id: "b13", name: "순정원 전통고추장 (1Kg)", price: 38, image: "assets/images/products/b13.png?v=3" },
          { id: "b14", name: "순정원 쌈장 (1Kg)", price: 25, wasPrice: 38, sale: true, image: "assets/images/products/b14.png?v=3" },
          { id: "b8", name: "올리브유 도시락김 — 대용량 (72봉)", price: 33, image: "assets/images/products/b8.png" },
          { id: "b9", name: "올리브유 도시락김 — 실속형 (36봉)", price: 18, image: "assets/images/products/b9.png" },
          { id: "b10", name: "조미 진미채 (200g × 3봉)", price: 40, image: "assets/images/products/b10.jpg", detailImage: "assets/images/products/detail-jinmichae/01.jpg" },
        ],
      },
    ],
  },
  walkerhill: {
    label: "워커힐 호텔 김치",
    delivery: "7/5일부터 배송",
    sections: [
      {
        id: "pogi",
        tab: "배추김치",
        title: "워커힐 호텔 배추김치",
        note: "1963년부터 이어온 프리미엄 호텔 김치 · 100% 국내산",
        items: [
          {
            id: "w1",
            name: "워커힐 호텔 배추김치 (4KG)",
            price: 75,
            image: "assets/images/walkerhill/pogi.jpg",
            detailImage: "assets/images/walkerhill/detail-pogi.jpg",
          },
        ],
      },
      {
        id: "chonggak",
        tab: "총각김치",
        title: "워커힐 호텔 총각김치",
        items: [
          {
            id: "w2",
            name: "워커힐 호텔 총각김치 (2KG)",
            price: 60,
            image: "assets/images/walkerhill/chonggak.png",
            detailImage: "assets/images/walkerhill/detail-chonggak.jpg",
          },
        ],
      },
      {
        id: "sets",
        tab: "세트",
        title: "세트 상품",
        note: "세트 구매 시 무료배송 + 추가할인",
        items: [
          { id: "w_set2a", tier: "set2", name: "2 SET ①", desc: "배추김치 2개", price: 145, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set2b", tier: "set2", name: "2 SET ②", desc: "배추김치 1개 + 총각김치 1개", price: 130, featured: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set2c", tier: "set2", name: "2 SET ③", desc: "총각김치 2개", price: 115, image: "assets/images/walkerhill/chonggak.png" },
          { id: "w_set3a", tier: "set3", name: "3 SET ①", desc: "배추김치 3개", price: 203, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set3b", tier: "set3", name: "3 SET ②", desc: "배추김치 2개 + 총각김치 1개", price: 189, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set3c", tier: "set3", name: "3 SET ③", desc: "배추김치 1개 + 총각김치 2개", price: 176, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set3d", tier: "set3", name: "3 SET ④", desc: "총각김치 3개", price: 162, image: "assets/images/walkerhill/chonggak.png" },
          { id: "w_set5a", tier: "set5", name: "5 SET ①", desc: "배추김치 5개", price: 319, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set5b", tier: "set5", name: "5 SET ②", desc: "배추김치 3개 + 총각김치 2개", price: 293, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set5c", tier: "set5", name: "5 SET ③", desc: "배추김치 2개 + 총각김치 3개", price: 280, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set5d", tier: "set5", name: "5 SET ④", desc: "총각김치 5개", price: 255, image: "assets/images/walkerhill/chonggak.png" },
        ],
      },
    ],
  },
};

window.KH_SPECIAL_TIERS = [[1, 27], [2, 49], [3, 71]];
window.KH_PA_TIERS = [[1, 33], [2, 61], [3, 89]];

window.getSaleOriginalPrice = function getSaleOriginalPrice(item, tierQty) {
  if (!item || !(item.sale || item.saleLabel)) return null;

  if (tierQty != null && item.wasTiers?.length) {
    const match = item.wasTiers.find(([n]) => n === tierQty);
    if (match) return match[1];
  }

  if (item.wasPrice != null) return item.wasPrice;

  if (item.saleNote) {
    const m = item.saleNote.match(/정가\s*\$?(\d+)/);
    if (m) return Number(m[1]);
  }

  return null;
};
