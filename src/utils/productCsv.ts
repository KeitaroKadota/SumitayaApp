// 商品のCSV取り込み(CMN-02 EV-10〜EV-12、04 CH-21〜CH-24)。A-01 の共通の仕組み(src/utils/csvImport)の
// 「取り込みの種類 products」の中身: 列の対応表・行のチェック・分類(追加／更新／変更なし／エラー)・保存。
// 空欄の項目は「変更しない」(【仮】00_仮決め一覧 CMN02-仮-13)。abc_rank などの分析の列は読まない(CH-14)。
import { query, type TransactionSql } from "@/utils/db";
import { formatQuantity } from "@/utils/format";
import { PRODUCT_CATEGORIES } from "@/utils/masterRules";
import {
  checkJanCode,
  checkProductCode,
  lotWarning,
  normalizeProductCode,
  parseCategory,
  parseLeadTimeDays,
  parseOrderUnit,
  parsePrice,
  parseTaxRate,
} from "@/utils/productRules";
import { toHalfWidth } from "@/utils/textNormalize";
import type { CsvRow } from "@/utils/csvImport/engine";
import { resolveColumns } from "@/utils/csvImport/engine";
import type { ImportCounts } from "@/utils/csvImport/batches";

// 【仮】1回に取り込める行数(00_仮決め一覧 CMN02-仮-12。ヒアリング No.34)
export const PRODUCT_CSV_MAX_ROWS = 20_000;
// 1回の SQL で送る行数(EV-12 の注)
const CHUNK_SIZE = 500;
// 確認の画面に返す行の数(区分ごと。02 G06「200行ずつ表示」)
export const PREVIEW_ROWS_PER_KIND = 200;

// ひな形の列(EV-10 の表の順)。見出しの別名は、CROSS MALL の商品CSV(No.49)・すみたやのExcel(No.35)の
// 見本が届いたら、候補の並びに足す(例:「商品管理番号」→ 商品コード)
export const PRODUCT_CSV_COLUMNS = {
  product_code: ["商品コード"],
  item_code: ["品番"],
  name: ["商品名"],
  size: ["サイズ"],
  color: ["色"],
  jan_code: ["JANコード"],
  category_code: ["分類"],
  supplier_code: ["主な仕入先コード"],
  cost_price: ["原価"],
  sell_price: ["売価"],
  sell_price_tax_included: ["売価の税区分"],
  tax_rate: ["税率"],
  is_in_house: ["自社縫製"],
  order_lot: ["発注の単位"],
  min_order_qty: ["最低の発注数"],
  lead_time_days: ["届くまでの日数"],
  is_active: ["使用中"],
} as const satisfies Record<string, readonly string[]>;
type CsvField = keyof typeof PRODUCT_CSV_COLUMNS;

// ---- CROSS MALL のCSV(CMN-02 01 の 11章。2026-11-25) ----
// 見出しで形を見分ける(04 の CH-21)。見出しは全角・半角をそろえて比べる
export type ProductCsvFormat = "template" | "crossmall_sku" | "crossmall_item";
export const PRODUCT_CSV_FORMAT_LABELS: Record<ProductCsvFormat, string> = {
  template: "ひな形CSV",
  crossmall_sku: "CROSS MALL の在庫CSV（SKUごとに商品を作る・直す）",
  crossmall_item: "CROSS MALL の商品マスタCSV（同じ親の商品のSKUの金額・税率・仕入先を直す）",
};

// ① 在庫CSV(1行＝SKU)
const CROSSMALL_SKU_COLUMNS = {
  sku_code: ["SKUコード"],
  item_code: ["商品コード"],
  name: ["商品名"],
  attribute1_name: ["属性1名"],
  attribute2_name: ["属性2名"],
  supplier_code: ["仕入先コード"],
  list_price: ["定価(税別)"],
  remark: ["商品備考"],
} as const satisfies Record<string, readonly string[]>;
type SkuField = keyof typeof CROSSMALL_SKU_COLUMNS;

// ② 商品マスタCSV(1行＝親の商品)
const CROSSMALL_ITEM_COLUMNS = {
  item_code: ["商品コード"],
  name: ["商品名"],
  cost_price: ["原価", "仕入単価(税別)"],
  sell_price: ["売上単価(税別)", "定価(税別)"],
  supplier_code: ["仕入先コード"],
  tax_code: ["税区分コード"],
} as const satisfies Record<string, readonly string[]>;
type ItemField = keyof typeof CROSSMALL_ITEM_COLUMNS;

