// 入金消込(E-06)のDBの読み書き(03 の 0章・EV-01〜EV-10、04 CH-02〜CH-10・CH-12)。計算は deposits.ts、CSVの読み取りは bankCsv.ts。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("receivables") を済ませている前提)。
// 請求書(E-05 の invoices)は、入金の列(payment_status・paid_amount・paid_on)だけを書く。
import { query, transaction, type SqlFragment, type SqlLike, type TransactionSql } from "@/utils/db";
import { isUniqueViolation } from "@/utils/dbErrors";
import { escapeLike } from "@/utils/textNormalize";
import { addresseeOf } from "@/utils/invoices";
import { readBankRows, isBankCsvFormat, type BankRow, type BankRowError } from "@/utils/bankCsv";
import type { CsvRow } from "@/utils/csvImport/engine";
import type { ImportCounts } from "@/utils/csvImport/batches";
import {
  WITHDRAWAL_REASON,
  checkMatch,
  suggestInvoices,
  type AccountType,
  type Candidate,
  type InvoiceForMatch,
  type MatchStatus,
} from "@/utils/deposits";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: string): boolean => UUID_PATTERN.test(v);

// 更新の衝突を見分ける値(updated_at をマイクロ秒の文字にしたもの。CH-10)
const VERSION = (sql: SqlLike, table: string) => sql`(extract(epoch from ${sql(table)}.updated_at) * 1000000)::bigint::text`;

// ---- 銀行口座(G04・EV-10) ----

export type BankAccount = {
  id: string;
  bankName: string;
  branchName: string | null;
  accountType: AccountType;
  last4: string | null;
  hasOnlineBanking: boolean;
  csvFormat: string | null;
  isTarget: boolean;
  sortOrder: number;
  isActive: boolean;
};

type AccountRow = {
  id: string;
  bank_name: string;
  branch_name: string | null;
  account_type: AccountType;
  account_number_last4: string | null;
  has_online_banking: boolean;
  csv_format: string | null;
  is_target: boolean;
  sort_order: number;
  is_active: boolean;
};
const toAccount = (r: AccountRow): BankAccount => ({
  id: r.id,
  bankName: r.bank_name,
  branchName: r.branch_name,
  accountType: r.account_type,
  last4: r.account_number_last4,
  hasOnlineBanking: r.has_online_banking,
  csvFormat: r.csv_format,
  isTarget: r.is_target,
  sortOrder: r.sort_order,
  isActive: r.is_active,
});

// 使っている口座を先に、並び順に
export const listBankAccounts = async (): Promise<BankAccount[]> => {
  const rows = await query(
    (sql) => sql<AccountRow[]>`
      select id, bank_name, branch_name, account_type, account_number_last4, has_online_banking, csv_format,
             is_target, sort_order, is_active
      from bank_accounts order by is_active desc, sort_order, bank_name, created_at`
  );
  return rows.map(toAccount);
};

// 消込の画面(G01)で選べる口座: 使っていて、消込の対象
export const isTargetAccount = (a: BankAccount): boolean => a.isActive && a.isTarget;

// CH-02 取り込める口座: 使っていて、消込の対象で、CSVの形が設定されている
export const isImportableAccount = (a: BankAccount): boolean =>
  a.isActive && a.isTarget && a.hasOnlineBanking && !!a.csvFormat && isBankCsvFormat(a.csvFormat);

export const getBankAccount = async (id: string): Promise<BankAccount | null> => {
  if (!isUuid(id)) return null;
  const rows = await query(
    (sql) => sql<AccountRow[]>`
      select id, bank_name, branch_name, account_type, account_number_last4, has_online_banking, csv_format,
             is_target, sort_order, is_active
      from bank_accounts where id = ${id}`
  );
  return rows[0] ? toAccount(rows[0]) : null;
};

export type BankAccountInput = Omit<BankAccount, "id">;

