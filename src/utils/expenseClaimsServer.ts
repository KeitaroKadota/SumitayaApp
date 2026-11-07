// 経費精算(E-07)のDBの読み書き(03 の 0.1〜0.3、EV-01〜EV-18)。0.4 で承認の段階とタスクをなくした(下書き → 登録で確定)。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess を済ませている前提)。
// 本人の経費だけを読む・書く関数は applicantId を受け取り、where に入れる(CH-02)。
// 判定(検算・二重計上・規程)は expenseClaims.ts の計算で行う。AIを呼ぶのは readReceiptWithAi だけ。
import { query, transaction, type SqlFragment, type SqlLike } from "@/utils/db";
import { HISTORY_YEARS } from "@/utils/expenseRules";
import {
  TITLE_SOURCES,
  runExpenseChecks,
  topFlagText,
  yearsBefore,
  type AccountTitle,
  type DuplicateHit,
  type Flag,
  type ExpenseInput,
  type ExpensePaymentMethod,
  type ExpenseStatus,
  type NormalizedReceipt,
  type TitleSource,
} from "@/utils/expenseClaims";
import { callGeminiJson, type AiResult } from "@/utils/gemini";
import { todayJST } from "@/utils/jst";
import { RECEIPT_INSTRUCTION, accountTitlesText, receiptSchema } from "@/utils/prompts/E-07";
import { getFileBytes } from "@/utils/storage";

export const EXPENSE_FEATURE_ID = "E-07";

export const EXPENSES_URL = "/expenses";
export const ADMIN_EXPENSES_URL = "/admin/expenses";
export const expenseUrl = (id: string) => `${EXPENSES_URL}/${encodeURIComponent(id)}`;
export const adminExpenseUrl = (id: string) => `${ADMIN_EXPENSES_URL}/${encodeURIComponent(id)}`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isExpenseId = (v: string): boolean => UUID_PATTERN.test(v);

// ---- 勘定科目 ----

export const listAccountTitles = async (): Promise<AccountTitle[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; code: string | null; name: string; description: string; is_active: boolean }[]>`
      select id, code, name, description, is_active from account_titles order by sort_order, name`
  );
  return rows.map((r) => ({ id: r.id, code: r.code, name: r.name, description: r.description, isActive: r.is_active }));
};

// ---- 読み取り ----

export type Expense = {
  id: string;
  applicantId: string;
  applicantName: string;
  applicantLastName: string;
  status: ExpenseStatus;
  receiptFileId: string | null;
  receiptContentType: string | null;
  receiptName: string | null;
  noReceiptReason: string | null;
  aiRequestId: string | null;
  // 読み取った日時(AiDraft の「作成」)
  aiReadAt: Date | null;
  aiRaw: unknown | null;
  spentOn: string | null;
  payeeName: string | null;
  payeeKey: string | null;
  registrationNo: string | null;
  total: number;
  total10: number;
  tax10: number;
  total8: number;
  tax8: number;
  totalExempt: number;
  paymentMethod: ExpensePaymentMethod;
  itemsText: string | null;
  purpose: string | null;
  attendees: string | null;
  accountTitleId: string | null;
  accountTitleName: string | null;
  accountTitleCode: string | null;
  accountTitleActive: boolean;
  accountTitleSource: TitleSource | null;
  accountTitleReason: string | null;
  checkFlags: string[];
  duplicateOf: string | null;
  // 登録(確定)した日時と、その日(日本時間。CH-10 の期限の計算に使う)
  confirmedAt: Date | null;
  confirmedOn: string | null;
  createdAt: Date;
  // CH-18 画面を開いたときの updated_at(マイクロ秒の数の文字)
  version: string;
};

