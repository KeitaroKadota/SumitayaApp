// 受け取った請求書(E-04)のDBの読み書きと判定(03 の 0.1〜0.4、EV-01・EV-03〜EV-11)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("payables") を済ませている前提)。
// 判定(検算・突合・支払予定日)は payables.ts の計算で行い、AIは呼ばない。AIを呼ぶのは readInvoiceWithAi だけ。
import { query, transaction, type SqlFragment, type SqlLike, type TransactionSql } from "@/utils/db";
import { listAcceptedSlips, linkSlipsToInvoice, type AcceptedSlip } from "@/utils/deliverySlips";
import { formatDateShort, formatYen } from "@/utils/format";
import { callGeminiJson, type AiResult } from "@/utils/gemini";
import { addDays, adjustToBankBusinessDay, isBankHoliday } from "@/utils/holidays";
import { toDateJST, todayJST } from "@/utils/jst";
import {
  BANK_SHIFT_DIRECTION,
  PAYABLES_PAGE_SIZE,
  READ_REASON_CODES,
  TASK_DUE_BUSINESS_DAYS_BEFORE,
  TASK_DUE_FALLBACK_DAYS,
  assessInvoice,
  isValidRegistrationNo,
  matchDeliverySlips,
  nextStatus,
  normalizeAiInvoice,
  normalizeCompanyName,
  purchaseTotalOf,
  reasonCodesOf,
  termsDueDate,
  type DueOutcome,
  type DueSource,
  type DuplicateHit,
  type InvoiceHeader,
  type InvoiceLine,
  type InvoiceLineInput,
  type LineMatchStatus,
  type MatchOutcome,
  type MatchResult,
  type NormalizedAiInvoice,
  type PayableKind,
  type PayableStatus,
  type PaymentMethod,
  type Reason,
  type TaxRate,
} from "@/utils/payables";
import { RECEIVED_INVOICE_INSTRUCTION, RECEIVED_INVOICE_SCHEMA, supplierHintText } from "@/utils/prompts/E-04";
import { getFileBytes } from "@/utils/storage";
import { completeTasksBySource, createTask } from "@/utils/tasks";

