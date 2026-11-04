// 発行する請求書(E-05)のDBの読み書き(03 の 0.3・0.4、EV-01・EV-05〜EV-12)。計算は invoices.ts。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("receivables") を済ませている前提)。
import { query, transaction, type SqlFragment, type SqlLike, type TransactionSql } from "@/utils/db";
import { isUniqueViolation } from "@/utils/dbErrors";
import { escapeLike } from "@/utils/textNormalize";
import {
  DEFAULT_ROUNDING,
  INVOICES_PAGE_SIZE,
  INVOICE_NO_MAX_SEQ,
  ISSUE_RETRY,
  bankTextOf,
  calcInvoiceTotals,
  formatInvoiceNo,
  invoiceNoPrefix,
  isRounding,
  issueBlockers,
  quantity100FromDb,
  quantityText,
  type CompanySettings,
  type InvoiceInput,
  type InvoiceLineInput,
  type InvoiceStatus,
  type PaymentStatus,
  type PriceBasis,
  type Rounding,
  type TaxRate,
} from "@/utils/invoices";
import { normalizeRegistrationNo } from "@/utils/payables";

export const INVOICES_URL = "/admin/invoices";
export const invoiceUrl = (id: string) => `${INVOICES_URL}/${encodeURIComponent(id)}`;
export const invoicePrintUrl = (ids: string[]) => `${INVOICES_URL}/print?ids=${ids.map(encodeURIComponent).join(",")}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isInvoiceId = (v: string): boolean => UUID_PATTERN.test(v);

// ---- 0.4 自社の情報を読む(A-03 の発注書も使う) ----

type CompanyRow = {
  company_name: string;
  postal_code: string | null;
  address: string | null;
  tel: string | null;
  fax: string | null;
  email: string | null;
  registration_no: string | null;
  bank_name: string | null;
  bank_branch: string | null;
  bank_account_type: string | null;
  bank_account_no: string | null;
  bank_account_holder: string | null;
  rounding: string;
};

const readCompany = async (sql: SqlLike): Promise<CompanySettings | null> => {
  const [r] = await sql<CompanyRow[]>`
    select company_name, postal_code, address, tel, fax, email, registration_no, bank_name, bank_branch,
           bank_account_type, bank_account_no, bank_account_holder, rounding
    from company_settings where id = 1`;
  if (!r) return null;
  return {
    companyName: r.company_name,
    postalCode: r.postal_code,
    address: r.address,
    tel: r.tel,
    fax: r.fax,
    email: r.email,
    registrationNo: r.registration_no,
    bankName: r.bank_name,
    bankBranch: r.bank_branch,
    bankAccountType: r.bank_account_type,
    bankAccountNo: r.bank_account_no,
    bankAccountHolder: r.bank_account_holder,
    rounding: isRounding(r.rounding) ? r.rounding : DEFAULT_ROUNDING,
  };
};

// 行が無ければ null(呼んだ側が CH-02 の文を出して止める)。書き込む関数は作らない(値は開発者が SQL で入れる)
export const getCompanySettings = (): Promise<CompanySettings | null> => query((sql) => readCompany(sql));

// 下書きの計算に使う端数処理(自社の情報の行が無ければ初期値)
export const currentRounding = (c: CompanySettings | null): Rounding => c?.rounding ?? DEFAULT_ROUNDING;

// ---- 取引先・商品(CMN-02。読むだけ) ----

export type InvoiceCustomer = {
  id: string;
  code: string | null;
  name: string;
  honorific: string;
  postalCode: string | null;
  address: string | null;
  contactName: string | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  isActive: boolean;
};

type CustomerRow = {
  id: string;
  customer_code: string | null;
  name: string;
  honorific: string;
  postal_code: string | null;
  address: string | null;
  contact_name: string | null;
  closing_day: number | null;
  payment_month_offset: number | null;
  payment_day: number | null;
  is_active: boolean;
};

const toCustomer = (r: CustomerRow): InvoiceCustomer => ({
  id: r.id,
  code: r.customer_code,
  name: r.name,
  honorific: r.honorific,
  postalCode: r.postal_code,
  address: r.address,
  contactName: r.contact_name,
  closingDay: r.closing_day,
  paymentMonthOffset: r.payment_month_offset,
  paymentDay: r.payment_day,
  isActive: r.is_active,
});

const SELECT_CUSTOMER = (sql: SqlLike, where: SqlFragment) => sql<CustomerRow[]>`
  select id, customer_code, name, honorific, postal_code, address, contact_name, closing_day, payment_month_offset,
         payment_day, is_active
  from customers where ${where} order by name_kana nulls last, name`;

// 在籍中の取引先(EV-02 手順1)。includeId を渡すと、取引停止でもその取引先を足す(下書きで選んでいたもの)
export const listInvoiceCustomers = async (includeId?: string | null): Promise<InvoiceCustomer[]> => {
  const rows = await query((sql) =>
    SELECT_CUSTOMER(sql, includeId ? sql`is_active or id = ${includeId}` : sql`is_active`)
  );
  return rows.map(toCustomer);
};

// IDで取引先を読む(印刷の下書き。取引停止も返す)
export const getCustomersByIds = async (ids: string[]): Promise<Map<string, InvoiceCustomer>> => {
  const unique = [...new Set(ids)].filter(isInvoiceId);
  if (unique.length === 0) return new Map();
  const rows = await query((sql) => SELECT_CUSTOMER(sql, sql`id = any(${unique}::uuid[])`));
  return new Map(rows.map((r) => [r.id, toCustomer(r)]));
};

const readCustomer = async (sql: SqlLike, id: string | null): Promise<InvoiceCustomer | null> => {
  if (!id) return null;
  const [r] = await SELECT_CUSTOMER(sql, sql`id = ${id}`);
  return r ? toCustomer(r) : null;
};

export type ProductPick = {
  id: string;
  productCode: string;
  name: string;
  size: string | null;
  color: string | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  taxRate: number;
};

// EV-04 商品を名前・商品コードで探す(在籍中の商品だけ)
export const searchInvoiceProducts = async (q: string, limit = 20): Promise<ProductPick[]> => {
  const word = q.trim();
  if (!word) return [];
  const like = `%${escapeLike(word)}%`;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        product_code: string;
        name: string;
        size: string | null;
        color: string | null;
        sell_price: number | null;
        sell_price_tax_included: boolean;
        tax_rate: number;
      }[]
    >`
      select id, product_code, name, size, color, sell_price, sell_price_tax_included, tax_rate
      from products where is_active and (name ilike ${like} or product_code ilike ${like})
      order by product_code limit ${limit}`
  );
  return rows.map((r) => ({
    id: r.id,
    productCode: r.product_code,
    name: r.name,
    size: r.size,
    color: r.color,
    sellPrice: r.sell_price,
    sellPriceTaxIncluded: r.sell_price_tax_included,
    taxRate: r.tax_rate,
  }));
};

// ---- 請求書の読み取り ----

export type InvoiceLine = InvoiceLineInput & { id: string; lineNo: number; amount: number };

export type Invoice = {
  id: string;
  invoiceNo: string | null;
  status: InvoiceStatus;
  customerId: string | null;
  customerName: string | null;
  customerHonorific: string | null;
  customerPostalCode: string | null;
  customerAddress: string | null;
  customerContact: string | null;
  subject: string | null;
  issuedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  priceBasis: PriceBasis;
  subtotal10: number;
  tax10: number;
  subtotal8: number;
  tax8: number;
  subtotalExempt: number;
  subtotal: number;
  tax: number;
  total: number;
  issuerName: string | null;
  issuerRegistrationNo: string | null;
  issuerPostalCode: string | null;
  issuerAddress: string | null;
  issuerTel: string | null;
  bankText: string | null;
  note: string | null;
  rounding: Rounding;
  replacesInvoiceId: string | null;
  // 差し替える前の請求書の番号・状態(訂正の下書き)
  replacesInvoiceNo: string | null;
  replacesStatus: InvoiceStatus | null;
  replacesPaymentStatus: PaymentStatus | null;
  // 訂正で差し替えた先の請求書(取消のもの)
  replacedById: string | null;
  replacedByNo: string | null;
  issuedAt: Date | null;
  issuedByName: string | null;
  voidReason: string | null;
  voidedAt: Date | null;
  voidedByName: string | null;
  paymentStatus: PaymentStatus;
  paidAmount: number | null;
  paidOn: string | null;
  // 今の取引先の名前・敬称(一覧・下書きの表示。発行済みは写した値を使う)
  currentCustomerName: string | null;
  currentCustomerHonorific: string | null;
  // CH-14 画面を開いたときの updated_at(マイクロ秒の数の文字)
  version: string;
};

type InvoiceRow = {
  id: string;
  invoice_no: string | null;
  status: InvoiceStatus;
  customer_id: string | null;
  customer_name: string | null;
  customer_honorific: string | null;
  customer_postal_code: string | null;
  customer_address: string | null;
  customer_contact: string | null;
  subject: string | null;
  issued_on: string | null;
  period_start: string | null;
  period_end: string | null;
  due_on: string | null;
  price_basis: PriceBasis;
  subtotal_10: number;
  tax_10: number;
  subtotal_8: number;
  tax_8: number;
  subtotal_exempt: number;
  subtotal: number;
  tax: number;
  total: number;
  issuer_name: string | null;
  issuer_registration_no: string | null;
  issuer_postal_code: string | null;
  issuer_address: string | null;
  issuer_tel: string | null;
  bank_text: string | null;
  note: string | null;
  rounding: string;
  replaces_invoice_id: string | null;
  replaces_invoice_no: string | null;
  replaces_status: InvoiceStatus | null;
  replaces_payment_status: PaymentStatus | null;
  replaced_by_id: string | null;
  replaced_by_no: string | null;
  issued_at: Date | null;
  issued_by_name: string | null;
  void_reason: string | null;
  voided_at: Date | null;
  voided_by_name: string | null;
  payment_status: PaymentStatus;
  paid_amount: number | null;
  paid_on: string | null;
  current_customer_name: string | null;
  current_customer_honorific: string | null;
  version: string;
};

const SELECT_INVOICE = (sql: SqlLike, where: SqlFragment, tail: SqlFragment) => sql<InvoiceRow[]>`
  select i.id, i.invoice_no, i.status, i.customer_id, i.customer_name, i.customer_honorific, i.customer_postal_code,
         i.customer_address, i.customer_contact, i.subject, to_char(i.issued_on, 'YYYY-MM-DD') as issued_on,
         to_char(i.period_start, 'YYYY-MM-DD') as period_start, to_char(i.period_end, 'YYYY-MM-DD') as period_end,
         to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.price_basis, i.subtotal_10, i.tax_10, i.subtotal_8, i.tax_8,
         i.subtotal_exempt, i.subtotal, i.tax, i.total, i.issuer_name, i.issuer_registration_no, i.issuer_postal_code,
         i.issuer_address, i.issuer_tel, i.bank_text, i.note, i.rounding, i.replaces_invoice_id,
         o.invoice_no as replaces_invoice_no, o.status as replaces_status, o.payment_status as replaces_payment_status,
         n.id as replaced_by_id, n.invoice_no as replaced_by_no,
         i.issued_at, case when ib.id is null then null else ib.last_name || ' ' || ib.first_name end as issued_by_name,
         i.void_reason, i.voided_at, case when vb.id is null then null else vb.last_name || ' ' || vb.first_name end as voided_by_name,
         i.payment_status, i.paid_amount, to_char(i.paid_on, 'YYYY-MM-DD') as paid_on,
         c.name as current_customer_name, c.honorific as current_customer_honorific,
         (extract(epoch from i.updated_at) * 1000000)::bigint::text as version
  from invoices i
  left join invoices o on o.id = i.replaces_invoice_id
  left join lateral (
    select x.id, x.invoice_no from invoices x
    where x.replaces_invoice_id = i.id and x.status = 'issued' order by x.issued_at desc limit 1
  ) n on true
  left join customers c on c.id = i.customer_id
  left join employees ib on ib.id = i.issued_by
  left join employees vb on vb.id = i.voided_by
  where ${where}
  ${tail}`;

const toInvoice = (r: InvoiceRow): Invoice => ({
  id: r.id,
  invoiceNo: r.invoice_no,
  status: r.status,
  customerId: r.customer_id,
  customerName: r.customer_name,
  customerHonorific: r.customer_honorific,
  customerPostalCode: r.customer_postal_code,
  customerAddress: r.customer_address,
  customerContact: r.customer_contact,
  subject: r.subject,
  issuedOn: r.issued_on,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  dueOn: r.due_on,
  priceBasis: r.price_basis,
  subtotal10: r.subtotal_10,
  tax10: r.tax_10,
  subtotal8: r.subtotal_8,
  tax8: r.tax_8,
  subtotalExempt: r.subtotal_exempt,
  subtotal: r.subtotal,
  tax: r.tax,
  total: r.total,
  issuerName: r.issuer_name,
  issuerRegistrationNo: r.issuer_registration_no,
  issuerPostalCode: r.issuer_postal_code,
  issuerAddress: r.issuer_address,
  issuerTel: r.issuer_tel,
  bankText: r.bank_text,
  note: r.note,
  rounding: isRounding(r.rounding) ? r.rounding : DEFAULT_ROUNDING,
  replacesInvoiceId: r.replaces_invoice_id,
  replacesInvoiceNo: r.replaces_invoice_no,
  replacesStatus: r.replaces_status,
  replacesPaymentStatus: r.replaces_payment_status,
  replacedById: r.replaced_by_id,
  replacedByNo: r.replaced_by_no,
  issuedAt: r.issued_at,
  issuedByName: r.issued_by_name,
  voidReason: r.void_reason,
  voidedAt: r.voided_at,
  voidedByName: r.voided_by_name,
  paymentStatus: r.payment_status,
  paidAmount: r.paid_amount,
  paidOn: r.paid_on,
  currentCustomerName: r.current_customer_name,
  currentCustomerHonorific: r.current_customer_honorific,
  version: r.version,
});

type LineRow = {
  id: string;
  line_no: number;
  transaction_on: string | null;
  product_id: string | null;
  description: string;
  quantity: string | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  tax_rate: number;
};

const readLines = async (sql: SqlLike, invoiceIds: string[]): Promise<Map<string, InvoiceLine[]>> => {
  const result = new Map<string, InvoiceLine[]>();
  if (invoiceIds.length === 0) return result;
  const rows = await sql<(LineRow & { invoice_id: string })[]>`
    select id, invoice_id, line_no, to_char(transaction_on, 'YYYY-MM-DD') as transaction_on, product_id, description,
           quantity::text as quantity, unit, unit_price, amount, tax_rate
    from invoice_lines where invoice_id = any(${invoiceIds}::uuid[]) order by invoice_id, line_no`;
  for (const r of rows) {
    const list = result.get(r.invoice_id) ?? [];
    list.push({
      id: r.id,
      lineNo: r.line_no,
      transactionOn: r.transaction_on,
      productId: r.product_id,
      description: r.description,
      quantity100: quantity100FromDb(r.quantity),
      unit: r.unit,
      unitPrice: r.unit_price,
      amount: r.amount,
      taxRate: r.tax_rate as TaxRate,
    });
    result.set(r.invoice_id, list);
  }
  return result;
};

// 1件と明細を読む。無ければ null
export const getInvoice = async (id: string): Promise<{ invoice: Invoice; lines: InvoiceLine[] } | null> => {
  if (!isInvoiceId(id)) return null;
  const [row] = await query((sql) => SELECT_INVOICE(sql, sql`i.id = ${id}`, sql``));
  if (!row) return null;
  const lines = await query((sql) => readLines(sql, [id]));
  return { invoice: toInvoice(row), lines: lines.get(id) ?? [] };
};

// EV-07 印刷するものを、渡した順に読む(見つからないIDは黙って外す)
export const getInvoicesForPrint = async (ids: string[]): Promise<{ invoice: Invoice; lines: InvoiceLine[] }[]> => {
  const valid = ids.filter(isInvoiceId);
  if (valid.length === 0) return [];
  const rows = await query((sql) => SELECT_INVOICE(sql, sql`i.id = any(${valid}::uuid[])`, sql``));
  const lines = await query((sql) => readLines(sql, valid));
  const byId = new Map(rows.map((r) => [r.id, toInvoice(r)]));
  return valid.flatMap((id) => {
    const invoice = byId.get(id);
    return invoice ? [{ invoice, lines: lines.get(id) ?? [] }] : [];
  });
};

// 保存した請求書を、計算・チェック(invoices.ts)に渡す形にする
export const toInvoiceInput = (invoice: Invoice, lines: InvoiceLine[]): InvoiceInput => ({
  customerId: invoice.customerId,
  subject: invoice.subject,
  issuedOn: invoice.issuedOn,
  periodStart: invoice.periodStart,
  periodEnd: invoice.periodEnd,
  dueOn: invoice.dueOn,
  priceBasis: invoice.priceBasis,
  note: invoice.note,
  lines: lines.map((l) => ({
    transactionOn: l.transactionOn,
    productId: l.productId,
    description: l.description,
    quantity100: l.quantity100,
    unit: l.unit,
    unitPrice: l.unitPrice,
    taxRate: l.taxRate,
  })),
});

// ---- EV-01 一覧 ----

export type InvoiceTab = "draft" | "issued" | "void" | "all";
export type PaymentFilter = "" | "unpaid" | "paid" | "overdue";
export type InvoiceFilter = {
  tab: InvoiceTab;
  payment: PaymentFilter;
  customerId: string;
  // 発行日の年月(YYYY-MM)。【仮】下書きは月で絞らずに出す(00_仮決め一覧 E-05-仮-09)
  month: string;
  today: string;
};

const lastDayOfMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

export const listInvoices = async (filter: InvoiceFilter, page: number): Promise<{ total: number; items: Invoice[] }> => {
  const where = (sql: SqlLike) => sql`
    ${filter.tab === "all" ? sql`true` : sql`i.status = ${filter.tab}`}
    ${filter.customerId ? sql`and i.customer_id = ${filter.customerId}` : sql``}
    ${filter.month ? sql`and (i.status = 'draft' or i.issued_on between ${`${filter.month}-01`} and ${lastDayOfMonth(filter.month)})` : sql``}
    ${
      filter.payment === "unpaid"
        ? sql`and i.status = 'issued' and i.payment_status <> 'paid'`
        : filter.payment === "paid"
          ? sql`and i.status = 'issued' and i.payment_status = 'paid'`
          : filter.payment === "overdue"
            ? sql`and i.status = 'issued' and i.payment_status = 'unpaid' and i.due_on < ${filter.today}`
            : sql``
    }`;
  // 並び: 下書きを先に、そのほかは発行日の新しい順(EV-01 手順2)
  const order = (sql: SqlLike) =>
    sql`order by (i.status = 'draft') desc, i.issued_on desc nulls last, i.invoice_no desc nulls last, i.created_at desc`;
  const [count] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from invoices i where ${where(sql)}`);
  const rows = await query((sql) =>
    SELECT_INVOICE(sql, where(sql), sql`${order(sql)} limit ${INVOICES_PAGE_SIZE} offset ${(page - 1) * INVOICES_PAGE_SIZE}`)
  );
  return { total: count.n, items: rows.map(toInvoice) };
};

