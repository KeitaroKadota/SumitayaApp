// CROSS MALL の受注CSV・在庫CSV → 整えた注文・在庫(B-01 01 7.1・7.2、03 EV-03 手順4〜6・EV-05 手順2〜3、
// 04 CH-02〜CH-07・CH-11)。列の対応表は csvMapping.ts。DBを読まない計算だけのファイル
// (商品マスタ・今の受注との照らし合わせは orders.ts・inventoryLevels.ts で行う)。
import type { CsvRow } from "@/utils/csvImport/engine";
import { resolveColumns } from "@/utils/csvImport/engine";
import { hasNamePrintKeyword } from "@/utils/orderExceptionRules";
import { normalizeProductCode } from "@/utils/productRules";
import { isValidDateStr, stripNumberDecorations, toHalfWidth } from "@/utils/textNormalize";
import {
  CANCEL_STATUS_KEYWORDS,
  DEFAULT_LOCATION_CODE,
  NO_CUSTOMIZATION_VALUES,
  ORDER_COLUMNS,
  ORDER_REQUIRED_FIELDS,
  PAYMENT_STATUS_RULES,
  SHOP_RULES,
  STOCK_COLUMNS,
  STOCK_REQUIRED_FIELDS,
  type OrderField,
  type StockField,
} from "./csvMapping";
import type { NormalizedOrder, NormalizedOrderItem, NormalizedStock, PaymentStatus, Shop } from "./types";

// 金額の上限(integer に入る範囲。00_共通設計 7.3)
const MAX_AMOUNT = 2_000_000_000;
// 数量の上限(CH-04)
const MAX_QUANTITY = 99_999;

// 【仮】文字の項目の長さの上限(DB の CHECK と同じ値。00_仮決め一覧 B-01-仮-13)
const MAX_LENGTHS: Partial<Record<OrderField, number>> = {
  crossmallOrderNo: 100,
  shopOrderNo: 100,
  crossmallStatus: 100,
  customerName: 200,
  customerKana: 200,
  customerEmail: 254,
  customerPhone: 50,
  shipName: 200,
  shipPrefecture: 20,
  shipAddress1: 300,
  shipAddress2: 300,
  shipPhone: 50,
  paymentMethod: 100,
  customerNote: 5000,
  productCode: 100,
  productName: 300,
  optionText: 2000,
  customization: 2000,
};
const FIELD_LABELS: Partial<Record<OrderField, string>> = {
  crossmallOrderNo: "受注番号",
  shopOrderNo: "注文番号",
  crossmallStatus: "状態",
  customerName: "注文者名",
  customerKana: "注文者名のふりがな",
  customerEmail: "メールアドレス",
  customerPhone: "電話番号",
  shipName: "届け先の名前",
  shipPrefecture: "届け先の都道府県",
  shipAddress1: "届け先の住所",
  shipAddress2: "届け先の建物名",
  shipPhone: "届け先の電話番号",
  paymentMethod: "支払方法",
  customerNote: "備考",
  productCode: "商品コード",
  productName: "商品名",
  optionText: "選択項目",
  customization: "名入れ",
};

// CH-02 見出しの前後の空白・全角半角の違いは無視して比べる
const normalizeHeader = (value: string): string => toHalfWidth(value).trim();

const resolve = <F extends string>(header: string[], columns: Record<F, readonly string[]>) => {
  const normalized = {} as Record<F, string[]>;
  for (const f of Object.keys(columns) as F[]) normalized[f] = columns[f].map(normalizeHeader);
  return resolveColumns(header.map(normalizeHeader), normalized);
};

// 元の行(列名→値)。同じ列名が2回あるときは「列名(2)」のように番号を付けて残す
const toRawRow = (header: string[], cells: string[]): Record<string, string> => {
  const raw: Record<string, string> = {};
  header.forEach((h, i) => {
    let key = h || `列${i + 1}`;
    for (let n = 2; key in raw; n += 1) key = `${h || `列${i + 1}`}(${n})`;
    raw[key] = cells[i] ?? "";
  });
  return raw;
};