// EV-10 手順2 登録または更新(口座は削除しない)。更新で行が無ければ false
export const saveBankAccount = async (id: string | null, input: BankAccountInput, by: string): Promise<boolean> => {
  const v = {
    bank_name: input.bankName,
    branch_name: input.branchName,
    account_type: input.accountType,
    account_number_last4: input.last4,
    has_online_banking: input.hasOnlineBanking,
    csv_format: input.csvFormat,
    is_target: input.isTarget,
    sort_order: input.sortOrder,
    is_active: input.isActive,
  };
  if (!id) {
    await query((sql) => sql`insert into bank_accounts ${sql({ ...v, created_by: by, updated_by: by })}`);
    return true;
  }
  const rows = await query(
    (sql) => sql`update bank_accounts set ${sql({ ...v, updated_by: by })} where id = ${id} returning id`
  );
  return rows.length > 0;
};

// ---- 消込の対象の請求書(03 0.1 手順2) ----

export type OpenInvoice = InvoiceForMatch & { addressee: string; customerId: string | null };

// 発行済み・未入金で、ほかの入金に消し込まれていない請求書(取消・下書きは除く)
const readOpenInvoices = async (sql: SqlLike, extra = sql``): Promise<OpenInvoice[]> => {
  const rows = await sql<
    {
      id: string;
      invoice_no: string;
      total: number;
      issued_on: string;
      due_on: string | null;
      customer_id: string | null;
      customer_name: string | null;
      customer_honorific: string | null;
      payer_name_kana: string | null;
    }[]
  >`
    select i.id, i.invoice_no, i.total, to_char(i.issued_on, 'YYYY-MM-DD') as issued_on,
           to_char(i.due_on, 'YYYY-MM-DD') as due_on, i.customer_id, i.customer_name, i.customer_honorific,
           c.payer_name_kana
    from invoices i
    left join customers c on c.id = i.customer_id
    where i.status = 'issued' and i.payment_status = 'unpaid'
      and not exists (select 1 from bank_transactions t where t.invoice_id = i.id)
      ${extra}
    order by i.due_on nulls last, i.invoice_no`;
  return rows.map((r) => ({
    id: r.id,
    invoiceNo: r.invoice_no,
    total: r.total,
    issuedOn: r.issued_on,
    dueOn: r.due_on,
    payerNamesKana: r.payer_name_kana,
    customerId: r.customer_id,
    addressee: addresseeOf(r.customer_name, r.customer_honorific),
  }));
};

export const listOpenInvoices = (): Promise<OpenInvoice[]> => query((sql) => readOpenInvoices(sql));

// 1件の入金の候補を探し直し、いちばん上を suggested_invoice_id に入れる(EV-07 手順4・EV-08 手順2)
const refreshSuggestion = async (tx: TransactionSql, txnId: string): Promise<void> => {
  const [t] = await tx<{ deposit: number; transaction_on: string; payer_name: string | null }[]>`
    select deposit, to_char(transaction_on, 'YYYY-MM-DD') as transaction_on, payer_name
    from bank_transactions where id = ${txnId}`;
  if (!t) return;
  const [top] = suggestInvoices(
    { deposit: t.deposit, transactionOn: t.transaction_on, payerName: t.payer_name },
    await readOpenInvoices(tx),
    1
  );
  await tx`update bank_transactions set suggested_invoice_id = ${top?.invoiceId ?? null} where id = ${txnId}`;
};

// ---- 明細の取り込み(EV-02・EV-03) ----

export type BankImportKind = "new" | "imported" | "duplicate";
export type BankImportEntry = BankRow & { kind: BankImportKind };

export type BankImportPlan =
  | {
      ok: true;
      entries: BankImportEntry[];
      errors: BankRowError[];
      skipped: number;
      unusedColumns: string[];
      dataRowCount: number;
      counts: ImportCounts;
      depositCount: number;
      withdrawalCount: number;
    }
  | { ok: false; error: string };

