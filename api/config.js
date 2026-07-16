import { getAdminKey, json, optionsResponse, requireEnv } from "./_lib/http.js";
import { readSettings, writeSettings } from "./_lib/settings-store.js";
import { publicSaleDetails, publicSaleMap, readSales } from "./_lib/sales-store.js";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    const [settings, sales] = await Promise.all([readSettings(), readSales()]);
    return json({
      ok: true,
      orderSecret: env.orderSecret,
      preorderOpen: settings.preorderOpen !== false,
      saleStatuses: publicSaleMap(sales),
      saleDetails: publicSaleDetails(sales),
      salesSettings: {
        autoSoldOutOnZero: sales.settings?.autoSoldOutOnZero !== false,
      },
    });
  } catch (err) {
    console.error("config GET error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}

export async function PATCH(request) {
  try {
    const env = requireEnv();
    if (!env.ok) return env.response;

    if (getAdminKey(request) !== env.adminPassword) {
      return json({ ok: false, error: "관리자 인증이 필요합니다." }, 401);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false, error: "잘못된 요청입니다." }, 400);
    }

    if (typeof body?.preorderOpen !== "boolean") {
      return json({ ok: false, error: "preorderOpen 값이 필요합니다." }, 400);
    }

    const settings = { ...(await readSettings()), preorderOpen: body.preorderOpen };
    await writeSettings(settings);

    return json({ ok: true, preorderOpen: settings.preorderOpen });
  } catch (err) {
    console.error("config PATCH error:", err);
    return json({ ok: false, error: err.message || "Server error" }, 500);
  }
}