// 【仮】商品名にこの言葉があれば使用中止にする(00_仮決め一覧 CMN02-仮-28)
const DISCONTINUED_KEYWORDS = ["廃盤", "廃番"];
// 【仮】税区分コード → 税率。2 は意味が未確認のため税率を変えない(00_仮決め一覧 CMN02-仮-29)
const CROSSMALL_TAX_RATES: Record<string, number> = { "1": 10 };
// 商品備考の長さ(DB の CHECK と同じ)
const MAX_REMARK_LENGTH = 500;

const normalizeHeader = (value: string): string => toHalfWidth(value).trim();

// CH-21 形を見分ける
export const detectProductCsvFormat = (header: string[]): ProductCsvFormat => {
  const h = new Set(header.map(normalizeHeader));
  if (h.has("SKUコード") && h.has("在庫数量")) return "crossmall_sku";
  if (h.has("仕入単価(税別)") && !h.has("SKUコード")) return "crossmall_item";
  return "template";
};

const resolveNormalized = <F extends string>(header: string[], columns: Record<F, readonly string[]>) => {
  const normalized = {} as Record<F, string[]>;
  for (const f of Object.keys(columns) as F[]) normalized[f] = columns[f].map(normalizeHeader);
  return resolveColumns(header.map(normalizeHeader), normalized);
};

// EV-10 ひな形CSV: 見出しと記入例1行
export const productTemplateRows = (): string[][] => [
  (Object.keys(PRODUCT_CSV_COLUMNS) as CsvField[]).map((f) => PRODUCT_CSV_COLUMNS[f][0]),
  ["HP-001-L", "HP-001", "本染め法被 紺", "L", "紺", "", "happi", "", "5000", "12100", "税込", "10", "1", "10", "20", "", "1"],
];

// CSVで送られた値(undefined は空欄=変更しない)
type ProductCsvValues = {
  item_code?: string;
  name?: string;
  size?: string;
  color?: string;
  jan_code?: string;
  category_code?: string;
  main_supplier_id?: string;
  cost_price?: number;
  sell_price?: number;
  sell_price_tax_included?: boolean;
  tax_rate?: number;
  is_in_house?: boolean;
  order_lot?: number;
  min_order_qty?: number;
  lead_time_days?: number;
  is_active?: boolean;
  crossmall_remark?: string;
};

// skip: CROSS MALL の商品マスタCSVで、当たるSKUが1つも無い行(登録しない)
export type PlannedRowKind = "add" | "update" | "same" | "skip" | "error";

type PlannedRow = {
  line: number;
  kind: PlannedRowKind;
  productCode: string;
  name: string;
  // エラーの理由、または更新の「旧 → 新」
  messages: string[];
  warnings: string[];
  values: ProductCsvValues;
  // CROSS MALL の商品マスタCSV: この行で直すSKUの商品コード(1行で複数のSKUを直す)
  targetCodes?: string[];
};

// 確認の画面に返す行(DBの行そのものは返さない。A-01 0.4)
export type ProductPreviewRow = {
  line: number;
  kind: PlannedRowKind;
  productCode: string;
  name: string;
  detail: string;
  warning: string | null;
};

export type ProductImportPlan =
  | {
      ok: true;
      format: ProductCsvFormat;
      dataRowCount: number;
      counts: ImportCounts;
      unusedColumns: string[];
      rows: PlannedRow[];
    }
  | { ok: false; error: string };

// 今の商品(比べるための列)
type ExistingProduct = {
  product_code: string;
  item_code: string | null;
  name: string;
  size: string | null;
  color: string | null;
  jan_code: string | null;
  category_code: string | null;
  main_supplier_id: string | null;
  supplier_code: string | null;
  cost_price: number | null;
  sell_price: number | null;
  sell_price_tax_included: boolean;
  tax_rate: number;
  is_in_house: boolean;
  order_lot: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  is_active: boolean;
  crossmall_remark: string | null;
};

const MAX_TEXT_LENGTH = 100;
const MAX_NAME_LENGTH = 200;

// はい/いいえ(自社縫製・使用中。CH-22): 1・0・○・はい・いいえ・空
const parseYesNo = (value: string): boolean | null | "error" => {
  const s = toHalfWidth(value).trim();
  if (s === "") return null;
  if (s === "1" || s === "○" || s === "はい") return true;
  if (s === "0" || s === "いいえ") return false;
  return "error";
};

