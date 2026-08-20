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

/**
 * 상차용 시트 품목 열 (이번 차수: 새벽팜4차 - 워커힐 3차 보이는 열 기준).
 * sku는 PRODUCT_COLUMN_MAP 키와 동일.
 */
export const LOADING_SHEET_PRODUCTS = [
  { sku: "w1", label: "워커힐\n포기" },
  { sku: "w2", label: "워커힐\n총각" },
  { sku: "b1:7kg", label: "서울\n7kg" },
  { sku: "b2:7kg", label: "남도\n7kg" },
  { sku: "b3:7kg", label: "자연\n7kg" },
  { sku: "b1:3.5kg", label: "서울\n3.5kg" },
  { sku: "b2:3.5kg", label: "남도\n3.5kg" },
  { sku: "b3:3.5kg", label: "자연\n3.5kg" },
  { sku: "b4", label: "총각" },
  { sku: "b5", label: "열무" },
  { sku: "b6", label: "쪽파" },
  { sku: "b7", label: "갓" },
  { sku: "a9", label: "간장게장" },
  { sku: "a10", label: "백명란" },
  { sku: "a3", label: "만두\n세트" },
  { sku: "a4", label: "충무\n김밥" },
  { sku: "extra-jaecheop", label: "재첩" },
  { sku: "b10", label: "진미채" },
  { sku: "extra-myeongtaecho", label: "명태\n커틀렛" },
  { sku: "b11", label: "생\n청국장" },
  { sku: "b12", label: "된장" },
  { sku: "b8", label: "김\n24팩" },
];

/** 주문 상품명 → 상차용 sku (sku 없을 때 이름 매칭) */
export const LOADING_PRODUCT_NAME_ALIASES = [
  { sku: "w1", match: ["워커힐 포기", "워커힐포기", "워포", "포기김치 4kg", "워커힐 포기김치"] },
  { sku: "w2", match: ["워커힐 총각", "워커힐총각", "워총", "총각김치 2kg", "워커힐 총각김치"] },
  { sku: "b1:7kg", match: ["서울식 포기김치", "서울 7", "서7", "서울식", "이북식 7"] },
  { sku: "b2:7kg", match: ["전통남도식", "남도 7", "남7", "남도식 7"] },
  { sku: "b3:7kg", match: ["자연 포기", "자연식 7", "자7", "무설탕", "자연 7"] },
  { sku: "b1:3.5kg", match: ["서울 3.5", "서3", "이북식 3.5", "서울식 3.5"] },
  { sku: "b2:3.5kg", match: ["남도 3.5", "남3", "남도식 3.5"] },
  { sku: "b3:3.5kg", match: ["자연 3.5", "자3", "자연식 3.5"] },
  { sku: "b4", match: ["총각김치", "총각"] },
  { sku: "b5", match: ["열무김치", "열무"] },
  { sku: "b6", match: ["쪽파김치", "쪽파"] },
  { sku: "b7", match: ["갓김치", "돌산 갓", "갓"] },
  { sku: "a9", match: ["간장게장"] },
  { sku: "a10", match: ["백명란", "명란"] },
  { sku: "a3", match: ["만두세트", "만두 세트"] },
  { sku: "a4", match: ["충무김밥", "충무 김밥"] },
  { sku: "extra-jaecheop", match: ["재첩"] },
  { sku: "b10", match: ["진미채"] },
  { sku: "extra-myeongtaecho", match: ["명태커틀렛", "명태커트랫", "명태 커틀렛"] },
  { sku: "b11", match: ["생청국장", "청국장"] },
  { sku: "b12", match: ["된장", "전통된장"] },
  { sku: "b8", match: ["김 24", "김24", "도시락김 — 실속", "72봉", "올리브유 도시락김 (72"] },
];
