// G01 自分の経費の一覧(スマホ。E-07 03 EV-01)。機能キー expenses_apply(全員)。本人の経費だけ(CH-02)。
import Link from "next/link";
import { fullName, requireAccess } from "@/utils/auth";
import { EXPENSE_STATUSES } from "@/utils/expenseClaims";
import { EXPENSES_URL, expenseUrl, listMyExpenses } from "@/utils/expenseClaimsServer";
import { formatDateShort, formatYearMonth, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { AiBadge } from "@/components/AiDraft";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { PeriodNav } from "@/components/PeriodNav";
import { StaffHeader } from "@/components/StaffHeader";
import { createExpenseWithoutReceipt } from "./actions";
import { EXPENSE_STATUS_TONES, isMonthStr, monthRange, shiftMonth } from "./expensesView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim() : "");

const DONE_MESSAGES: Record<string, string> = {
  submitted: "申請しました。",
  saved: "下書きを保存しました。",
  deleted: "削除しました。",
  withdrawn: "取り下げました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  not_found: "この経費は見つかりません。",
  failed: "保存できませんでした。時間をおいてもう一度お試しください。",
};

export default async function ExpensesPage({ searchParams }: PageProps<"/expenses">) {
  const me = await requireAccess("expenses_apply", EXPENSES_URL);
  const params = await searchParams;

  // 手順1: ?month=(なければ今月)
  const thisMonth = todayJST().slice(0, 7);
  const monthParam = str(params.month);
  const month = isMonthStr(monthParam) ? monthParam : thisMonth;
  const { from, to } = monthRange(month);

  // 手順2・3
  const items = await listMyExpenses(me.id, from, to);
  // 手順4
  const done = DONE_MESSAGES[str(params.done)];
  const error = ERROR_MESSAGES[str(params.error)];

  const label = (m: string) => formatYearMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)));
  const hrefOf = (m: string) => (m === thisMonth ? EXPENSES_URL : `${EXPENSES_URL}?month=${m}`);
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href="/" label="ホームへ" />
        </div>
        <h1 className="text-xl font-bold">経費</h1>
        {done && <Alert tone="success">{done}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        <LinkButton href={`${EXPENSES_URL}/new`} variant="primary" size="lg" className="w-full">
          領収書を撮影する
        </LinkButton>
        <form action={createExpenseWithoutReceipt}>
          <button type="submit" className="min-h-11 text-sm font-bold text-primary hover:underline">
            領収書なしで入力する
          </button>
        </form>

        <PeriodNav
          label={label(month)}
          prev={{ href: hrefOf(prev), label: label(prev) }}
          next={{ href: hrefOf(next), label: label(next) }}
        />

        {items.length === 0 ? (
          <EmptyState message="この月の経費はまだありません。" />
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((e) => (
              <li key={e.id}>
                <Link
                  href={expenseUrl(e.id)}
                  className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 hover:bg-canvas focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span className="flex flex-wrap gap-2">
                    <Badge tone={EXPENSE_STATUS_TONES[e.status]}>{EXPENSE_STATUSES[e.status]}</Badge>
                    {/* 一度も申請していない、AIが読み取った下書き */}
                    {e.status === "draft" && e.aiRequestId && !e.submittedAt && <AiBadge />}
                  </span>
                  <span className="font-bold break-words">
                    {e.spentOn ? formatDateShort(e.spentOn) : "日付なし"} {e.payeeName ?? "支払先なし"}
                  </span>
                  {e.total > 0 && (
                    <span className="text-sm tabular-nums">
                      {formatYen(e.total, "included")} {e.accountTitleName ?? ""}
                    </span>
                  )}
                  {e.status === "returned" && e.returnReason && (
                    <span className="text-sm break-words text-danger">理由: {e.returnReason}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