// EV-02 手順2〜4: 口座の形で読み、行を確かめ、同じ口座に同じ明細があれば「取込済み」にする(CH-03・CH-04)
export const planBankImport = async (account: BankAccount, header: string[], rows: CsvRow[]): Promise<BankImportPlan> => {
  if (!account.csvFormat || !isBankCsvFormat(account.csvFormat))
    return { ok: false, error: "この口座の明細は、まだ取り込めません（口座の設定で「CSVの形」を選んでください）。" };
  const read = readBankRows(account.csvFormat, account.id, header, rows);
  if (!read.ok) return read;

  const hashes = read.rows.map((r) => r.rowHash);
  const existing = new Set<string>();
  if (hashes.length > 0) {
    const found = await query(
      (sql) => sql<{ row_hash: string }[]>`
        select row_hash from bank_transactions where bank_account_id = ${account.id} and row_hash = any(${hashes}::text[])`
    );
    for (const f of found) existing.add(f.row_hash);
  }
  const seen = new Set<string>();
  const entries: BankImportEntry[] = read.rows.map((r) => {
    const kind: BankImportKind = existing.has(r.rowHash) ? "imported" : seen.has(r.rowHash) ? "duplicate" : "new";
    seen.add(r.rowHash);
    return { ...r, kind };
  });
  const count = (k: BankImportKind) => entries.filter((e) => e.kind === k).length;
  return {
    ok: true,
    entries,
    errors: read.errors,
    skipped: read.skipped,
    unusedColumns: read.unusedColumns,
    dataRowCount: read.rows.length + read.errors.length,
    counts: { add: count("new"), change: 0, same: count("imported"), delete: 0, skip: count("duplicate") + read.skipped, error: read.errors.length },
    depositCount: read.rows.filter((r) => r.deposit > 0).length,
    withdrawalCount: read.rows.filter((r) => r.withdrawal > 0).length,
  };
};

// EV-03 手順2・3: 「取込済み」を除いた行を入れ(出金は対象外、入金は未消込)、入れた入金ごとに候補を探す。呼ぶ側のトランザクションの中で
export const applyBankImport = async (
  tx: TransactionSql,
  accountId: string,
  entries: BankImportEntry[],
  batchId: string
): Promise<{ added: number; suggested: number; latestOn: string | null }> => {
  const rows = entries
    .filter((e) => e.kind === "new")
    .map((e) => ({
      transaction_on: e.transactionOn,
      description: e.description,
      payer_name: e.payerName,
      deposit: e.deposit,
      withdrawal: e.withdrawal,
      balance: e.balance,
      row_hash: e.rowHash,
      match_status: e.deposit > 0 ? "unmatched" : "ignored",
      ignore_reason: e.deposit > 0 ? null : WITHDRAWAL_REASON,
    }));
  if (rows.length === 0) return { added: 0, suggested: 0, latestOn: null };
  // 同じ明細が別の画面で先に入ったときは入れない(CH-04。DBの重複不可でもふせぐ)
  const inserted = await tx<{ id: string; deposit: number; transaction_on: string; payer_name: string | null }[]>`
    insert into bank_transactions (
      bank_account_id, import_batch_id, transaction_on, description, payer_name, deposit, withdrawal, balance,
      row_hash, match_status, ignore_reason
    )
    select ${accountId}, ${batchId}, d.transaction_on, d.description, d.payer_name, d.deposit, d.withdrawal, d.balance,
           d.row_hash, d.match_status, d.ignore_reason
    from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as d (
      transaction_on date, description text, payer_name text, deposit integer, withdrawal integer, balance bigint,
      row_hash text, match_status text, ignore_reason text
    )
    on conflict (bank_account_id, row_hash) do nothing
    returning id, deposit, to_char(transaction_on, 'YYYY-MM-DD') as transaction_on, payer_name`;

  const deposits = inserted.filter((r) => r.deposit > 0);
  const suggestions: { id: string; invoice_id: string }[] = [];
  if (deposits.length > 0) {
    const invoices = await readOpenInvoices(tx);
    for (const d of deposits) {
      const [top] = suggestInvoices({ deposit: d.deposit, transactionOn: d.transaction_on, payerName: d.payer_name }, invoices, 1);
      if (top) suggestions.push({ id: d.id, invoice_id: top.invoiceId });
    }
  }
  if (suggestions.length > 0) {
    await tx`
      update bank_transactions t set suggested_invoice_id = d.invoice_id
      from jsonb_to_recordset(${JSON.stringify(suggestions)}::jsonb) as d (id uuid, invoice_id uuid)
      where t.id = d.id`;
  }
  const latestOn = inserted.reduce<string | null>((max, r) => (max === null || r.transaction_on > max ? r.transaction_on : max), null);
  return { added: inserted.length, suggested: suggestions.length, latestOn };
};