// 売価の税区分(CH-12): 税込・税抜・1・0・空
const parseTaxIncluded = (value: string): boolean | null | "error" => {
  const s = toHalfWidth(value).trim();
  if (s === "") return null;
  if (s === "税込" || s === "1") return true;
  if (s === "税抜" || s === "0") return false;
  return "error";
};

const yen = (n: number | null | undefined) => (n === null || n === undefined ? "（空）" : `${formatQuantity(n)}円`);
const text = (s: string | null | undefined) => (s === null || s === undefined || s === "" ? "（空）" : s);
const yesNo = (b: boolean) => (b ? "はい" : "いいえ");

// 今の商品を商品コードでまとめて読む
const EXISTING_COLUMNS_SQL = `p.product_code, p.item_code, p.name, p.size, p.color, p.jan_code, p.category_code, p.main_supplier_id,
  s.supplier_code, p.cost_price, p.sell_price, p.sell_price_tax_included, p.tax_rate, p.is_in_house,
  p.order_lot, p.min_order_qty, p.lead_time_days, p.is_active, p.crossmall_remark`;

const loadSuppliers = async (codes: string[]): Promise<Map<string, string>> => {
  if (codes.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<{ id: string; supplier_code: string }[]>`
      select id, supplier_code from suppliers where supplier_code = any(${codes}::text[])`
  );
  return new Map(rows.map((s) => [s.supplier_code, s.id]));
};

// 更新の「旧 → 新」(違う列だけ)
const diffsOf = (values: ProductCsvValues, current: ExistingProduct, supplierCode: string): string[] => {
  const diffs: string[] = [];
  const cmp = <T,>(label: string, next: T | undefined, prev: T, show: (v: T) => string) => {
    if (next !== undefined && next !== prev) diffs.push(`${label} ${show(prev)} → ${show(next)}`);
  };
  cmp("品番", values.item_code, current.item_code, text);
  cmp("商品名", values.name, current.name, text);
  cmp("サイズ", values.size, current.size, text);
  cmp("色", values.color, current.color, text);
  cmp("JANコード", values.jan_code, current.jan_code, text);
  cmp("分類", values.category_code, current.category_code, (c) => (c ? (PRODUCT_CATEGORIES[c] ?? c) : "（空）"));
  if (values.main_supplier_id !== undefined && values.main_supplier_id !== current.main_supplier_id)
    diffs.push(`主な仕入先 ${text(current.supplier_code)} → ${supplierCode}`);
  cmp("原価", values.cost_price, current.cost_price, yen);
  cmp("売価", values.sell_price, current.sell_price, yen);
  cmp("売価の税区分", values.sell_price_tax_included, current.sell_price_tax_included, (b) => (b ? "税込" : "税抜"));
  cmp("税率", values.tax_rate, current.tax_rate, (n) => `${n}％`);
  cmp("自社縫製", values.is_in_house, current.is_in_house, yesNo);
  cmp("発注の単位", values.order_lot, current.order_lot, (n) => (n === null ? "（空）" : String(n)));
  cmp("最低の発注数", values.min_order_qty, current.min_order_qty, (n) => (n === null ? "（空）" : String(n)));
  cmp("届くまでの日数", values.lead_time_days, current.lead_time_days, (n) => (n === null ? "（空）" : `${n}日`));
  cmp("使用中", values.is_active, current.is_active, yesNo);
  cmp("商品備考", values.crossmall_remark, current.crossmall_remark, text);
  return diffs;
};

const countKinds = (planned: PlannedRow[]): ImportCounts => {
  const count = (k: PlannedRowKind) => planned.filter((p) => p.kind === k).length;
  return { add: count("add"), change: count("update"), same: count("same"), delete: 0, skip: count("skip"), error: count("error") };
};

