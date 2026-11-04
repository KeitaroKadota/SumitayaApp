// 全員のタスク(管理)の読み書き(CMN-03 EV-05〜EV-07)。権限チェックは呼ぶ側(tasks_admin)で済ませる。
import { query } from "@/utils/db";
import { todayJST } from "@/utils/jst";
import type { ActiveEmployee } from "@/utils/masters";
import { canAccess, isRole, type Role } from "@/utils/permissions";
import { isTaskId as isUuid, selectTasks, type Task } from "@/utils/tasks";
import { isFeatureKey, isTaskStatus, type TaskPriority, type TaskStatus } from "@/utils/taskTypes";

export const PAGE_SIZE = 50;

// 絞り込み(EV-05 手順2)。assignee は従業員id・区分の値・key:機能キー・retired
export type TaskFilter = {
  status: TaskStatus | "all";
  assignee: string;
  type: string;
  overdue: boolean;
  page: number;
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export const parseTaskFilter = (params: Record<string, string | string[] | undefined>): TaskFilter => {
  const status = first(params.status);
  const page = Number(first(params.page));
  return {
    status: status === "all" ? "all" : isTaskStatus(status) ? status : "open",
    assignee: first(params.assignee),
    type: first(params.type),
    overdue: first(params.overdue) === "1",
    page: Number.isInteger(page) && page >= 1 ? page : 1,
  };
};

export const taskFilterQuery = (f: TaskFilter, page = f.page): string => {
  const p = new URLSearchParams();
  if (f.status !== "open") p.set("status", f.status);
  if (f.assignee) p.set("assignee", f.assignee);
  if (f.type) p.set("type", f.type);
  if (f.overdue) p.set("overdue", "1");
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `?${s}` : "";
};

export const listTasksForAdmin = async (f: TaskFilter): Promise<{ tasks: Task[]; total: number }> => {
  const today = todayJST();
  return await query(async (sql) => {
    const assignee = f.assignee;
    const where = sql`
      ${f.status === "all" ? sql`true` : sql`t.status = ${f.status}`}
      ${
        assignee === "retired"
          ? sql`and a.is_active = false`
          : assignee.startsWith("key:")
            ? sql`and t.assignee_feature_key = ${assignee.slice(4)}`
            : isRole(assignee)
              ? sql`and t.assignee_role = ${assignee}`
              : isUuid(assignee)
                ? sql`and t.assignee_employee_id = ${assignee}`
                : sql``
      }
      ${f.type ? sql`and t.task_type = ${f.type}` : sql``}
      ${f.overdue ? sql`and t.status = 'open' and t.due_on < ${today}::date` : sql``}`;
    const [count] = await sql<{ count: number }[]>`
      select count(*)::int as count from tasks t left join employees a on a.id = t.assignee_employee_id where ${where}`;
    // 期限の近い順(期限なしは後ろ)。同じなら急ぎが先、次に作った順
    const tasks = await selectTasks(
      sql,
      where,
      sql`order by t.due_on asc nulls last, (t.priority = 'urgent') desc, t.created_at asc
          limit ${PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}`
    );
    return { tasks, total: count?.count ?? 0 };
  });
};

// 見出しの「未完了 12件（期限切れ 3件）」
export const countAllOpenTasks = async (): Promise<{ open: number; overdue: number }> => {
  const today = todayJST();
  const rows = await query(
    (sql) => sql<{ open: number; overdue: number }[]>`
      select count(*)::int as open, count(*) filter (where due_on < ${today}::date)::int as overdue
      from tasks where status = 'open'`
  );
  return rows[0] ?? { open: 0, overdue: 0 };
};

// 担当の絞り込みの選択肢に出す機能キー(タスクに使われているものだけ)
export const listUsedFeatureKeys = async (): Promise<string[]> => {
  const rows = await query(
    (sql) => sql<{ key: string }[]>`
      select distinct assignee_feature_key as key from tasks where assignee_feature_key is not null order by 1`
  );
  return rows.map((r) => r.key);
};

// 種類の絞り込みの選択肢(タスクに使われているもの)
export const listUsedTaskTypes = async (): Promise<string[]> => {
  const rows = await query((sql) => sql<{ type: string }[]>`select distinct task_type as type from tasks order by 1`);
  return rows.map((r) => r.type);
};

// EV-05 手順3 「通知」の列: 送信済・未連携・まとめ。区分あて・機能キーあては当てはまる在籍中の全員が未連携なら未連携
export type NotifyColumn = "sent" | "not_linked" | "digest";
export const notifyColumnOf = (task: Task, activeEmployees: ActiveEmployee[]): NotifyColumn => {
  if (task.notifiedAt) return "sent";
  let recipients: ActiveEmployee[] = [];
  if (task.assigneeEmployeeId) return task.assigneeLinked ? "digest" : "not_linked";
  if (task.assigneeRole) {
    const role: Role = task.assigneeRole;
    recipients = activeEmployees.filter((e) => e.roles.includes(role));
  } else if (task.assigneeFeatureKey && isFeatureKey(task.assigneeFeatureKey)) {
    const key = task.assigneeFeatureKey;
    recipients = activeEmployees.filter((e) => canAccess(e.roles, key));
  }
  return recipients.some((e) => e.lineUserId) ? "digest" : "not_linked";
};

export const NOTIFY_COLUMN_LABELS: Record<NotifyColumn, string> = { sent: "送信済", not_linked: "未連携", digest: "まとめ" };

// ---- G04 ----

export type TaskNotificationLog = {
  createdAt: Date;
  kind: string;
  employeeName: string | null;
  status: "sent" | "failed" | "skipped";
  skipReason: string | null;
};

// G04 の「通知の記録」: そのタスクの通知(すぐの通知)
export const listTaskNotificationLogs = async (taskId: string): Promise<TaskNotificationLog[]> => {
  const rows = await query(
    (sql) => sql<
      { created_at: Date; kind: string; employee_name: string | null; status: "sent" | "failed" | "skipped"; skip_reason: string | null }[]
    >`
      select l.created_at, l.kind, case when e.id is null then null else e.last_name || ' ' || e.first_name end as employee_name,
             l.status, l.skip_reason
      from notification_logs l left join employees e on e.id = l.employee_id
      where l.task_id = ${taskId}
      order by l.created_at desc limit 50`
  );
  return rows.map((r) => ({
    createdAt: r.created_at,
    kind: r.kind,
    employeeName: r.employee_name,
    status: r.status,
    skipReason: r.skip_reason,
  }));
};

// EV-06 手順3: 担当(ちょうど1つ)・期限・急ぎを保存する。未完了のときだけ(CH-09)。
// resetNotified: 担当が変わり急ぎのとき、すぐの通知を送り直すために notified_at を空にする
export const updateTaskAssignment = async ({
  id,
  assigneeEmployeeId,
  assigneeRole,
  assigneeFeatureKey,
  dueDate,
  priority,
  resetNotified,
  by,
}: {
  id: string;
  assigneeEmployeeId: string | null;
  assigneeRole: Role | null;
  assigneeFeatureKey: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  resetNotified: boolean;
  by: string;
}): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update tasks
      set assignee_employee_id = ${assigneeEmployeeId}, assignee_role = ${assigneeRole},
          assignee_feature_key = ${assigneeFeatureKey}, due_on = ${dueDate}, priority = ${priority},
          ${resetNotified ? sql`notified_at = null,` : sql``} updated_by = ${by}
      where id = ${id} and status = 'open'
      returning id`
  );
  return rows.length > 0;
};

// CH-03 担当者が在籍中の従業員か
export const isActiveEmployee = async (id: string): Promise<boolean> => {
  if (!isUuid(id)) return false;
  const rows = await query((sql) => sql<{ id: string }[]>`select id from employees where id = ${id} and is_active`);
  return rows.length > 0;
};