type ExpenseRow = {
  id: string;
  applicant_id: string;
  applicant_last_name: string;
  applicant_first_name: string;
  status: ExpenseStatus;
  receipt_file_id: string | null;
  receipt_content_type: string | null;
  receipt_name: string | null;
  no_receipt_reason: string | null;
  ai_request_id: string | null;
  ai_read_at: Date | null;
  ai_raw: unknown | null;
  spent_on: string | null;
  payee_name: string | null;
  payee_key: string | null;
  registration_no: string | null;
  total: number;
  total_10: number;
  tax_10: number;
  total_8: number;
  tax_8: number;
  total_exempt: number;
  payment_method: ExpensePaymentMethod;
  items_text: string | null;
  purpose: string | null;
  attendees: string | null;
  account_title_id: string | null;
  account_title_name: string | null;
  account_title_code: string | null;
  account_title_active: boolean | null;
  account_title_source: TitleSource | null;
  account_title_reason: string | null;
  check_flags: string[];
  duplicate_of: string | null;
  confirmed_at: Date | null;
  confirmed_on: string | null;
  created_at: Date;
  version: string;
};

const SELECT_EXPENSE = (sql: SqlLike, where: SqlFragment, tail: SqlFragment) => sql<ExpenseRow[]>`
  select e.id, e.applicant_id, ap.last_name as applicant_last_name, ap.first_name as applicant_first_name, e.status,
         e.receipt_file_id, f.content_type as receipt_content_type, f.original_name as receipt_name, e.no_receipt_reason,
         e.ai_request_id, ai.created_at as ai_read_at, e.ai_raw, to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, e.payee_name, e.payee_key, e.registration_no,
         e.total, e.total_10, e.tax_10, e.total_8, e.tax_8, e.total_exempt, e.payment_method, e.items_text, e.purpose, e.attendees,
         e.account_title_id, t.name as account_title_name, t.code as account_title_code, t.is_active as account_title_active,
         e.account_title_source, e.account_title_reason, e.check_flags, e.duplicate_of,
         e.confirmed_at, to_char(e.confirmed_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as confirmed_on, e.created_at,
         (extract(epoch from e.updated_at) * 1000000)::bigint::text as version
  from expenses e
  join employees ap on ap.id = e.applicant_id
  left join stored_files f on f.id = e.receipt_file_id and f.deleted_at is null
  left join account_titles t on t.id = e.account_title_id
  left join ai_requests ai on ai.id = e.ai_request_id
  where ${where}
  ${tail}`;

const toExpense = (r: ExpenseRow): Expense => ({
  id: r.id,
  applicantId: r.applicant_id,
  applicantName: `${r.applicant_last_name} ${r.applicant_first_name}`,
  applicantLastName: r.applicant_last_name,
  status: r.status,
  receiptFileId: r.receipt_file_id,
  receiptContentType: r.receipt_content_type,
  receiptName: r.receipt_name,
  noReceiptReason: r.no_receipt_reason,
  aiRequestId: r.ai_request_id,
  aiReadAt: r.ai_read_at,
  aiRaw: r.ai_raw,
  spentOn: r.spent_on,
  payeeName: r.payee_name,
  payeeKey: r.payee_key,
  registrationNo: r.registration_no,
  total: r.total,
  total10: r.total_10,
  tax10: r.tax_10,
  total8: r.total_8,
  tax8: r.tax_8,
  totalExempt: r.total_exempt,
  paymentMethod: r.payment_method,
  itemsText: r.items_text,
  purpose: r.purpose,
  attendees: r.attendees,
  accountTitleId: r.account_title_id,
  accountTitleName: r.account_title_name,
  accountTitleCode: r.account_title_code,
  accountTitleActive: r.account_title_active ?? false,
  accountTitleSource: r.account_title_source,
  accountTitleReason: r.account_title_reason,
  checkFlags: r.check_flags,
  duplicateOf: r.duplicate_of,
  confirmedAt: r.confirmed_at,
  confirmedOn: r.confirmed_on,
  createdAt: r.created_at,
  version: r.version,
});

