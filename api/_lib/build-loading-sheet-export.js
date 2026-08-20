/**
 * 상차용 배송일정표 export (이번 차수 품목 열 기준).
 */
import ExcelJS from "exceljs";
import {
  BUNDLE_COMPONENT_MAP,
  LOADING_PRODUCT_NAME_ALIASES,
  LOADING_SHEET_PRODUCTS,
  PRODUCT_COLUMN_MAP,
} from "./order-export-config.js";
import { expandOrderItems } from "./build-order-template-export.js";
import { paymentLabel as utilPaymentLabel } from "./order-utils.js";
import { readOrders } from "./orders-store.js";

const META_HEADERS = [
  "순번",
  "배송시간",
  "이름",
  "전화번호",
  "배송주소",
  "품목금액",
  "배송료",
  "결제금액",
  "결제상태",
  "AG\n회사%",
  "본인\n부담$",
  "회사\n청구$",
  "수금",
  "영수증·\n사은품",
  "주문내역",
];

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFB0B0B0" } },
  left: { style: "thin", color: { argb: "FFB0B0B0" } },
  bottom: { style: "thin", color: { argb: "FFB0B0B0" } },
  right: { style: "thin", color: { argb: "FFB0B0B0" } },
};

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF9DC3E6" },
};

const ZONE_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2F0D9" },
};

const META_WIDTHS = [5.5, 8.5, 12, 12, 32, 9, 7, 9, 10, 7, 8, 8, 7, 9, 22];

