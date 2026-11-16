// 売上の取り込み(A-01 03 の 0.2・0.5、EV-02〜EV-05、04 CH-04〜CH-11・CH-14〜CH-16)。
// 確認(EV-02)と登録(EV-03)の両方で planSalesImport を呼び、登録のときはファイルを読み直して分類し直す(確認の結果は保存しない)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("sales", …) 済みの前提)。
import { query, transaction, type TransactionSql } from "@/utils/db";
import { getSalesSettings } from "@/utils/appSettings";
import type { ImportCounts } from "@/utils/csvImport/batches";
import { resolveColumns, type CsvRow } from "@/utils/csvImport/engine";
import { parseCsvCode, parseCsvDate, parseCsvInt, parseCsvText } from "@/utils/csvImport/fields";
import {
  SALES_KINDS,
  type SalesChannel,
  type SalesField,
  type SalesImportKind,
  type SalesKindDef,
} from "@/utils/csvImport/kinds/salesColumns";
import { resolveProductCodes } from "@/utils/masters";
import { todayJST } from "@/utils/jst";
// 【仮】確認してから登録できるまでの時間(24時間。A-01 CH-06 の「1日以内」)
import { PREVIEW_VALID_HOURS } from "@/app/admin/products/import/importChecks";

// CH-14 データの行の上限(【仮】00_仮決め一覧 A-01-仮-07)
export const SALES_CSV_MAX_ROWS = 200_000;
// CH-09 数量・金額の範囲
const QTY_LIMIT = 100_000;
const AMOUNT_LIMIT = 100_000_000;
// 0.4 確認の画面に返す行の数
export const SALES_PREVIEW_MAX_ROWS = 200;
// EV-03 手順11 一括で書く行の数
const CHUNK_SIZE = 1000;

// ---- 0.2 行を項目に直す ----

type ParsedRow = {
  line: number;
  date: string;
  channel: SalesChannel;
  code: string;
  name: string;
  qty: number;
  incl: number;
  excl: number;
  // 明細の数の列の値(無ければ null)
  lineCount: number | null;
};

type RowError = { line: number; detail: string };

// 7.5 税込 → 税抜、税抜 → 税込(1円未満は切り捨て。マイナスは0に向けて切り捨てる)
const exclFromIncl = (incl: number, rate: number) => Math.trunc((incl * 100) / (100 + rate));
const inclFromExcl = (excl: number, rate: number) => Math.trunc((excl * (100 + rate)) / 100);

type ParseResult =
  | { ok: true; rows: ParsedRow[]; errors: RowError[]; skipCount: number; unusedColumns: string[] }
  | { ok: false; error: string };