export const PAYABLE_FEATURE_ID = "E-04";
export const PAYABLE_TASK_TYPE = "payable_review";
export const payableUrl = (id: string) => `/admin/payables/${encodeURIComponent(id)}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isPayableId = (v: string): boolean => UUID_PATTERN.test(v);

// ---- 読み取り ----

export type Payable = InvoiceHeader & {
  id: string;
  status: PayableStatus;
  supplierName: string | null;
  purchaseTotal: number;
  matchResult: MatchResult;
  matchedTotal: number | null;
  differenceAmount: number | null;
  reviewReasons: string[];
  fileId: string | null;
  fileContentType: string | null;
  fileName: string | null;
  aiRequestId: string | null;
  aiRaw: unknown | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  cancelReason: string | null;
  createdAt: Date;
  // CH-18 画面を開いたときの updated_at(マイクロ秒の数の文字)
  version: string;
};

type PayableRow = {
  id: string;
  status: PayableStatus;
  kind: PayableKind;
  supplier_id: string | null;
  supplier_name: string | null;
  payee_name: string | null;
  registration_no: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  period_start: string | null;
  period_end: string | null;
  previous_balance: number | null;
  payment_received: number | null;
  carried_over: number | null;
  subtotal_10: number;
  tax_10: number;
  subtotal_8: number;
  tax_8: number;
  subtotal_exempt: number;
  purchase_total: number;
  amount_due: number;
  due_on: string | null;
  due_date_source: DueSource | null;
  payment_method: PaymentMethod | null;
  transfer_to: string | null;
  match_result: MatchResult;
  matched_total: number | null;
  difference_amount: number | null;
  review_reasons: string[];
  file_id: string | null;
  file_content_type: string | null;
  file_name: string | null;
  ai_request_id: string | null;
  ai_raw: unknown | null;
  reviewed_at: Date | null;
  reviewed_by_name: string | null;
  review_note: string | null;
  cancel_reason: string | null;
  created_at: Date;
  version: string;
};

const SELECT_PAYABLE = (sql: SqlLike, where: SqlFragment, tail: SqlFragment) => sql<PayableRow[]>`
  select r.id, r.status, r.kind, r.supplier_id, s.name as supplier_name, r.payee_name, r.registration_no, r.invoice_no,
         to_char(r.invoice_date, 'YYYY-MM-DD') as invoice_date, to_char(r.period_start, 'YYYY-MM-DD') as period_start,
         to_char(r.period_end, 'YYYY-MM-DD') as period_end, r.previous_balance, r.payment_received, r.carried_over,
         r.subtotal_10, r.tax_10, r.subtotal_8, r.tax_8, r.subtotal_exempt, r.purchase_total, r.amount_due,
         to_char(r.due_on, 'YYYY-MM-DD') as due_on, r.due_date_source, r.payment_method, r.transfer_to,
         r.match_result, r.matched_total, r.difference_amount, r.review_reasons, r.file_id,
         f.content_type as file_content_type, f.original_name as file_name, r.ai_request_id, r.ai_raw,
         r.reviewed_at, case when rv.id is null then null else rv.last_name || ' ' || rv.first_name end as reviewed_by_name,
         r.review_note, r.cancel_reason, r.created_at,
         (extract(epoch from r.updated_at) * 1000000)::bigint::text as version
  from received_invoices r
  left join suppliers s on s.id = r.supplier_id
  left join stored_files f on f.id = r.file_id and f.deleted_at is null
  left join employees rv on rv.id = r.reviewed_by
  where ${where}
  ${tail}`;

const toPayable = (r: PayableRow): Payable => ({
  id: r.id,
  status: r.status,
  kind: r.kind,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name,
  payeeName: r.payee_name,
  registrationNo: r.registration_no,
  invoiceNo: r.invoice_no,
  invoiceDate: r.invoice_date,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  previousBalance: r.previous_balance,
  paymentReceived: r.payment_received,
  carriedOver: r.carried_over,
  subtotal10: r.subtotal_10,
  tax10: r.tax_10,
  subtotal8: r.subtotal_8,
  tax8: r.tax_8,
  subtotalExempt: r.subtotal_exempt,
  purchaseTotal: r.purchase_total,
  amountDue: r.amount_due,
  dueOn: r.due_on,
  dueDateSource: r.due_date_source,
  paymentMethod: r.payment_method,
  transferTo: r.transfer_to,
  matchResult: r.match_result,
  matchedTotal: r.matched_total,
  differenceAmount: r.difference_amount,
  reviewReasons: r.review_reasons,
  fileId: r.file_id,
  fileContentType: r.file_content_type,
  fileName: r.file_name,
  aiRequestId: r.ai_request_id,
  aiRaw: r.ai_raw,
  reviewedAt: r.reviewed_at,
  reviewedByName: r.reviewed_by_name,
  reviewNote: r.review_note,
  cancelReason: r.cancel_reason,
  createdAt: r.created_at,
  version: r.version,
});

type LineRow = {
  id: string;
  line_no: number;
  line_date: string | null;
  slip_no: string | null;
  description: string;
  item_code: string | null;
  quantity: number | null;
  unit_price: number | null;
  amount: number;
  tax_rate: number;
  delivery_slip_id: string | null;
  purchase_order_line_id: string | null;
  match_status: LineMatchStatus;
  diff_amount: number | null;
};

const readLines = async (invoiceId: string): Promise<InvoiceLine[]> => {
  const rows = await query(
    (sql) => sql<LineRow[]>`
      select id, line_no, to_char(line_date, 'YYYY-MM-DD') as line_date, slip_no, description, item_code,
             quantity::float8 as quantity, unit_price, amount, tax_rate, delivery_slip_id, purchase_order_line_id,
             match_status, diff_amount
      from received_invoice_lines where received_invoice_id = ${invoiceId} order by line_no`
  );
  return rows.map((r) => ({
    id: r.id,
    lineNo: r.line_no,
    lineDate: r.line_date,
    slipNo: r.slip_no,
    description: r.description,
    itemCode: r.item_code,
    quantity: r.quantity,
    unitPrice: r.unit_price,
    amount: r.amount,
    taxRate: r.tax_rate as TaxRate,
    deliverySlipId: r.delivery_slip_id,
    purchaseOrderLineId: r.purchase_order_line_id,
    matchStatus: r.match_status,
    diffAmount: r.diff_amount,
  }));
};

// 1件と明細を読む。無ければ null
export const getPayable = async (id: string): Promise<{ invoice: Payable; lines: InvoiceLine[] } | null> => {
  if (!isPayableId(id)) return null;
  const [row] = await query((sql) => SELECT_PAYABLE(sql, sql`r.id = ${id}`, sql``));
  if (!row) return null;
  return { invoice: toPayable(row), lines: await readLines(id) };
};

// ---- EV-01 一覧 ----

export type PayableTab = "needs_review" | "scheduled" | "cancelled" | "all";
export type PayableFilter = {
  tab: PayableTab;
  supplierId: string;
  dateFrom: string;
  dateTo: string;
  amountMin: number | null;
  amountMax: number | null;
};

// 確認待ちのタブには、読み取り中のまま止まったものも入れる(【仮】00_仮決め一覧 E-04-仮-14)
const tabWhere = (sql: SqlLike, tab: PayableTab) =>
  tab === "needs_review"
    ? sql`r.status in ('needs_review', 'reading')`
    : tab === "all"
      ? sql`true`
      : sql`r.status = ${tab}`;

export const listPayables = async (filter: PayableFilter, page: number): Promise<{ total: number; items: Payable[] }> => {
  const where = (sql: SqlLike) => sql`
    ${tabWhere(sql, filter.tab)}
    ${filter.supplierId ? sql`and r.supplier_id = ${filter.supplierId}` : sql``}
    ${filter.dateFrom ? sql`and r.invoice_date >= ${filter.dateFrom}` : sql``}
    ${filter.dateTo ? sql`and r.invoice_date <= ${filter.dateTo}` : sql``}
    ${filter.amountMin !== null ? sql`and r.amount_due >= ${filter.amountMin}` : sql``}
    ${filter.amountMax !== null ? sql`and r.amount_due <= ${filter.amountMax}` : sql``}`;
  // 並び: 確認待ちは支払予定日の早い順、ほかは請求日の新しい順(02 G01)
  const order = (sql: SqlLike) =>
    filter.tab === "needs_review"
      ? sql`order by r.due_on asc nulls last, r.created_at asc`
      : sql`order by r.invoice_date desc nulls last, r.created_at desc`;
  const [count] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from received_invoices r where ${where(sql)}`);
  const rows = await query((sql) =>
    SELECT_PAYABLE(sql, where(sql), sql`${order(sql)} limit ${PAYABLES_PAGE_SIZE} offset ${(page - 1) * PAYABLES_PAGE_SIZE}`)
  );
  return { total: count.n, items: rows.map(toPayable) };
};

