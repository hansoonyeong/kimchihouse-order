# kimchihouse-order

김치하우스 3차 사전예약 주문 사이트

## 로컬 실행

```bash
npm install
npm start
```

## Vercel 배포

### 1. Vercel 프로젝트 설정

**Settings → General**

- Framework Preset: **Other**
- Build Command: **비워두기**
- Output Directory: **비워두기**
- Install Command: `npm install`

> 루트의 `server.js`는 로컬 전용입니다. Vercel은 HTML을 정적 파일로, `/api/*`만 서버리스 함수로 배포합니다.

### 2. Redis (주문 저장) — Upstash 연결

Vercel KV는 종료되었습니다. **Upstash Redis**를 사용합니다.

**방법 A — Vercel Marketplace (권장)**

1. Vercel 대시보드 → **Marketplace** (또는 프로젝트 → **Integrations**)
2. **Upstash** 검색 → **Upstash for Redis** 설치
3. 프로젝트 `kimchihouse-order`에 연결
4. Redis 데이터베이스 생성/선택

연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN`이 자동 설정됩니다.

**방법 B — Upstash 콘솔에서 직접**

1. [console.upstash.com](https://console.upstash.com) 가입
2. Redis 데이터베이스 생성 (Free tier)
3. REST API → **UPSTASH_REDIS_REST_URL**, **UPSTASH_REDIS_REST_TOKEN** 복사
4. Vercel **Environment Variables**에 수동 추가

### 3. Environment Variables

| 변수 | 필수 | 설명 |
|------|------|------|
| `ADMIN_PASSWORD` | ✅ | 관리자 로그인 비밀번호 |
| `ORDER_SECRET` | ✅ | 주문 API 비밀키 |
| `KV_REST_API_URL` | ✅ | Upstash 연결 시 자동 |
| `KV_REST_API_TOKEN` | ✅ | Upstash 연결 시 자동 |

환경변수 변경 후 **Redeploy** 필요.

### 4. 확인

- `https://your-site.vercel.app/` → 홈 (500 없이 열려야 함)
- `https://your-site.vercel.app/api/health` → `{ "envReady": true, "redisReady": true }`

## 페이지

- `/` — 공지 + 주문 링크
- `/order.html` — 통합 주문
- `/admin.html` — 관리자 주문 조회
