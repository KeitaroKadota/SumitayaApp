// E-07 G03 経費の承認(全員の一覧。03 EV-11)と、G04 経費の詳細・承認(モーダル。EV-12)の中身。
// /admin/expenses と /admin/expenses/[id] の2つのページがこれを使う(G04 は G03 の上にモーダルで出す)。
// 権限チェックは呼ぶページの先頭で requireAccess("expenses_admin") を済ませている前提。承認のボタンは expenses_approve の人にだけ出す。
import Link from "next/link";
import { redirect } from "next/navigation";
import { canAccess, type CurrentEmployee } from "@/utils/auth";
import { EXPENSE_STATUSES, runExpenseChecks, topFlagText, type Flag } from "@/utils/expenseClaims";
import {
  adminExpenseUrl,
  countAdminTabs,
  findDuplicate,
  getExpense,
  listAccountTitles,
  listAdminExpenses,
  listExpenseApplicants,
  type AdminExpenseFilter,
  type Expense,
} from "@/utils/expenseClaimsServer";
import { formatDateShort, formatDateTime, formatQuantity, formatYearMonth } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { getSignedUrls } from "@/utils/storage";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { FileViewer } from "@/app/admin/payables/[id]/FileViewer";
import { ExpenseDetail } from "@/app/expenses/ExpenseDetail";
import { EXPENSE_STATUS_TONES, isMonthStr, monthRange, shiftMonth } from "@/app/expenses/expensesView";
import { approveSelectedExpenses, decideExpense } from "./actions";
import { DecideForm } from "./DecideForm";
import { ADMIN_LIST_URL, ADMIN_TABS, adminListUrl, isAdminTab, type AdminListQuery } from "./expensesAdminUrl";
import { ExpenseTable, type ExpenseRow } from "./ExpenseTable";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");
const UUID = /^[0-9a-f-]{36}$/i;

const doneMessage = (code: string, detail: string): string | null => {
  switch (code) {
    case "approved":
      return "承認しました。";
    case "returned":
      return "差し戻しました。";
    case "bulk":
      return `承認しました（${detail}件）。`;
    default:
      return null;
  }
};
const errorMessage = (code: string, detail: string): string | null => {
  switch (code) {
    case "bulk":
      return `承認できない経費があるため、承認しませんでした（${detail}）。1件ずつ開いて確かめてください。`;
    case "none":
      return "承認する経費を選んでください。";
    case "conflict":
      return "ほかの人が経費を更新しました。画面を開き直してください。";
    case "failed":
      return "保存できませんでした。時間をおいてもう一度お試しください。";
    default:
      return null;
  }
};