// ① CROSS MALL の在庫CSV → SKUごとの商品(01 の 11.1)
const planCrossmallSku = async (header: string[], rows: CsvRow[]): Promise<ProductImportPlan> => {
  const { index, unused, duplicated } = resolveNormalized(header, CROSSMALL_SKU_COLUMNS);
  if (duplicated.length > 0) return { ok: false, error: `見出しに同じ列名が2回あります: ${duplicated.join("、")}` };
  const cell = (r: CsvRow, f: SkuField) => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };

  const codes = [...new Set(rows.map((r) => normalizeProductCode(cell(r, "sku_code"))).filter(Boolean))];
  const existingRows =
    codes.length === 0
      ? []
      : await query(
          (sql) => sql<ExistingProduct[]>`
            select ${sql.unsafe(EXISTING_COLUMNS_SQL)}
            from products p left join suppliers s on s.id = p.main_supplier_id
            where p.product_code = any(${codes}::text[])`,
          { timeoutMs: 30_000 }
        );
  const existing = new Map(existingRows.map((p) => [p.product_code, p]));
  const supplierIdByCode = await loadSuppliers([
    ...new Set(rows.map((r) => toHalfWidth(cell(r, "supplier_code")).trim()).filter(Boolean)),
  ]);

  const firstLineByCode = new Map<string, number>();
  const planned: PlannedRow[] = [];
  for (const r of rows) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const values: ProductCsvValues = {};
    if (r.cells.length !== header.length) errors.push("列の数が合いません");

    // CH-08 SKUコード・CH-23 重複
    const productCode = normalizeProductCode(cell(r, "sku_code"));
    const codeError = checkProductCode(productCode);
    if (codeError) errors.push(productCode ? "SKUコードの形が正しくありません" : "SKUコードがありません");
    else {
      const first = firstLineByCode.get(productCode);
      if (first !== undefined) errors.push(`${first}行目と同じSKUコードです`);
      else firstLineByCode.set(productCode, r.line);
    }
    const current = !codeError ? existing.get(productCode) : undefined;

    const itemCode = toHalfWidth(cell(r, "item_code")).trim();
    if (itemCode.length > MAX_TEXT_LENGTH) errors.push(`商品コードが長すぎます（${MAX_TEXT_LENGTH}文字まで）`);
    else if (itemCode) values.item_code = itemCode;

    // 商品名＋属性(CMN02-仮-27)。200文字を超えるときは商品名だけ
    const baseName = cell(r, "name");
    if (!baseName) {
      if (!current) errors.push("商品名がありません");
    } else if (baseName.length > MAX_NAME_LENGTH) errors.push(`商品名が長すぎます（${MAX_NAME_LENGTH}文字まで）`);
    else {
      const full = [baseName, cell(r, "attribute1_name"), cell(r, "attribute2_name")].filter(Boolean).join(" ");
      if (full.length > MAX_NAME_LENGTH) {
        values.name = baseName;
        warnings.push("商品名と属性を合わせると長すぎるため、商品名だけにしました");
      } else values.name = full;
      // 廃盤の商品は使用中止にする(CMN02-仮-28)
      if (DISCONTINUED_KEYWORDS.some((k) => baseName.includes(k))) values.is_active = false;
    }

    const supplierCode = toHalfWidth(cell(r, "supplier_code")).trim();
    if (supplierCode) {
      const id = supplierIdByCode.get(supplierCode);
      if (id) values.main_supplier_id = id;
      else warnings.push(`仕入先コード ${supplierCode} が見つかりません（${current ? "今の値のまま" : "空で登録"}）`);
    }

    // 定価(税別)を売価(税抜)に
    const price = parsePrice(cell(r, "list_price"), "定価");
    if (!price.ok) errors.push("定価が数ではありません");
    else if (price.value !== null) {
      values.sell_price = price.value;
      values.sell_price_tax_included = false;
    }

    const remark = cell(r, "remark");
    if (remark.length > MAX_REMARK_LENGTH) errors.push(`商品備考が長すぎます（${MAX_REMARK_LENGTH}文字まで）`);
    else if (remark) values.crossmall_remark = remark;

    const displayName = values.name ?? current?.name ?? baseName;
    if (errors.length > 0) {
      planned.push({ line: r.line, kind: "error", productCode, name: displayName, messages: errors, warnings, values });
    } else if (!current) {
      planned.push({ line: r.line, kind: "add", productCode, name: displayName, messages: [], warnings, values });
    } else {
      const diffs = diffsOf(values, current, supplierCode);
      planned.push({ line: r.line, kind: diffs.length > 0 ? "update" : "same", productCode, name: displayName, messages: diffs, warnings, values });
    }
  }
  return { ok: true, format: "crossmall_sku", dataRowCount: rows.length, unusedColumns: unused, rows: planned, counts: countKinds(planned) };
};

