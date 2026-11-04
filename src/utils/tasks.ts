// タスクの共通関数(CMN-03 03 の 0.1〜0.3)。各機能はタスクを出すときに createTask、
// 元の問題が解決したら completeTasksBySource を呼ぶ。権限チェックはしない(呼ぶ側の画面・操作で済ませている前提)。
// みるきーの board.ts の考え方(宛先ごとに完了、出したときに LINE で知らせる、送れなくても失敗にしない)を参考にし、
// 表は型付きの tasks 1つに作り直した(CMN-03 01 7.4)。
import { query, queryOn, type SqlFragment, type SqlLike, type TransactionSql } from "@/utils/db";
import { todayJST } from "@/utils/jst";
import { safeNextPath } from "@/utils/loginNext";
import { notifyTask } from "@/utils/notify";
import { FEATURES, canAccess, isRole, type FeatureKey, type Role } from "@/utils/permissions";
import { isValidDateStr } from "@/utils/textNormalize";
import {
  TASK_BODY_MAX,
  TASK_NOTE_MAX,
  TASK_TITLE_MAX,
  assigneeLabel,
  isFeatureKey,
  isTaskType,
  type TaskPriority,
  type TaskStatus,
} from "@/utils/taskTypes";

export type Task = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  assigneeEmployeeId: string | null;
  assigneeName: string | null;
  assigneeLastName: string | null;
  // 人あての担当者が在籍中か・LINE と結び付いているか(人あて以外は null)
  assigneeActive: boolean | null;
  assigneeLinked: boolean | null;
  assigneeRole: Role | null;
  assigneeFeatureKey: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  sourceFeature: string | null;
  sourceId: string | null;
  linkUrl: string | null;
  completedAt: Date | null;
  completedByName: string | null;
  completionNote: string | null;
  notifiedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
};

type TaskRow = {
  id: string;
  task_type: string;
  title: string;
  body: string | null;
  assignee_employee_id: string | null;
  assignee_last_name: string | null;
  assignee_first_name: string | null;
  assignee_active: boolean | null;
  assignee_linked: boolean | null;
  assignee_role: string | null;
  assignee_feature_key: string | null;
  due_on: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source_feature: string | null;
  source_id: string | null;
  link_url: string | null;
  completed_at: Date | null;
  completed_by_name: string | null;
  completion_note: string | null;
  notified_at: Date | null;
  created_at: Date;
  created_by_name: string | null;
};

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  type: r.task_type,
  title: r.title,
  body: r.body,
  assigneeEmployeeId: r.assignee_employee_id,
  assigneeName: r.assignee_last_name !== null ? `${r.assignee_last_name} ${r.assignee_first_name ?? ""}`.trim() : null,
  assigneeLastName: r.assignee_last_name,
  assigneeActive: r.assignee_active,
  assigneeLinked: r.assignee_linked,
  assigneeRole: r.assignee_role && isRole(r.assignee_role) ? r.assignee_role : null,
  assigneeFeatureKey: r.assignee_feature_key,
  dueDate: r.due_on,
  priority: r.priority,
  status: r.status,
  sourceFeature: r.source_feature,
  sourceId: r.source_id,
  linkUrl: r.link_url,
  completedAt: r.completed_at,
  completedByName: r.completed_by_name,
  completionNote: r.completion_note,
  notifiedAt: r.notified_at,
  createdAt: r.created_at,
  createdByName: r.created_by_name,
});