// 1件を読む(G04)。無ければ null
export const getExpense = async (id: string): Promise<Expense | null> => {
  if (!isExpenseId(id)) return null;
  const [row] = await query((sql) => SELECT_EXPENSE(sql, sql`e.id = ${id}`, sql``));
  return row ? toExpense(row) : null;
};

// CH-02 本人の経費だけを読む(G02)。ほかの人の経費は「見つからない」と同じにする
export const getOwnExpense = async (id: string, applicantId: string): Promise<Expense | null> => {
  if (!isExpenseId(id)) return null;
  const [row] = await query((sql) => SELECT_EXPENSE(sql, sql`e.id = ${id} and e.applicant_id = ${applicantId}`, sql``));
  return row ? toExpense(row) : null;
};

// ---- EV-01 自分の経費の一覧 ----

// 支払った日がその月の登録済みのものと、月に関係なく下書きのもの。並び: 下書き → 登録済み(支払った日の新しい順)
export const listMyExpenses = async (applicantId: string, from: string, to: string): Promise<Expense[]> => {
  const rows = await query((sql) =>
    SELECT_EXPENSE(
      sql,
      sql`e.applicant_id = ${applicantId}
          and (e.status = 'draft' or e.spent_on between ${from} and ${to})`,
      sql`order by case e.status when 'draft' then 0 else 1 end,
                   e.spent_on desc nulls first, e.created_at desc`
    )
  );
  return rows.map(toExpense);
};

// ---- EV-02・EV-03 手順4 下書きを作る ----

export const insertDraft = async (input: { applicantId: string; receiptFileId: string | null }): Promise<string> => {
  const [row] = await query(
    (sql) => sql<{ id: string }[]>`
      insert into expenses (applicant_id, status, receipt_file_id, payment_method, created_by, updated_by)
      values (${input.applicantId}, 'draft', ${input.receiptFileId}, 'cash', ${input.applicantId}, ${input.applicantId})
      returning id`
  );
  return row.id;
};

// 保存した領収書の画像が、本人が上げた領収書の画像で、まだどの経費にも使われていないか
export const isReceiptFileUsable = async (fileId: string, by: string): Promise<boolean> => {
  if (!isExpenseId(fileId)) return false;
  const [row] = await query(
    (sql) => sql<{ ok: boolean }[]>`
      select (f.purpose = 'receipt' and f.created_by = ${by} and f.deleted_at is null
              and f.content_type in ('image/jpeg', 'image/png', 'image/webp')
              and not exists (select 1 from expenses e where e.receipt_file_id = f.id)) as ok
      from stored_files f where f.id = ${fileId}`
  );
  return row?.ok ?? false;
};

// ---- 0.1 readReceipt 読み取り(AI。1枚につき1回、読み取りと勘定科目の案を同じ呼び出しで) ----

export const readReceiptWithAi = async (
  expenseId: string,
  fileId: string,
  titles: readonly AccountTitle[],
  by: string
): Promise<AiResult<unknown> | { ok: false; reason: "file"; message: string }> => {
  let file: Awaited<ReturnType<typeof getFileBytes>>;
  try {
    file = await getFileBytes(fileId);
  } catch (e) {
    console.error("領収書の画像を読めませんでした:", e instanceof Error ? e.message : e);
    file = null;
  }
  if (!file) return { ok: false, reason: "file", message: "領収書の画像を読めませんでした。" };
  const active = titles.filter((t) => t.isActive);
  return callGeminiJson<unknown>({
    featureId: EXPENSE_FEATURE_ID,
    purpose: "expense_receipt_read",
    targetTable: "expenses",
    targetId: expenseId,
    instruction: RECEIPT_INSTRUCTION,
    input: `添付の領収書を読み取ってください。\n\n${accountTitlesText(active)}`,
    files: [{ bytes: file.bytes, mimeType: file.contentType }],
    schema: receiptSchema(active.map((t) => t.name)),
    requestedBy: by,
    // 【仮】30秒で打ち切り、手入力に切り替える(00_仮決め一覧 E-04-仮-11)
    timeoutMs: 30_000,
  });
};