const parseSalesRows = (
  def: SalesKindDef,
  header: string[],
  rows: CsvRow[],
  settings: { taxRate: number; cutoverDate: string | null },
  today: string
): ParseResult => {
  // CH-04 列の対応表の列が見出しにある
  const { index, unused, duplicated } = resolveColumns(header, def.columnMap as Record<SalesField, readonly string[]>);
  const missing = def.required.filter((r) => index[r.field] === undefined).map((r) => r.label);
  const amountFields: SalesField[] = ["amount", "amountInclTax", "amountExclTax", "unitPrice"];
  if (!amountFields.some((f) => index[f] !== undefined)) missing.push("金額");
  if (missing.length > 0)
    return { ok: false, error: `${def.label}のCSVではないようです。足りない列: ${missing.join("・")}` };
  const usedDup = duplicated.filter((h) => Object.values(index).some((i) => header[i as number] === h));
  if (usedDup.length > 0) return { ok: false, error: `見出しに同じ名前の列が2つあります: ${usedDup.join("・")}` };

  const cell = (r: CsvRow, f: SalesField): string => {
    const i = index[f];
    return i === undefined ? "" : (r.cells[i] ?? "");
  };
  const o = def.options;
  const parsed: ParsedRow[] = [];
  const errors: RowError[] = [];
  let skipCount = 0;

  for (const r of rows) {
    const err = (detail: string) => errors.push({ line: r.line, detail: `${r.line}行目: ${detail}` });

    // 0.5 手順2 対象外: 除外する状態(キャンセルなど)・除外するショップ(読み替えより先。CH-10)
    const status = cell(r, "status").trim();
    if (status && o.excludeStatusKeywords?.some((k) => status.includes(k))) {
      skipCount++;
      continue;
    }
    const shop = cell(r, "shop").trim();
    if (shop && o.excludeShops?.includes(shop)) {
      skipCount++;
      continue;
    }

    // 0.5 手順1 販路(CH-10)
    let channel: SalesChannel | null = o.fixedChannel ?? null;
    if (!channel) {
      const lower = shop.toLowerCase();
      channel = o.channelRules?.find((rule) => rule.keywords.some((k) => lower.includes(k.toLowerCase())))?.shop ?? null;
      if (!channel) {
        err(`ショップ名『${shop}』の読み替えがありません（開発者へ連絡してください）`);
        continue;
      }
    }

    // CH-07 日付
    const rawDate = cell(r, "salesDate");
    const date = parseCsvDate(rawDate, today);
    if (!date) {
      err(`売上日『${rawDate.trim()}』が読めません`);
      continue;
    }
    // CH-11 切替日より前である(CROSS MALL のみ)
    if (def.kind === "sales_crossmall" && settings.cutoverDate && date >= settings.cutoverDate) {
      err(`${date.replace(/-/g, "/")} 以後のネットの売上は、受注の取り込み（B-01）から集計します`);
      continue;
    }
    // CH-08 商品コード
    const code = parseCsvCode(cell(r, "productCode"));
    if (!code.ok) {
      err(code.error);
      continue;
    }
    // CH-09 数量・金額
    const qty = parseCsvInt(cell(r, "quantity"), QTY_LIMIT);
    if (qty === null || qty === "error") {
      err(`数量『${cell(r, "quantity").trim()}』が読めません`);
      continue;
    }
    const readAmount = (f: SalesField) => parseCsvInt(cell(r, f), AMOUNT_LIMIT);
    const inclCol = readAmount("amountInclTax");
    const exclCol = readAmount("amountExclTax");
    const amountCol = readAmount("amount");
    const unitCol = readAmount("unitPrice");
    if ([inclCol, exclCol, amountCol, unitCol].includes("error")) {
      err("金額が読めません（整数で入っているか確かめてください）");
      continue;
    }
    // 0.5 手順4 金額を税込・税抜にそろえる。両方あればそのまま、単価だけなら 単価×数量
    let incl: number;
    let excl: number;
    const rate = settings.taxRate;
    if (typeof inclCol === "number" && typeof exclCol === "number") [incl, excl] = [inclCol, exclCol];
    else if (typeof inclCol === "number") [incl, excl] = [inclCol, exclFromIncl(inclCol, rate)];
    else if (typeof exclCol === "number") [incl, excl] = [inclFromExcl(exclCol, rate), exclCol];
    else {
      const base = typeof amountCol === "number" ? amountCol : typeof unitCol === "number" ? unitCol * qty : null;
      if (base === null) {
        err("金額が空です");
        continue;
      }
      if (Math.abs(base) > AMOUNT_LIMIT) {
        err("金額が大きすぎます");
        continue;
      }
      [incl, excl] = o.amountTax === "incl" ? [base, exclFromIncl(base, rate)] : [inclFromExcl(base, rate), base];
    }
    const lineCount = parseCsvInt(cell(r, "lineCount"), QTY_LIMIT);
    if (lineCount === "error" || (typeof lineCount === "number" && lineCount < 0)) {
      err(`件数『${cell(r, "lineCount").trim()}』が読めません`);
      continue;
    }
    // 0.5 手順2 数量と金額がどちらも0の行は対象外
    if (qty === 0 && incl === 0 && excl === 0) {
      skipCount++;
      continue;
    }
    parsed.push({ line: r.line, date, channel, code: code.value, name: parseCsvText(cell(r, "productName"), 300), qty, incl, excl, lineCount });
  }
  return { ok: true, rows: parsed, errors, skipCount, unusedColumns: unused };
};

// ---- 0.5 分類 ----

export type SalesAggRow = {
  date: string;
  channel: SalesChannel;
  code: string;
  productId: string | null;
  productName: string | null;
  qty: number;
  incl: number;
  excl: number;
  lineCount: number;
};

