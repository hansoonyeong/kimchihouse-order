export const TEMPLATE_SHEET_NAME = "새벽팜4차 - 워커힐 3차";
export const EXPORT_FILENAME = "김치하우스_8월_주문.xlsx";

export const CUSTOMER_COLUMNS = {
  region: "B",
  name: "C",
  address: "D",
  phone: "E",
  productTotal: "F",
  paidAmount: "G",
  note: "BF",
};

export const CUSTOMER_ROW_RANGES = [
  [9, 38],
  [40, 73],
  [75, 102],
  [104, 136],
  [138, 166],
  [168, 204],
  [206, 245],
  [247, 275],
  [277, 310],
  [312, 355],
  [357, 386],
  [388, 417],
  [419, 448],
  [450, 475],
  [477, 498],
  [500, 519],
];

/**
 * 온라인몰 productId/SKU → 템플릿의 보이는 상품 열.
 * 숨김 열(U, AB:AY, BB:BC, BE)은 의도적으로 포함하지 않는다.
 */
export const PRODUCT_COLUMN_MAP = {
  w1: "H",
  w2: "I",
  "b1:7kg": "J",
  "b2:7kg": "K",
  "b3:7kg": "L",
  "b1:3.5kg": "M",
  "b2:3.5kg": "N",
  "b3:3.5kg": "O",
  b4: "P",
  b5: "Q",
  b6: "R",
  b7: "S",
  a9: "T",
  a10: "V",
  a3: "W",
  a4: "X",
  "extra-jaecheop": "Y",
  b10: "Z",
  "extra-myeongtaecho": "AA",
  b11: "AZ",
  b12: "BA",
  b8: "BD",
};

/** 워커힐 세트 SKU → 실제 구성 상품 수량. */
export const BUNDLE_COMPONENT_MAP = {
  w_set2a: { w1: 2 },
  w_set2b: { w1: 1, w2: 1 },
  w_set2c: { w2: 2 },
  w_set3a: { w1: 3 },
  w_set3b: { w1: 2, w2: 1 },
  w_set3c: { w1: 1, w2: 2 },
  w_set3d: { w2: 3 },
  w_set5a: { w1: 5 },
  w_set5b: { w1: 3, w2: 2 },
  w_set5c: { w1: 2, w2: 3 },
  w_set5d: { w2: 5 },
};

/**
 * 실제 suburb 표기 → 템플릿 B열의 비표준 표기.
 * 정확히 일치하는 지역을 먼저 찾고, 없을 때만 적용한다.
 */
export const REGION_ALIAS_MAP = {
  "beacon hill": "beacon hills",
  cherrybrook: "cherrybrrok",
  "east lindfield": "east linfield",
  freshwater: "fresh water",
  glenorie: "glenori",
  greystanes: "greystaines",
  hornsby: "hornaby",
  lindfield: "linfiled",
  milperra: "milpera",
  "mount kuring gai": "mt kuring gal",
  oatlands: "oatland",
  rosebery: "roseberry",
  schofields: "schofield",
  telopea: "telopia",
  "nirimba fields": "nirimba fields schofield",
};

export const HIDDEN_PRODUCT_COLUMNS = [
  "U",
  "AB",
  "AC",
  "AD",
  "AE",
  "AF",
  "AG",
  "AH",
  "AI",
  "AJ",
  "AK",
  "AL",
  "AM",
  "AN",
  "AO",
  "AP",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AV",
  "AW",
  "AX",
  "AY",
  "BB",
  "BC",
  "BE",
];