// ---- 0.2 estimateAccountTitle 勘定科目の推定 ----

export type TitleEstimate = { titleId: string; source: Exclude<TitleSource, "manual">; reason: string };

// ① 同じ支払先の登録済みの経費(過去2年)でいちばん多い科目(同じ回数なら新しく登録された方。使わない科目は飛ばす)
// ② 履歴が無く、AIの案があればそれ ③ どちらも無ければ null
export const estimateAccountTitle = async (
  payeeKey: string | null,
  ai: { titleName: string | null; titleReason: string | null; itemsText: string | null } | null,
  titles: readonly AccountTitle[],
  excludeId: string | null
): Promise<TitleEstimate | null> => {
  if (payeeKey) {
    const from = yearsBefore(todayJST(), HISTORY_YEARS);
    const [top] = await query(
      (sql) => sql<{ id: string; name: string; n: number }[]>`
        select e.account_title_id as id, t.name, count(*)::int as n
        from expenses e
        join account_titles t on t.id = e.account_title_id and t.is_active
        where e.status = 'confirmed' and e.payee_key = ${payeeKey} and e.spent_on >= ${from}
          ${excludeId ? sql`and e.id <> ${excludeId}` : sql``}
        group by e.account_title_id, t.name
        order by n desc, max(e.confirmed_at) desc
        limit 1`
    );
    if (top) return { titleId: top.id, source: "history", reason: `この支払先の過去の処理: ${top.name}（${top.n}回）` };
  }
  if (ai?.titleName) {
    const title = titles.find((t) => t.isActive && t.name === ai.titleName);
    if (title) {
      const basis = ai.itemsText ? `品目「${ai.itemsText}」から` : (ai.titleReason ?? "");
      return { titleId: title.id, source: "ai", reason: `${TITLE_SOURCES.ai}（履歴なし）${basis ? `: ${basis}` : ""}`.slice(0, 200) };
    }
  }
  return null;
};

// 読み取った結果で、経費の読み取りの項目を置き換える(用途・支払い方・相手先は残す)。元の JSON は ai_raw に残す
export const applyReceiptRead = async (
  expenseId: string,
  applicantId: string,
  read: {
    values: NormalizedReceipt["values"];
    amounts: { total: number; total10: number; tax10: number; total8: number; tax8: number; totalExempt: number };
    payeeKey: string | null;
    raw: unknown;
    requestId: string;
  },
  estimate: TitleEstimate | null
): Promise<void> => {
  const v = read.values;
  const a = read.amounts;
  await query(
    (sql) => sql`
      update expenses set
        spent_on = ${v.spentOn}, payee_name = ${v.payeeName}, payee_key = ${read.payeeKey}, registration_no = ${v.registrationNo},
        total = ${a.total}, total_10 = ${a.total10}, tax_10 = ${a.tax10}, total_8 = ${a.total8}, tax_8 = ${a.tax8},
        total_exempt = ${a.totalExempt}, items_text = ${v.itemsText},
        ai_request_id = ${read.requestId}, ai_raw = ${sql.json(read.raw as Parameters<typeof sql.json>[0])},
        account_title_id = ${estimate?.titleId ?? null}, account_title_source = ${estimate?.source ?? null},
        account_title_reason = ${estimate?.reason ?? null}, updated_by = ${applicantId}
      where id = ${expenseId} and applicant_id = ${applicantId} and status = 'draft'`
  );
};

// ---- CH-09 二重計上の疑い ----