// ② CROSS MALL の商品マスタCSV → 同じ親の商品のすべてのSKU(01 の 11.2)
const planCrossmallItem = async (header: string[], rows: CsvRow[]): Promise<ProductImportPlan> => {
  const { index, unused, duplicated } = resolveNormalized(header, CROSSMALL_ITEM_COLUMNS);
  if (duplicated.length > 0) return { ok: false, error: `見出しに同じ列名が2回あります: ${duplicated.join("、")}` };
  if (index.item_code === undefined) return { ok: false, error: "『商品コード』の列が見つかりません。" };
  const cell = (r: CsvRow, f: ItemField) => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };

  // 親の商品コード(item_code)か、属性の無い商品の商品コード(product_code)が同じ商品
  const codes = [...new Set(rows.map((r) => normalizeProductCode(cell(r, "item_code"))).filter(Boolean))];
  const codeSet = new Set(codes);
  // 「= any(配列) or = any(配列)」だと、商品が1万件を超えたときに1行ずつ配列を探して30秒を超えたため、
  // 商品コードの表(c)を作り、in (select ...) で照らし合わせる(PostgreSQL が表を作って一度に照らす)
  const existingRows =
    codes.length === 0
      ? []
      : await query(
          (sql) => sql<ExistingProduct[]>`
            with c (code) as (select distinct unnest(${codes}::text[]))
            select ${sql.unsafe(EXISTING_COLUMNS_SQL)}
            from products p left join suppliers s on s.id = p.main_supplier_id
            where p.item_code in (select code from c) or p.product_code in (select code from c)
            order by p.product_code`,
          { timeoutMs: 30_000 }
        );
  const byItem = new Map<string, ExistingProduct[]>();
  for (const p of existingRows) {
    for (const key of new Set([p.item_code, p.product_code])) {
      if (!key || !codeSet.has(key)) continue;
      byItem.set(key, [...(byItem.get(key) ?? []), p]);
    }
  }
  const supplierIdByCode = await loadSuppliers([
    ...new Set(rows.map((r) => toHalfWidth(cell(r, "supplier_code")).trim()).filter(Boolean)),
  ]);

  const firstLineByCode = new Map<string, number>();
  const planned: PlannedRow[] = [];
  for (const r of rows) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const values: ProductCsvValues = {};
    if (r.cells.length !== header.length) errors.push("列の数が合いません");

    const itemCode = normalizeProductCode(cell(r, "item_code"));
    if (!itemCode) errors.push("商品コードがありません");
    else {
      const first = firstLineByCode.get(itemCode);
      if (first !== undefined) errors.push(`${first}行目と同じ商品コードです`);
      else firstLineByCode.set(itemCode, r.line);
    }

    for (const [field, label] of [
      ["cost_price", "原価"],
      ["sell_price", "売上単価"],
    ] as const) {
      const p = parsePrice(cell(r, field), label);
      if (!p.ok) errors.push(`${label}が数ではありません`);
      else if (p.value !== null) values[field] = p.value;
    }
    if (values.sell_price !== undefined) values.sell_price_tax_included = false;

    const supplierCode = toHalfWidth(cell(r, "supplier_code")).trim();
    if (supplierCode) {
      const id = supplierIdByCode.get(supplierCode);
      if (id) values.main_supplier_id = id;
      else warnings.push(`仕入先コード ${supplierCode} が見つかりません（今の値のまま）`);
    }

    // 税区分コード(CMN02-仮-29)
    const taxCode = toHalfWidth(cell(r, "tax_code")).trim();
    if (taxCode) {
      const rate = CROSSMALL_TAX_RATES[taxCode];
      if (rate !== undefined) values.tax_rate = rate;
      else warnings.push(`税区分コード ${taxCode} の意味が未確認のため、税率は変えません`);
    }

    const targets = itemCode ? (byItem.get(itemCode) ?? []) : [];
    const name = cell(r, "name") || targets[0]?.name || "";
    if (errors.length > 0) {
      planned.push({ line: r.line, kind: "error", productCode: itemCode, name, messages: errors, warnings, values });
      continue;
    }
    if (targets.length === 0) {
      planned.push({
        line: r.line,
        kind: "skip",
        productCode: itemCode,
        name,
        messages: ["この商品のSKUがまだ登録されていません（先に CROSS MALL の在庫CSVを取り込んでください）"],
        warnings,
        values,
      });
      continue;
    }
    // SKUごとに比べ、違うSKUだけを直す
    const changed = targets
      .map((p) => ({ p, diffs: diffsOf(values, p, supplierCode) }))
      .filter((x) => x.diffs.length > 0);
    planned.push({
      line: r.line,
      kind: changed.length > 0 ? "update" : "same",
      productCode: itemCode,
      name,
      messages: changed.length > 0 ? [`SKU ${changed.length}件: ${changed[0].diffs.join("／")}`] : [],
      warnings,
      values,
      targetCodes: changed.map((x) => x.p.product_code),
    });
  }
  return { ok: true, format: "crossmall_item", dataRowCount: rows.length, unusedColumns: unused, rows: planned, counts: countKinds(planned) };
};