// 状態ごとの件数(タブ・左メニューのバッジ)
export const countPayablesByTab = async (): Promise<Record<PayableTab, number>> => {
  const rows = await query((sql) => sql<{ status: PayableStatus; n: number }[]>`
    select status, count(*)::int as n from received_invoices group by status`);
  const by = (s: PayableStatus) => rows.find((r) => r.status === s)?.n ?? 0;
  return {
    needs_review: by("needs_review") + by("reading"),
    scheduled: by("scheduled"),
    cancelled: by("cancelled"),
    all: rows.reduce((s, r) => s + r.n, 0),
  };
};

// ---- EV-11 支払予定 ----

export const listScheduleOfMonth = async (
  from: string,
  to: string
): Promise<{ dated: Payable[]; undated: Payable[] }> => {
  const dated = await query((sql) =>
    SELECT_PAYABLE(
      sql,
      sql`r.status in ('scheduled', 'needs_review') and r.due_on between ${from} and ${to}`,
      sql`order by r.due_on, r.payee_name nulls last, r.created_at`
    )
  );
  const undated = await query((sql) =>
    SELECT_PAYABLE(sql, sql`r.status in ('needs_review', 'reading') and r.due_on is null`, sql`order by r.created_at`)
  );
  return { dated: dated.map(toPayable), undated: undated.map(toPayable) };
};

// ---- EV-03 手順5 登録 ----