// ほかの経費(下書き・ほかの人の経費も含む)で、① 同じ画像 ② 同じ支払先・日付・合計 ③ 同じ日付・合計で支払先の名前が似ている
export const findDuplicate = async (e: {
  id: string;
  receiptFileId: string | null;
  payeeKey: string | null;
  spentOn: string | null;
  total: number;
}): Promise<DuplicateHit | null> => {
  const rows = await query((sql) => {
    const conds: SqlFragment[] = [];
    if (e.receiptFileId)
      conds.push(sql`(f.sha256 = (select sha256 from stored_files where id = ${e.receiptFileId}))`);
    if (e.spentOn && e.total > 0 && e.payeeKey) {
      conds.push(sql`(e.spent_on = ${e.spentOn} and e.total = ${e.total} and e.payee_key = ${e.payeeKey})`);
      conds.push(
        sql`(e.spent_on = ${e.spentOn} and e.total = ${e.total} and e.payee_key is not null
             and (strpos(e.payee_key, ${e.payeeKey}) > 0 or strpos(${e.payeeKey}, e.payee_key) > 0))`
      );
    }
    if (conds.length === 0) return Promise.resolve([] as { id: string; last_name: string; spent_on: string | null; total: number }[]);
    const any = conds.reduce((acc, c, i) => (i === 0 ? c : sql`${acc} or ${c}`));
    return sql<{ id: string; last_name: string; spent_on: string | null; total: number }[]>`
      select e.id, ap.last_name, to_char(e.spent_on, 'YYYY-MM-DD') as spent_on, e.total
      from expenses e
      join employees ap on ap.id = e.applicant_id
      left join stored_files f on f.id = e.receipt_file_id
      where e.id <> ${e.id} and (${any})
      order by e.created_at limit 1`;
  });
  const [hit] = rows;
  return hit ? { id: hit.id, applicantName: hit.last_name, spentOn: hit.spent_on, total: hit.total } : null;
};

// ---- EV-07・EV-08 保存・登録(CH-18 ほかの画面の更新を見る) ----

export type WriteTitle = { id: string | null; source: TitleSource | null; reason: string | null };

// 本人の下書きを書き換える。confirm を渡すと登録済み(確定)にする。更新できなければ false(CH-18・状態)
export const writeExpense = async (
  id: string,
  applicantId: string,
  version: string,
  input: ExpenseInput & { payeeKey: string | null },
  title: WriteTitle,
  confirm: { flags: string[]; duplicateOf: string | null } | null
): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update expenses set
        spent_on = ${input.spentOn}, payee_name = ${input.payeeName}, payee_key = ${input.payeeKey},
        registration_no = ${input.registrationNo},
        total = ${input.total}, total_10 = ${input.total10}, tax_10 = ${input.tax10}, total_8 = ${input.total8},
        tax_8 = ${input.tax8}, total_exempt = ${input.totalExempt}, payment_method = ${input.paymentMethod},
        items_text = ${input.itemsText}, purpose = ${input.purpose}, attendees = ${input.attendees},
        no_receipt_reason = ${input.noReceiptReason},
        account_title_id = ${title.id}, account_title_source = ${title.source}, account_title_reason = ${title.reason},
        ${
          confirm
            ? sql`status = 'confirmed', confirmed_at = now(), check_flags = ${confirm.flags}::text[], duplicate_of = ${confirm.duplicateOf},`
            : sql``
        }
        updated_by = ${applicantId}
      where id = ${id} and applicant_id = ${applicantId} and status = 'draft'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`
  );
  return rows.length > 0;
};

// CH-18 だけを見る(削除の前)
export const isCurrentVersion = async (id: string, version: string): Promise<boolean> => {
  const [row] = await query(
    (sql) => sql<{ ok: boolean }[]>`
      select (extract(epoch from updated_at) * 1000000)::bigint::text = ${version} as ok from expenses where id = ${id}`
  );
  return row?.ok ?? false;
};

// ---- EV-05 撮り直す(前の画像は stored_files に記録として残す) ----

export const replaceReceipt = async (id: string, applicantId: string, version: string, fileId: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update expenses set receipt_file_id = ${fileId}, no_receipt_reason = null, updated_by = ${applicantId}
      where id = ${id} and applicant_id = ${applicantId} and status = 'draft'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning id`
  );
  return rows.length > 0;
};

// ---- EV-10 下書きの削除。消した経費の領収書の画像のIDを返す ----