// ---- 入金の一覧(G01・EV-01) ----

export type DepositTab = MatchStatus;

export type Deposit = {
  id: string;
  bankAccountId: string;
  transactionOn: string;
  description: string;
  payerName: string | null;
  deposit: number;
  matchStatus: MatchStatus;
  suggestedInvoiceId: string | null;
  invoiceId: string | null;
  invoiceNo: string | null;
  invoiceAddressee: string | null;
  invoiceTotal: number | null;
  feeAmount: number;
  matchedByName: string | null;
  matchedAt: Date | null;
  ignoreReason: string | null;
  importBatchId: string;
  version: string;
};

type DepositRow = {
  id: string;
  bank_account_id: string;
  transaction_on: string;
  description: string;
  payer_name: string | null;
  deposit: number;
  match_status: MatchStatus;
  suggested_invoice_id: string | null;
  invoice_id: string | null;
  invoice_no: string | null;
  customer_name: string | null;
  customer_honorific: string | null;
  invoice_total: number | null;
  fee_amount: number;
  matched_by_name: string | null;
  matched_at: Date | null;
  ignore_reason: string | null;
  import_batch_id: string;
  version: string;
};

const SELECT_DEPOSIT = (sql: SqlLike, where: SqlFragment) => sql<DepositRow[]>`
  select t.id, t.bank_account_id, to_char(t.transaction_on, 'YYYY-MM-DD') as transaction_on, t.description, t.payer_name,
         t.deposit, t.match_status, t.suggested_invoice_id, t.invoice_id, i.invoice_no, i.customer_name, i.customer_honorific,
         i.total as invoice_total, t.fee_amount,
         case when e.id is null then null else e.last_name || ' ' || e.first_name end as matched_by_name,
         t.matched_at, t.ignore_reason, t.import_batch_id, ${VERSION(sql, "t")} as version
  from bank_transactions t
  left join invoices i on i.id = t.invoice_id
  left join employees e on e.id = t.matched_by
  where t.deposit > 0 and ${where}
  order by t.transaction_on desc, t.created_at desc, t.id`;

const toDeposit = (r: DepositRow): Deposit => ({
  id: r.id,
  bankAccountId: r.bank_account_id,
  transactionOn: r.transaction_on,
  description: r.description,
  payerName: r.payer_name,
  deposit: r.deposit,
  matchStatus: r.match_status,
  suggestedInvoiceId: r.suggested_invoice_id,
  invoiceId: r.invoice_id,
  invoiceNo: r.invoice_no,
  invoiceAddressee: r.invoice_id ? addresseeOf(r.customer_name, r.customer_honorific) : null,
  invoiceTotal: r.invoice_total,
  feeAmount: r.fee_amount,
  matchedByName: r.matched_by_name,
  matchedAt: r.matched_at,
  ignoreReason: r.ignore_reason,
  importBatchId: r.import_batch_id,
  version: r.version,
});

const monthRange = (month: string): [string, string] => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return [`${month}-01`, `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`];
};

// EV-01 手順3: その口座・月の入金(出金は出さない)を、取引日の新しい順に
export const listDeposits = async (accountId: string, month: string, tab: DepositTab): Promise<Deposit[]> => {
  const [from, to] = monthRange(month);
  const rows = await query((sql) =>
    SELECT_DEPOSIT(
      sql,
      sql`t.bank_account_id = ${accountId} and t.transaction_on between ${from} and ${to} and t.match_status = ${tab}`
    )
  );
  return rows.map(toDeposit);
};