export const insertReadingInvoice = async (input: {
  kind: PayableKind;
  supplierId: string | null;
  payeeName: string | null;
  fileId: string | null;
  by: string;
}): Promise<string> => {
  const [row] = await query(
    (sql) => sql<{ id: string }[]>`
      insert into received_invoices (status, kind, supplier_id, payee_name, file_id, created_by, updated_by)
      values ('reading', ${input.kind}, ${input.supplierId}, ${input.payeeName}, ${input.fileId}, ${input.by}, ${input.by})
      returning id`
  );
  return row.id;
};

// ---- EV-03 手順6・7 AIで読み取る ----

type SupplierInfo = {
  id: string;
  name: string;
  aliases: string[];
  registration_no: string | null;
  payment_month_offset: number | null;
  payment_day: number | null;
  ocr_hint: string | null;
};

const getSupplier = async (id: string | null): Promise<SupplierInfo | null> => {
  if (!id) return null;
  const [row] = await query(
    (sql) => sql<SupplierInfo[]>`
      select id, name, aliases, registration_no, payment_month_offset, payment_day, ocr_hint from suppliers where id = ${id}`
  );
  return row ?? null;
};

// 請求書のファイルを Gemini に渡して読み取る(1枚につき1回。01 7.1)。結果は raw のまま返す(整えるのは呼ぶ側)
export const readInvoiceWithAi = async (
  invoiceId: string,
  fileId: string,
  supplierId: string | null,
  by: string
): Promise<AiResult<unknown> | { ok: false; reason: "file"; message: string }> => {
  let file: Awaited<ReturnType<typeof getFileBytes>>;
  try {
    file = await getFileBytes(fileId);
  } catch (e) {
    console.error("請求書のファイルを読めませんでした:", e instanceof Error ? e.message : e);
    file = null;
  }
  if (!file) return { ok: false, reason: "file", message: "請求書のファイルを読めませんでした。" };
  const supplier = await getSupplier(supplierId);
  return callGeminiJson<unknown>({
    featureId: PAYABLE_FEATURE_ID,
    purpose: "received_invoice_read",
    targetTable: "received_invoices",
    targetId: invoiceId,
    instruction: RECEIVED_INVOICE_INSTRUCTION,
    input: supplier ? supplierHintText(supplier.name, supplier.ocr_hint) : "添付の請求書を読み取ってください。",
    files: [{ bytes: file.bytes, mimeType: file.contentType }],
    schema: RECEIVED_INVOICE_SCHEMA,
    requestedBy: by,
    timeoutMs: 30_000,
  });
};

const insertLines = async (tx: TransactionSql, invoiceId: string, lines: (InvoiceLineInput & { manualOk?: boolean })[]) => {
  if (lines.length === 0) return;
  const rows = lines.map((l, i) => ({
    received_invoice_id: invoiceId,
    line_no: i + 1,
    line_date: l.lineDate,
    slip_no: l.slipNo,
    description: l.description,
    item_code: l.itemCode,
    quantity: l.quantity,
    unit_price: l.unitPrice,
    amount: l.amount,
    tax_rate: l.taxRate,
    match_status: l.manualOk ? "manual_ok" : "not_applicable",
  }));
  await tx`insert into received_invoice_lines ${tx(
    rows,
    "received_invoice_id",
    "line_no",
    "line_date",
    "slip_no",
    "description",
    "item_code",
    "quantity",
    "unit_price",
    "amount",
    "tax_rate",
    "match_status"
  )}`;
};

// 手順7: 整えた読み取り結果で、請求書と明細を置き換える。そのままの JSON は ai_raw に残す
export const applyAiRead = async (
  invoiceId: string,
  normalized: NormalizedAiInvoice,
  aiRaw: unknown,
  aiRequestId: string,
  by: string
): Promise<void> => {
  const h = normalized.header;
  const total = purchaseTotalOf(h);
  await transaction(async (tx) => {
    await tx`
      update received_invoices set
        payee_name = coalesce(${h.payeeName}, payee_name),
        registration_no = ${h.registrationNo}, invoice_no = ${h.invoiceNo}, invoice_date = ${h.invoiceDate},
        period_start = ${h.periodStart}, period_end = ${h.periodEnd},
        previous_balance = ${h.previousBalance}, payment_received = ${h.paymentReceived}, carried_over = ${h.carriedOver},
        subtotal_10 = ${h.subtotal10}, tax_10 = ${h.tax10}, subtotal_8 = ${h.subtotal8}, tax_8 = ${h.tax8},
        subtotal_exempt = ${h.subtotalExempt}, purchase_total = ${total}, amount_due = ${h.amountDue},
        due_on = ${h.dueOnStated}, due_date_source = ${h.dueOnStated ? "invoice" : null},
        transfer_to = ${h.transferTo},
        ai_request_id = ${aiRequestId}, ai_raw = ${tx.json(aiRaw as Parameters<typeof tx.json>[0])},
        reviewed_by = null, reviewed_at = null, updated_by = ${by}
      where id = ${invoiceId}`;
    await tx`delete from received_invoice_lines where received_invoice_id = ${invoiceId}`;
    await insertLines(tx, invoiceId, normalized.lines);
  });
};

