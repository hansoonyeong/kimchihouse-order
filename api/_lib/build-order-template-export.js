import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  BUNDLE_COMPONENT_MAP,
  CUSTOMER_COLUMNS,
  EXPORT_FILENAME,
  PRODUCT_COLUMN_MAP,
  TEMPLATE_SHEET_NAME,
} from "./order-export-config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = path.join(__dirname, "../_templates/kimchi-house-august-order-template.xlsx");
const POSTCODE_PATH = path.join(__dirname, "../_data/nsw-postcodes.json");

let postcodeCache = null;

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeRegion(value) {
  return text(value)
    .normalize("NFKD")
    .replace(/\b(?:nsw|new south wales)\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function loadPostcodes() {
  if (postcodeCache) return postcodeCache;
  const rows = JSON.parse(fs.readFileSync(POSTCODE_PATH, "utf8"));
  const byPostcode = new Map();
  const bySuburb = new Map();
  const suburbDisplay = new Map();
  for (const row of rows) {
    const postcode = text(row.postcode);
    const suburb = text(row.suburb);
    if (!postcode || !suburb || row.category === "Post Office Boxes") continue;
    if (!byPostcode.has(postcode)) byPostcode.set(postcode, []);
    byPostcode.get(postcode).push(suburb);
    const normalized = normalizeRegion(suburb);
    if (normalized && !bySuburb.has(normalized)) bySuburb.set(normalized, postcode);
    if (normalized && !suburbDisplay.has(normalized)) suburbDisplay.set(normalized, suburb);
  }
  postcodeCache = { byPostcode, bySuburb, suburbDisplay };
  return postcodeCache;
}

function extractPostcode(order) {
  const customer = order?.customer || {};
  const explicit = text(customer.postcode || order?.postcode);
  if (/^\d{4}$/.test(explicit)) return explicit;
  const combined = [customer.address, customer.suburb, order?.address].filter(Boolean).join(" ");
  return combined.match(/\b(\d{4})\b/)?.[1] || "";
}

function resolveOrderRegion(order) {
  const customer = order?.customer || {};
  const explicit = text(customer.suburb || order?.suburb)
    .replace(/\b(?:NSW|New South Wales)\b/gi, " ")
    .replace(/\b\d{4}\b/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const postcode = extractPostcode(order);
  if (explicit) return { region: explicit, postcode };

  const address = normalizeRegion(customer.address || order?.address);
  const postcodeCandidates = postcode ? loadPostcodes().byPostcode.get(postcode) || [] : [];
  const addressCandidate = postcodeCandidates.find((suburb) => {
    const normalized = normalizeRegion(suburb);
    return new RegExp(
      `(?:^| )${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`
    ).test(address);
  });
  if (addressCandidate) return { region: addressCandidate, postcode };
  if (postcodeCandidates.length === 1) return { region: postcodeCandidates[0], postcode };

  const addressSuburb = Array.from(loadPostcodes().suburbDisplay.entries())
    .sort((a, b) => b[0].length - a[0].length)
    .find(([normalized]) =>
      new RegExp(
        `(?:^| )${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?: |$)`
      ).test(address)
    );
  return { region: addressSuburb?.[1] || "", postcode };
}

function orderCreatedAtMs(order) {
  const raw = order?.createdAt;
  if (raw == null || raw === "") return 0;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function sortOrdersForContinuousExport(orders) {
  return (orders || [])
    .map((order) => ({ order, ...resolveOrderRegion(order), expanded: expandOrderItems(order) }))
    .sort((a, b) => {
      const createdCompare = orderCreatedAtMs(b.order) - orderCreatedAtMs(a.order);
      if (createdCompare) return createdCompare;
      return text(b.order?.id).localeCompare(text(a.order?.id), "en", { numeric: true });
    });
}

function itemSku(item) {
  const raw = text(item?.productId || item?.sku || item?.id);
  if (!raw) return "";
  if (raw.includes(":")) return raw;
  const variant = text(item?.variantKey);
  return variant ? `${raw}:${variant}` : raw;
}

function addQty(target, sku, qty) {
  if (!sku || !qty) return;
  target[sku] = (target[sku] || 0) + qty;
}

export function expandOrderItems(order) {
  const quantities = {};
  const unmapped = [];

  for (const item of order?.items || []) {
    const sku = itemSku(item);
    const baseSku = sku.split(":")[0];
    const qty = Math.max(0, Number(item?.qty) || 0);
    if (!sku || qty <= 0) continue;

    const bundle = BUNDLE_COMPONENT_MAP[baseSku];
    if (bundle) {
      if (item?.componentsIncluded === true || item?.bundleComponentsIncluded === true) {
        unmapped.push({
          sku,
          name: text(item?.name) || sku,
          qty,
          reason: "주문 데이터에 구성상품 포함 표시가 있어 세트 자동 분해를 생략했습니다.",
        });
        continue;
      }
      for (const [componentSku, componentQty] of Object.entries(bundle)) {
        addQty(quantities, componentSku, componentQty * qty);
      }
      continue;
    }

    if (PRODUCT_COLUMN_MAP[sku]) {
      addQty(quantities, sku, qty);
    } else {
      unmapped.push({
        sku,
        name: text(item?.name) || sku,
        qty,
        reason: baseSku.startsWith("w_set")
          ? "세트 구성 매핑이 없습니다."
          : "보이는 템플릿 상품 열 매핑이 없습니다.",
      });
    }
  }

  return { quantities, unmapped };
}

function requestNotes(order, unmapped) {
  const notes = [];
  const fields = [
    order?.note,
    order?.deliveryRequest,
    order?.customerRequest,
    order?.accessMethod,
    order?.absenceInstruction,
    order?.adminMemo,
    order?.customer?.deliveryRequest,
    order?.customer?.request,
    order?.customer?.accessMethod,
    order?.customer?.absenceInstruction,
  ];
  for (const value of fields) {
    const line = text(value);
    if (line && !notes.includes(line)) notes.push(line);
  }
  const shippingFee = Number(order?.shippingFee) || 0;
  if (shippingFee > 0) notes.push(`배송비 $${shippingFee}`);
  for (const item of unmapped) {
    notes.push(`미매핑 상품: ${item.name} × ${item.qty} (${item.reason})`);
  }
  return notes.join("\n");
}

function displayAddress(order, resolvedSuburb, postcode) {
  const customer = order?.customer || {};
  const address = text(customer.address);
  const suburb = text(customer.suburb) || text(resolvedSuburb);
  const parts = [];
  if (address) parts.push(address);
  const normalizedAddress = normalizeRegion(address);
  if (suburb && !normalizedAddress.includes(normalizeRegion(suburb))) parts.push(suburb);
  if (postcode && !new RegExp(`\\b${postcode}\\b`).test(address)) parts.push(postcode);
  return parts.join(", ");
}

function productPriceAdjustment(sheet, order) {
  let adjustment = 0;
  for (const item of order?.items || []) {
    const sku = itemSku(item);
    const baseSku = sku.split(":")[0];
    const qty = Math.max(0, Number(item?.qty) || 0);
    const charged = Number(item?.price);
    if (!sku || qty <= 0 || !Number.isFinite(charged) || charged <= 0) continue;

    const bundle = BUNDLE_COMPONENT_MAP[baseSku];
    if (bundle && item?.componentsIncluded !== true && item?.bundleComponentsIncluded !== true) {
      let regular = 0;
      for (const [componentSku, componentQty] of Object.entries(bundle)) {
        const column = PRODUCT_COLUMN_MAP[componentSku];
        const unitPrice = Number(sheet.getCell(`${column}1`).value) || 0;
        regular += unitPrice * componentQty * qty;
      }
      adjustment += regular - charged;
      continue;
    }

    const column = PRODUCT_COLUMN_MAP[sku];
    if (!column) continue;
    const unitPrice = Number(sheet.getCell(`${column}1`).value) || 0;
    adjustment += unitPrice * qty - charged;
  }
  return adjustment;
}

function adjustProductTotalFormula(sheet, row, discount) {
  if (!discount) return;
  const cell = sheet.getCell(`${CUSTOMER_COLUMNS.productTotal}${row}`);
  const formula = cell.formula || (typeof cell.value === "object" ? cell.value?.formula : "");
  if (!formula) return;
  const rounded = Math.round(discount * 100) / 100;
  const operator = rounded >= 0 ? "-" : "+";
  cell.value = { formula: `(${formula})${operator}${Math.abs(rounded)}` };
}

function formulaForRow(referenceFormula, row) {
  return referenceFormula.replace(/([A-Z]{1,3})9\b/g, `$1${row}`);
}

function prepareContinuousOrderRow(sheet, row, region, referenceFormula) {
  for (const column of [
    CUSTOMER_COLUMNS.region,
    CUSTOMER_COLUMNS.name,
    CUSTOMER_COLUMNS.address,
    CUSTOMER_COLUMNS.phone,
    CUSTOMER_COLUMNS.paidAmount,
    CUSTOMER_COLUMNS.note,
  ]) {
    sheet.getCell(`${column}${row}`).value = null;
  }
  for (let column = 8; column <= 57; column += 1) sheet.getCell(row, column).value = null;
  sheet.getCell(`${CUSTOMER_COLUMNS.region}${row}`).value = region;
  sheet.getCell(`${CUSTOMER_COLUMNS.productTotal}${row}`).value = {
    formula: formulaForRow(referenceFormula, row),
  };
}

function writeOrderToRow(sheet, row, order, placement, expanded) {
  const customer = order?.customer || {};
  const displayRegion = placement.displayRegion || placement.rawSuburb;
  sheet.getCell(`${CUSTOMER_COLUMNS.name}${row}`).value = text(customer.name);
  sheet.getCell(`${CUSTOMER_COLUMNS.address}${row}`).value = displayAddress(
    order,
    displayRegion,
    placement.postcode
  );
  sheet.getCell(`${CUSTOMER_COLUMNS.phone}${row}`).value = text(customer.phone);
  sheet.getCell(`${CUSTOMER_COLUMNS.paidAmount}${row}`).value = null;

  for (const [sku, qty] of Object.entries(expanded.quantities)) {
    const column = PRODUCT_COLUMN_MAP[sku];
    if (column && qty) sheet.getCell(`${column}${row}`).value = qty;
  }

  const note = requestNotes(order, expanded.unmapped);
  if (note) sheet.getCell(`${CUSTOMER_COLUMNS.note}${row}`).value = note;
  adjustProductTotalFormula(sheet, row, productPriceAdjustment(sheet, order));
}

function orderItemsLabel(order) {
  return (order?.items || [])
    .map((item) => `${text(item.name) || itemSku(item)} × ${Number(item.qty) || 0}`)
    .join(" / ");
}

function previewProductLabel(expanded) {
  const names = { w1: "워커힐 포기김치", w2: "워커힐 총각김치" };
  const mapped = Object.entries(expanded.quantities).map(
    ([sku, qty]) => `${names[sku] || sku} × ${qty}`
  );
  const unmapped = expanded.unmapped.map((item) => `${item.name} × ${item.qty} (미매핑)`);
  return [...mapped, ...unmapped].join(" / ");
}

function previewRecord(order, placement, expanded, status) {
  const customer = order?.customer || {};
  return {
    orderId: text(order?.id),
    region: placement.displayRegion || placement.rawSuburb || text(customer.suburb) || "-",
    customerName: text(customer.name),
    address: displayAddress(order, placement.displayRegion || placement.rawSuburb, placement.postcode),
    phone: text(customer.phone),
    products: previewProductLabel(expanded),
    note: requestNotes(order, expanded.unmapped),
    status,
  };
}

function unclassifiedRecord(order, placement, expanded, reason) {
  const customer = order?.customer || {};
  return {
    orderId: text(order?.id),
    customerName: text(customer.name),
    address: text(customer.address),
    suburb: text(customer.suburb),
    postcode: placement.postcode || extractPostcode(order),
    phone: text(customer.phone),
    items: orderItemsLabel(order),
    requests: requestNotes(order, expanded.unmapped),
    reason,
  };
}

function setXmlAttribute(tag, name, value) {
  const pattern = new RegExp(`\\s${name}="[^"]*"`);
  if (pattern.test(tag)) return tag.replace(pattern, ` ${name}="${value}"`);
  return tag.replace(/\/?>$/, (ending) => ` ${name}="${value}"${ending}`);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnNumber(address) {
  const letters = String(address).match(/^[A-Z]+/)?.[0] || "";
  let result = 0;
  for (const char of letters) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function buildCellXml(existing, address, patch) {
  let open = existing?.match(/^<c\b[^>]*(?:\/>|>)/)?.[0] || `<c r="${address}">`;
  open = open.replace(/\s+t="[^"]*"/g, "").replace(/\/>$/, ">");

  if (patch.type === "number") {
    return `${open}<v>${Number(patch.value)}</v></c>`;
  }
  if (patch.type === "formula") {
    return `${open}<f>${xmlEscape(patch.value)}</f></c>`;
  }
  open = setXmlAttribute(open, "t", "inlineStr");
  return `${open}<is><t xml:space="preserve">${xmlEscape(patch.value)}</t></is></c>`;
}

function patchCell(sheetXml, address, patch) {
  const cellPattern = new RegExp(
    `<c\\b(?=[^>]*\\br="${address}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`
  );
  const existing = sheetXml.match(cellPattern)?.[0] || "";
  const replacement = buildCellXml(existing, address, patch);
  if (existing) return sheetXml.replace(cellPattern, replacement);

  const rowNumber = Number(address.match(/\d+$/)?.[0]);
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>[\\s\\S]*?<\\/row>`);
  const rowXml = sheetXml.match(rowPattern)?.[0];
  if (!rowXml) throw new Error(`템플릿에서 ${rowNumber}행을 찾을 수 없습니다.`);

  const targetColumn = columnNumber(address);
  const cells = Array.from(rowXml.matchAll(/<c\b[^>]*\br="([A-Z]+\d+)"[^>]*(?:\/>|>[\s\S]*?<\/c>)/g));
  const next = cells.find((match) => columnNumber(match[1]) > targetColumn);
  const nextRowXml = next
    ? rowXml.replace(next[0], `${replacement}${next[0]}`)
    : rowXml.replace("</row>", `${replacement}</row>`);
  return sheetXml.replace(rowPattern, nextRowXml);
}

function targetWorksheetPath(workbookXml, relationshipsXml) {
  const sheetTag = Array.from(workbookXml.matchAll(/<sheet\b[^>]*\/>/g))
    .map((match) => match[0])
    .find((tag) => tag.includes(`name="${TEMPLATE_SHEET_NAME}"`));
  const relationshipId = sheetTag?.match(/\br:id="([^"]+)"/)?.[1];
  if (!relationshipId) throw new Error("템플릿 대상 시트 관계를 찾을 수 없습니다.");

  const relationshipTag = Array.from(relationshipsXml.matchAll(/<Relationship\b[^>]*\/>/g))
    .map((match) => match[0])
    .find((tag) => tag.includes(`Id="${relationshipId}"`));
  const target = relationshipTag?.match(/\bTarget="([^"]+)"/)?.[1];
  if (!target) throw new Error("템플릿 대상 시트 파일을 찾을 수 없습니다.");
  if (target.startsWith("/")) return target.slice(1);
  return `xl/${target.replace(/^(\.\.\/)+/, "")}`;
}

async function removeHiddenTemplateSheets(zip, workbookXml, relationshipsXml) {
  const hiddenSheets = Array.from(workbookXml.matchAll(/<sheet\b[^>]*state="hidden"[^>]*\/>/g)).map(
    (match) => match[0]
  );
  if (!hiddenSheets.length) return { workbookXml, relationshipsXml };

  const contentTypesFile = zip.file("[Content_Types].xml");
  let contentTypesXml = contentTypesFile ? await contentTypesFile.async("string") : "";

  for (const sheetTag of hiddenSheets) {
    const relationshipId = sheetTag.match(/\br:id="([^"]+)"/)?.[1];
    if (!relationshipId) continue;
    const relationshipTag = Array.from(relationshipsXml.matchAll(/<Relationship\b[^>]*\/>/g))
      .map((match) => match[0])
      .find((tag) => tag.includes(`Id="${relationshipId}"`));
    const target = relationshipTag?.match(/\bTarget="([^"]+)"/)?.[1];
    if (!relationshipTag || !target) continue;

    const sheetPath = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^(\.\.\/)+/, "")}`;
    workbookXml = workbookXml.replace(sheetTag, "");
    relationshipsXml = relationshipsXml.replace(relationshipTag, "");
    zip.remove(sheetPath);
    const fileName = path.posix.basename(sheetPath);
    zip.remove(`xl/worksheets/_rels/${fileName}.rels`);
    if (contentTypesXml) {
      const partName = `/${sheetPath}`;
      contentTypesXml = contentTypesXml.replace(
        new RegExp(`<Override\\b(?=[^>]*PartName="${partName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}")\\s*[^>]*/>`),
        ""
      );
    }
  }

  workbookXml = workbookXml.replace(/<workbookView\b[^>]*\/>/, (tag) => {
    let next = setXmlAttribute(tag, "activeTab", "0");
    return setXmlAttribute(next, "firstSheet", "0");
  });
  if (contentTypesFile) zip.file("[Content_Types].xml", contentTypesXml);
  zip.file("xl/_rels/workbook.xml.rels", relationshipsXml);
  return { workbookXml, relationshipsXml };
}

function collectPlacedRowPatches(sheet, writtenRows) {
  const patches = [];
  const productColumns = Array.from(new Set(Object.values(PRODUCT_COLUMN_MAP)));
  for (const row of writtenRows) {
    for (const column of [
      CUSTOMER_COLUMNS.region,
      CUSTOMER_COLUMNS.name,
      CUSTOMER_COLUMNS.address,
      CUSTOMER_COLUMNS.phone,
      CUSTOMER_COLUMNS.note,
      ...productColumns,
    ]) {
      const cell = sheet.getCell(`${column}${row}`);
      if (cell.value == null || cell.value === "") continue;
      patches.push({
        address: cell.address,
        type: typeof cell.value === "number" ? "number" : "string",
        value: cell.value,
      });
    }
    const formulaCell = sheet.getCell(`${CUSTOMER_COLUMNS.productTotal}${row}`);
    if (formulaCell.formula) {
      patches.push({ address: formulaCell.address, type: "formula", value: formulaCell.formula });
    }
  }
  return patches;
}

function columnLetter(number) {
  let value = number;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function worksheetRowXml(sheetXml, rowNumber) {
  return sheetXml.match(
    new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>[\\s\\S]*?<\\/row>`)
  )?.[0];
}

function cloneWorksheetRow(rowXml, sourceRow, targetRow) {
  return rowXml
    .replace(new RegExp(`(<row\\b[^>]*\\br=")${sourceRow}(")`), `$1${targetRow}$2`)
    .replace(new RegExp(`(\\br="[A-Z]+)${sourceRow}(")`, "g"), `$1${targetRow}$2`);
}

function buildContinuousWorksheetXml(sheetXml, orderCount) {
  const sheetData = sheetXml.match(/<sheetData>[\s\S]*?<\/sheetData>/)?.[0];
  const orderTemplateRow = worksheetRowXml(sheetXml, 9);
  const summaryTemplateRow = worksheetRowXml(sheetXml, 521);
  if (!sheetData || !orderTemplateRow || !summaryTemplateRow) {
    throw new Error("템플릿 연속 주문 행 또는 요약행을 찾을 수 없습니다.");
  }

  const headerRows = [];
  for (let row = 1; row <= 8; row += 1) {
    const rowXml = worksheetRowXml(sheetXml, row);
    if (rowXml) headerRows.push(rowXml);
  }
  const orderRows = Array.from({ length: orderCount }, (_, index) =>
    cloneWorksheetRow(orderTemplateRow, 9, 9 + index)
  );
  const summaryRow = 9 + orderCount;
  const summaryXml = cloneWorksheetRow(summaryTemplateRow, 521, summaryRow);
  const nextSheetData = `<sheetData>${[...headerRows, ...orderRows, summaryXml].join(
    ""
  )}</sheetData>`;

  let nextXml = sheetXml.replace(sheetData, nextSheetData);
  nextXml = nextXml.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:DO${summaryRow}"/>`);
  nextXml = nextXml.replace(/<rowBreaks\b[\s\S]*?<\/rowBreaks>/g, "");
  nextXml = nextXml.replace(
    /<autoFilter\b[^>]*\/>/,
    `<autoFilter ref="B8:BF${summaryRow}"/>`
  );
  return { sheetXml: nextXml, summaryRow };
}

function applyContinuousFormulaPatches(sheetXml, orderCount, summaryRow) {
  const lastOrderRow = 8 + orderCount;
  const totalFormula = (column) =>
    orderCount ? `SUM(${column}9:${column}${lastOrderRow})` : "0";

  for (let columnNumber = 8; columnNumber <= 57; columnNumber += 1) {
    const column = columnLetter(columnNumber);
    sheetXml = patchCell(sheetXml, `${column}5`, {
      type: "formula",
      value: `${column}${summaryRow}`,
    });
    sheetXml = patchCell(sheetXml, `${column}6`, {
      type: "formula",
      value: `${column}2-${column}${summaryRow}`,
    });
  }
  for (let columnNumber = 6; columnNumber <= 57; columnNumber += 1) {
    const column = columnLetter(columnNumber);
    sheetXml = patchCell(sheetXml, `${column}${summaryRow}`, {
      type: "formula",
      value: totalFormula(column),
    });
  }
  return sheetXml;
}

function inlineStringCell(address, value) {
  return `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(
    value
  )}</t></is></c>`;
}

function unclassifiedWorksheetXml(records) {
  const headers = [
    "주문번호",
    "고객명",
    "주소",
    "Suburb",
    "Postcode",
    "연락처",
    "주문 상품",
    "요청사항",
    "미분류 사유",
  ];
  const rows = [
    `<row r="1" ht="24" customHeight="1">${headers
      .map((value, index) => inlineStringCell(`${String.fromCharCode(65 + index)}1`, value))
      .join("")}</row>`,
  ];
  records.forEach((record, index) => {
    const rowNumber = index + 2;
    const values = [
      record.orderId,
      record.customerName,
      record.address,
      record.suburb,
      record.postcode,
      record.phone,
      record.items,
      record.requests,
      record.reason,
    ];
    rows.push(
      `<row r="${rowNumber}">${values
        .map((value, columnIndex) =>
          value
            ? inlineStringCell(`${String.fromCharCode(65 + columnIndex)}${rowNumber}`, value)
            : ""
        )
        .join("")}</row>`
    );
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:I${Math.max(1, records.length + 1)}"/>
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <cols>
    <col min="1" max="1" width="20" customWidth="1"/>
    <col min="2" max="2" width="16" customWidth="1"/>
    <col min="3" max="3" width="38" customWidth="1"/>
    <col min="4" max="4" width="20" customWidth="1"/>
    <col min="5" max="5" width="12" customWidth="1"/>
    <col min="6" max="6" width="18" customWidth="1"/>
    <col min="7" max="7" width="48" customWidth="1"/>
    <col min="8" max="8" width="42" customWidth="1"/>
    <col min="9" max="9" width="35" customWidth="1"/>
  </cols>
  <sheetData>${rows.join("")}</sheetData>
  <autoFilter ref="A1:I1"/>
</worksheet>`;
}

function addUnclassifiedWorksheet(zip, workbookXml, relationshipsXml, records) {
  if (!records.length) return { workbookXml, relationshipsXml };

  const usedSheetNumbers = Object.keys(zip.files)
    .map((name) => name.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const sheetNumber = Math.max(0, ...usedSheetNumbers) + 1;
  const usedSheetIds = Array.from(workbookXml.matchAll(/\bsheetId="(\d+)"/g)).map((match) =>
    Number(match[1])
  );
  const sheetId = Math.max(0, ...usedSheetIds) + 1;
  const usedRelationshipIds = Array.from(relationshipsXml.matchAll(/\bId="rId(\d+)"/g)).map(
    (match) => Number(match[1])
  );
  const relationshipId = `rId${Math.max(0, ...usedRelationshipIds) + 1}`;
  const sheetPath = `xl/worksheets/sheet${sheetNumber}.xml`;

  workbookXml = workbookXml.replace(
    "</sheets>",
    `<sheet name="미분류" sheetId="${sheetId}" r:id="${relationshipId}"/></sheets>`
  );
  relationshipsXml = relationshipsXml.replace(
    "</Relationships>",
    `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${sheetNumber}.xml"/></Relationships>`
  );

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) throw new Error("템플릿 Content Types를 찾을 수 없습니다.");
  zip.file(sheetPath, unclassifiedWorksheetXml(records));
  return { workbookXml, relationshipsXml, contentTypesFile, sheetNumber };
}

async function createPreservedTemplateBuffer(sheet, writtenRows, unclassified) {
  const zip = await JSZip.loadAsync(fs.readFileSync(TEMPLATE_PATH));
  const workbookFile = zip.file("xl/workbook.xml");
  const relationshipsFile = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbookFile || !relationshipsFile) throw new Error("템플릿 워크북 구조가 올바르지 않습니다.");

  let workbookXml = await workbookFile.async("string");
  let relationshipsXml = await relationshipsFile.async("string");
  const sheetPath = targetWorksheetPath(workbookXml, relationshipsXml);
  const cleanedWorkbook = await removeHiddenTemplateSheets(zip, workbookXml, relationshipsXml);
  workbookXml = cleanedWorkbook.workbookXml;
  relationshipsXml = cleanedWorkbook.relationshipsXml;
  const sheetFile = zip.file(sheetPath);
  if (!sheetFile) throw new Error("템플릿 대상 시트 XML을 찾을 수 없습니다.");
  let sheetXml = await sheetFile.async("string");
  const continuousSheet = buildContinuousWorksheetXml(sheetXml, writtenRows.length);
  sheetXml = continuousSheet.sheetXml;

  const patches = collectPlacedRowPatches(sheet, writtenRows);
  for (const patch of patches) sheetXml = patchCell(sheetXml, patch.address, patch);
  sheetXml = applyContinuousFormulaPatches(
    sheetXml,
    writtenRows.length,
    continuousSheet.summaryRow
  );
  zip.file(sheetPath, sheetXml);

  const unclassifiedSheet = addUnclassifiedWorksheet(
    zip,
    workbookXml,
    relationshipsXml,
    unclassified
  );
  workbookXml = unclassifiedSheet.workbookXml;
  relationshipsXml = unclassifiedSheet.relationshipsXml;
  if (unclassifiedSheet.contentTypesFile) {
    let contentTypesXml = await unclassifiedSheet.contentTypesFile.async("string");
    contentTypesXml = contentTypesXml.replace(
      "</Types>",
      `<Override PartName="/xl/worksheets/sheet${unclassifiedSheet.sheetNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`
    );
    zip.file("[Content_Types].xml", contentTypesXml);
    zip.file("xl/_rels/workbook.xml.rels", relationshipsXml);
  }

  if (/<calcPr\b[^>]*\/>/.test(workbookXml)) {
    workbookXml = workbookXml.replace(/<calcPr\b[^>]*\/>/, (tag) => {
      let next = setXmlAttribute(tag, "calcMode", "auto");
      next = setXmlAttribute(next, "fullCalcOnLoad", "1");
      return setXmlAttribute(next, "forceFullCalc", "1");
    });
  } else {
    workbookXml = workbookXml.replace(
      "</workbook>",
      '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'
    );
  }
  workbookXml = workbookXml.replace(
    /(<definedName\b[^>]*name="_xlnm\._FilterDatabase"[^>]*>)[^<]*(<\/definedName>)/,
    (_, opening, closing) =>
      `${opening}'${TEMPLATE_SHEET_NAME}'!$B$8:$BF$${continuousSheet.summaryRow}${closing}`
  );
  zip.file("xl/workbook.xml", workbookXml);

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function buildOrderTemplateExport(orders, { preview = false } = {}) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const sheet = workbook.getWorksheet(TEMPLATE_SHEET_NAME);
  if (!sheet) throw new Error(`템플릿 시트 「${TEMPLATE_SHEET_NAME}」를 찾을 수 없습니다.`);

  const referenceFormula = sheet.getCell(`${CUSTOMER_COLUMNS.productTotal}9`).formula;
  if (!referenceFormula) throw new Error("템플릿 주문 금액 기준 수식을 찾을 수 없습니다.");
  const sortedOrders = sortOrdersForContinuousExport(orders);
  const warnings = [];
  const unclassified = [];
  const previewRows = [];
  const writtenRows = [];
  let placedOrders = 0;
  let mappingErrorCount = 0;

  for (const [index, prepared] of sortedOrders.entries()) {
    const { order, region, postcode, expanded } = prepared;
    mappingErrorCount += expanded.unmapped.length;
    for (const issue of expanded.unmapped) {
      warnings.push({
        type: "product_mapping",
        orderId: order.id,
        message: `${issue.name} × ${issue.qty}: ${issue.reason}`,
      });
    }

    const placement = {
      normalized: normalizeRegion(region),
      displayRegion: region,
      rawSuburb: region,
      postcode,
    };
    let status = "연속 배치 예정";
    if (!region) {
      const reason = "suburb, postcode, 전체 주소에서 지역을 확인하지 못했습니다.";
      unclassified.push(unclassifiedRecord(order, placement, expanded, reason));
      warnings.push({ type: "region", orderId: order.id, message: reason });
      status = `미분류 · ${reason}`;
    } else {
      placedOrders += 1;
    }

    if (expanded.unmapped.length) {
      status += ` · 상품 매핑 오류 ${expanded.unmapped.length}건`;
    }
    previewRows.push(
      previewRecord(order, placement, expanded, status)
    );
    if (!preview) {
      const row = 9 + index;
      prepareContinuousOrderRow(sheet, row, region, referenceFormula);
      writeOrderToRow(sheet, row, order, placement, expanded);
      writtenRows.push(row);
    }
  }

  const summary = {
    targetOrders: sortedOrders.length,
    placedOrders,
    unclassifiedOrders: unclassified.length,
    mappingErrorCount,
    warnings,
    unclassified,
    previewRows,
    filename: EXPORT_FILENAME,
  };

  if (preview) return { summary, workbook: null, buffer: null };

  const buffer = await createPreservedTemplateBuffer(sheet, writtenRows, unclassified);
  return { summary, workbook, buffer: Buffer.from(buffer) };
}

export { EXPORT_FILENAME, TEMPLATE_PATH };
