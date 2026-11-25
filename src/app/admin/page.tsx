import Link from "next/link";
import { redirect } from "next/navigation";
import { canAccess, requireLogin } from "@/utils/auth";
import { canUseAdmin } from "@/utils/permissions";
import { getAdminCounts, type AdminCountKey } from "@/utils/adminCounts";
import { getCalendar, addDays } from "@/utils/holidays";
import { todayJST } from "@/utils/jst";
import { formatDate, formatDateShort, formatDateTime } from "@/utils/format";
import { listMyOpenTasks, type Task } from "@/utils/tasks";
import { getLatestImport } from "@/utils/orders";
import { getLastImport, isTargetAccount, listBankAccounts } from "@/utils/depositsServer";
import { accountLabel } from "@/utils/deposits";
import { getAiUsage, type AiUsage } from "@/utils/gemini";
import { Alert } from "@/components/Alert";
import { Badge, type BadgeTone } from "@/components/Badge";

// G05 管理画面のトップ(CMN-01 02 G05・03 EV-11 手順2・2-2。2026-11-25 A案「今日やること型」)。
// 管理画面の機能が1つも使えなければ「権限がありません」へ。
// 各部分は読めなくても画面は出し、その部分だけ「読み込めませんでした」にする。

// 自分のタスクは5件まで(00_仮決め一覧 CMN01-仮-18)
const MY_TASK_LIMIT = 5;

// 確認が必要なことのカード(02 G05 のカードの表の順)
const CARDS: { key: AdminCountKey; mark: string; group: string; label: string; href: string }[] = [
  { key: "inquiries_open", mark: "D", group: "問い合わせ", label: "対応中の問い合わせ", href: "/admin/inquiries" },
  { key: "exceptions_open", mark: "B", group: "受注・在庫", label: "例外注文", href: "/admin/orders/exceptions" },
  { key: "receiving_review", mark: "C", group: "仕入・検収", label: "確認が必要な納品書", href: "/admin/purchasing/receiving" },
  { key: "payables_review", mark: "E", group: "請求・支払", label: "確認待ちの受け取った請求書", href: "/admin/payables" },
  { key: "deposits_unmatched", mark: "E", group: "請求・支払", label: "照合できていない入金", href: "/admin/deposits" },
  { key: "attendance_alerts", mark: "E", group: "勤怠・給与", label: "勤怠の異常", href: "/admin/attendance/alerts" },
];

const LOAD_ERROR = "読み込めませんでした。";

// 失敗したら null を返す(部分ごとに「読み込めませんでした」を出すため)
const safe = async <T,>(label: string, fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (e) {
    console.error(`管理画面のトップ: ${label}を読み込めませんでした:`, e instanceof Error ? e.message : e);
    return null;
  }
};

type ImportRow = { key: string; name: string; at: Date | null; failed: boolean; href: string };

const loadImports = async (roles: Parameters<typeof canAccess>[0]): Promise<ImportRow[]> => {
  const rows: ImportRow[] = [];
  if (canAccess(roles, "orders")) {
    const [orders, stock] = await Promise.all([getLatestImport("crossmall_orders"), getLatestImport("crossmall_stock")]);
    rows.push(
      { key: "orders", name: "CROSS MALL の受注", at: orders?.at ?? null, failed: orders?.status === "failed", href: "/admin/orders/import" },
      { key: "stock", name: "CROSS MALL の在庫", at: stock?.at ?? null, failed: stock?.status === "failed", href: "/admin/inventory/import" }
    );
  }
  if (canAccess(roles, "receivables")) {
    const accounts = (await listBankAccounts()).filter(isTargetAccount);
    const lasts = await Promise.all(accounts.map((a) => getLastImport(a.id)));
    accounts.forEach((a, i) =>
      rows.push({
        key: `bank-${a.id}`,
        name: accountLabel(a),
        at: lasts[i]?.appliedAt ?? null,
        failed: false,
        href: `/admin/deposits/import?account=${a.id}`,
      })
    );
  }
  return rows;
};

// 期限のバッジ(期限切れ・今日は赤、明日は注意、それより先は藍の薄い色)
const dueBadge = (task: Task, today: string): { tone: BadgeTone; text: string } => {
  if (!task.dueDate) return { tone: "neutral", text: "期限なし" };
  if (task.dueDate < today) return { tone: "danger", text: "期限切れ" };
  if (task.dueDate === today) return { tone: "danger", text: "今日" };
  if (task.dueDate === addDays(today, 1)) return { tone: "warning", text: "明日" };
  return { tone: "neutral", text: formatDateShort(task.dueDate) };
};