// ---- EV-07 保存(CH-18 ほかの人の更新を見る) ----

export const saveInvoiceInput = async (
  invoiceId: string,
  version: string,
  header: InvoiceHeader,
  lines: (InvoiceLineInput & { manualOk: boolean })[],
  reviewNote: string | null,
  by: string
): Promise<boolean> =>
  transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update received_invoices set
        kind = ${header.kind}, supplier_id = ${header.supplierId}, payee_name = ${header.payeeName},
        registration_no = ${header.registrationNo}, invoice_no = ${header.invoiceNo}, invoice_date = ${header.invoiceDate},
        period_start = ${header.periodStart}, period_end = ${header.periodEnd},
        previous_balance = ${header.previousBalance}, payment_received = ${header.paymentReceived},
        carried_over = ${header.carriedOver},
        subtotal_10 = ${header.subtotal10}, tax_10 = ${header.tax10}, subtotal_8 = ${header.subtotal8}, tax_8 = ${header.tax8},
        subtotal_exempt = ${header.subtotalExempt}, purchase_total = ${purchaseTotalOf(header)}, amount_due = ${header.amountDue},
        due_on = ${header.dueOn}, due_date_source = ${header.dueOn ? header.dueDateSource : null},
        payment_method = ${header.paymentMethod}, transfer_to = ${header.transferTo},
        review_note = ${reviewNote}, updated_by = ${by}
      where id = ${invoiceId} and status <> 'cancelled'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`;
    if (updated.length === 0) return false;
    await tx`delete from received_invoice_lines where received_invoice_id = ${invoiceId}`;
    await insertLines(tx, invoiceId, lines);
    return true;
  });

// CH-18 だけを見る(読み取り直す・差異を認める・取消の前)
export const isCurrentVersion = async (invoiceId: string, version: string): Promise<boolean> => {
  const [row] = await query(
    (sql) => sql<{ ok: boolean }[]>`
      select (extract(epoch from updated_at) * 1000000)::bigint::text = ${version} as ok
      from received_invoices where id = ${invoiceId}`
  );
  return row?.ok ?? false;
};

// ---- 0.1 判定 ----

// 判定のきっかけ: read(読み取り・手入力で登録) / save(人が保存) / other(差異を認めた・画面の表示など)
export type EvaluateTrigger = "read" | "save" | "other";

export type Assessment = {
  reasons: Reason[];
  codes: string[];
  match: MatchOutcome;
  due: DueOutcome;
  ai: NormalizedAiInvoice | null;
  supplierId: string | null;
  supplier: SupplierInfo | null;
};

// 手順2 CH-08: 仕入先を特定する(① 登録番号 → ② 名前・別名をそろえて一致。1件だけ見つかったときだけ)
const identifySupplier = async (h: InvoiceHeader): Promise<string | null> => {
  const suppliers = await query(
    (sql) => sql<{ id: string; name: string; aliases: string[]; registration_no: string | null }[]>`
      select id, name, aliases, registration_no from suppliers where is_active`
  );
  if (h.registrationNo && isValidRegistrationNo(h.registrationNo)) {
    const byReg = suppliers.filter((s) => s.registration_no === h.registrationNo);
    if (byReg.length === 1) return byReg[0].id;
  }
  if (h.payeeName) {
    const target = normalizeCompanyName(h.payeeName);
    if (!target) return null;
    const byName = suppliers.filter((s) => [s.name, ...s.aliases].some((n) => normalizeCompanyName(n) === target));
    if (byName.length === 1) return byName[0].id;
  }
  return null;
};

// 0.3 支払予定日(請求書の日付 → 締め日・支払日から計算 → 銀行の休日なら前の営業日)
const calcDueDate = async (
  inv: Pick<InvoiceHeader, "dueOn" | "dueDateSource" | "periodEnd" | "invoiceDate">,
  supplier: SupplierInfo | null,
  ai: NormalizedAiInvoice | null
): Promise<DueOutcome> => {
  const statedSource = inv.dueDateSource === "invoice" || inv.dueDateSource === "manual" ? inv.dueDateSource : null;
  // 請求書から読んだ日付は、読み取ったままの日付からずらし直す(休日でずらしたことを出すため)
  const statedRaw = statedSource
    ? statedSource === "invoice" && ai?.header.dueOnStated
      ? ai.header.dueOnStated
      : inv.dueOn
    : null;
  const base = inv.periodEnd ?? inv.invoiceDate;
  const termsRaw =
    supplier && supplier.payment_month_offset !== null && supplier.payment_day !== null && base
      ? termsDueDate(base, supplier.payment_month_offset, supplier.payment_day)
      : null;
  const adjust = async (d: string | null) => (d ? adjustToBankBusinessDay(d, BANK_SHIFT_DIRECTION) : null);
  const statedOn = await adjust(statedRaw);
  const termsOn = await adjust(termsRaw);
  const dueOn = statedOn ?? termsOn;
  const source: DueSource | null = statedOn ? statedSource : termsOn ? "terms" : null;
  const raw = statedOn ? statedRaw : termsRaw;
  return { dueOn, source, statedOn, termsOn, shiftedFrom: raw && dueOn && raw !== dueOn ? raw : null };
};

// CH-09 二重登録の疑い(取消でないほかの請求書)
const findDuplicates = async (id: string, fileId: string | null, h: InvoiceHeader): Promise<DuplicateHit[]> => {
  const rows = await query((sql) => {
    const conds: SqlFragment[] = [];
    if (fileId)
      conds.push(sql`(r.file_id is not null and f.sha256 = (select sha256 from stored_files where id = ${fileId}))`);
    if (h.invoiceNo && (h.supplierId || h.payeeName))
      conds.push(
        sql`(r.invoice_no = ${h.invoiceNo} and ${h.supplierId ? sql`r.supplier_id = ${h.supplierId}` : sql`r.payee_name = ${h.payeeName}`})`
      );
    if (h.supplierId && h.periodEnd)
      conds.push(sql`(r.supplier_id = ${h.supplierId} and r.period_end = ${h.periodEnd} and r.amount_due = ${h.amountDue})`);
    if (conds.length === 0) return Promise.resolve([] as { id: string; created_at: Date }[]);
    const any = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} or ${c}`));
    return sql<{ id: string; created_at: Date }[]>`
      select r.id, r.created_at from received_invoices r
      left join stored_files f on f.id = r.file_id
      where r.id <> ${id} and r.status <> 'cancelled' and (${any})
      order by r.created_at limit 5`;
  });
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at }));
};