function text(value) {
  return String(value ?? "").trim();
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDeliveryDateLabel(iso) {
  const raw = text(iso);
  if (!raw) return "";
  const d = new Date(raw.includes("T") ? raw : `${raw}T00:00:00`);
  if (Number.isNaN(d.getTime())) return raw;
  const week = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()} (${week})`;
}

function addMinutesToTime(hhmm, minutes) {
  const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  let total = Number(m[1]) * 60 + Number(m[2]) + Number(minutes || 0);
  if (total < 0) total = 0;
  const hh = String(Math.floor(total / 60) % 24).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function normalizeProductKey(name) {
  return text(name)
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[^0-9a-z가-힣]+/gi, "")
    .trim();
}

function parseItemsFromSummary(summary) {
  return String(summary || "")
    .split(/\n| \/ /)
    .map((line) => text(line))
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(.*?)(?:\s*[×x]\s*|\s+)(\d+(?:\.\d+)?)\s*$/i);
      if (m) return { name: text(m[1]), qty: num(m[2]) || 1 };
      return { name: line, qty: 1 };
    });
}

function itemSku(item) {
  const raw = text(item?.productId || item?.sku || item?.id);
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  const variant = text(item?.variantKey);
  return variant ? `${raw}:${variant}` : raw;
}

function matchSkuByName(name) {
  const key = normalizeProductKey(name);
  if (!key) return "";
  for (const entry of LOADING_PRODUCT_NAME_ALIASES) {
    for (const alias of entry.match) {
      const a = normalizeProductKey(alias);
      if (!a) continue;
      if (key === a || key.includes(a) || a.includes(key)) return entry.sku;
    }
  }
  return "";
}

/** @returns {Record<string, number>} sku → qty */
function quantitiesFromItems(items) {
  const fakeOrder = {
    items: (items || []).map((item) => {
      const sku = itemSku(item) || matchSkuByName(item.name);
      if (!sku) return item;
      const [productId, variantKey] = sku.includes(":") ? sku.split(":") : [sku, ""];
      return {
        ...item,
        productId,
        sku,
        variantKey: variantKey || item.variantKey,
      };
    }),
  };
  const { quantities } = expandOrderItems(fakeOrder);

  // name-only items not covered by expandOrderItems
  for (const item of items || []) {
    const qty = num(item.qty);
    if (!qty) continue;
    if (itemSku(item) && (PRODUCT_COLUMN_MAP[itemSku(item)] || BUNDLE_COMPONENT_MAP[itemSku(item).split(":")[0]])) {
      continue;
    }
    const sku = matchSkuByName(item.name);
    if (!sku) continue;
    const bundle = BUNDLE_COMPONENT_MAP[sku.split(":")[0]];
    if (bundle) {
      for (const [componentSku, componentQty] of Object.entries(bundle)) {
        quantities[componentSku] = (quantities[componentSku] || 0) + componentQty * qty;
      }
    } else if (PRODUCT_COLUMN_MAP[sku]) {
      quantities[sku] = (quantities[sku] || 0) + qty;
    }
  }
  return quantities;
}

function resolveOrderRow(orderId, clientOrder, dbOrder, reservation) {
  if (clientOrder) {
    const items =
      Array.isArray(clientOrder.items) && clientOrder.items.length
        ? clientOrder.items.map((i) => ({
            name: text(i.name),
            qty: num(i.qty) || 1,
            productId: i.productId || i.id,
            sku: i.sku,
            variantKey: i.variantKey,
            componentsIncluded: i.componentsIncluded,
            bundleComponentsIncluded: i.bundleComponentsIncluded,
          }))
        : parseItemsFromSummary(clientOrder.orderSummary);
    const productAmount = num(clientOrder.productTotal ?? clientOrder.subtotal);
    const shipping = num(clientOrder.shippingFee ?? clientOrder.deliveryFee);
    const total = num(clientOrder.total) || productAmount + shipping;
    const payStatus = text(clientOrder.paymentLabel || clientOrder.paymentStatus || "");
    const isCash = /현금|현장|cash/i.test(payStatus);
    return {
      name: text(clientOrder.name),
      phone: text(clientOrder.phone),
      address: [
        text(clientOrder.unitOrShop),
        text(clientOrder.originalAddress || clientOrder.address),
        text(clientOrder.suburb),
        text(clientOrder.postcode),
      ]
        .filter(Boolean)
        .join(", ")
        .replace(/^,\s*/, ""),
      productAmount: productAmount || Math.max(0, total - shipping),
      shipping,
      payAmount: total,
      payStatus,
      orderDetail: text(clientOrder.orderSummary) || items.map((i) => `${i.name} × ${i.qty}`).join("\n"),
      note: text(clientOrder.notes || clientOrder.note),
      quantities: quantitiesFromItems(items),
      collect:
        text(clientOrder.collectAmount) !== ""
          ? num(clientOrder.collectAmount)
          : isCash
            ? total
            : 0,
    };
  }

  if (reservation) {
    const fromCols = (reservation.productCols || [])
      .map((p) => {
        const header = text(p.header);
        const qty = num(p.qty);
        if (!header || !qty) return null;
        return { name: header, qty };
      })
      .filter(Boolean);
    const items =
      fromCols.length > 0 ? fromCols : parseItemsFromSummary(reservation.orderSummary);
    return {
      name: text(reservation.name),
      phone: text(reservation.phone),
      address: text(reservation.address),
      productAmount: num(reservation.productAmount || reservation.paidAmount),
      shipping: num(reservation.shippingFee),
      payAmount: num(reservation.payAmount || reservation.paidAmount),
      payStatus: text(reservation.paymentStatus || ""),
      orderDetail:
        text(reservation.orderSummary) ||
        items.map((i) => `${i.name} × ${i.qty}`).join("\n"),
      note: text(reservation.note),
      quantities: quantitiesFromItems(items),
      collect: null,
    };
  }

  if (dbOrder) {
    const c = dbOrder.customer || {};
    const items = dbOrder.items || [];
    const shipping =
      num(dbOrder.shippingFee) ||
      num(dbOrder.deliveryFee) ||
      num(dbOrder.shippingBreakdown?.total);
    const total = num(dbOrder.total);
    const productAmount = Math.max(0, total - shipping);
    const { quantities } = expandOrderItems(dbOrder);
    return {
      name: text(c.name),
      phone: text(c.phone),
      address: [text(c.address), text(c.suburb), text(c.postcode)].filter(Boolean).join(", "),
      productAmount,
      shipping,
      payAmount: total,
      payStatus: utilPaymentLabel(dbOrder.payment),
      orderDetail: items.map((i) => `${text(i.name)} × ${num(i.qty) || 0}`).join("\n"),
      note: text(dbOrder.note),
      quantities,
      collect: dbOrder.payment === "cash" ? total : 0,
    };
  }

  return {
    name: `(주문 ${orderId})`,
    phone: "",
    address: "",
    productAmount: 0,
    shipping: 0,
    payAmount: 0,
    payStatus: "",
    orderDetail: "",
    note: "주문 데이터를 찾지 못했습니다",
    quantities: {},
    collect: null,
  };
}

function styleHeaderCell(cell) {
  cell.fill = HEADER_FILL;
  cell.font = { name: "Calibri", size: 11, bold: true };
  cell.alignment = { wrapText: true, horizontal: "center", vertical: "middle" };
  cell.border = THIN_BORDER;
}

function styleDataCell(cell, { center = true } = {}) {
  cell.border = THIN_BORDER;
  cell.alignment = {
    horizontal: center ? "center" : "left",
    vertical: "middle",
    wrapText: true,
  };
  cell.font = { name: "Calibri", size: 11 };
}

function writeZoneRow(sheet, rowNumber, label, lastCol) {
  sheet.mergeCells(rowNumber, 1, rowNumber, lastCol);
  for (let c = 1; c <= lastCol; c++) {
    const cell = sheet.getCell(rowNumber, c);
    cell.fill = ZONE_FILL;
    cell.border = THIN_BORDER;
  }
  const cell = sheet.getCell(rowNumber, 1);
  cell.value = label;
  cell.font = { name: "Calibri", size: 12, bold: true };
  cell.alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(rowNumber).height = 28;
}

function writeStopRow(sheet, rowNumber, seq, timeLabel, row, productCols, noteCol) {
  const values = [
    seq,
    timeLabel || "",
    row.name,
    row.phone,
    row.address,
    row.productAmount || "",
    row.shipping || 0,
    row.payAmount || "",
    row.payStatus || "",
    "",
    "",
    "",
    row.collect == null ? "" : row.collect,
    "",
    row.orderDetail,
  ];
  values.forEach((value, idx) => {
    const cell = sheet.getCell(rowNumber, idx + 1);
    cell.value = value;
    styleDataCell(cell, { center: idx !== 4 && idx !== 14 });
  });

  productCols.forEach((product, idx) => {
    const col = META_HEADERS.length + 1 + idx;
    const qty = num(row.quantities?.[product.sku]);
    const cell = sheet.getCell(rowNumber, col);
    cell.value = qty || "";
    styleDataCell(cell);
  });

  const noteCell = sheet.getCell(rowNumber, noteCol);
  noteCell.value = row.note || "";
  styleDataCell(noteCell, { center: false });
  sheet.getRow(rowNumber).height = 36;
}

function createWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("상차용", {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: {
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      paperSize: 9,
    },
  });

  const productCols = LOADING_SHEET_PRODUCTS.slice();
  const noteCol = META_HEADERS.length + productCols.length + 1;

  META_WIDTHS.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
  productCols.forEach((_, i) => {
    sheet.getColumn(META_HEADERS.length + 1 + i).width = 7;
  });
  sheet.getColumn(noteCol).width = 28;

  const headerRow = sheet.getRow(1);
  headerRow.height = 48;
  META_HEADERS.forEach((label, i) => {
    const cell = sheet.getCell(1, i + 1);
    cell.value = label;
    styleHeaderCell(cell);
  });
  productCols.forEach((product, i) => {
    const cell = sheet.getCell(1, META_HEADERS.length + 1 + i);
    cell.value = product.label;
    styleHeaderCell(cell);
  });
  {
    const cell = sheet.getCell(1, noteCol);
    cell.value = "특이사항 및 메모";
    styleHeaderCell(cell);
  }

  return { workbook, sheet, productCols, noteCol };
}

/**
 * @param {object} body
 * @param {{ preview?: boolean }} opts
 */
export async function buildLoadingSheetExport(body, { preview = false } = {}) {
  const routes = Array.isArray(body?.routes) ? body.routes : [];
  const deliveryDate = text(body?.deliveryDate);
  const clientOrders = body?.orders || {};
  const reservationOrders = body?.reservationOrders || {};
  const minsPerStop = Math.max(5, num(body?.minsPerStop) || 15);

  const dbOrders = await readOrders();
  const dbMap = new Map(dbOrders.map((o) => [text(o.id), o]));

  const { workbook, sheet, productCols, noteCol } = createWorkbook();
  const dateLabel = formatDeliveryDateLabel(deliveryDate);
  const previewRows = [];
  let rowNumber = 2;
  let placed = 0;

  routes.forEach((route, routeIndex) => {
    const orderIds = Array.isArray(route.orderIds) ? route.orderIds : [];
    if (!orderIds.length) return;
    const routeName = text(route.name) || `Route ${routeIndex + 1}`;
    const departure = text(route.departureTime);
    const zoneLabel = `━━━ ${routeName} (${orderIds.length}건)${
      dateLabel ? ` · 배송일 ${dateLabel}` : ""
    }${departure ? ` · 출발 ${departure}` : ""} ━━━`;

    if (!preview) writeZoneRow(sheet, rowNumber, zoneLabel, noteCol);
    rowNumber += 1;

    orderIds.forEach((rawId, stopIndex) => {
      const orderId = text(rawId);
      const resolved = resolveOrderRow(
        orderId,
        clientOrders[orderId],
        dbMap.get(orderId),
        reservationOrders[orderId]
      );
      const timeLabel = departure ? addMinutesToTime(departure, stopIndex * minsPerStop) : "";
      previewRows.push({
        route: routeName,
        seq: stopIndex + 1,
        time: timeLabel,
        name: resolved.name,
        address: resolved.address,
        orderDetail: resolved.orderDetail,
        note: resolved.note,
        quantities: resolved.quantities,
      });
      if (!preview) {
        writeStopRow(sheet, rowNumber, stopIndex + 1, timeLabel, resolved, productCols, noteCol);
      }
      rowNumber += 1;
      placed += 1;
    });
  });

  if (!placed) {
    throw new Error("내보낼 배송 주문이 없습니다.");
  }

  const filename = `김치하우스_상차용_${deliveryDate || new Date().toISOString().slice(0, 10)}.xlsx`;
  if (preview) {
    return {
      summary: {
        filename,
        placedOrders: placed,
        routeCount: routes.length,
        products: productCols.map((p) => p.label.replace(/\n/g, " ")),
        previewRows: previewRows.slice(0, 30),
      },
    };
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  return {
    buffer,
    summary: {
      filename,
      placedOrders: placed,
      routeCount: routes.length,
      products: productCols.map((p) => p.label.replace(/\n/g, " ")),
    },
  };
}

/** Client print helper data */
export function getLoadingSheetProductHeaders() {
  return LOADING_SHEET_PRODUCTS.map((p) => p.label.replace(/\n/g, " "));
}