export const deleteDraft = async (id: string, applicantId: string, version: string): Promise<{ ok: boolean; fileIds: string[] }> =>
  transaction(async (tx) => {
    const [row] = await tx<{ receipt_file_id: string | null }[]>`
      delete from expenses
      where id = ${id} and applicant_id = ${applicantId} and status = 'draft'
        and (extract(epoch from updated_at) * 1000000)::bigint::text = ${version}
      returning receipt_file_id`;
    if (!row) return { ok: false, fileIds: [] };
    return { ok: true, fileIds: row.receipt_file_id ? [row.receipt_file_id] : [] };
  });

// ---- EV-11 全員の経費の一覧(G03) ----

// 登録済みで、支払った日がその月のもの(下書きは本人だけが見えるので出さない)。needsCheck: 印のあるものだけ
export type AdminExpenseFilter = { from: string; to: string; applicantId: string; titleId: string; needsCheck: boolean };

export const listAdminExpenses = async (f: AdminExpenseFilter): Promise<Expense[]> => {
  const rows = await query((sql) =>
    SELECT_EXPENSE(
      sql,
      sql`e.status = 'confirmed' and e.spent_on between ${f.from} and ${f.to}
          ${f.applicantId ? sql`and e.applicant_id = ${f.applicantId}` : sql``}
          ${f.titleId ? sql`and e.account_title_id = ${f.titleId}` : sql``}
          ${f.needsCheck ? sql`and cardinality(e.check_flags) > 0` : sql``}`,
      sql`order by e.spent_on desc, e.confirmed_at desc`
    )
  );
  return rows.map(toExpense);
};

// 絞り込みの「登録した人」(経費を登録したことのある人)
export const listExpenseApplicants = async (): Promise<{ id: string; name: string }[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; last_name: string; first_name: string }[]>`
      select distinct ap.id, ap.last_name, ap.first_name, ap.employee_code
      from expenses e join employees ap on ap.id = e.applicant_id
      where e.status = 'confirmed'
      order by ap.employee_code`
  );
  return rows.map((r) => ({ id: r.id, name: `${r.last_name} ${r.first_name}` }));
};

// ---- EV-18 CSV(登録済み・支払った日がその月) ----

export const listConfirmedForCsv = async (from: string, to: string): Promise<Expense[]> => {
  const rows = await query((sql) =>
    SELECT_EXPENSE(
      sql,
      sql`e.status = 'confirmed' and e.spent_on between ${from} and ${to}`,
      sql`order by e.spent_on, ap.employee_code, e.confirmed_at`
    )
  );
  return rows.map(toExpense);
};

// ---- 確認が必要な点(G02 の①③・G04。03 EV-04 手順3・EV-12 手順2) ----

// 下書き: 今の内容で 0.3 の印を計算する(保存はしない)。登録済み: 保存した印(check_flags)の文だけを、今の内容で作り直して出す。
// 登録したときに付いた印で、今は計算に出ないもの(相手の下書きが消えた など)も残す。二重計上の疑いの相手も返す
export const expenseFlagsForDisplay = async (e: Expense): Promise<{ flags: Flag[]; duplicate: DuplicateHit | null }> => {
  const duplicate = await findDuplicate({
    id: e.id,
    receiptFileId: e.receiptFileId,
    payeeKey: e.payeeKey,
    spentOn: e.spentOn,
    total: e.total,
  });
  const recomputed = runExpenseChecks({ ...e, titleName: e.accountTitleName }, e.confirmedOn ?? todayJST(), duplicate);
  if (e.status === "draft") return { flags: recomputed, duplicate };
  const flags = recomputed.filter((f) => e.checkFlags.includes(f.code));
  for (const code of e.checkFlags)
    if (!flags.some((f) => f.code === code))
      flags.push({ code: code as Flag["code"], message: `${topFlagText([code], e) ?? code}（登録のときの印）` });
  return { flags, duplicate };
};