// 突合の期間(period_start〜period_end。始めが空なら period_end の前1か月)
const slipPeriod = (h: InvoiceHeader): { from: string; to: string } | null => {
  if (!h.periodEnd) return null;
  if (h.periodStart) return { from: h.periodStart, to: h.periodEnd };
  const y = Number(h.periodEnd.slice(0, 4));
  const m = Number(h.periodEnd.slice(5, 7));
  const prev = termsDueDate(`${y}-${String(m).padStart(2, "0")}-01`, -1, Number(h.periodEnd.slice(8, 10)));
  return { from: addDays(prev, 1), to: h.periodEnd };
};

// 判定の計算(書き込まない)。画面(G03)の「確認が必要な点」もこれで作り直す
export const assessPayable = async (
  invoice: Payable,
  lines: InvoiceLine[],
  trigger: EvaluateTrigger,
  { identify = false }: { identify?: boolean } = {}
): Promise<Assessment> => {
  const ai = invoice.aiRaw ? normalizeAiInvoice(invoice.aiRaw) : null;
  // 手順2
  const supplierId = invoice.supplierId ?? (identify ? await identifySupplier(invoice) : null);
  const header: InvoiceHeader = { ...invoice, supplierId };
  const supplier = await getSupplier(supplierId);
  // 手順5 突合(仕入れで仕入先が分かるとき)
  let slips: AcceptedSlip[] = [];
  const period = slipPeriod(header);
  if (header.kind === "purchase" && supplierId && period)
    slips = await listAcceptedSlips({ supplierId, from: period.from, to: period.to, excludeInvoiceId: invoice.id });
  const match = matchDeliverySlips(
    header.kind,
    purchaseTotalOf(header),
    lines.map((l) => ({ ...l, manualOk: l.matchStatus === "manual_ok" })),
    slips
  );
  // 手順6
  const due = await calcDueDate(header, supplier, ai);
  // 手順4
  const duplicates = await findDuplicates(invoice.id, invoice.fileId, header);
  const readActive =
    trigger === "read" ? true : trigger === "save" ? false : invoice.reviewReasons.some((c) => (READ_REASON_CODES as readonly string[]).includes(c));
  const reasons = assessInvoice({
    header: { ...header, dueOn: due.dueOn },
    lines,
    supplier: supplier ? { registrationNo: supplier.registration_no } : null,
    match,
    due,
    duplicates,
    readActive,
    ai,
    today: todayJST(),
  });
  // 手順7: 読み取りの理由は、読み取りのとき以外は前に入っていたものだけ残す
  const filtered =
    trigger === "other"
      ? reasons.filter(
          (r) => !(READ_REASON_CODES as readonly string[]).includes(r.code) || invoice.reviewReasons.includes(r.code)
        )
      : reasons;
  return { reasons: filtered, codes: reasonCodesOf(filtered), match, due, ai, supplierId, supplier };
};

