// 通知の共通関数(CMN-03 03 の 0.4・0.5)。LINE の push で送り、送れた・失敗・送らなかったを notification_logs に残す。
// みるきーの lineNotify.ts(管理者全員へ)は使わず、宛先(人・区分・機能キー)ごとの送り方にした(CMN-03 01 7.4)。
// 通知は「おまけ」。送れなくても例外を投げず、記録だけ残す(タスクは画面で必ず見られる。01 4.3)。
import { query } from "@/utils/db";
import { getSiteUrl } from "@/utils/accountEmail";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { pushLineMessage } from "@/utils/lineMessaging";
import { listActiveEmployees } from "@/utils/masters";
import { FEATURES, ROLE_LABELS, isRole, type Role } from "@/utils/permissions";
import { isFeatureKey } from "@/utils/taskTypes";

export type NotifyKind = "task_created" | "task_digest" | "test" | "linked" | "other";
export type SkipReason = "not_linked" | "inactive" | "disabled" | "daily_limit";
export type NotifyOutcome = { employeeId: string; status: "sent" | "failed" | "skipped"; skipReason?: SkipReason };
export type NotifyResult = { sent: number; skipped: number; failed: number; outcomes: NotifyOutcome[] };

// CH-16 LINE のテキストは1通 5,000文字まで。超えるときは 4,990文字で切って末尾に付ける
const LINE_TEXT_MAX = 5000;
const LINE_TEXT_CUT = 4990;
const TRUNCATED_SUFFIX = "…（続きはアプリで）";
// 失敗したときに残す LINE の返事の長さ
const ERROR_MAX = 500;

// 【仮】1日に送る上限の通数の初期値(00_仮決め一覧 CMN03-仮-09)。環境変数 LINE_DAILY_PUSH_LIMIT で変える
const DEFAULT_DAILY_PUSH_LIMIT = 30;

// 7.5 環境変数 LINE_NOTIFY_ENABLED=1 のときだけ実際に送る
export const isLineNotifyEnabled = (): boolean => process.env.LINE_NOTIFY_ENABLED === "1";

const dailyPushLimit = (): number => {
  const raw = process.env.LINE_DAILY_PUSH_LIMIT?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_DAILY_PUSH_LIMIT;
};

export const limitLineText = (text: string): string =>
  text.length <= LINE_TEXT_MAX ? text : `${text.slice(0, LINE_TEXT_CUT)}${TRUNCATED_SUFFIX}`;

// 文面(03「メッセージの文面（案）」)
export const TEST_MESSAGE = "テストのお知らせです（祭すみたや 業務システム）";
export const LINKED_MESSAGE = "祭すみたや 業務システムのLINE通知を設定しました。\nタスクのお知らせがこのアカウントに届きます。";

// CH-17 今日(日本時間)送れた通数
const countSentToday = async (): Promise<number> => {
  const from = `${todayJST()}T00:00:00+09:00`;
  const rows = await query(
    (sql) => sql<{ count: number }[]>`
      select count(*)::int as count from notification_logs where status = 'sent' and sent_at >= ${from}::timestamptz`
  );
  return rows[0]?.count ?? 0;
};

const writeLog = async (log: {
  employeeId: string;
  lineUserId: string | null;
  kind: NotifyKind;
  taskId: string | null;
  sourceFeature: string | null;
  message: string;
  status: "sent" | "failed" | "skipped";
  skipReason: SkipReason | null;
  error: string | null;
}) => {
  await query(
    (sql) => sql`
      insert into notification_logs
        (employee_id, line_user_id, kind, task_id, source_feature, message, status, skip_reason, error, sent_at)
      values (${log.employeeId}, ${log.lineUserId}, ${log.kind}, ${log.taskId}, ${log.sourceFeature}, ${log.message},
              ${log.status}, ${log.skipReason}, ${log.error}, ${log.status === "sent" ? sql`now()` : null})`
  );
};

// 記録が書けなくても送信は続ける(ログにだけ残す)
const writeLogSafely = async (log: Parameters<typeof writeLog>[0]) => {
  try {
    await writeLog(log);
  } catch (e) {
    console.error("通知の記録を書けませんでした:", e instanceof Error ? e.message : e);
  }
};

