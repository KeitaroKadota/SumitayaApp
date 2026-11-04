// 毎朝のまとめ通知(CMN-03 03 の EV-17。cron の処理 task_digest)。未完了のタスクがある人だけに LINE で送る。
import { getSiteUrl } from "@/utils/accountEmail";
import { formatDateShort } from "@/utils/format";
import { isClosedDay } from "@/utils/holidays";
import { listActiveEmployees } from "@/utils/masters";
import { notifyEmployees } from "@/utils/notify";
import { listMyOpenTasks, type Task } from "@/utils/tasks";

// 【仮】件名を出すのは上から10件まで(00_仮決め一覧 CMN03-仮-02)
const DIGEST_TITLE_COUNT = 10;

// 文面2「毎朝のまとめ通知」
const buildDigestMessage = (lastName: string, tasks: Task[], today: string): string => {
  const overdue = tasks.filter((t) => t.dueDate !== null && t.dueDate < today).length;
  const lines = [`【今日のタスク】${lastName}さん 未完了 ${tasks.length}件（期限切れ ${overdue}件）`, ""];
  for (const t of tasks.slice(0, DIGEST_TITLE_COUNT)) {
    if (!t.dueDate) lines.push(`・${t.title}`);
    else if (t.dueDate < today) lines.push(`・${t.title}（期限切れ）`);
    else lines.push(`・${t.title}（${formatDateShort(t.dueDate)}まで）`);
  }
  if (tasks.length > DIGEST_TITLE_COUNT) lines.push(`…ほか ${tasks.length - DIGEST_TITLE_COUNT}件`);
  lines.push("", "一覧はこちら", `${getSiteUrl()}/tasks`);
  return lines.join("\n");
};

// 手順1: 【仮】休業日は送らない(00_仮決め一覧 CMN03-仮-03)
export const taskDigestRunsOn = async (today: string): Promise<boolean> => !(await isClosedDay(today));

// 手順2〜5
export const runTaskDigest = async (today: string): Promise<Record<string, number>> => {
  const employees = await listActiveEmployees();
  const summary = { targets: 0, sent: 0, skipped: 0, failed: 0 };
  for (const employee of employees) {
    const tasks = await listMyOpenTasks({ id: employee.id, roles: employee.roles });
    // 0件の人には送らない
    if (tasks.length === 0) continue;
    summary.targets += 1;
    const result = await notifyEmployees([employee.id], buildDigestMessage(employee.lastName, tasks, today), {
      kind: "task_digest",
    });
    summary.sent += result.sent;
    summary.skipped += result.skipped;
    summary.failed += result.failed;
  }
  return summary;
};