// 支払予定日の n 営業日(銀行の営業日)前
const bankBusinessDaysBefore = async (date: string, n: number): Promise<string> => {
  let current = date;
  let remaining = n;
  for (let i = 0; i < 30 && remaining > 0; i += 1) {
    current = addDays(current, -1);
    if (!(await isBankHoliday(current))) remaining -= 1;
  }
  return current;
};

// 0.4 確認待ちのタスク(機能キー payables を使える人あて。同じ請求書の未完了のタスクがあれば上書き)
const issueReviewTask = async (invoice: Payable, dueOn: string | null, reasons: Reason[]) => {
  const taskDue = dueOn
    ? await bankBusinessDaysBefore(dueOn, TASK_DUE_BUSINESS_DAYS_BEFORE)
    : addDays(toDateJST(invoice.createdAt), TASK_DUE_FALLBACK_DAYS);
  const payee = invoice.payeeName ?? invoice.supplierName ?? "請求元不明";
  const due = dueOn ? `支払予定 ${formatDateShort(dueOn)}` : "支払予定日 未定";
  await createTask({
    type: PAYABLE_TASK_TYPE,
    title: `請求書の確認: ${payee} ${formatYen(invoice.amountDue, "included")}（${due}）`,
    body: ["確認が必要な点:", ...reasons.map((r) => `・${r.message}`)].join("\n"),
    assigneeFeatureKey: "payables",
    dueDate: taskDue,
    sourceFeature: PAYABLE_FEATURE_ID,
    sourceId: invoice.id,
    linkUrl: payableUrl(invoice.id),
  });
};