// タブの件数(その口座・月の入金)
export const countDepositsByStatus = async (accountId: string, month: string): Promise<Record<MatchStatus, number>> => {
  const [from, to] = monthRange(month);
  const rows = await query(
    (sql) => sql<{ match_status: MatchStatus; n: number }[]>`
      select match_status, count(*)::int as n from bank_transactions
      where deposit > 0 and bank_account_id = ${accountId} and transaction_on between ${from} and ${to}
      group by match_status`
  );
  const counts: Record<MatchStatus, number> = { unmatched: 0, matched: 0, ignored: 0 };
  for (const r of rows) counts[r.match_status] = r.n;
  return counts;
};

// 左メニューの件数のバッジ(未消込の入金。すべての口座・月)
export const countUnmatchedDeposits = async (): Promise<number> => {
  const [row] = await query(
    (sql) => sql<{ n: number }[]>`select count(*)::int as n from bank_transactions where deposit > 0 and match_status = 'unmatched'`
  );
  return row?.n ?? 0;
};

export const getDeposit = async (id: string): Promise<Deposit | null> => {
  if (!isUuid(id)) return null;
  const rows = await query((sql) => SELECT_DEPOSIT(sql, sql`t.id = ${id}`));
  return rows[0] ? toDeposit(rows[0]) : null;
};

// 未消込の入金ごとの候補(画面を開いたときに計算し直す。取り込みのときの候補がまだ使えれば、それを先に出す)
export const candidatesForDeposits = (deposits: Deposit[], invoices: OpenInvoice[]): Map<string, Candidate[]> => {
  const result = new Map<string, Candidate[]>();
  for (const d of deposits) {
    const list = suggestInvoices({ deposit: d.deposit, transactionOn: d.transactionOn, payerName: d.payerName }, invoices);
    const i = list.findIndex((c) => c.invoiceId === d.suggestedInvoiceId);
    if (i > 0) list.unshift(...list.splice(i, 1));
    result.set(d.id, list);
  }
  return result;
};

// EV-01 手順4: 発行済み・未入金の請求書を、期限の古い順に(未入金の請求書のタブ)
export const listUnpaidInvoices = (): Promise<OpenInvoice[]> => listOpenInvoices();

// EV-01 手順5: その口座の最後の取り込み(日時・人・件数)
export type LastImport = { batchId: string; appliedAt: Date; byName: string | null; rowCount: number; matchedCount: number };
export const getLastImport = async (accountId: string): Promise<LastImport | null> => {
  const rows = await query(
    (sql) => sql<{ id: string; applied_at: Date; by_name: string | null; row_count: number; matched_count: number }[]>`
      select b.id, b.applied_at,
             case when e.id is null then null else e.last_name || ' ' || e.first_name end as by_name,
             count(t.id)::int as row_count, count(t.id) filter (where t.match_status = 'matched')::int as matched_count
      from import_batches b
      join bank_transactions t on t.import_batch_id = b.id
      left join employees e on e.id = b.applied_by
      where b.kind = 'bank_transactions' and b.status = 'applied' and t.bank_account_id = ${accountId}
      group by b.id, b.applied_at, e.id, e.last_name, e.first_name
      order by b.applied_at desc nulls last
      limit 1`
  );
  const r = rows[0];
  return r ? { batchId: r.id, appliedAt: r.applied_at, byName: r.by_name, rowCount: r.row_count, matchedCount: r.matched_count } : null;
};

// ---- 請求書を選ぶ(G03・EV-05) ----

// 【仮】G03 に出す請求書の数の上限(00_仮決め一覧 E-06-仮-10)
export const SELECT_INVOICES_LIMIT = 100;

