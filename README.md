# kimchihouse-order

김치하우스 3차 사전예약 주문 사이트

## 로컬 실행

```bash
npm install
npm start
```

- 홈: http://127.0.0.1:3456/
- 주문: http://127.0.0.1:3456/order.html
- 관리자: http://127.0.0.1:3456/admin.html

## Vercel 배포

### 1. Storage → KV 연결
프로젝트에 Vercel KV를 연결하면 `KV_REST_API_URL`, `KV_REST_API_TOKEN`이 자동 설정됩니다.

### 2. Environment Variables

| 변수 | 필수 | 설명 |
|------|------|------|
| `ADMIN_PASSWORD` | ✅ | 관리자 로그인 비밀번호 |
| `ORDER_SECRET` | ✅ | 주문 API 비밀키 (긴 랜덤 문자열) |
| `KV_REST_API_URL` | ✅ | KV 연결 시 자동 |
| `KV_REST_API_TOKEN` | ✅ | KV 연결 시 자동 |

환경변수 변경 후 **Redeploy** 필요합니다.

### 3. 상태 확인

- `https://your-site.vercel.app/api/health` → `{ envReady: true, kvReady: true }`
- `https://your-site.vercel.app/` → 홈 페이지

## 페이지

- `/` — 공지 + 주문 링크
- `/order.html` — 통합 주문
- `/admin.html` — 관리자 주문 조회
