import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { listActiveEmployees } from "@/utils/masters";
import { ROLES, ROLE_LABELS } from "@/utils/permissions";
import {
  TASK_STATUS_LABELS,
  assigneeLabel,
  dueStateOf,
  featureAssigneeLabel,
  taskTypeInfo,
} from "@/utils/taskTypes";
import { Badge } from "@/components/Badge";
import { Checkbox } from "@/components/Checkbox";
import { EmptyState } from "@/components/EmptyState";
import { Field } from "@/components/Field";
import { Pagination } from "@/components/Pagination";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import {
  NOTIFY_COLUMN_LABELS,
  PAGE_SIZE,
  countAllOpenTasks,
  listTasksForAdmin,
  listUsedFeatureKeys,
  listUsedTaskTypes,
  notifyColumnOf,
  parseTaskFilter,
  taskFilterQuery,
} from "./taskAdminData";

// G03 全員のタスク(PC。CMN-03 EV-05)
export default async function AdminTasksPage({ searchParams }: PageProps<"/admin/tasks">) {
  const params = await searchParams;
  const filter = parseTaskFilter(params);
  // 手順1
  await requireAccess("tasks_admin", `/admin/tasks${taskFilterQuery(filter)}`);

  // 手順2(DBの接続1本の決まりのため、順番に読む)
  const { tasks, total } = await listTasksForAdmin(filter);
  const counts = await countAllOpenTasks();
  const activeEmployees = await listActiveEmployees();
  const usedFeatureKeys = await listUsedFeatureKeys();
  const usedTypes = await listUsedTaskTypes();
  const today = todayJST();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">タスク</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="status" label="状態">
          <Select id="status" name="status" defaultValue={filter.status} className="w-36">
            {(["open", "done", "cancelled"] as const).map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="all">すべて</option>
          </Select>
        </Field>
        <Field id="assignee" label="担当">
          <Select id="assignee" name="assignee" defaultValue={filter.assignee} className="w-56">
            <option value="">すべて</option>
            <optgroup label="人（在籍中）">
              {activeEmployees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.lastName} {e.firstName}
                </option>
              ))}
            </optgroup>
            <optgroup label="区分">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </optgroup>
            {usedFeatureKeys.length > 0 && (
              <optgroup label="機能キー">
                {usedFeatureKeys.map((k) => (
                  <option key={k} value={`key:${k}`}>
                    {featureAssigneeLabel(k)}
                  </option>
                ))}
              </optgroup>
            )}
            <option value="retired">退職者が担当</option>
          </Select>
        </Field>
        <Field id="type" label="種類">
          <Select id="type" name="type" defaultValue={filter.type} className="w-48">
            <option value="">すべて</option>
            {usedTypes.map((t) => (
              <option key={t} value={t}>
                {taskTypeInfo(t).label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox name="overdue" value="1" label="期限切れだけ" defaultChecked={filter.overdue} />
        <SubmitButton variant="secondary" pendingText="絞り込み中…">
          絞り込む
        </SubmitButton>
      </form>

      <p className="text-sm tabular-nums">
        未完了 {counts.open}件（期限切れ {counts.overdue}件）
      </p>

      {tasks.length === 0 ? (
        <EmptyState message="当てはまるタスクはまだありません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-3 py-2">急ぎ</th>
                <th className="px-3 py-2">件名</th>
                <th className="px-3 py-2">種類</th>
                <th className="px-3 py-2">担当</th>
                <th className="px-3 py-2">期限</th>
                <th className="px-3 py-2">状態</th>
                <th className="px-3 py-2">通知</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.id} className="border-b border-line last:border-b-0 hover:bg-canvas">
                  <td className="px-3 py-2">{t.priority === "urgent" && <Badge tone="danger">急ぎ</Badge>}</td>
                  <td className="px-3 py-2">
                    <Link href={`/admin/tasks/${t.id}`} className="font-bold break-words text-primary hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{taskTypeInfo(t.type).label}</td>
                  <td className="px-3 py-2">
                    {assigneeLabel(t)}
                    {t.assigneeActive === false && (
                      <span className="ml-1">
                        （退職） <Badge tone="warning">担当を変えてください</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                    {t.dueDate ? formatDateShort(t.dueDate) : "—"}
                    {t.status === "open" && dueStateOf(t.dueDate, today) === "overdue" && (
                      <span className="ml-1">
                        <Badge tone="danger">期限切れ</Badge>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">{TASK_STATUS_LABELS[t.status]}</td>
                  <td className="px-3 py-2">{NOTIFY_COLUMN_LABELS[notifyColumnOf(t, activeEmployees)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        total={total}
        page={filter.page}
        pageSize={PAGE_SIZE}
        hrefOf={(page) => `/admin/tasks${taskFilterQuery(filter, page)}`}
      />
    </div>
  );
}