// EV-11 手順4・5: 見出しを確かめ、1行ずつチェックして、今の商品と比べて分ける。確認と登録の両方で呼ぶ
export const planProductImport = async (header: string[], rows: CsvRow[]): Promise<ProductImportPlan> => {
  // CH-21 形を見分ける(CROSS MALL の在庫CSV・商品マスタCSV・ひな形)
  const format = detectProductCsvFormat(header);
  if (format === "crossmall_sku") return planCrossmallSku(header, rows);
  if (format === "crossmall_item") return planCrossmallItem(header, rows);

  // CH-21 見出し
  const { index, unused, duplicated } = resolveColumns(header, PRODUCT_CSV_COLUMNS);
  if (duplicated.length > 0) return { ok: false, error: `見出しに同じ列名が2回あります: ${duplicated.join("、")}` };
  if (index.product_code === undefined)
    return { ok: false, error: "『商品コード』の列が見つかりません。ひな形CSVの見出しをお使いください。" };

  const cell = (r: CsvRow, f: CsvField) => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "").trim();
  };

  // 今の商品と仕入先を、まとめて1回ずつ読む
  const codes = [...new Set(rows.map((r) => normalizeProductCode(cell(r, "product_code"))).filter(Boolean))];
  const supplierCodes = [...new Set(rows.map((r) => toHalfWidth(cell(r, "supplier_code")).trim()).filter(Boolean))];
  const existingRows =
    codes.length === 0
      ? []
      : await query(
          (sql) => sql<ExistingProduct[]>`
            select ${sql.unsafe(EXISTING_COLUMNS_SQL)}
            from products p left join suppliers s on s.id = p.main_supplier_id
            where p.product_code = any(${codes}::text[])`,
          { timeoutMs: 30_000 }
        );
  const existing = new Map(existingRows.map((p) => [p.product_code, p]));
  const supplierIdByCode = await loadSuppliers(supplierCodes);

  const firstLineByCode = new Map<string, number>();
  const planned: PlannedRow[] = [];

  for (const r of rows) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const values: ProductCsvValues = {};

    // CH-22 列の数
    if (r.cells.length !== header.length) errors.push("列の数が合いません");

    // CH-08 商品コード(既存の商品と同じなら「更新」。エラーにしない)
    const productCode = normalizeProductCode(cell(r, "product_code"));
    const codeError = checkProductCode(productCode);
    if (codeError) errors.push(productCode ? "商品コードの形が正しくありません" : "商品コードがありません");

    // CH-23 CSVの中の重複: 2回目以降の行はエラー
    if (!codeError) {
      const first = firstLineByCode.get(productCode);
      if (first !== undefined) errors.push(`${first}行目と同じ商品コードです`);
      else firstLineByCode.set(productCode, r.line);
    }
    const current = !codeError ? existing.get(productCode) : undefined;

    // 文字の項目
    for (const [field, label] of [
      ["item_code", "品番"],
      ["size", "サイズ"],
      ["color", "色"],
    ] as const) {
      const v = field === "item_code" ? toHalfWidth(cell(r, field)).trim() : cell(r, field);
      if (!v) continue;
      if (v.length > MAX_TEXT_LENGTH) errors.push(`${label}が長すぎます（${MAX_TEXT_LENGTH}文字まで）`);
      else values[field] = v;
    }

    // CH-09 商品名(新しい商品で空ならエラー)
    const name = cell(r, "name");
    if (name) {
      if (name.length > MAX_NAME_LENGTH) errors.push(`商品名が長すぎます（${MAX_NAME_LENGTH}文字まで）`);
      else values.name = name;
    } else if (!current) errors.push("商品名がありません");

    // CH-10 JANコード
    const jan = toHalfWidth(cell(r, "jan_code")).replace(/\s/g, "");
    if (jan) {
      const check = checkJanCode(jan);
      if (check.error) errors.push("JANコードは数字8桁か13桁にしてください");
      else values.jan_code = jan;
      if (check.warning) warnings.push("JANコードの最後の数字が合いません");
    }

    // 分類
    const category = parseCategory(cell(r, "category_code"));
    if (!category.ok) errors.push(category.error.replace(/。$/, ""));
    else if (category.value) values.category_code = category.value;

    // CH-13 主な仕入先コード(見つからなければ警告にして、新しい商品は空・既存の商品は今の値のまま)
    const supplierCode = toHalfWidth(cell(r, "supplier_code")).trim();
    if (supplierCode) {
      const id = supplierIdByCode.get(supplierCode);
      if (id) values.main_supplier_id = id;
      else warnings.push(`仕入先コード ${supplierCode} が見つかりません（${current ? "今の値のまま" : "空で登録"}）`);
    }

    // CH-11 金額
    for (const [field, label] of [
      ["cost_price", "原価"],
      ["sell_price", "売価"],
    ] as const) {
      const p = parsePrice(cell(r, field), label);
      if (!p.ok) errors.push(`${label}が数ではありません`);
      else if (p.value !== null) values[field] = p.value;
    }

    // CH-12 税区分・税率
    const included = parseTaxIncluded(cell(r, "sell_price_tax_included"));
    if (included === "error") errors.push("売価の税区分は「税込」か「税抜」にしてください");
    else if (included !== null) values.sell_price_tax_included = included;
    const tax = parseTaxRate(cell(r, "tax_rate"));
    if (!tax.ok) errors.push("税率は10・8・0のどれかにしてください");
    else if (tax.value !== null) values.tax_rate = tax.value;

    // 自社縫製・使用中
    for (const [field, label] of [
      ["is_in_house", "自社縫製"],
      ["is_active", "使用中"],
    ] as const) {
      const b = parseYesNo(cell(r, field));
      if (b === "error") errors.push(`${label}は1か0にしてください`);
      else if (b !== null) values[field] = b;
    }

    // CH-35 発注の単位・最低の発注数
    for (const [field, label] of [
      ["order_lot", "発注の単位"],
      ["min_order_qty", "最低の発注数"],
    ] as const) {
      const n = parseOrderUnit(cell(r, field), label);
      if (!n.ok) errors.push(n.error.replace(/。$/, ""));
      else if (n.value !== null) values[field] = n.value;
    }
    const lot = values.order_lot ?? current?.order_lot ?? null;
    const minQty = values.min_order_qty ?? current?.min_order_qty ?? null;
    const lotWarn = lotWarning(lot, minQty);
    if (lotWarn && (values.order_lot !== undefined || values.min_order_qty !== undefined))
      warnings.push(lotWarn.replace(/。$/, ""));

    // CH-36 届くまでの日数
    const lead = parseLeadTimeDays(cell(r, "lead_time_days"));
    if (!lead.ok) errors.push(lead.error.replace(/。$/, ""));
    else if (lead.value !== null) values.lead_time_days = lead.value;

    const displayName = values.name ?? current?.name ?? name;
    if (errors.length > 0) {
      planned.push({ line: r.line, kind: "error", productCode, name: displayName, messages: errors, warnings, values });
      continue;
    }
    if (!current) {
      planned.push({ line: r.line, kind: "add", productCode, name: displayName, messages: [], warnings, values });
      continue;
    }

    // 更新: 違う列を「旧 → 新」で記録する
    const diffs = diffsOf(values, current, supplierCode);
    planned.push({
      line: r.line,
      kind: diffs.length > 0 ? "update" : "same",
      productCode,
      name: displayName,
      messages: diffs,
      warnings,
      values,
    });
  }

  return { ok: true, format: "template", dataRowCount: rows.length, unusedColumns: unused, rows: planned, counts: countKinds(planned) };
};