type ExistingRow = {
  id: string;
  sales_date: string;
  channel: SalesChannel;
  product_code: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
  amount_excl_tax: number;
  amount_incl_tax: number;
  line_count: number;
  source: string;
};

export type SalesPreviewRow = {
  status: "error" | "change" | "delete" | "add";
  line: number | null;
  date: string | null;
  code: string;
  name: string;
  qtyText: string;
  amountText: string;
  detail: string;
};

export type SalesImportPlan =
  | {
      ok: true;
      dataRowCount: number;
      unusedColumns: string[];
      counts: ImportCounts;
      periodFrom: string | null;
      periodTo: string | null;
      channels: SalesChannel[];
      adds: SalesAggRow[];
      changes: (SalesAggRow & { id: string })[];
      deleteIds: string[];
      // マスタに無い商品コードの数(取り込む。7.3)
      unknownProductCount: number;
      // CH-16 数量と金額の向きが違う行の数
      directionWarningCount: number;
      // 0.4 確認の画面の明細(エラー → 変更 → 削除 → 追加 の順に最大200行)
      previewRows: SalesPreviewRow[];
    }
  | { ok: false; error: string };

const keyOf = (date: string, channel: string, code: string) => `${date}|${channel}|${code}`;
const dateOf = (v: string | Date): string => (typeof v === "string" ? v.slice(0, 10) : v.toISOString().slice(0, 10));