const includesAny = (value: string, keywords: readonly string[]): boolean => {
  const v = toHalfWidth(value).toLowerCase();
  return keywords.some((k) => v.includes(toHalfWidth(k).toLowerCase()));
};

// CH-03 注文日時: YYYY/MM/DD HH:MM(:SS)・YYYY-MM-DD HH:MM(:SS) を日本時間として読む
export const parseJstDateTime = (value: string): Date | null => {
  const m = toHalfWidth(value)
    .trim()
    .match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const [hh, mm, ss] = [Number(m[4]), Number(m[5]), Number(m[6] ?? "0")];
  if (!isValidDateStr(date) || hh > 23 || mm > 59 || ss > 59) return null;
  return new Date(`${date}T${String(hh).padStart(2, "0")}:${m[5]}:${String(ss).padStart(2, "0")}+09:00`);
};

// 日付(出荷日・お届け希望日): 先頭の YYYY/MM/DD・YYYY-MM-DD を読む(後ろに時刻があってもよい)。空は null、読めなければ "error"
const parseDateOnly = (value: string): string | null | "error" => {
  const s = toHalfWidth(value).trim();
  if (s === "") return null;
  const m = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T].*)?$/);
  if (!m) return "error";
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return isValidDateStr(date) ? date : "error";
};

// CH-04 金額: 「,」「円」「¥」を取り除いて整数として読む。空なら 0。読めなければ null
const parseAmount = (value: string): number | null => {
  const s = stripNumberDecorations(value);
  if (s === "") return 0;
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return Math.abs(n) <= MAX_AMOUNT ? n : null;
};

