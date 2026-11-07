// E-07 G03 全員の経費の一覧(03 EV-11)と、G04 経費の詳細(モーダル。見るだけ。EV-12)の中身。
// /admin/expenses と /admin/expenses/[id] の2つのページがこれを使う(G04 は G03 の上にモーダルで出す)。
// 権限チェックは呼ぶページの先頭で requireAccess("expenses_admin")(社長だけ)を済ませている前提。
// 0.4 で承認の段階をなくした(承認・差し戻し・まとめて承認のタブとボタンは無い)。
import Link from "next/link";
import { redirect } from "next/navigation";
import { topFlagText } from "@/utils/expenseClaims";
import {
  adminExpenseUrl,
  expenseFlagsForDisplay,
  getExpense,
  listAccountTitles,
  listAdminExpenses,
  listExpenseApplicants,
  type Expense,
} from "@/utils/expenseClaimsServer";
import { formatDateShort, formatDateTime, formatYearMonth } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { getSignedUrls } from "@/utils/storage";
import { Alert } from "@/components/Alert";
import { AutoSubmitCheckbox } from "@/components/AutoSubmitCheckbox";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { FileViewer } from "@/app/admin/payables/[id]/FileViewer";
import { ExpenseDetail } from "@/app/expenses/ExpenseDetail";
import { isMonthStr, monthRange, shiftMonth } from "@/app/expenses/expensesView";
import { ADMIN_LIST_URL, adminListUrl, type AdminListQuery } from "./expensesAdminUrl";
import { ExpenseTable, type ExpenseRow } from "./ExpenseTable";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
const UUID = /^[0-9a-f-]{36}$/i;

export async function ExpensesScreen({
  searchParams,
  openId,
}: {
  searchParams: Record<string, string | string[] | undefined>;
  openId?: string;
}) {
  const today = todayJST();

  // 手順1: ?month=・登録した人・勘定科目・要確認だけ
  const thisMonth = today.slice(0, 7);
  const monthParam = str(searchParams.month);
  const month = isMonthStr(monthParam) ? monthParam : thisMonth;
  const applicantParam = str(searchParams.applicant);
  const titleParam = str(searchParams.title);
  const base: AdminListQuery = {
    month: month === thisMonth ? undefined : month,
    applicant: UUID.test(applicantParam) ? applicantParam : undefined,
    title: UUID.test(titleParam) ? titleParam : undefined,
    check: str(searchParams.check) === "1",
  };
  const { from, to } = monthRange(month);

  // 手順2・3: 登録済みで、支払った日がその月のもの
  const items = await listAdminExpenses({
    from,
    to,
    applicantId: base.applicant ?? "",
    titleId: base.title ?? "",
    needsCheck: base.check ?? false,
  });
  const applicants = await listExpenseApplicants();
  const titles = await listAccountTitles();
  const back = adminListUrl(base);

  // G04(モーダル)。登録済みのものだけ
  const opened = openId ? await getExpense(openId) : null;
  if (openId && (!opened || opened.status !== "confirmed")) redirect(back);

  const rows: ExpenseRow[] = items.map((e) => ({
    id: e.id,
    href: adminListUrl(base, adminExpenseUrl(e.id)),
    confirmedLabel: e.confirmedAt ? formatDateShort(e.confirmedAt) : "−",
    applicant: e.applicantName,
    spentLabel: e.spentOn ? formatDateShort(e.spentOn) : "−",
    payee: e.payeeName ?? "−",
    total: e.total,
    title: e.accountTitleName ?? "−",
    flag: topFlagText(e.checkFlags, e),
  }));
  const monthLabel = (m: string) => formatYearMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const monthQuery = (m: string) => (m === thisMonth ? undefined : m);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">経費</h1>
        {/* 登録済みの、表示している月の経費(01 7.3) */}
        <a href={`${ADMIN_LIST_URL}/csv?month=${month}`} className={buttonClassName("secondary")}>
          CSVを出力する
        </a>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-72">
          <PeriodNav
            label={`${monthLabel(month)}（支払日）`}
            prev={{ href: adminListUrl({ ...base, month: monthQuery(prev) }), label: monthLabel(prev) }}
            next={{ href: adminListUrl({ ...base, month: monthQuery(next) }), label: monthLabel(next) }}
          />
        </div>
        <form method="get" action={ADMIN_LIST_URL} className="flex flex-wrap items-end gap-2">
          {base.month && <input type="hidden" name="month" value={month} />}
          <Field id="f_applicant" label="登録した人">
            <AutoSubmitSelect id="f_applicant" name="applicant" defaultValue={base.applicant ?? ""} className="w-48">
              <option value="">全員</option>
              {applicants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </Field>
          <Field id="f_title" label="勘定科目">
            <AutoSubmitSelect id="f_title" name="title" defaultValue={base.title ?? ""} className="w-48">
              <option value="">すべて</option>
              {titles.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </AutoSubmitSelect>
          </Field>
          <AutoSubmitCheckbox name="check" label="要確認だけ" defaultChecked={base.check ?? false} />
        </form>
      </div>

      {rows.length === 0 ? <EmptyState message="この条件の経費はありません。" /> : <ExpenseTable rows={rows} />}

      {opened && (
        <Modal title="経費の詳細" closeHref={back}>
          <ExpenseModal expense={opened} />
        </Modal>
      )}
    </div>
  );
}

// G04 経費の詳細(EV-12。見るだけ)
async function ExpenseModal({ expense: e }: { expense: Expense }) {
  // 手順1: 領収書のURL(10分)
  const urls = e.receiptFileId ? await getSignedUrls([e.receiptFileId]) : new Map<string, string>();
  const url = e.receiptFileId ? (urls.get(e.receiptFileId) ?? null) : null;

  // 手順2: check_flags を文にする(二重計上の疑いは相手の経費を「開く」で見られるようにする)
  const { flags, duplicate } = e.checkFlags.length > 0 ? await expenseFlagsForDisplay(e) : { flags: [], duplicate: null };
  const duplicateId = duplicate?.id ?? e.duplicateOf;
  // 手順3: 推定の理由を勘定科目の横に出す
  const reason =
    (e.accountTitleSource === "history" || e.accountTitleSource === "ai") && e.accountTitleReason ? e.accountTitleReason : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          {e.receiptFileId ? (
            <FileViewer url={url} contentType={e.receiptContentType} name={e.receiptName ?? "領収書の画像"} />
          ) : (
            <p className="rounded-md border border-line bg-canvas p-4 text-sm text-ink-muted">領収書なし（理由: {e.noReceiptReason ?? "−"}）</p>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            登録した人 <span className="font-bold">{e.applicantName}</span>
            {e.confirmedAt && <span className="ml-2 text-ink-muted tabular-nums">登録 {formatDateTime(e.confirmedAt)}</span>}
          </p>
          <ExpenseDetail expense={e} />
          {reason && <p className="text-sm text-ink-muted">（{reason}）</p>}
        </div>
      </div>

      {flags.length > 0 && (
        <Alert tone="warning">
          <span className="font-bold">確認が必要な点</span>
          <ul className="flex flex-col gap-1">
            {flags.map((f, i) => (
              <li key={`${f.code}-${i}`}>
                ・{f.message}
                {f.code === "CH-09" && duplicateId && (
                  <Link href={adminListUrl({}, adminExpenseUrl(duplicateId))} className="ml-2 font-bold text-primary underline">
                    開く
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