// 0.5 手順1〜11。確認と登録の両方で呼ぶ
export const planSalesImport = async (kind: SalesImportKind, header: string[], rows: CsvRow[]): Promise<SalesImportPlan> => {
  const def = SALES_KINDS.find((k) => k.kind === kind);
  if (!def) return { ok: false, error: "取り込むものを選んでください。" };
  const settings = await getSalesSettings();
  const parsed = parseSalesRows(def, header, rows, { taxRate: settings.taxRate, cutoverDate: settings.crossmallCutoverDate }, todayJST());
  if (!parsed.ok) return parsed;

  // 手順5・11 商品コードを読み替えの表(あれば)で自社のコードに直し、商品マスタを引く
  const products = await resolveProductCodes(def.aliasSource, [...new Set(parsed.rows.map((r) => r.code))]);

  // 手順6 日×販路×商品コードで合計する
  const agg = new Map<string, SalesAggRow & { rowsWithoutCount: number }>();
  for (const r of parsed.rows) {
    const product = products.get(r.code);
    const code = product?.productCode ?? r.code;
    const key = keyOf(r.date, r.channel, code);
    let a = agg.get(key);
    if (!a) {
      a = {
        date: r.date,
        channel: r.channel,
        code,
        productId: product?.id ?? null,
        productName: r.name || product?.name || null,
        qty: 0,
        incl: 0,
        excl: 0,
        lineCount: 0,
        rowsWithoutCount: 0,
      };
      agg.set(key, a);
    }
    a.qty += r.qty;
    a.incl += r.incl;
    a.excl += r.excl;
    if (!a.productName && r.name) a.productName = r.name;
    if (r.lineCount !== null) a.lineCount += r.lineCount;
    else if (def.options.rowIsDailySummary) a.rowsWithoutCount++;
    else a.lineCount += 1;
  }
  const aggRows: SalesAggRow[] = [...agg.values()].map(({ rowsWithoutCount, ...a }) => ({
    ...a,
    // 日別集計で件数が分からないときは、売れた日を1回と数える(A-01-仮-09)
    lineCount: rowsWithoutCount > 0 && a.lineCount === 0 ? 1 : a.lineCount,
  }));

  // 手順7 ファイルの期間と販路
  const dates = aggRows.map((a) => a.date).sort();
  const periodFrom = dates[0] ?? null;
  const periodTo = dates[dates.length - 1] ?? null;
  const channels = [...new Set(aggRows.map((a) => a.channel))];

  // 手順8 今の sales_daily から、その期間・その販路の行を読む(取り込み元の違う行は、重なりを見るためにだけ使う)
  const existing =
    periodFrom && periodTo
      ? await query(
          (sql) => sql<ExistingRow[]>`
            select id, sales_date::text as sales_date, channel, product_code, product_id, product_name, quantity,
                   amount_excl_tax, amount_incl_tax, line_count, source
            from sales_daily
            where sales_date between ${periodFrom}::date and ${periodTo}::date and channel = any(${channels}::text[])`,
          { timeoutMs: 30_000 }
        )
      : [];
  const existingByKey = new Map(existing.map((e) => [keyOf(dateOf(e.sales_date), e.channel, e.product_code), e]));

  // 手順9・10 追加・変更・変更なし・削除
  const adds: SalesAggRow[] = [];
  const changes: (SalesAggRow & { id: string; prev: ExistingRow })[] = [];
  const errors = [...parsed.errors];
  const conflictRows: SalesAggRow[] = [];
  let same = 0;
  const seen = new Set<string>();
  for (const a of aggRows) {
    const key = keyOf(a.date, a.channel, a.code);
    seen.add(key);
    const e = existingByKey.get(key);
    if (!e) adds.push(a);
    else if (e.source !== def.source) conflictRows.push(a);
    else if (
      e.quantity === a.qty &&
      e.amount_incl_tax === a.incl &&
      e.amount_excl_tax === a.excl &&
      e.line_count === a.lineCount &&
      e.product_id === a.productId
    )
      same++;
    else changes.push({ ...a, id: e.id, prev: e });
  }
  const deletes = existing.filter((e) => e.source === def.source && !seen.has(keyOf(dateOf(e.sales_date), e.channel, e.product_code)));

  const unknownProductCount = new Set(aggRows.filter((a) => !a.productId).map((a) => a.code)).size;
  const directionWarningCount = aggRows.filter((a) => (a.qty > 0 && a.incl < 0) || (a.qty < 0 && a.incl > 0)).length;

  // 0.4 確認の画面の明細
  const fmt = (n: number) => n.toLocaleString("ja-JP");
  const direction = (a: SalesAggRow) =>
    (a.qty > 0 && a.incl < 0) || (a.qty < 0 && a.incl > 0) ? "数量と金額の向きが違います" : "";
  const previewRows: SalesPreviewRow[] = [
    ...errors.map((e) => ({ status: "error" as const, line: e.line, date: null, code: "", name: "", qtyText: "", amountText: "", detail: e.detail })),
    ...conflictRows.map((a) => ({
      status: "error" as const,
      line: null,
      date: a.date,
      code: a.code,
      name: a.productName ?? "",
      qtyText: fmt(a.qty),
      amountText: fmt(a.incl),
      detail: "ほかの取り込み元（受注など）の売上があるため取り込みません",
    })),
    ...changes.map((c) => ({
      status: "change" as const,
      line: null,
      date: c.date,
      code: c.code,
      name: c.productName ?? "",
      qtyText: `${fmt(c.prev.quantity)}→${fmt(c.qty)}`,
      amountText: `${fmt(c.prev.amount_incl_tax)}→${fmt(c.incl)}`,
      detail: direction(c),
    })),
    ...deletes.map((d) => ({
      status: "delete" as const,
      line: null,
      date: dateOf(d.sales_date),
      code: d.product_code,
      name: d.product_name ?? "",
      qtyText: `${fmt(d.quantity)}→0`,
      amountText: `${fmt(d.amount_incl_tax)}→0`,
      detail: "",
    })),
    ...adds.map((a) => ({
      status: "add" as const,
      line: null,
      date: a.date,
      code: a.code,
      name: a.productName ?? "",
      qtyText: fmt(a.qty),
      amountText: fmt(a.incl),
      detail: [a.productId ? "" : "マスタに無い商品", direction(a)].filter(Boolean).join("・"),
    })),
  ].slice(0, SALES_PREVIEW_MAX_ROWS);

  return {
    ok: true,
    dataRowCount: rows.length,
    unusedColumns: parsed.unusedColumns,
    counts: {
      add: adds.length,
      change: changes.length,
      same,
      delete: deletes.length,
      skip: parsed.skipCount,
      error: errors.length + conflictRows.length,
    },
    periodFrom,
    periodTo,
    channels,
    adds,
    changes: changes.map(({ prev, ...c }) => {
      void prev;
      return c;
    }),
    deleteIds: deletes.map((d) => d.id),
    unknownProductCount,
    directionWarningCount,
    previewRows,
  };
};

