# NSW G-NAF import

Geoscape G-NAF를 **서버 전용** 인덱스로 변환합니다.  
프론트엔드에 G-NAF 전체를 넣지 않습니다.

## 파이프라인

```
Order address
  → AU normalize
  → G-NAF lookup (/api/gnaf-geocode)   ← 외부 API 없음
  → high confidence → verified
  → G-NAF 없음일 때만 Nominatim fallback
  → Needs Review (애매한 경우만)
```

---

## 1) Geoscape에서 받아야 하는 파일

공식 배포는 보통 **PSV (pipe `|` separated)** 입니다.  
폴더(또는 zip 압축 해제) 안에 아래 테이블이 있어야 합니다.

| 필수 | 파일명 예 | 비고 |
|------|-----------|------|
| ✅ | `*ADDRESS_DETAIL*.psv` | 번지 |
| ✅ | `*STREET_LOCALITY*.psv` | 도로명 (POINT/ALIAS 제외) |
| ✅ | `*LOCALITY*.psv` | suburb (ALIAS/POINT 제외) |
| ✅ | `*ADDRESS_DEFAULT_GEOCODE*.psv` | lat/lng |
| 권장 | `*STATE*.psv` | NSW만 필터 |

예시 (이름 변형 가능):

```
data/gnaf-extract/
  NSW_ADDRESS_DETAIL_psv.psv
  NSW_STREET_LOCALITY_psv.psv
  NSW_LOCALITY_psv.psv
  NSW_ADDRESS_DEFAULT_GEOCODE_psv.psv
  Authority_Code_STATE_psv.psv          # optional
```

> `STREET_LOCALITY_POINT`, `LOCALITY_ALIAS` 같은 satellite 테이블은 **자동 제외**됩니다.

### 필수 컬럼

**ADDRESS_DETAIL**
- `ADDRESS_DETAIL_PID`
- `STREET_LOCALITY_PID`
- `NUMBER_FIRST` (+ optional `NUMBER_FIRST_PREFIX` / `NUMBER_FIRST_SUFFIX`)
- `POSTCODE`
- optional: `FLAT_TYPE_CODE`, `FLAT_NUMBER`, `LEVEL_*`, `LOT_NUMBER`, `CONFIDENCE`

**STREET_LOCALITY**
- `STREET_LOCALITY_PID`
- `STREET_NAME`
- `LOCALITY_PID`
- optional: `STREET_TYPE_CODE`

**LOCALITY**
- `LOCALITY_PID`
- `LOCALITY_NAME`
- `STATE_PID`
- optional: `PRIMARY_POSTCODE`

**ADDRESS_DEFAULT_GEOCODE**
- `ADDRESS_DETAIL_PID`
- `LATITUDE`
- `LONGITUDE`

**STATE** (optional)
- `STATE_PID`
- `STATE_NAME` (`NEW SOUTH WALES` / `NSW`)

### 대안: 이미 denormalized 된 CSV 1개

컬럼:

`house_number, street_name, street_type, locality|suburb, postcode, latitude|lat, longitude|lng, address_detail_pid?`

```bash
npm run import-gnaf -- --input ./data/NSW_GNAF_flat.csv --out data/gnaf-nsw.sqlite
```

---

## 2) 어디에 넣을까

```
kimchi-house-preorder/
  data/                          ← gitignore (대용량)
    gnaf-extract/                ← Geoscape 원본 PSV 폴더
    gnaf-nsw.sqlite              ← import 결과 (권장)
    gnaf-nsw.jsonl               ← 또는 JSONL
```

---

## 3) 실행 명령어

```bash
# A) Geoscape 폴더 → SQLite (권장)
npm run import-gnaf -- --input ./data/gnaf-extract --out data/gnaf-nsw.sqlite

# B) denormalized CSV
npm run import-gnaf -- --input ./data/NSW_GNAF_flat.csv --out data/gnaf-nsw.sqlite

# C) 개발용 샘플 (25건)
npm run import-gnaf -- --sample --out data/gnaf-nsw.jsonl

# D) 기대 스키마 JSON 출력
npm run import-gnaf -- --describe
```

alias: `npm run import:gnaf-nsw` 동일.

성공 시 로그 예:

```
✅ Collected 4,123,456 NSW addresses
========== G-NAF IMPORT RESULT ==========
  Rows imported : 4,123,456
  Output        : .../data/gnaf-nsw.sqlite
=========================================
```

---

## 4) 성공 확인

```bash
# 서버 재시작
npm run dev

# 인덱스 상태
curl -s 'http://localhost:3456/api/gnaf-geocode?stats=1'

# Sydney 20주소 테스트 (exact / fuzzy / fail)
npm run test:gnaf
```

관리자 → 배송루트에서 주문 100건+ 업로드 시:
- G-NAF ready면 **병렬 검색** (외부 API 없이 verified)
- miss만 Nominatim fallback

---

## 5) Vercel

- sample 자동 로드 **안 함** (`VERCEL` 환경)
- 로컬만 sample fallback (`GNAF_USE_SAMPLE=1`로 강제 가능)
- 프로덕션 대용량 SQLite는 serverless에 부적합 → 추후 Postgres/Turso 어댑터 교체

환경변수:

| Var | Default |
|-----|---------|
| `GNAF_SQLITE_PATH` | `data/gnaf-nsw.sqlite` |
| `GNAF_JSONL_PATH` | `data/gnaf-nsw.jsonl` |
| `GNAF_USE_SAMPLE` | (unset) |