// 下書きの件数(状態のタブの「下書き 2」)
export const countDraftInvoices = async (): Promise<number> => {
  const [row] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from invoices where status = 'draft'`);
  return row?.n ?? 0;
};

// ---- EV-05 保存(下書き) ----

const insertLines = async (tx: TransactionSql, invoiceId: string, lines: InvoiceLineInput[], amounts: number[]) => {
  if (lines.length === 0) return;
  const rows = lines.map((l, i) => ({
    invoice_id: invoiceId,
    line_no: i + 1,
    transaction_on: l.transactionOn,
    product_id: l.productId,
    description: l.description,
    quantity: l.quantity100 === null ? null : quantityText(l.quantity100),
    unit: l.unit,
    unit_price: l.unitPrice,
    amount: amounts[i],
    tax_rate: l.taxRate,
  }));
  await tx`insert into invoice_lines ${tx(
    rows,
    "invoice_id",
    "line_no",
    "transaction_on",
    "product_id",
    "description",
    "quantity",
    "unit",
    "unit_price",
    "amount",
    "tax_rate"
  )}`;
};

const headerColumns = (input: InvoiceInput, rounding: Rounding) => {
  const t = calcInvoiceTotals(input.lines, input.priceBasis, rounding);
  return {
    totals: t,
    columns: {
      customer_id: input.customerId,
      subject: input.subject,
      issued_on: input.issuedOn,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      due_on: input.dueOn,
      price_basis: input.priceBasis,
      subtotal_10: t.subtotal10,
      tax_10: t.tax10,
      subtotal_8: t.subtotal8,
      tax_8: t.tax8,
      subtotal_exempt: t.subtotalExempt,
      subtotal: t.subtotal,
      tax: t.tax,
      total: t.total,
      note: input.note,
      rounding,
    },
  };
};

export type SaveResult = { ok: true; id: string } | { ok: false; reason: "conflict" | "status" | "not_found" };

// 新規なら draft で登録、あれば更新して明細を入れ替える(1つのトランザクション。CH-10・CH-14)
export const saveDraft = async (
  id: string | null,
  version: string,
  input: InvoiceInput,
  rounding: Rounding,
  by: string,
  replacesInvoiceId: string | null = null
): Promise<SaveResult> =>
  transaction(async (tx) => {
    const { totals, columns } = headerColumns(input, rounding);
    if (!id) {
      const [row] = await tx<{ id: string }[]>`
        insert into invoices ${tx({ ...columns, status: "draft", replaces_invoice_id: replacesInvoiceId, created_by: by, updated_by: by })}
        returning id`;
      await insertLines(tx, row.id, input.lines, totals.amounts);
      return { ok: true, id: row.id };
    }
    const [current] = await tx<{ status: InvoiceStatus; version: string }[]>`
      select status, (extract(epoch from updated_at) * 1000000)::bigint::text as version
      from invoices where id = ${id} for update`;
    if (!current) return { ok: false, reason: "not_found" };
    if (current.status !== "draft") return { ok: false, reason: "status" };
    if (current.version !== version) return { ok: false, reason: "conflict" };
    await tx`update invoices set ${tx({ ...columns, updated_by: by })} where id = ${id}`;
    await tx`delete from invoice_lines where invoice_id = ${id}`;
    await insertLines(tx, id, input.lines, totals.amounts);
    return { ok: true, id };
  });

// ---- EV-08 発行 ----

export type IssueResult =
  | { ok: true; invoiceNo: string }
  | { ok: false; reason: "conflict" | "status" | "not_found" | "replace_blocked" | "no_limit" | "failed" }
  | { ok: false; reason: "blocked"; blockers: string[] };

class IssueStop extends Error {
  constructor(readonly result: IssueResult) {
    super("issue stopped");
  }
}

const issueOnce = (id: string, version: string, today: string, by: string): Promise<IssueResult> =>
  transaction(async (tx) => {
    const [row] = await SELECT_INVOICE(tx, tx`i.id = ${id}`, tx`for update of i`);
    if (!row) return { ok: false, reason: "not_found" };
    const invoice = toInvoice(row);
    if (invoice.status !== "draft") return { ok: false, reason: "status" };
    if (invoice.version !== version) return { ok: false, reason: "conflict" };

    // 発行のトランザクションの中で自社の情報・取引先を読む(CH-02 で確かめたものと同じ値を写すため。0.3)
    const company = await readCompany(tx);
    const customer = await readCustomer(tx, invoice.customerId);
    const lines = (await readLines(tx, [id])).get(id) ?? [];
    const input = toInvoiceInput(invoice, lines);
    const rounding = currentRounding(company);

    // CH-09 発行できる条件
    const blockers = issueBlockers(input, {
      company,
      customer: customer ? { name: customer.name, isActive: customer.isActive } : null,
      today,
      rounding,
    });
    if (blockers.length > 0) return { ok: false, reason: "blocked", blockers };

    // CH-11 訂正の下書きなら、元の請求書がまだ発行済みで、入金の消込が無いこと(発行の直前にもう一度)
    let original: { id: string; invoice_no: string } | undefined;
    if (invoice.replacesInvoiceId) {
      [original] = await tx<{ id: string; invoice_no: string }[]>`
        select id, invoice_no from invoices
        where id = ${invoice.replacesInvoiceId} and status = 'issued' and payment_status = 'unpaid' and coalesce(paid_amount, 0) = 0
        for update`;
      if (!original) return { ok: false, reason: "replace_blocked" };
    }

    // CH-12 その年月の最大の番号＋1
    const prefix = invoiceNoPrefix(input.issuedOn ?? today);
    const [seqRow] = await tx<{ n: number }[]>`
      select coalesce(max(substr(invoice_no, 8)::int), 0)::int + 1 as n from invoices where invoice_no like ${`${prefix}-%`}`;
    if (seqRow.n > INVOICE_NO_MAX_SEQ) return { ok: false, reason: "no_limit" };
    const invoiceNo = formatInvoiceNo(input.issuedOn ?? today, seqRow.n);

    // 0.3 の写しと、金額の計算し直し(発行のときの端数処理で。CH-06・CH-07)
    const t = calcInvoiceTotals(input.lines, input.priceBasis, rounding);
    if (!customer || !company) throw new IssueStop({ ok: false, reason: "failed" });
    await tx`
      update invoices set ${tx({
        invoice_no: invoiceNo,
        status: "issued",
        customer_name: customer.name,
        customer_honorific: customer.honorific,
        customer_postal_code: customer.postalCode,
        customer_address: customer.address,
        customer_contact: customer.contactName,
        subtotal_10: t.subtotal10,
        tax_10: t.tax10,
        subtotal_8: t.subtotal8,
        tax_8: t.tax8,
        subtotal_exempt: t.subtotalExempt,
        subtotal: t.subtotal,
        tax: t.tax,
        total: t.total,
        issuer_name: company.companyName.trim(),
        issuer_registration_no: normalizeRegistrationNo(company.registrationNo ?? ""),
        issuer_postal_code: company.postalCode,
        issuer_address: company.address,
        issuer_tel: company.tel,
        bank_text: bankTextOf(company),
        rounding,
        issued_by: by,
        payment_status: "unpaid",
        updated_by: by,
      })}, issued_at = now()
      where id = ${id}`;
    // 明細の金額も計算し直した値にそろえる(CH-06)
    for (const [i, l] of lines.entries()) {
      if (l.amount !== t.amounts[i]) await tx`update invoice_lines set amount = ${t.amounts[i]} where id = ${l.id}`;
    }

    // 訂正なら、同じトランザクションで元の請求書を取消にする(EV-08 手順4)
    if (original) {
      await tx`
        update invoices set status = 'void', void_reason = ${`訂正のため ${invoiceNo} に差し替え`},
               voided_at = now(), voided_by = ${by}, updated_by = ${by}
        where id = ${original.id}`;
    }
    return { ok: true, invoiceNo };
  });

// 番号が重なったら(一意制約の違反)取り直す(3回まで。CH-12)
export const issueInvoice = async (id: string, version: string, today: string, by: string): Promise<IssueResult> => {
  for (let attempt = 0; attempt < ISSUE_RETRY; attempt++) {
    try {
      return await issueOnce(id, version, today, by);
    } catch (e) {
      if (e instanceof IssueStop) return e.result;
      if (isUniqueViolation(e, "invoices_invoice_no_key")) continue;
      throw e;
    }
  }
  return { ok: false, reason: "failed" };
};

// ---- EV-10 訂正 ----

export type CorrectionResult = { ok: true; id: string } | { ok: false; reason: "not_found" | "status" | "paid" };

// CH-11 取消・訂正できる条件(状態が発行済みで、入金の消込が無い)
export const canVoidOrCorrect = (invoice: Pick<Invoice, "status" | "paymentStatus" | "paidAmount">): boolean =>
  invoice.status === "issued" && invoice.paymentStatus === "unpaid" && (invoice.paidAmount ?? 0) === 0;

// 元の請求書の内容を写した下書きを作る。すでに訂正の下書きがあれば、新しく作らずにそれを返す
export const createCorrectionDraft = async (id: string, by: string): Promise<CorrectionResult> => {
  const loaded = await getInvoice(id);
  if (!loaded) return { ok: false, reason: "not_found" };
  const { invoice, lines } = loaded;
  if (invoice.status !== "issued") return { ok: false, reason: "status" };
  if (!canVoidOrCorrect(invoice)) return { ok: false, reason: "paid" };

  const [existing] = await query(
    (sql) => sql<{ id: string }[]>`select id from invoices where replaces_invoice_id = ${id} and status = 'draft' limit 1`
  );
  if (existing) return { ok: true, id: existing.id };

  const company = await getCompanySettings();
  try {
    const saved = await saveDraft(null, "", toInvoiceInput(invoice, lines), currentRounding(company), by, id);
    return saved.ok ? { ok: true, id: saved.id } : { ok: false, reason: "status" };
  } catch (e) {
    // 同時に押して、もう一方が先に作ったとき(invoices_replaces_draft_key)
    if (isUniqueViolation(e, "invoices_replaces_draft_key")) {
      const [again] = await query(
        (sql) => sql<{ id: string }[]>`select id from invoices where replaces_invoice_id = ${id} and status = 'draft' limit 1`
      );
      if (again) return { ok: true, id: again.id };
    }
    throw e;
  }
};

// ---- EV-11 取消 ----

export type VoidResult = { ok: true } | { ok: false; reason: "conflict" | "paid" | "not_found" };

export const voidInvoice = async (id: string, version: string, reason: string, by: string): Promise<VoidResult> =>
  transaction(async (tx) => {
    const [row] = await tx<{ status: InvoiceStatus; payment_status: PaymentStatus; paid_amount: number | null; version: string }[]>`
      select status, payment_status, paid_amount, (extract(epoch from updated_at) * 1000000)::bigint::text as version
      from invoices where id = ${id} for update`;
    if (!row) return { ok: false, reason: "not_found" };
    if (row.version !== version) return { ok: false, reason: "conflict" };
    if (!canVoidOrCorrect({ status: row.status, paymentStatus: row.payment_status, paidAmount: row.paid_amount }))
      return { ok: false, reason: "paid" };
    await tx`
      update invoices set status = 'void', void_reason = ${reason}, voided_at = now(), voided_by = ${by}, updated_by = ${by}
      where id = ${id}`;
    return { ok: true };
  });

// ---- EV-12 削除(下書きだけ) ----

export const deleteDraft = async (id: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`delete from invoices where id = ${id} and status = 'draft' returning id`
  );
  return rows.length > 0;
};