// 確認の画面に返す行: エラー → 更新 → 追加 → 対象なし の順に、区分ごとに最大200行
export const previewRows = (rows: PlannedRow[]): ProductPreviewRow[] =>
  (["error", "update", "add", "skip"] as const).flatMap((kind) =>
    rows
      .filter((r) => r.kind === kind)
      .slice(0, PREVIEW_ROWS_PER_KIND)
      .map((r) => ({
        line: r.line,
        kind: r.kind,
        productCode: r.productCode,
        name: r.name,
        detail: r.messages.join("／"),
        warning: r.warnings.length > 0 ? r.warnings.join("／") : null,
      }))
  );

// ---- 登録(EV-12 手順4〜5。呼ぶ側のトランザクションの中で動かす) ----

const COLUMNS = [
  "product_code",
  "item_code",
  "name",
  "size",
  "color",
  "jan_code",
  "category_code",
  "main_supplier_id",
  "cost_price",
  "sell_price",
  "sell_price_tax_included",
  "tax_rate",
  "is_in_house",
  "order_lot",
  "min_order_qty",
  "lead_time_days",
  "is_active",
  "crossmall_remark",
] as const;

// 1つの SQL の VALUES に入れるため、値はすべて文字(または null)にして送り、SQL の中で型を付ける
const toCells = (code: string, v: ProductCsvValues): (string | null)[] =>
  COLUMNS.map((c) => {
    if (c === "product_code") return code;
    const value = v[c];
    return value === undefined ? null : String(value);
  });