// タスクを読む共通の select。where・並び順・件数は呼ぶ側で渡す(sql の部品)
export const selectTasks = async (
  sql: SqlLike,
  where: SqlFragment,
  tail: SqlFragment = sql``
): Promise<Task[]> => {
  const rows = await sql<TaskRow[]>`
    select t.id, t.task_type, t.title, t.body, t.assignee_employee_id,
           a.last_name as assignee_last_name, a.first_name as assignee_first_name,
           a.is_active as assignee_active, case when a.id is null then null else a.line_user_id is not null end as assignee_linked,
           t.assignee_role, t.assignee_feature_key, to_char(t.due_on, 'YYYY-MM-DD') as due_on, t.priority, t.status,
           t.source_feature, t.source_id, t.link_url, t.completed_at,
           case when c.id is null then null else c.last_name || ' ' || c.first_name end as completed_by_name,
           t.completion_note, t.notified_at, t.created_at,
           case when cr.id is null then null else cr.last_name || ' ' || cr.first_name end as created_by_name
    from tasks t
    left join employees a on a.id = t.assignee_employee_id
    left join employees c on c.id = t.completed_by
    left join employees cr on cr.id = t.created_by
    where ${where}
    ${tail}`;
  return rows.map(toTask);
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isTaskId = (value: string): boolean => UUID_PATTERN.test(value);

// 1件読む。見つからなければ null
export const getTask = async (id: string): Promise<Task | null> => {
  if (!isTaskId(id)) return null;
  const [task] = await query((sql) => selectTasks(sql, sql`t.id = ${id}`));
  return task ?? null;
};

// ---- 0.1 createTask ----

export type CreateTaskInput = {
  // 種類(種類の表 src/utils/taskTypes.ts にあること)
  type: string;
  title: string;
  // 内容(複数行可)
  body?: string | null;
  // 担当は人・区分・機能キーのちょうど1つ(CH-02)
  assigneeEmployeeId?: string | null;
  assigneeRole?: Role | null;
  assigneeFeatureKey?: FeatureKey | null;
  // 期限(YYYY-MM-DD。過去の日付でもよい)
  dueDate?: string | null;
  priority?: TaskPriority;
  // 発行元の機能ID(例: E-02)と対象のID
  sourceFeature?: string | null;
  sourceId?: string | null;
  // 開く画面(アプリの中のURL)
  linkUrl?: string | null;
  // 作った人(各機能が自動で出したときは空)
  createdBy?: string | null;
};

const TYPE_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
const SOURCE_FEATURE_PATTERN = /^(CMN|[A-E])-\d{2}$/;
const SOURCE_ID_MAX = 200;

// CH-01〜CH-06・CH-10。だめなら例外(呼んだ機能の作りの誤り)
const validateCreateInput = async (sql: SqlLike, input: CreateTaskInput) => {
  // CH-06 種類と発行元の形式
  if (!TYPE_PATTERN.test(input.type) || !isTaskType(input.type)) {
    throw new Error(`タスクの種類 ${input.type} が登録されていません`);
  }
  const sourceFeature = input.sourceFeature?.trim() || null;
  if (sourceFeature && !SOURCE_FEATURE_PATTERN.test(sourceFeature)) {
    throw new Error(`タスクの発行元 ${sourceFeature} の形式が正しくありません`);
  }
  const sourceId = input.sourceId?.trim() || null;
  if (sourceId && sourceId.length > SOURCE_ID_MAX) throw new Error("タスクの対象のIDが長すぎます(200文字まで)");

  // CH-01 件名は必須。100文字を超えたら切る。内容は2,000文字を超えたら切る
  const title = input.title.trim().slice(0, TASK_TITLE_MAX);
  if (!title) throw new Error("タスクの件名がありません");
  let body = input.body?.trim() ? input.body.trimEnd() : null;

  // CH-02 担当はちょうど1つ
  const assigneeCount = [input.assigneeEmployeeId, input.assigneeRole, input.assigneeFeatureKey].filter(Boolean).length;
  if (assigneeCount !== 1) throw new Error("タスクの担当は人・区分・機能キーのどれか1つを指定してください");

  let assigneeEmployeeId = input.assigneeEmployeeId ?? null;
  let assigneeRole = input.assigneeRole ?? null;
  const assigneeFeatureKey = input.assigneeFeatureKey ?? null;

  // CH-04 区分・機能キーが決まった値
  if (assigneeRole && !isRole(assigneeRole)) throw new Error(`区分 ${assigneeRole} が正しくありません`);
  if (assigneeFeatureKey && !isFeatureKey(assigneeFeatureKey)) {
    throw new Error(`機能キー ${assigneeFeatureKey} が権限表にありません`);
  }

  // CH-03 担当者が在籍中。退職者あてなら社長の区分あてに変え、内容の先頭に書く
  if (assigneeEmployeeId) {
    if (!isTaskId(assigneeEmployeeId)) throw new Error("タスクの担当者のIDが正しくありません");
    const [employee] = await sql<{ last_name: string; first_name: string; is_active: boolean }[]>`
      select last_name, first_name, is_active from employees where id = ${assigneeEmployeeId}`;
    if (!employee) throw new Error("タスクの担当者が見つかりません");
    if (!employee.is_active) {
      // 【仮】00_仮決め一覧 CMN03-仮-06
      const note = `（担当の${employee.last_name} ${employee.first_name}さんは退職済みのため社長あて）`;
      body = body ? `${note}\n${body}` : note;
      assigneeEmployeeId = null;
      assigneeRole = "president";
    }
  }
  if (body) body = body.slice(0, TASK_BODY_MAX);

  // CH-05 期限の日付
  const dueDate = input.dueDate || null;
  if (dueDate && !isValidDateStr(dueDate)) throw new Error(`タスクの期限 ${dueDate} が正しい日付ではありません`);

  // CH-10 開く画面がアプリの中のURL
  let linkUrl: string | null = null;
  if (input.linkUrl) {
    linkUrl = safeNextPath(input.linkUrl);
    if (!linkUrl) throw new Error(`タスクの開く画面 ${input.linkUrl} がアプリの中のURLではありません`);
  }

  const priority: TaskPriority = input.priority === "urgent" ? "urgent" : "normal";

  return {
    type: input.type,
    title,
    body,
    assigneeEmployeeId,
    assigneeRole,
    assigneeFeatureKey,
    dueDate,
    priority,
    sourceFeature,
    sourceId,
    linkUrl,
    createdBy: input.createdBy ?? null,
  };
};

// 0.1 タスクを発行する。同じ種類・発行元・対象のIDで未完了のタスクがあれば作らず、件名・内容・期限・急ぎを上書きして返す(CH-07)。
// tx を渡したとき(呼んだ機能のトランザクションの中)は通知を送らない。確定の後に notifyNewTasks(id一覧) を呼ぶこと
export const createTask = async (input: CreateTaskInput, { tx }: { tx?: TransactionSql } = {}): Promise<Task> => {
  const task = await queryOn(tx, async (sql) => {
    const v = await validateCreateInput(sql, input);
    // 同時に2回呼ばれても1件になるよう、重複不可の索引(tasks_open_source_key)で上書きにする
    const [row] = await sql<{ id: string }[]>`
      insert into tasks (task_type, title, body, assignee_employee_id, assignee_role, assignee_feature_key, due_on,
                         priority, source_feature, source_id, link_url, created_by, updated_by)
      values (${v.type}, ${v.title}, ${v.body}, ${v.assigneeEmployeeId}, ${v.assigneeRole}, ${v.assigneeFeatureKey},
              ${v.dueDate}, ${v.priority}, ${v.sourceFeature}, ${v.sourceId}, ${v.linkUrl}, ${v.createdBy}, ${v.createdBy})
      on conflict (task_type, source_feature, source_id) where status = 'open' and source_id is not null
      do update set title = excluded.title, body = excluded.body, due_on = excluded.due_on,
                    priority = excluded.priority, updated_by = excluded.updated_by
      returning id`;
    const [created] = await selectTasks(sql, sql`t.id = ${row.id}`);
    return created;
  });

  // 手順4: 急ぎで、まだ知らせていなければすぐ知らせる。通知の失敗はタスクの発行の失敗にしない
  if (!tx && task.priority === "urgent" && !task.notifiedAt) {
    try {
      await notifyTask(task.id);
    } catch (e) {
      console.error("タスクの通知を送れませんでした:", e instanceof Error ? e.message : e);
    }
  }
  return task;
};

// ---- 0.2 completeTasksBySource・0.2b getTasksBySource ----

// 0.2 元の機能から閉じる。閉じた件数を返す(無ければ 0。エラーにしない)
export const completeTasksBySource = async (
  sourceFeature: string,
  sourceId: string,
  { types, status = "done", note = null }: { types?: string[]; status?: "done" | "cancelled"; note?: string | null } = {}
): Promise<number> => {
  const completionNote = note?.trim() ? note.trim().slice(0, TASK_NOTE_MAX) : null;
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update tasks
      set status = ${status}, completed_at = now(), completed_by = null, completion_note = ${completionNote}
      where source_feature = ${sourceFeature} and source_id = ${sourceId} and status = 'open'
        ${types && types.length > 0 ? sql`and task_type = any(${types}::text[])` : sql``}
      returning id`
  );
  return rows.length;
};

export type SourceTask = {
  id: string;
  type: string;
  title: string;
  status: TaskStatus;
  assigneeLabel: string;
  dueDate: string | null;
  completedAt: Date | null;
  completedByName: string | null;
  completionNote: string | null;
};

// 0.2b 発行元からタスクを読む(未完了・完了・取消とも、新しい順)
export const getTasksBySource = async (
  sourceFeature: string,
  sourceId: string,
  { types }: { types?: string[] } = {}
): Promise<SourceTask[]> => {
  const tasks = await query((sql) =>
    selectTasks(
      sql,
      sql`t.source_feature = ${sourceFeature} and t.source_id = ${sourceId}
          ${types && types.length > 0 ? sql`and t.task_type = any(${types}::text[])` : sql``}`,
      sql`order by t.created_at desc`
    )
  );
  return tasks.map((t) => ({
    id: t.id,
    type: t.type,
    title: t.title,
    status: t.status,
    assigneeLabel: assigneeLabel(t),
    dueDate: t.dueDate,
    completedAt: t.completedAt,
    completedByName: t.completedByName,
    completionNote: t.completionNote,
  }));
};

// ---- 0.3 読み取り ----

export type TaskViewer = { id: string; roles: readonly Role[] };

// 本人が使える機能キー(機能キーあてのタスクの宛先。CMN-01 の canAccess)
const usableFeatureKeys = (roles: readonly Role[]): FeatureKey[] =>
  (Object.keys(FEATURES) as FeatureKey[]).filter((key) => canAccess(roles, key));

// CH-08 の 1〜3: 担当が本人、本人の区分あて、本人が使える機能キーあて
const mineWhere = (sql: SqlLike, me: TaskViewer) => sql`(
  t.assignee_employee_id = ${me.id}
  or t.assignee_role = any(${[...me.roles]}::text[])
  or t.assignee_feature_key = any(${usableFeatureKeys(me.roles)}::text[])
)`;

// 未完了の自分のタスク。並び順は G01(期限切れ → 今日まで → これから → 期限なし。同じなら急ぎが先、次に作った順)
export const listMyOpenTasks = async (me: TaskViewer): Promise<Task[]> =>
  await query((sql) =>
    selectTasks(
      sql,
      sql`t.status = 'open' and ${mineWhere(sql, me)}`,
      sql`order by t.due_on asc nulls last, (t.priority = 'urgent') desc, t.created_at asc`
    )
  );

// ホームのタイル用: 未完了の件数と、そのうち期限切れ(期限 < 今日)の件数
export const countMyOpenTasks = async (me: TaskViewer): Promise<{ open: number; overdue: number }> => {
  const today = todayJST();
  const rows = await query(
    (sql) => sql<{ open: number; overdue: number }[]>`
      select count(*)::int as open, count(*) filter (where t.due_on < ${today}::date)::int as overdue
      from tasks t where t.status = 'open' and ${mineWhere(sql, me)}`
  );
  return rows[0] ?? { open: 0, overdue: 0 };
};

// CMN-02 の退職の確認用: その人が担当(人あて)の未完了の件数
export const countOpenTasksOfEmployee = async (employeeId: string): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ count: number }[]>`
      select count(*)::int as count from tasks where assignee_employee_id = ${employeeId} and status = 'open'`
  );
  return rows[0]?.count ?? 0;
};

// CH-08 その人がタスクを見る・完了にしてよいか(全員のタスクを使える人〔社長〕も含む)
export const canHandleTask = (
  me: TaskViewer,
  task: Pick<Task, "assigneeEmployeeId" | "assigneeRole" | "assigneeFeatureKey">
): boolean => {
  if (task.assigneeEmployeeId === me.id) return true;
  if (task.assigneeRole && me.roles.includes(task.assigneeRole)) return true;
  if (task.assigneeFeatureKey && isFeatureKey(task.assigneeFeatureKey) && canAccess(me.roles, task.assigneeFeatureKey)) {
    return true;
  }
  return canAccess(me.roles, "tasks_admin");
};

// ---- 画面の操作で使う書き込み(EV-02・EV-04・EV-07) ----

// 未完了のタスクを完了・取消にする。ほかの人が先に閉じていたら false(CH-09。条件に今の状態を入れる)
export const closeTask = async ({
  id,
  status,
  by,
  note,
}: {
  id: string;
  status: "done" | "cancelled";
  by: string;
  note: string | null;
}): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update tasks
      set status = ${status}, completed_at = now(), completed_by = ${by}, completion_note = ${note}, updated_by = ${by}
      where id = ${id} and status = 'open'
      returning id`
  );
  return rows.length > 0;
};

// EV-04 未完了に戻す。完了・取消のものだけ戻せる。同じ発行元の未完了のタスクがほかにあれば重複不可の制約で例外になる(CH-07)
export const reopenTask = async (id: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update tasks
      set status = 'open', completed_at = null, completed_by = null, completion_note = null, updated_by = ${by}
      where id = ${id} and status <> 'open'
      returning id`
  );
  return rows.length > 0;
};