// 発行済み・未入金・発行日 ≦ 入金日 の請求書(取引先・番号・宛名で絞り込める)
export const listSelectableInvoices = (
  transactionOn: string,
  filter: { customerId: string; q: string }
): Promise<OpenInvoice[]> =>
  query((sql) => {
    const like = `%${escapeLike(filter.q)}%`;
    return readOpenInvoices(
      sql,
      sql`and i.issued_on <= ${transactionOn}
          ${filter.customerId ? sql`and i.customer_id = ${filter.customerId}` : sql``}
          ${filter.q ? sql`and (i.invoice_no ilike ${like} or i.customer_name ilike ${like})` : sql``}`
    );
  }).then((rows) => rows.slice(0, SELECT_INVOICES_LIMIT));

// 絞り込みの取引先(発行済み・未入金の請求書がある取引先)
export const listOpenInvoiceCustomers = async (): Promise<{ id: string; name: string }[]> =>
  query(
    (sql) => sql<{ id: string; name: string }[]>`
      select distinct c.id, c.name from invoices i join customers c on c.id = i.customer_id
      where i.status = 'issued' and i.payment_status = 'unpaid' order by c.name`
  );

// ---- 消込の確定・外す・対象外(0.3・0.4、EV-04・EV-06〜EV-08) ----

export type MatchResult =
  | { ok: true; invoiceNo: string }
  | { ok: false; reason: "not_found" | "conflict" | "status" | "invoice_void" | "invoice_taken" | "amount" | "date" };

// 0.3 消込を確定する(1つのトランザクション。CH-07・CH-10 を確定の直前にもう一度確かめる)
export const applyMatch = async (txnId: string, invoiceId: string, version: string, by: string): Promise<MatchResult> => {
  if (!isUuid(txnId) || !isUuid(invoiceId)) return { ok: false, reason: "not_found" };
  try {
    return await transaction(async (tx): Promise<MatchResult> => {
      const [t] = await tx<{ deposit: number; transaction_on: string; match_status: MatchStatus; version: string }[]>`
        select deposit, to_char(transaction_on, 'YYYY-MM-DD') as transaction_on, match_status, ${VERSION(tx, "bank_transactions")} as version
        from bank_transactions where id = ${txnId} for update`;
      if (!t) return { ok: false, reason: "not_found" };
      if (t.version !== version) return { ok: false, reason: "conflict" };
      if (t.match_status !== "unmatched" || t.deposit <= 0) return { ok: false, reason: "status" };
      const [inv] = await tx<{ invoice_no: string; status: string; payment_status: string; total: number; issued_on: string; taken: boolean }[]>`
        select invoice_no, status, payment_status, total, to_char(issued_on, 'YYYY-MM-DD') as issued_on,
               exists (select 1 from bank_transactions x where x.invoice_id = invoices.id) as taken
        from invoices where id = ${invoiceId} for update`;
      if (!inv) return { ok: false, reason: "not_found" };
      if (inv.status === "void") return { ok: false, reason: "invoice_void" };
      if (inv.status !== "issued") return { ok: false, reason: "not_found" };
      if (inv.taken || inv.payment_status !== "unpaid") return { ok: false, reason: "invoice_taken" };
      const check = checkMatch({ deposit: t.deposit, transactionOn: t.transaction_on }, { total: inv.total, issuedOn: inv.issued_on });
      if (!check.ok) return { ok: false, reason: check.reason };
      // 手順2: 入金
      await tx`
        update bank_transactions set match_status = 'matched', invoice_id = ${invoiceId}, fee_amount = ${check.fee},
               matched_by = ${by}, matched_at = now()
        where id = ${txnId}`;
      // 手順3: 請求書(E-05)を入金済みに(入金額は手数料を含めたご請求額)
      await tx`
        update invoices set payment_status = 'paid', paid_amount = total, paid_on = ${t.transaction_on}, updated_by = ${by}
        where id = ${invoiceId}`;
      return { ok: true, invoiceNo: inv.invoice_no };
    });
  } catch (e) {
    // CH-07 の3: 同じ請求書に同時に消し込まれたとき(invoice_id の重複不可)
    if (isUniqueViolation(e, "bank_transactions_invoice_key")) return { ok: false, reason: "invoice_taken" };
    throw e;
  }
};