// ---- EV-03 手順9〜11 保存(呼ぶ側のトランザクションの中で) ----

const toRecord = (a: SalesAggRow, source: string, batchId: string, id?: string) => ({
  id: id ?? null,
  sales_date: a.date,
  channel: a.channel,
  product_code: a.code,
  product_id: a.productId,
  product_name: a.productName,
  quantity: a.qty,
  amount_excl_tax: a.excl,
  amount_incl_tax: a.incl,
  line_count: a.lineCount,
  source,
  import_batch_id: batchId,
});

export const applySalesPlan = async (
  tx: TransactionSql,
  kind: SalesImportKind,
  plan: Extract<SalesImportPlan, { ok: true }>,
  batchId: string
): Promise<void> => {
  const def = SALES_KINDS.find((k) => k.kind === kind);
  if (!def) throw new Error("取り込みの種類が正しくありません");
  // 手順9 削除する行を消す(id を指定して)
  for (let i = 0; i < plan.deleteIds.length; i += CHUNK_SIZE) {
    await tx`delete from sales_daily where id = any(${plan.deleteIds.slice(i, i + CHUNK_SIZE)}::uuid[])`;
  }
  // 手順10 変更する行を更新する
  for (let i = 0; i < plan.changes.length; i += CHUNK_SIZE) {
    const records = plan.changes.slice(i, i + CHUNK_SIZE).map((c) => toRecord(c, def.source, batchId, c.id));
    await tx`
      update sales_daily s set
        quantity = d.quantity, amount_excl_tax = d.amount_excl_tax, amount_incl_tax = d.amount_incl_tax,
        line_count = d.line_count, product_id = d.product_id, product_name = d.product_name, import_batch_id = d.import_batch_id
      from jsonb_to_recordset(${JSON.stringify(records)}::text::jsonb) as d (
        id uuid, quantity integer, amount_excl_tax integer, amount_incl_tax integer, line_count integer,
        product_id uuid, product_name text, import_batch_id uuid
      )
      where s.id = d.id`;
  }
  // 手順11 追加する行を1000行ずつまとめて INSERT
  for (let i = 0; i < plan.adds.length; i += CHUNK_SIZE) {
    const records = plan.adds.slice(i, i + CHUNK_SIZE).map((a) => toRecord(a, def.source, batchId));
    await tx`
      insert into sales_daily (
        sales_date, channel, product_code, product_id, product_name, quantity, amount_excl_tax, amount_incl_tax,
        line_count, source, import_batch_id
      )
      select d.sales_date, d.channel, d.product_code, d.product_id, d.product_name, d.quantity, d.amount_excl_tax,
             d.amount_incl_tax, d.line_count, d.source, d.import_batch_id
      from jsonb_to_recordset(${JSON.stringify(records)}::text::jsonb) as d (
        sales_date date, channel text, product_code text, product_id uuid, product_name text, quantity integer,
        amount_excl_tax integer, amount_incl_tax integer, line_count integer, source text, import_batch_id uuid
      )`;
  }
};

// 取り込みの記録にファイルの期間を書く(EV-02 手順6・EV-03 手順12。共通の createPreviewBatch は期間を持たないため)
export const setBatchPeriod = async (
  batchId: string,
  from: string | null,
  to: string | null,
  tx?: TransactionSql
): Promise<void> => {
  if (tx) await tx`update import_batches set period_from = ${from}, period_to = ${to} where id = ${batchId}`;
  else await query((sql) => sql`update import_batches set period_from = ${from}, period_to = ${to} where id = ${batchId}`);
};

// CH-05 同じファイルを登録済みか(登録した日時。無ければ null)
export const findAppliedSameFile = async (kind: SalesImportKind, fileHash: string): Promise<Date | null> => {
  const rows = await query(
    (sql) => sql<{ applied_at: Date | null }[]>`
      select applied_at from import_batches
      where kind = ${kind} and file_hash = ${fileHash} and status = 'applied'
      order by applied_at desc nulls last limit 1`
  );
  return rows[0] ? (rows[0].applied_at ?? null) : null;
};

