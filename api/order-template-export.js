import { buildOrderTemplateExport, EXPORT_FILENAME } from "./_lib/build-order-template-export.js";
import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { isCurrentRoundOrder } from "./_lib/order-utils.js";
import { readOrders } from "./_lib/orders-store.js";

export async function OPTIONS() {
  return optionsResponse();
}

function currentRoundOrders(orders) {
  return orders.filter(isCurrentRoundOrder);
}

export async function POST(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;
    if (getAdminKey(request) !== env.adminPassword) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    let body = {};
    try {
      body = await request.json();
    } catch {
      // 빈 요청은 이번 차수 실제 다운로드로 처리
    }

    const preview = body?.preview === true;
    const orders = currentRoundOrders(await readOrders());
    const result = await buildOrderTemplateExport(orders, { preview });

    if (preview) {
      return json({ ok: true, scope: "current", summary: result.summary });
    }

    const encodedFilename = encodeURIComponent(EXPORT_FILENAME);
    return new Response(result.buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="kimchi-house-august-orders.xlsx"; filename*=UTF-8''${encodedFilename}`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Content-Disposition",
      },
    });
  } catch (err) {
    console.error("order-template-export POST error:", err);
    return json({ ok: false, error: err.message || "Excel 생성 중 오류가 발생했습니다." }, 500);
  }
}