// CH-04 数量・在庫数: 整数として読む。空は "empty"、読めない・範囲外は null
const parseInteger = (value: string, min: number, max: number): number | null | "empty" => {
  const s = stripNumberDecorations(value);
  if (s === "") return "empty";
  if (!/^-?\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
};

// CH-05 販路
const toShop = (value: string): Shop | null => {
  if (!value.trim()) return null;
  return SHOP_RULES.find((r) => includesAny(value, r.keywords))?.shop ?? null;
};

// CH-06 支払状況
const toPaymentStatus = (value: string): PaymentStatus =>
  value.trim() ? (PAYMENT_STATUS_RULES.find((r) => includesAny(value, r.keywords))?.status ?? "unknown") : "unknown";

// CH-06 郵便番号: 数字以外を取り除き、7桁ならそのまま、それ以外は元の文字のまま
const toPostalCode = (value: string): string | null => {
  const s = value.trim();
  if (!s) return null;
  const digits = toHalfWidth(s).replace(/\D/g, "");
  return digits.length === 7 ? digits : s;
};

// CH-06・CH-13 電話番号を数字だけに(全角は半角に)。空・20桁を超えるときは null
export const phoneDigits = (value: string): string | null => {
  const digits = toHalfWidth(value).replace(/\D/g, "");
  return digits.length >= 1 && digits.length <= 20 ? digits : null;
};

// CH-06 メールアドレス: 前後の空白を取り、小文字にそろえる
export const normalizeEmail = (value: string): string | null => {
  const s = toHalfWidth(value).trim().toLowerCase();
  return s ? s : null;
};

const orEmpty = (value: string): string | null => (value === "" ? null : value);

// ---- 受注CSV ----

export type ParsedOrderEntry = {
  // CSV の行番号(同じ注文の行すべて)
  lines: number[];
  crossmallOrderNo: string;
  // エラーが無いときだけ入る
  order: NormalizedOrder | null;
  errors: string[];
  warnings: string[];
};

export type ParsedOrderCsv =
  | { ok: true; dataRowCount: number; unusedColumns: string[]; entries: ParsedOrderEntry[] }
  | { ok: false; error: string };

type RowValues = {
  line: number;
  raw: Record<string, string>;
  errors: string[];
  warnings: string[];
  order: Omit<NormalizedOrder, "items" | "rawRows">;
  item: Omit<NormalizedOrderItem, "lineNo"> | null;
};

export const parseOrderCsv = (header: string[], rows: CsvRow[]): ParsedOrderCsv => {
  // CH-02 必須の列
  const { index, unused } = resolve(header, ORDER_COLUMNS);
  const missing = ORDER_REQUIRED_FIELDS.filter((f) => index[f.field] === undefined).map((f) => f.label);
  if (missing.length > 0)
    return { ok: false, error: `CROSS MALL の受注CSVではないようです。足りない列: ${missing.join("、")}` };
  if (rows.length === 0) return { ok: false, error: "データの行がありません。" };

  const cell = (r: CsvRow, f: OrderField): string => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };
  const hasColumn = (f: OrderField) => index[f] !== undefined;

  const readRow = (r: CsvRow): RowValues => {
    const errors: string[] = [];
    const warnings: string[] = [];

    // 文字の長さ
    for (const [field, max] of Object.entries(MAX_LENGTHS) as [OrderField, number][]) {
      if (cell(r, field).length > max) errors.push(`${FIELD_LABELS[field] ?? field}が長すぎます（${max}文字まで）`);
    }

    // CH-03 受注番号・注文日時
    const crossmallOrderNo = cell(r, "crossmallOrderNo");
    if (!crossmallOrderNo) errors.push("受注番号がありません");
    const orderedAt = parseJstDateTime(cell(r, "orderedAt"));
    if (!orderedAt) errors.push(cell(r, "orderedAt") ? "注文日時の形が正しくありません" : "注文日時がありません");

    // CH-05 販路
    const shopValue = cell(r, "shop");
    const shop = toShop(shopValue);
    if (!shop) warnings.push(shopValue ? `販路「${shopValue}」が分からないため「その他」にしました` : "販路が分からないため「その他」にしました");

    // CH-04 金額(注文)
    const amount = (f: OrderField, label: string): number => {
      const n = parseAmount(cell(r, f));
      if (n === null) {
        errors.push(`${label}が整数ではありません`);
        return 0;
      }
      return n;
    };
    const subtotal = amount("subtotal", "商品合計");
    const shippingFee = amount("shippingFee", "送料");
    const discount = amount("discount", "値引き");
    const tax = amount("tax", "消費税");
    const total = amount("total", "合計金額");

    // 日付(出荷日・お届け希望日)。読めなければ空にして警告
    const dateOf = (f: OrderField, label: string): string | null => {
      const d = parseDateOnly(cell(r, f));
      if (d === "error") {
        warnings.push(`${label}「${cell(r, f)}」を読めないため空にしました`);
        return null;
      }
      return d;
    };
    const shippedOn = dateOf("shippedOn", "出荷日");
    const requestedDeliveryDate = dateOf("requestedDeliveryDate", "お届け希望日");

    // CH-06 状態・キャンセル
    const crossmallStatus = cell(r, "crossmallStatus");
    const customerPhone = cell(r, "customerPhone");

    // ---- 明細 ----
    let item: RowValues["item"] = null;
    const productCode = normalizeProductCode(cell(r, "productCode"));
    if (!productCode) errors.push("商品コードがありません");
    const quantity = parseInteger(cell(r, "quantity"), 1, MAX_QUANTITY);
    if (quantity === "empty") errors.push("数量がありません");
    else if (quantity === null) errors.push(`数量は1〜${MAX_QUANTITY}の整数にしてください`);
    const unitPrice = parseAmount(cell(r, "unitPrice"));
    if (unitPrice === null) errors.push("単価が整数ではありません");
    const lineAmountText = cell(r, "amount");
    const lineAmount = parseAmount(lineAmountText);
    if (lineAmount === null) errors.push("金額が整数ではありません");

    if (productCode && typeof quantity === "number" && unitPrice !== null && lineAmount !== null) {
      // CH-06 名入れ・加工
      const optionText = orEmpty(cell(r, "optionText"));
      let hasCustomization = false;
      let customizationText: string | null = null;
      if (hasColumn("customization")) {
        const v = cell(r, "customization");
        if (v && !NO_CUSTOMIZATION_VALUES.includes(toHalfWidth(v).trim())) {
          hasCustomization = true;
          customizationText = v;
        }
      } else if (optionText && hasNamePrintKeyword(optionText)) {
        hasCustomization = true;
        customizationText = optionText;
      }
      item = {
        productCode,
        productName: cell(r, "productName"),
        optionText,
        hasCustomization,
        customizationText,
        quantity,
        unitPrice,
        // 金額がCSVに無ければ 単価×数量
        amount: lineAmountText === "" ? unitPrice * quantity : lineAmount,
      };
    }

    return {
      line: r.line,
      raw: toRawRow(header, r.cells),
      errors,
      warnings,
      item,
      order: {
        crossmallOrderNo,
        shop: shop ?? "other",
        shopOrderNo: orEmpty(cell(r, "shopOrderNo")),
        orderedAt: orderedAt ?? new Date(0),
        crossmallStatus: orEmpty(crossmallStatus),
        isCancelled: crossmallStatus !== "" && includesAny(crossmallStatus, CANCEL_STATUS_KEYWORDS),
        shippedOn,
        customerName: cell(r, "customerName"),
        customerKana: cell(r, "customerKana"),
        customerEmail: normalizeEmail(cell(r, "customerEmail")),
        customerPhone: orEmpty(customerPhone),
        customerPhoneDigits: phoneDigits(customerPhone),
        shipName: cell(r, "shipName"),
        shipPostalCode: toPostalCode(cell(r, "shipPostalCode")),
        shipPrefecture: orEmpty(cell(r, "shipPrefecture")),
        shipAddress1: orEmpty(cell(r, "shipAddress1")),
        shipAddress2: orEmpty(cell(r, "shipAddress2")),
        shipPhone: orEmpty(cell(r, "shipPhone")),
        paymentMethod: orEmpty(cell(r, "paymentMethod")),
        paymentStatus: toPaymentStatus(cell(r, "paymentStatus")),
        requestedDeliveryDate,
        customerNote: orEmpty(cell(r, "customerNote")),
        subtotal,
        shippingFee,
        discount,
        tax,
        total,
      },
    };
  };

  // EV-03 手順6: 受注番号で行をまとめる(CSVに出てきた順)
  const groups = new Map<string, RowValues[]>();
  const entries: ParsedOrderEntry[] = [];
  for (const r of rows) {
    const values = readRow(r);
    // 列の数が見出しと違う行(CH-01 の形の違い)
    if (r.cells.length !== header.length) values.errors.push("列の数が見出しと合いません");
    const key = values.order.crossmallOrderNo;
    if (!key) {
      // 受注番号の無い行は、まとめられないので1行だけのエラーにする
      entries.push({ lines: [r.line], crossmallOrderNo: "", order: null, errors: values.errors, warnings: values.warnings });
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(values);
    else groups.set(key, [values]);
  }

  for (const [crossmallOrderNo, list] of groups) {
    const lines = list.map((v) => v.line);
    const errors = list.flatMap((v) => (list.length > 1 ? v.errors.map((e) => `${v.line}行目: ${e}`) : v.errors));
    // 同じ警告(販路など)は1回だけ出す
    const warnings = [...new Set(list.flatMap((v) => v.warnings))];
    const first = list[0];

    // CH-07 同じ注文の行で、注文日時・注文者の名前・合計金額がそろっている
    const mismatched: string[] = [];
    for (const v of list.slice(1)) {
      if (v.order.orderedAt.getTime() !== first.order.orderedAt.getTime()) mismatched.push("注文日時");
      if (v.order.customerName !== first.order.customerName) mismatched.push("注文者名");
      if (v.order.total !== first.order.total) mismatched.push("合計金額");
    }
    if (mismatched.length > 0)
      errors.push(`同じ受注番号の行で${[...new Set(mismatched)].join("・")}が違います（別の注文が同じ番号になっていないか確かめてください）`);

    if (errors.length > 0) {
      entries.push({ lines, crossmallOrderNo, order: null, errors, warnings });
      continue;
    }
    entries.push({
      lines,
      crossmallOrderNo,
      errors: [],
      warnings,
      order: {
        ...first.order,
        items: list.flatMap((v, i) => (v.item ? [{ ...v.item, lineNo: i + 1 }] : [])),
        rawRows: list.map((v) => v.raw),
      },
    });
  }

  return { ok: true, dataRowCount: rows.length, unusedColumns: unused, entries };
};

// ---- 在庫CSV ----

export type ParsedStockEntry = {
  line: number;
  productCode: string;
  // エラーが無いときだけ入る
  stock: NormalizedStock | null;
  errors: string[];
  warnings: string[];
};

export type ParsedStockCsv =
  | { ok: true; dataRowCount: number; unusedColumns: string[]; entries: ParsedStockEntry[] }
  | { ok: false; error: string };

export const parseStockCsv = (header: string[], rows: CsvRow[]): ParsedStockCsv => {
  // CH-02 必須の列
  const { index, unused } = resolve(header, STOCK_COLUMNS);
  const missing = STOCK_REQUIRED_FIELDS.filter((f) => index[f.field] === undefined).map((f) => f.label);
  if (missing.length > 0)
    return { ok: false, error: `CROSS MALL の在庫CSVではないようです。足りない列: ${missing.join("、")}` };
  if (rows.length === 0) return { ok: false, error: "データの行がありません。" };

  const cell = (r: CsvRow, f: StockField): string => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };

  const firstLineByCode = new Map<string, number>();
  const entries = rows.map((r): ParsedStockEntry => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (r.cells.length !== header.length) errors.push("列の数が見出しと合いません");

    const productCode = normalizeProductCode(cell(r, "productCode"));
    if (!productCode) errors.push("商品コードがありません");
    else {
      // CH-11 同じ商品コードが2回出ない(置き場所は main の1か所だけなので、商品コードだけで見る)
      const first = firstLineByCode.get(productCode);
      if (first !== undefined) errors.push(`${first}行目と同じ商品コードです`);
      else firstLineByCode.set(productCode, r.line);
    }

    // CH-04 在庫数: -99999〜99999(マイナスは警告)
    const quantity = parseInteger(cell(r, "quantity"), -MAX_QUANTITY, MAX_QUANTITY);
    if (quantity === "empty") errors.push("在庫数がありません");
    else if (quantity === null) errors.push(`在庫数は${-MAX_QUANTITY}〜${MAX_QUANTITY}の整数にしてください`);
    else if (quantity < 0) warnings.push("在庫数がマイナスです");

    const optional = (f: StockField, label: string): number | null => {
      const n = parseInteger(cell(r, f), -MAX_QUANTITY, MAX_QUANTITY);
      if (n === "empty") return null;
      if (n === null) {
        errors.push(`${label}は${-MAX_QUANTITY}〜${MAX_QUANTITY}の整数にしてください`);
        return null;
      }
      return n;
    };
    const allocatedQuantity = optional("allocatedQuantity", "引当済みの数");
    const availableCsv = optional("availableQuantity", "引き当て可能な数");

    if (errors.length > 0 || typeof quantity !== "number") return { line: r.line, productCode, stock: null, errors, warnings };
    // 引き当て可能な数: CSVにあればその値、無くて引当済みがあれば 在庫数−引当済み、どちらも無ければ空(01 6.3)
    const computed = allocatedQuantity !== null ? quantity - allocatedQuantity : null;
    const availableQuantity =
      availableCsv ?? (computed !== null && Math.abs(computed) <= MAX_QUANTITY ? computed : null);
    return {
      line: r.line,
      productCode,
      errors,
      warnings,
      stock: { productCode, locationCode: DEFAULT_LOCATION_CODE, quantity, allocatedQuantity, availableQuantity },
    };
  });

  return { ok: true, dataRowCount: rows.length, unusedColumns: unused, entries };
};