const aiUsageText = (usage: AiUsage): string => {
  if (usage.state !== "stopped") return `今日 ${usage.used} 回 ／ 1日 ${usage.dailyLimit} 回まで`;
  switch (usage.stoppedReason) {
    case "no_key":
      return "停止中（AIの設定がありません）";
    case "db_error":
      return "停止中（回数を確かめられませんでした）";
    default:
      return "停止中（今日の回数の上限に達しました）";
  }
};

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default async function AdminTopPage() {
  const me = await requireLogin("/admin");
  if (!canUseAdmin(me.roles)) redirect("/no-permission");

  const today = todayJST();
  const canTasks = canAccess(me.roles, "tasks");
  const [calendar, counts, tasks, imports, aiUsage] = await Promise.all([
    safe("休業日", () => getCalendar(today, today)),
    getAdminCounts(me.roles),
    canTasks ? safe("自分のタスク", () => listMyOpenTasks(me)) : Promise.resolve(null),
    safe("取り込み状況", () => loadImports(me.roles)),
    getAiUsage(),
  ]);
  const closedDay = calendar?.get(today);
  const cards = CARDS.filter((c) => c.key in counts);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-ink-muted">{formatDate(today)}</p>
          <h1 className="mt-1 text-2xl font-bold">ホーム</h1>
        </div>
        {closedDay?.isClosed && (
          <Alert tone="warning" className="font-bold">
            今日は休業日です（{closedDay.name}）
          </Alert>
        )}
      </header>

      {cards.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-bold">確認が必要なこと</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => {
              const count = counts[card.key];
              return (
                <Link
                  key={card.key}
                  href={card.href}
                  className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <span className="flex items-center gap-2 text-xs text-ink-muted">
                    <span
                      aria-hidden="true"
                      className="inline-flex size-5 items-center justify-center rounded bg-primary-soft font-bold text-primary"
                    >
                      {card.mark}
                    </span>
                    {card.group}
                  </span>
                  <span className="font-bold text-ink">{card.label}</span>
                  {count === null || count === undefined ? (
                    <span className="text-sm text-danger">数えられませんでした</span>
                  ) : (
                    <span className="flex items-baseline gap-1">
                      <span className={`text-3xl font-bold tabular-nums ${count > 0 ? "text-primary" : "text-ink-muted"}`}>
                        {count}
                      </span>
                      <span className="text-sm text-ink-muted">件</span>
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {canTasks && (
          <Section
            title="自分のタスク"
            action={
              <Link href="/tasks" className="text-sm font-bold text-primary hover:underline">
                すべて見る
              </Link>
            }
          >
            {tasks === null ? (
              <p className="text-sm text-danger">{LOAD_ERROR}</p>
            ) : tasks.length === 0 ? (
              <p className="text-sm text-ink-muted">未完了のタスクはありません。</p>
            ) : (
              <ul className="flex flex-col">
                {tasks.slice(0, MY_TASK_LIMIT).map((task) => {
                  const due = dueBadge(task, today);
                  return (
                    <li key={task.id} className="border-t border-line first:border-t-0">
                      <Link href={`/tasks/${task.id}`} className="flex min-h-11 items-center gap-3 py-2 text-sm hover:underline">
                        <Badge tone={due.tone}>{due.text}</Badge>
                        <span className="flex-1">{task.title}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            {tasks && tasks.length > MY_TASK_LIMIT && (
              <p className="text-xs text-ink-muted">ほかに {tasks.length - MY_TASK_LIMIT} 件あります。</p>
            )}
          </Section>
        )}

        <Section title="データの取り込み状況">
          {imports === null ? (
            <p className="text-sm text-danger">{LOAD_ERROR}</p>
          ) : imports.length > 0 ? (
            <ul className="flex flex-col">
              {imports.map((row) => (
                <li key={row.key} className="flex min-h-11 flex-wrap items-center gap-3 border-t border-line py-2 text-sm first:border-t-0">
                  <span className="flex-1">{row.name}</span>
                  {row.failed && <Badge tone="danger">失敗</Badge>}
                  <span className="text-ink-muted tabular-nums">{row.at ? formatDateTime(row.at) : "まだありません"}</span>
                  <Link href={row.href} className="font-bold text-primary hover:underline">
                    取り込む
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-ai-soft px-3 py-2 text-sm text-ai">
            <span className="font-bold">AIの使用回数</span>
            <span className="tabular-nums">{aiUsageText(aiUsage)}</span>
          </div>
        </Section>
      </div>
    </div>
  );
}