// ---- EV-05 取り込みの記録(G03) ----

export const SALES_HISTORY_PAGE_SIZE = 50;

export type SalesBatchSummary = {
  id: string;
  kind: SalesImportKind;
  source: "csv" | "api";
  fileName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  counts: ImportCounts;
  status: "previewed" | "applied" | "cancelled" | "failed";
  message: string | null;
  createdAt: Date;
  // 確認中のまま1日(PREVIEW_VALID_HOURS)たった(G03 の「期限切れ」)
  expired: boolean;
  createdByName: string | null;
  appliedBy: string | null;
  appliedByName: string | null;
};

type BatchListRow = {
  id: string;
  kind: SalesImportKind;
  source: "csv" | "api";
  file_name: string | null;
  period_from: string | null;
  period_to: string | null;
  add_count: number;
  change_count: number;
  same_count: number;
  delete_count: number;
  skip_count: number;
  error_count: number;
  status: SalesBatchSummary["status"];
  message: string | null;
  created_at: Date;
  expired: boolean;
  created_by_name: string | null;
  applied_by: string | null;
  applied_by_name: string | null;
};

export const listSalesBatches = async (
  kinds: SalesImportKind[],
  page: number
): Promise<{ total: number; batches: SalesBatchSummary[] }> => {
  const offset = (page - 1) * SALES_HISTORY_PAGE_SIZE;
  const [countRows, rows] = [
    await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from import_batches where kind = any(${kinds}::text[])`),
    await query(
      (sql) => sql<BatchListRow[]>`
        select b.id, b.kind, b.source, b.file_name, b.period_from::text as period_from, b.period_to::text as period_to,
               b.add_count, b.change_count, b.same_count, b.delete_count, b.skip_count, b.error_count, b.status, b.message,
               b.created_at, b.applied_by, b.created_at < now() - make_interval(hours => ${PREVIEW_VALID_HOURS}) as expired,
               case when c.id is null then null else c.last_name || ' ' || c.first_name end as created_by_name,
               case when a.id is null then null else a.last_name || ' ' || a.first_name end as applied_by_name
        from import_batches b
        left join employees c on c.id = b.created_by
        left join employees a on a.id = b.applied_by
        where b.kind = any(${kinds}::text[])
        order by b.created_at desc
        limit ${SALES_HISTORY_PAGE_SIZE} offset ${offset}`
    ),
  ];
  return {
    total: countRows[0]?.n ?? 0,
    batches: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      source: r.source,
      fileName: r.file_name,
      periodFrom: r.period_from,
      periodTo: r.period_to,
      counts: {
        add: r.add_count,
        change: r.change_count,
        same: r.same_count,
        delete: r.delete_count,
        skip: r.skip_count,
        error: r.error_count,
      },
      status: r.status,
      message: r.message,
      createdAt: r.created_at,
      expired: r.expired,
      createdByName: r.created_by_name,
      appliedBy: r.applied_by,
      appliedByName: r.applied_by_name,
    })),
  };
};

// ---- EV-04 取消 ----

export type CancelResult = { ok: true; deleted: number } | { ok: false; error: string };

// 手順4〜6: 記録を FOR UPDATE で読み直し、まだ登録済みなら、この取り込みで入れた sales_daily の行を消して取消にする。
// 後の取り込みが上書きした行(import_batch_id が別のもの)は消えない
export const cancelSalesBatch = (batchId: string, by: string): Promise<CancelResult> =>
  transaction(async (tx): Promise<CancelResult> => {
    const [locked] = await tx<{ status: string; kind: string }[]>`
      select status, kind from import_batches where id = ${batchId} for update`;
    if (!locked || !SALES_KINDS.some((k) => k.kind === locked.kind)) return { ok: false, error: "この取り込みは見つかりません。" };
    if (locked.status !== "applied") return { ok: false, error: "この取り込みは登録済みではないので取消できません。" };
    const deleted = await tx`delete from sales_daily where import_batch_id = ${batchId}`;
    await tx`
      update import_batches set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), updated_by = ${by}
      where id = ${batchId}`;
    return { ok: true, deleted: deleted.count };
  });