// 0.4 LINE で送る。1人ずつ順番に送り、1人の失敗でほかの人への送信を止めない
export const notifyEmployees = async (
  employeeIds: string[],
  text: string,
  { kind, taskId = null, sourceFeature = null }: { kind: NotifyKind; taskId?: string | null; sourceFeature?: string | null }
): Promise<NotifyResult> => {
  const result: NotifyResult = { sent: 0, skipped: 0, failed: 0, outcomes: [] };
  // 手順1: 重なりは1人にまとめる
  const ids = [...new Set(employeeIds)];
  if (ids.length === 0) return result;

  const rows = await query(
    (sql) => sql<{ id: string; is_active: boolean; line_user_id: string | null }[]>`
      select id, is_active, line_user_id from employees where id = any(${ids}::uuid[])`
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const enabled = isLineNotifyEnabled();
  const limit = dailyPushLimit();
  let sentToday = enabled ? await countSentToday() : 0;
  // 手順3 CH-16
  const message = limitLineText(text);

  for (const id of ids) {
    const employee = byId.get(id);
    if (!employee) continue;
    const base = { employeeId: id, lineUserId: employee.line_user_id, kind, taskId, sourceFeature, message };

    // 手順2 CH-11: 最初に当てはまった理由で送らない
    const lineUserId = employee.line_user_id;
    const skipReason: SkipReason | null = !enabled
      ? "disabled"
      : !employee.is_active
        ? "inactive"
        : !lineUserId
          ? "not_linked"
          : sentToday >= limit
            ? "daily_limit"
            : null;
    if (skipReason || !lineUserId) {
      const reason = skipReason ?? "not_linked";
      await writeLogSafely({ ...base, status: "skipped", skipReason: reason, error: null });
      result.skipped += 1;
      result.outcomes.push({ employeeId: id, status: "skipped", skipReason: reason });
      continue;
    }

    // 手順4・5
    try {
      await pushLineMessage(lineUserId, [{ type: "text", text: message }]);
      sentToday += 1;
      await writeLogSafely({ ...base, status: "sent", skipReason: null, error: null });
      result.sent += 1;
      result.outcomes.push({ employeeId: id, status: "sent" });
    } catch (e) {
      const error = (e instanceof Error ? e.message : String(e)).slice(0, ERROR_MAX);
      console.error("LINE を送れませんでした:", error);
      await writeLogSafely({ ...base, status: "failed", skipReason: null, error });
      result.failed += 1;
      result.outcomes.push({ employeeId: id, status: "failed" });
    }
  }
  return result;
};

// ---- 0.5 タスクのすぐの通知 ----

type NotifyTaskRow = {
  id: string;
  title: string;
  body: string | null;
  assignee_employee_id: string | null;
  assignee_last_name: string | null;
  assignee_role: string | null;
  assignee_feature_key: string | null;
  due_on: string | null;
  priority: string;
  status: string;
  notified_at: Date | null;
};

// 本文の「内容」に入れる長さ
const BODY_PREVIEW_MAX = 100;

// 文面1「タスクのすぐの通知（急ぎ）」
const buildTaskCreatedMessage = (task: NotifyTaskRow): string => {
  const role: Role | null = task.assignee_role && isRole(task.assignee_role) ? task.assignee_role : null;
  const assignee = role
    ? `${ROLE_LABELS[role]}の皆さん`
    : task.assignee_feature_key
      ? `${isFeatureKey(task.assignee_feature_key) ? FEATURES[task.assignee_feature_key].label : task.assignee_feature_key}の担当の皆さん`
      : `${task.assignee_last_name ?? ""}さん`;
  const lines = [`【急ぎのタスク】${task.title}`];
  if (task.due_on) lines.push(`期限: ${formatDateShort(task.due_on)}`);
  lines.push(`担当: ${assignee}`);
  if (task.body) lines.push("", task.body.slice(0, BODY_PREVIEW_MAX));
  lines.push("", "確認・完了はこちら", `${getSiteUrl()}/tasks/${task.id}`);
  return lines.join("\n");
};

const readTasksForNotify = async (ids: string[]): Promise<NotifyTaskRow[]> =>
  await query(
    (sql) => sql<NotifyTaskRow[]>`
      select t.id, t.title, t.body, t.assignee_employee_id, e.last_name as assignee_last_name, t.assignee_role,
             t.assignee_feature_key, to_char(t.due_on, 'YYYY-MM-DD') as due_on, t.priority, t.status, t.notified_at
      from tasks t left join employees e on e.id = t.assignee_employee_id
      where t.id = any(${ids}::uuid[])`
  );

// 手順1: 宛先。人あては担当者、区分あては区分を持つ在籍中の全員、機能キーあては使える在籍中の全員(社長を含む)
const recipientsOf = async (task: NotifyTaskRow): Promise<string[]> => {
  if (task.assignee_employee_id) return [task.assignee_employee_id];
  if (task.assignee_role && isRole(task.assignee_role)) {
    return (await listActiveEmployees({ roles: [task.assignee_role] })).map((e) => e.id);
  }
  if (task.assignee_feature_key && isFeatureKey(task.assignee_feature_key)) {
    return (await listActiveEmployees({ featureKey: task.assignee_feature_key })).map((e) => e.id);
  }
  return [];
};

const notifyTaskRow = async (task: NotifyTaskRow): Promise<NotifyResult> => {
  const recipients = await recipientsOf(task);
  const result = await notifyEmployees(recipients, buildTaskCreatedMessage(task), { kind: "task_created", taskId: task.id });
  // 手順3: 1人以上に送れたら送った時刻を残す
  if (result.sent > 0) {
    await query((sql) => sql`update tasks set notified_at = now() where id = ${task.id}`);
  }
  return result;
};

// 1件のタスクをすぐ知らせる(未完了のときだけ)
export const notifyTask = async (taskId: string): Promise<NotifyResult | null> => {
  const [task] = await readTasksForNotify([taskId]);
  if (!task || task.status !== "open") return null;
  return await notifyTaskRow(task);
};

// 手順4: 呼んだ機能がトランザクションの確定の後に呼ぶ。急ぎで、まだ知らせていない未完了のものだけ送る。
// 通知の失敗は例外にしない(ログにだけ残す)
export const notifyNewTasks = async (taskIds: string[]): Promise<void> => {
  if (taskIds.length === 0) return;
  try {
    const tasks = await readTasksForNotify([...new Set(taskIds)]);
    for (const task of tasks) {
      if (task.status !== "open" || task.priority !== "urgent" || task.notified_at) continue;
      await notifyTaskRow(task);
    }
  } catch (e) {
    console.error("タスクの通知を送れませんでした:", e instanceof Error ? e.message : e);
  }
};
