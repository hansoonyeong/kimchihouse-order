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
    label: "냉동·수산",
    delivery: "8월 23일경 배송 예정 (해운 사정에 따라 변동 가능)",
    sections: [
      {
        id: "mandu",
        tab: "냉동·간편식",
        title: "냉동·간편식",
        items: [
          {
            id: "a1",
            name: "비건고기만두 (1KG)",
            price: 15,
            vegan: true,
            saleStatus: "hidden",
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
            saleStatus: "hidden",
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
          {
            id: "a3",
            name: "만두세트 (비건고기 1KG + 김치 1KG)",
            price: 25,
            wasPrice: 30,
            sale: true,
            image: "assets/images/products/a3.jpg",
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
          {
            id: "a4",
            name: "충무김밥 세트 (김밥 20개 + 꼬들매콤 오징어무침 500g)",
            price: 45,
            image: "assets/images/products/a4.png",
          },
          {
            id: "extra-jaecheop",
            name: "재첩국 500g (2인분)",
            price: 12,
            isNew: true,
            tiers: [
              [1, 12],
              [2, 20],
              [3, 30],
              [5, 50],
            ],
            image: "assets/images/products/jaecheop.jpg",
            detailImages: [
              "assets/images/products/detail-jaecheop/01.jpg",
              "assets/images/products/detail-jaecheop/02.jpg",
              "assets/images/products/detail-jaecheop/03.jpg",
              "assets/images/products/detail-jaecheop/04.jpg",
              "assets/images/products/detail-jaecheop/05.jpg",
            ],
          },
          {
            id: "extra-myeongtaecho",
            name: "명태커틀렛 (1.2kg / 60g×20)",
            price: 30,
            isNew: true,
            image: "assets/images/products/myeongtae-cutlet.jpg",
            detailImages: [
              "assets/images/products/detail-myeongtae/01.jpg",
              "assets/images/products/detail-myeongtae/02.jpg",
              "assets/images/products/detail-myeongtae/03.jpg",
              "assets/images/products/detail-myeongtae/04.jpg",
              "assets/images/products/detail-myeongtae/05.jpg",
            ],
          },
        ],
      },
      {
        id: "kimbap",
        tab: "김밥·간편식",
        title: "김밥·간편식",
        items: [],
      },
      {
        id: "fish",
        tab: "생선",
        title: "손질 생선",
        items: [
          { id: "a5", name: "손질 가자미 (미국산 / 850g)", price: 15, image: "assets/images/products/a5.png" },
          { id: "a6", name: "손질 갈치 (오만산 / 850g)", price: 25, image: "assets/images/products/a6.png" },
          { id: "a7", name: "손질 고등어 (한국산 / 500g)", price: 15, image: "assets/images/products/a7.png" },
          { id: "a8", name: "[모듬 세트] 가자미 + 갈치 + 고등어", price: 40, wasPrice: 55, sale: true, image: "assets/images/products/a8.png" },
        ],
      },
      {
        id: "jeotgal",
        tab: "프리미엄 수산·반찬",
        title: "프리미엄 수산·반찬",
        items: [
          {
            id: "a9",
            name: "간장게장 (650g)",
            price: 25,
            tiers: [
              [1, 25],
              [3, 70],
              [5, 110],
              [10, 220],
            ],
            image: "assets/images/products/a9.jpg",
            detailImage: "assets/images/products/detail-gejang/01.jpg",
          },
          {
            id: "a10",
            name: "최고급 명품 참 백명란 (500g)",
            price: 45,
            tiers: [
              [1, 45],
              [2, 85],
              [3, 125],
            ],
            image: "assets/images/products/a10.png",
            detailImages: [
              "assets/images/products/detail-baekmyeongran/01.jpg",
              "assets/images/products/detail-baekmyeongran/02.jpg",
              "assets/images/products/detail-baekmyeongran/03.jpg",
              "assets/images/products/detail-baekmyeongran/04.jpg",
              "assets/images/products/detail-baekmyeongran/05.jpg",
              "assets/images/products/detail-baekmyeongran/06.jpg",
              "assets/images/products/detail-baekmyeongran/07.jpg",
              "assets/images/products/detail-baekmyeongran/08.jpg",
              "assets/images/products/detail-baekmyeongran/09.jpg",
              "assets/images/products/detail-baekmyeongran/10.jpg",
              "assets/images/products/detail-baekmyeongran/11.jpg",
              "assets/images/products/detail-baekmyeongran/12.jpg",
            ],
          },
          {
            id: "b10",
            name: "진미채 (200g × 3봉)",
            price: 40,
            image: "assets/images/products/b10.jpg",
            detailImage: "assets/images/products/detail-jinmichae/01.jpg",
          },
          { id: "a11", name: "최고급 낙지젓", soldOut: true, image: "assets/images/products/a11.png" },
          { id: "a12", name: "씨앗비빔 오징어젓 (500g)", price: 20, image: "assets/images/products/a12.png" },
        ],
      },
      {
        id: "namul",
        tab: "나물·반찬",
        title: "나물·반찬",
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
    delivery: "8월 23일경 배송 예정 (해운 사정에 따라 변동 가능)",
    sections: [
      {
        id: "pogi",
        tab: "포기김치",
        title: "포기김치",
        items: [
          {
            id: "b1",
            name: "서울식 포기김치",
            variants: [
              { key: "7kg", label: "7kg", price: 85 },
              { key: "3.5kg", label: "3.5kg", price: 45 },
            ],
            image: "assets/images/products/b2.jpg",
          },
          {
            id: "b2",
            name: "전통남도식 포기김치",
            variants: [
              { key: "7kg", label: "7kg", price: 85 },
              { key: "3.5kg", label: "3.5kg", price: 45 },
            ],
            image: "assets/images/products/pogi-thumb.gif",
          },
          {
            id: "b3",
            name: "무설탕 무조미료 자연 포기김치",
            variants: [
              { key: "7kg", label: "7kg", price: 85 },
              { key: "3.5kg", label: "3.5kg", price: 45 },
            ],
            image: "assets/images/products/b3.png",
          },
        ],
      },
      {
        id: "special",
        tab: "별미김치",
        title: "별미김치 (1KG)",
        items: [
          {
            id: "b4",
            name: "총각김치 (1KG)",
            price: 27,
            tiers: [
              [1, 27],
              [2, 49],
              [3, 71],
            ],
            image: "assets/images/products/b4.jpg",
          },
          {
            id: "b5",
            name: "열무김치 (1KG)",
            price: 27,
            tiers: [
              [1, 27],
              [2, 49],
              [3, 71],
            ],
            image: "assets/images/products/b5.jpg",
          },
          {
            id: "b6",
            name: "쪽파김치 (1KG)",
            price: 33,
            tiers: [
              [1, 33],
              [2, 61],
              [3, 89],
            ],
            image: "assets/images/products/b6.jpg",
          },
          {
            id: "b7",
            name: "돌산 갓김치 (1KG)",
            price: 29,
            tiers: [
              [1, 29],
              [2, 53],
              [3, 77],
            ],
            image: "assets/images/products/b7.png",
          },
        ],
      },
      {
        id: "jang",
        tab: "전통 장류·김",
        title: "전통 장류·김",
        items: [
          {
            id: "b11",
            name: "항아골 생청국장 (120g)",
            price: 25,
            packOnly: true,
            tiers: [
              [4, 25],
              [8, 45],
            ],
            image: "assets/images/products/b11.png?v=2",
            detailImage: "assets/images/products/detail-cheonggukjang/01.jpg",
          },
          {
            id: "b12",
            name: "순정원 전통된장 (1Kg)",
            price: 38,
            image: "assets/images/products/b12.jpg",
            detailImages: [
              "assets/images/products/detail-doenjang/01.jpg",
              "assets/images/products/detail-doenjang/02.jpg",
              "assets/images/products/detail-doenjang/03.jpg",
            ],
          },
          {
            id: "b8",
            name: "올리브유 도시락김 (72봉)",
            price: 33,
            image: "assets/images/products/b8.png",
          },
          {
            id: "b13",
            name: "순정원 전통고추장 (1Kg)",
            price: 38,
            image: "assets/images/products/b13.jpg",
            detailImages: [
              "assets/images/products/detail-gochujang/01.jpg",
              "assets/images/products/detail-gochujang/02.jpg",
              "assets/images/products/detail-gochujang/03.jpg",
            ],
          },
          {
            id: "b14",
            name: "순정원 쌈장 (1Kg)",
            price: 25,
            wasPrice: 38,
            sale: true,
            image: "assets/images/products/b14.jpg",
            detailImages: [
              "assets/images/products/detail-ssamjang/01.jpg",
              "assets/images/products/detail-ssamjang/02.jpg",
            ],
          },
          { id: "b9", name: "올리브유 도시락김 — 실속형 (36봉)", price: 18, image: "assets/images/products/b9.png" },
        ],
      },
    ],
  },
  walkerhill: {
    label: "워커힐 프리미엄",
    delivery: "8월 23일경 배송 예정 (해운 사정에 따라 변동 가능)",
    sections: [
      {
        id: "pogi",
        tab: "포기김치",
        title: "워커힐 포기김치",
        note: "Premium Line · 1963년부터 이어온 호텔 김치",
        items: [
          {
            id: "w1",
            name: "워커힐 포기김치 4kg",
            price: 70,
            featured: true,
            premium: true,
            image: "assets/images/walkerhill/pogi.jpg",
            detailImage: "assets/images/walkerhill/detail-pogi.jpg",
          },
        ],
      },
      {
        id: "chonggak",
        tab: "총각김치",
        title: "워커힐 총각김치",
        items: [
          {
            id: "w2",
            name: "워커힐 총각김치 2kg",
            price: 55,
            premium: true,
            image: "assets/images/walkerhill/chonggak.png",
            detailImage: "assets/images/walkerhill/detail-chonggak.jpg",
          },
        ],
      },
      {
        id: "sets",
        tab: "세트",
        title: "워커힐 Premium Set",
        note: "세트 구매 시 무료배송 + 추가할인",
        items: [
          { id: "w_set2a", tier: "set2", name: "2 SET ①", desc: "배추김치 2개", price: 135, premium: true, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set2b", tier: "set2", name: "2 SET ②", desc: "배추김치 1개 + 총각김치 1개", price: 120, featured: true, premium: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set2c", tier: "set2", name: "2 SET ③", desc: "총각김치 2개", price: 105, premium: true, image: "assets/images/walkerhill/chonggak.png" },
          { id: "w_set3a", tier: "set3", name: "3 SET ①", desc: "배추김치 3개", price: 200, premium: true, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set3b", tier: "set3", name: "3 SET ②", desc: "배추김치 2개 + 총각김치 1개", price: 185, premium: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set3c", tier: "set3", name: "3 SET ③", desc: "배추김치 1개 + 총각김치 2개", price: 170, premium: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set3d", tier: "set3", name: "3 SET ④", desc: "총각김치 3개", price: 155, premium: true, image: "assets/images/walkerhill/chonggak.png" },
          { id: "w_set5a", tier: "set5", name: "5 SET ①", desc: "배추김치 5개", price: 335, premium: true, image: "assets/images/walkerhill/pogi.jpg" },
          { id: "w_set5b", tier: "set5", name: "5 SET ②", desc: "배추김치 3개 + 총각김치 2개", price: 305, premium: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set5c", tier: "set5", name: "5 SET ③", desc: "배추김치 2개 + 총각김치 3개", price: 290, premium: true, image: "assets/images/walkerhill/set.jpg" },
          { id: "w_set5d", tier: "set5", name: "5 SET ④", desc: "총각김치 5개", price: 260, premium: true, image: "assets/images/walkerhill/chonggak.png" },
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