export type SimpleResult = { ok: true } | { ok: false; reason: "not_found" | "conflict" | "status" };

// 0.4 消込を外す(CH-08・CH-10)。外した後に候補を探し直す(EV-07 手順4)
export const removeMatch = async (txnId: string, version: string, by: string): Promise<SimpleResult> => {
  if (!isUuid(txnId)) return { ok: false, reason: "not_found" };
  return transaction(async (tx): Promise<SimpleResult> => {
    const [t] = await tx<{ match_status: MatchStatus; invoice_id: string | null; version: string }[]>`
      select match_status, invoice_id, ${VERSION(tx, "bank_transactions")} as version
      from bank_transactions where id = ${txnId} for update`;
    if (!t) return { ok: false, reason: "not_found" };
    if (t.version !== version) return { ok: false, reason: "conflict" };
    // CH-08 消込済みであること(請求書が取消になっていても外せる)
    if (t.match_status !== "matched" || !t.invoice_id) return { ok: false, reason: "status" };
    await tx`
      update bank_transactions set match_status = 'unmatched', invoice_id = null, fee_amount = 0, matched_by = null, matched_at = null
      where id = ${txnId}`;
    await tx`
      update invoices set payment_status = 'unpaid', paid_amount = null, paid_on = null, updated_by = ${by}
      where id = ${t.invoice_id}`;
    await refreshSuggestion(tx, txnId);
    return { ok: true };
  });
};

// EV-08 手順1 対象外にする(未消込の入金だけ)
export const ignoreDeposit = async (txnId: string, reason: string): Promise<SimpleResult> => {
  if (!isUuid(txnId)) return { ok: false, reason: "not_found" };
  const rows = await query(
    (sql) => sql`
      update bank_transactions set match_status = 'ignored', ignore_reason = ${reason}, suggested_invoice_id = null
      where id = ${txnId} and deposit > 0 and match_status = 'unmatched' returning id`
  );
  return rows.length > 0 ? { ok: true } : { ok: false, reason: "status" };
};

// EV-08 手順2 対象外を未消込に戻し、候補を探し直す
export const restoreDeposit = async (txnId: string): Promise<SimpleResult> => {
  if (!isUuid(txnId)) return { ok: false, reason: "not_found" };
  return transaction(async (tx): Promise<SimpleResult> => {
    const rows = await tx`
      update bank_transactions set match_status = 'unmatched', ignore_reason = null
      where id = ${txnId} and deposit > 0 and match_status = 'ignored' returning id`;
    if (rows.length === 0) return { ok: false, reason: "status" };
    await refreshSuggestion(tx, txnId);
    return { ok: true };
  });
};

// ---- 取り込みの取消(EV-09・CH-09) ----

export type CancelImportResult = { ok: true; deleted: number } | { ok: false; reason: "not_found" | "matched" };

export const cancelBankImport = async (batchId: string, by: string): Promise<CancelImportResult> => {
  if (!isUuid(batchId)) return { ok: false, reason: "not_found" };
  return transaction(async (tx): Promise<CancelImportResult> => {
    const [batch] = await tx<{ id: string }[]>`
      select id from import_batches where id = ${batchId} and kind = 'bank_transactions' and status = 'applied' for update`;
    if (!batch) return { ok: false, reason: "not_found" };
    // CH-09 消込済みの明細が1件も無いこと(対象外は消してよい)
    const [m] = await tx<{ n: number }[]>`
      select count(*)::int as n from bank_transactions where import_batch_id = ${batchId} and match_status = 'matched'`;
    if (m.n > 0) return { ok: false, reason: "matched" };
    const deleted = await tx`delete from bank_transactions where import_batch_id = ${batchId} returning id`;
    await tx`
      update import_batches set status = 'cancelled', cancelled_by = ${by}, cancelled_at = now(), updated_by = ${by}
      where id = ${batchId}`;
    return { ok: true, deleted: deleted.length };
  });
};