export async function ExpensesScreen({
  me,
  searchParams,
  openId,
}: {
  me: CurrentEmployee;
  searchParams: Record<string, string | string[] | undefined>;
  openId?: string;
}) {
  const canApprove = canAccess(me.roles, "expenses_approve");
  const today = todayJST();

  // 手順1: ?tab=(なければ要確認)・?month=・申請者・勘定科目
  const tabParam = str(searchParams.tab);
  const tab = isAdminTab(tabParam) ? tabParam : "needs_check";
  const thisMonth = today.slice(0, 7);
  const monthParam = str(searchParams.month);
  const month = isMonthStr(monthParam) ? monthParam : thisMonth;
  const applicantParam = str(searchParams.applicant);
  const titleParam = str(searchParams.title);
  const base: AdminListQuery = {
    tab,
    month: month === thisMonth ? undefined : month,
    applicant: UUID.test(applicantParam) ? applicantParam : undefined,
    title: UUID.test(titleParam) ? titleParam : undefined,
  };
  const { from, to } = monthRange(month);
  const filter: AdminExpenseFilter = { tab, from, to, applicantId: base.applicant ?? "", titleId: base.title ?? "" };

  // 手順2・3
  const items = await listAdminExpenses(filter);
  const counts = await countAdminTabs(from, to);
  const applicants = await listExpenseApplicants();
  const titles = await listAccountTitles();
  const back = adminListUrl(base);

  const done = doneMessage(str(searchParams.done), str(searchParams.detail));
  const error = errorMessage(str(searchParams.error), str(searchParams.detail));

  // G04(モーダル)
  const opened = openId ? await getExpense(openId) : null;
  if (openId && (!opened || opened.status === "draft")) redirect(adminListUrl({ ...base, error: "failed" }));

  const rows: ExpenseRow[] = items.map((e) => ({
    id: e.id,
    version: e.version,
    href: adminListUrl(base, adminExpenseUrl(e.id)),
    submittedLabel: e.submittedAt ? formatDateShort(e.submittedAt) : "−",
    applicant: e.applicantName,
    spentLabel: e.spentOn ? formatDateShort(e.spentOn) : "−",
    payee: e.payeeName ?? "−",
    total: e.total,
    title: e.accountTitleName ?? "未選択",
    status: { label: EXPENSE_STATUSES[e.status], tone: EXPENSE_STATUS_TONES[e.status] },
    flag: e.status === "submitted" ? topFlagText(e.checkFlags, e) : null,
  }));
  const monthLabel = (m: string) => formatYearMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const monthQuery = (m: string) => (m === thisMonth ? undefined : m);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const monthly = tab !== "needs_check" && tab !== "ok";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">経費の承認</h1>
        {/* 承認済みの、表示している月の経費(01 7.3) */}
        <a href={`${ADMIN_LIST_URL}/csv?month=${month}`} className={buttonClassName("secondary")}>
          CSVを出力する
        </a>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <nav aria-label="表示する一覧" className="flex flex-wrap gap-2">
        {ADMIN_TABS.map((t) => {
          const active = t.key === tab;
          const n = t.key === "needs_check" || t.key === "ok" || t.key === "returned" ? counts[t.key] : 0;
          return (
            <Link
              key={t.key}
              href={adminListUrl({ ...base, tab: t.key })}
              aria-current={active ? "page" : undefined}
              className={buttonClassName(active ? "primary" : "secondary")}
            >
              {t.label}
              {n > 0 && <Badge tone={t.key === "needs_check" ? "warning" : "neutral"}>{formatQuantity(n)}</Badge>}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-end gap-4">
        <form method="get" action={ADMIN_LIST_URL} className="flex flex-wrap items-end gap-2">
          {tab !== "needs_check" && <input type="hidden" name="tab" value={tab} />}
          {base.month && <input type="hidden" name="month" value={month} />}
          <Field id="f_applicant" label="申請者">
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
        </form>
        <div className="w-72">
          <PeriodNav
            label={`${monthLabel(month)}${monthly ? "（支払日）" : ""}`}
            prev={{ href: adminListUrl({ ...base, month: monthQuery(prev) }), label: monthLabel(prev) }}
            next={{ href: adminListUrl({ ...base, month: monthQuery(next) }), label: monthLabel(next) }}
          />
        </div>
      </div>
      {!monthly && <p className="text-sm text-ink-muted">承認待ちは、月に関係なくすべて出します。</p>}

      {rows.length === 0 ? (
        <EmptyState message="この条件の経費はありません。" />
      ) : (
        <ExpenseTable
          rows={rows}
          selectable={tab === "ok" && canApprove}
          showStatus={tab === "all"}
          action={approveSelectedExpenses}
          back={back}
        />
      )}

      {opened && (
        <Modal title="経費の詳細" closeHref={back}>
          <ExpenseModal expense={opened} me={me} canApprove={canApprove} back={back} titles={titles} />
        </Modal>
      )}
    </div>
  );
}

// G04 経費の詳細・承認(EV-12)
async function ExpenseModal({
  expense: e,
  me,
  canApprove,
  back,
  titles,
}: {
  expense: Expense;
  me: CurrentEmployee;
  canApprove: boolean;
  back: string;
  titles: Awaited<ReturnType<typeof listAccountTitles>>;
}) {
  // 手順1: 領収書のURL(10分)
  const urls = e.receiptFileId ? await getSignedUrls([e.receiptFileId]) : new Map<string, string>();
  const url = e.receiptFileId ? (urls.get(e.receiptFileId) ?? null) : null;

  // 手順2: check_flags を文にする(今の内容で計算し直し、付いている印の文だけを出す)
  let flags: Flag[] = [];
  let duplicateId: string | null = null;
  if (e.checkFlags.length > 0) {
    const duplicate = await findDuplicate({
      id: e.id,
      receiptFileId: e.receiptFileId,
      payeeKey: e.payeeKey,
      spentOn: e.spentOn,
      total: e.total,
    });
    duplicateId = duplicate?.id ?? e.duplicateOf;
    const recomputed = runExpenseChecks({ ...e, titleName: e.accountTitleName }, e.submittedOn ?? todayJST(), duplicate);
    flags = recomputed.filter((f) => e.checkFlags.includes(f.code));
    // 申請のときに付いた印で、今は計算に出ないもの(相手が取り下げた など)も残す
    for (const code of e.checkFlags)
      if (!flags.some((f) => f.code === code))
        flags.push({ code: code as Flag["code"], message: `${topFlagText([code], e) ?? code}（申請のときの印）` });
  }

  const titleOptions = titles.filter((t) => t.isActive || t.id === e.accountTitleId).map((t) => ({ id: t.id, name: t.name }));
  const estimated =
    e.accountTitleId && (e.accountTitleSource === "history" || e.accountTitleSource === "ai") && e.accountTitleReason
      ? { titleId: e.accountTitleId, reason: e.accountTitleReason, ai: e.accountTitleSource === "ai" }
      : null;

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
            申請者 <span className="font-bold">{e.applicantName}</span>
            {e.submittedAt && <span className="ml-2 text-ink-muted tabular-nums">申請 {formatDateTime(e.submittedAt)}</span>}
          </p>
          {/* CH-14 承認者本人の申請も承認できる(【仮】E-07-仮-01) */}
          {e.applicantId === me.id && <Badge tone="neutral">本人の申請です</Badge>}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={EXPENSE_STATUS_TONES[e.status]}>{EXPENSE_STATUSES[e.status]}</Badge>
          </div>
          <ExpenseDetail expense={e} showTitle={!(canApprove && e.status === "submitted")} />
          {e.status === "approved" && e.approvedAt && (
            <p className="text-sm text-success">
              ✓ 承認済み（{e.approvedByName ?? ""}・{formatDateTime(e.approvedAt)}）{e.approveNote ? ` ひとこと: ${e.approveNote}` : ""}
            </p>
          )}
          {e.returnReason && e.returnedAt && (
            <p className="text-sm text-ink-muted">
              差し戻し（{e.returnedByName ?? ""}・{formatDateTime(e.returnedAt)}）理由: {e.returnReason}
            </p>
          )}
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

      {canApprove && e.status === "submitted" ? (
        <DecideForm
          action={decideExpense.bind(null, e.id)}
          version={e.version}
          back={back}
          titles={titleOptions}
          initialTitleId={e.accountTitleId ?? ""}
          estimated={estimated}
          needsNote={e.checkFlags.length > 0}
        />
      ) : (
        estimated && <p className="text-sm text-ink-muted">（{estimated.reason}）</p>
      )}
    </div>
  );
}