const chunks = <T,>(list: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK_SIZE) out.push(list.slice(i, i + CHUNK_SIZE));
  return out;
};

export const applyProductImport = async (
  tx: TransactionSql,
  rows: PlannedRow[],
  by: string
): Promise<{ added: number; updated: number }> => {
  const adds = rows.filter((r) => r.kind === "add");
  // CROSS MALL の商品マスタCSVの行は、直すSKUごとの行に広げる(01 の 11.2)
  const updates = rows
    .filter((r) => r.kind === "update")
    .flatMap((r) => (r.targetCodes ? r.targetCodes.map((code) => ({ ...r, productCode: code })) : [r]));

  // 手順5: 確認のあとに同じ商品コードがほかで登録されていた場合は、更新として扱う(空欄の列は変えない)
  const addCodes = adds.map((r) => r.productCode);
  const takenRows =
    addCodes.length === 0
      ? []
      : await tx<{ product_code: string }[]>`select product_code from products where product_code = any(${addCodes}::text[])`;
  const taken = new Set(takenRows.map((r) => r.product_code));
  const inserts = adds.filter((r) => !taken.has(r.productCode));
  const merged = [...updates, ...adds.filter((r) => taken.has(r.productCode))];

  for (const chunk of chunks(inserts)) {
    // null は空の値として送る(postgres の型は null を受け付けない形なので、型だけ合わせる)
    const data = chunk.map((r) => toCells(r.productCode, r.values)) as unknown as string[][];
    await tx`
      insert into products (
        product_code, item_code, name, size, color, jan_code, category_code, main_supplier_id, cost_price, sell_price,
        sell_price_tax_included, tax_rate, is_in_house, order_lot, min_order_qty, lead_time_days, is_active,
        crossmall_remark, created_by, updated_by
      )
      select d.product_code, d.item_code, d.name, d.size, d.color, d.jan_code, d.category_code, d.main_supplier_id::uuid,
             d.cost_price::integer, d.sell_price::integer,
             coalesce(d.sell_price_tax_included::boolean, true), coalesce(d.tax_rate::smallint, 10),
             coalesce(d.is_in_house::boolean, false), d.order_lot::integer, d.min_order_qty::integer,
             d.lead_time_days::integer, coalesce(d.is_active::boolean, true), d.crossmall_remark, ${by}::uuid, ${by}::uuid
      from (values ${tx(data)}) as d (${tx.unsafe(COLUMNS.join(", "))})`;
  }

  for (const chunk of chunks(merged)) {
    // null は空の値として送る(postgres の型は null を受け付けない形なので、型だけ合わせる)
    const data = chunk.map((r) => toCells(r.productCode, r.values)) as unknown as string[][];
    await tx`
      update products p set
        item_code = coalesce(d.item_code, p.item_code),
        name = coalesce(d.name, p.name),
        size = coalesce(d.size, p.size),
        color = coalesce(d.color, p.color),
        jan_code = coalesce(d.jan_code, p.jan_code),
        category_code = coalesce(d.category_code, p.category_code),
        main_supplier_id = coalesce(d.main_supplier_id::uuid, p.main_supplier_id),
        cost_price = coalesce(d.cost_price::integer, p.cost_price),
        sell_price = coalesce(d.sell_price::integer, p.sell_price),
        sell_price_tax_included = coalesce(d.sell_price_tax_included::boolean, p.sell_price_tax_included),
        tax_rate = coalesce(d.tax_rate::smallint, p.tax_rate),
        is_in_house = coalesce(d.is_in_house::boolean, p.is_in_house),
        order_lot = coalesce(d.order_lot::integer, p.order_lot),
        min_order_qty = coalesce(d.min_order_qty::integer, p.min_order_qty),
        lead_time_days = coalesce(d.lead_time_days::integer, p.lead_time_days),
        is_active = coalesce(d.is_active::boolean, p.is_active),
        crossmall_remark = coalesce(d.crossmall_remark, p.crossmall_remark),
        updated_by = ${by}::uuid
      from (values ${tx(data)}) as d (${tx.unsafe(COLUMNS.join(", "))})
      where p.product_code = d.product_code`;
  }

  return { added: inserts.length, updated: merged.length };
};