// 0.1 evaluateReceivedInvoice: 登録・読み取り・保存のたびに呼ぶ。結果を書き、確認待ちになったらタスクを出す
export const evaluateReceivedInvoice = async (
  id: string,
  trigger: EvaluateTrigger,
  by: string
): Promise<{ status: PayableStatus; assessment: Assessment } | null> => {
  // 手順1
  const loaded = await getPayable(id);
  if (!loaded) return null;
  const { invoice, lines } = loaded;
  if (invoice.status === "cancelled") return null;

  // 手順2〜7
  const a = await assessPayable(invoice, lines, trigger, { identify: true });
  // 手順8
  const status = nextStatus({
    current: invoice.status,
    reviewed: invoice.reviewedAt !== null,
    previousCodes: invoice.reviewReasons,
    codes: a.codes,
  });
  const backToReview = invoice.reviewedAt !== null && status === "needs_review";

  await transaction(async (tx) => {
    await tx`
      update received_invoices set
        status = ${status}, supplier_id = ${a.supplierId},
        due_on = ${a.due.dueOn}, due_date_source = ${a.due.dueOn ? a.due.source : null},
        match_result = ${a.match.matchResult}, matched_total = ${a.match.matchedTotal},
        difference_amount = ${a.match.differenceAmount}, review_reasons = ${a.codes}::text[],
        ${backToReview ? tx`reviewed_by = null, reviewed_at = null,` : tx``}
        updated_by = ${by}
      where id = ${id} and status <> 'cancelled'`;
    for (const [i, l] of lines.entries()) {
      const m = a.match.lines[i];
      if (!l.id || !m) continue;
      await tx`
        update received_invoice_lines set
          match_status = ${m.matchStatus}, delivery_slip_id = ${m.deliverySlipId},
          purchase_order_line_id = ${m.purchaseOrderLineId}, diff_amount = ${m.diffAmount}
        where id = ${l.id}`;
    }
  });

  // C-01 の delivery_slips.received_invoice_id(C-02 を作るまでは何もしない)
  await linkSlipsToInvoice(
    id,
    a.match.lines.map((m) => m.deliverySlipId).filter((x): x is string => x !== null)
  );

  // 手順9: 確認待ちに変わったときはタスクを出す(失敗しても判定は取り消さない)
  if (status === "needs_review" && invoice.status !== "needs_review") {
    try {
      await issueReviewTask({ ...invoice, supplierId: a.supplierId }, a.due.dueOn, a.reasons);
    } catch (e) {
      console.error("請求書の確認のタスクを出せませんでした:", e instanceof Error ? e.message : e);
    }
  }
  return { status, assessment: a };
};

// ---- EV-08 差異を認める ----

export const approveLineDifference = async (
  invoiceId: string,
  version: string,
  lineId: string | null,
  reviewNote: string,
  by: string
): Promise<boolean> =>
  transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update received_invoices set review_note = ${reviewNote}, updated_by = ${by}
      where id = ${invoiceId} and status <> 'cancelled'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`;
    if (updated.length === 0) return false;
    if (lineId) {
      await tx`
        update received_invoice_lines set match_status = 'manual_ok'
        where id = ${lineId} and received_invoice_id = ${invoiceId}`;
    }
    return true;
  });

// ---- EV-09 確認して支払予定にする ----

export const markScheduled = async (invoiceId: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update received_invoices set status = 'scheduled', reviewed_by = ${by}, reviewed_at = now(), updated_by = ${by}
      where id = ${invoiceId} and status in ('reading', 'needs_review', 'scheduled')`
  );
  await completeTasksBySource(PAYABLE_FEATURE_ID, invoiceId, { types: [PAYABLE_TASK_TYPE] });
};

// ---- EV-10 取り消す ----

export const cancelInvoice = async (invoiceId: string, version: string, reason: string, by: string): Promise<boolean> => {
  const ok = await transaction(async (tx) => {
    const updated = await tx<{ id: string }[]>`
      update received_invoices set status = 'cancelled', cancel_reason = ${reason}, updated_by = ${by}
      where id = ${invoiceId} and status <> 'cancelled'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`;
    if (updated.length === 0) return false;
    // ほかの請求書に結び付けられるように、納品書との結び付きを外す
    await tx`update received_invoice_lines set delivery_slip_id = null where received_invoice_id = ${invoiceId}`;
    return true;
  });
  if (!ok) return false;
  await linkSlipsToInvoice(invoiceId, []);
  await completeTasksBySource(PAYABLE_FEATURE_ID, invoiceId, { types: [PAYABLE_TASK_TYPE], note: "請求書を取り消した" });
  return true;
};

// EV-03 手順3 のあと: 同じファイルがほかの請求書に使われていないか(1つのファイルは1つの請求書にだけ使う)
export const isFileUsable = async (fileId: string, by: string): Promise<boolean> => {
  const [row] = await query(
    (sql) => sql<{ ok: boolean }[]>`
      select (f.purpose = 'received_invoice' and f.created_by = ${by} and f.deleted_at is null
              and not exists (select 1 from received_invoices r where r.file_id = f.id)) as ok
      from stored_files f where f.id = ${fileId}`
  );
  return row?.ok ?? false;
};

