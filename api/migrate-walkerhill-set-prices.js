import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { runWalkerhillSetPriceMigration } from "./_lib/run-walkerhill-set-price-migration.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    let body = {};
    try {
      body = await request.json();
    } catch {
      // empty body is fine
    }

    const adminOk = getAdminKey(request) === env.adminPassword;
    const secretOk = body?.secret === env.orderSecret;
    if (!adminOk && !secretOk) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    const force = body?.force === true;

    const result = await runWalkerhillSetPriceMigration({ force });
    const message = result.skipped
      ? "이미 세트 가격 마이그레이션이 완료되었습니다."
      : result.updatedOrders
        ? `세트 가격 ${result.updatedOrders}건 주문, ${result.itemChanges}개 품목을 수정했습니다.`
        : "수정이 필요한 주문이 없습니다.";

    return json({ ...result, message });
  } catch (err) {
    console.error("migrate-walkerhill-set-prices error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
