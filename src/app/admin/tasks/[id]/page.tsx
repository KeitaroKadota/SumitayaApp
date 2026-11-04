import { requireAccess } from "@/utils/auth";
import { formatDate, formatDateTime } from "@/utils/format";
import { listActiveEmployees } from "@/utils/masters";
import { FEATURES, ROLES, ROLE_LABELS, type FeatureKey } from "@/utils/permissions";
import { getTask } from "@/utils/tasks";
import { TASK_STATUS_LABELS, assigneeLabel, taskTypeInfo, taskTypeLabel } from "@/utils/taskTypes";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { closeTaskByAdmin, reopenTaskByAdmin, saveTaskAssignment } from "../actions";
import { listTaskNotificationLogs } from "../taskAdminData";
import { TaskAdminReopenForm, TaskAssignmentForm, TaskCloseForm } from "../TaskAdminForms";

const SAVED_MESSAGES: Record<string, string> = {
  "1": "保存しました。",
  done: "完了にしました。",
  cancelled: "取り消しました。",
  reopened: "未完了に戻しました。",
};

const KIND_LABELS: Record<string, string> = {
  task_created: "すぐの通知",
  task_digest: "まとめ通知",
  test: "テスト",
  linked: "連携",
  other: "その他",
};
const LOG_STATUS_LABELS: Record<string, string> = { sent: "送信済", failed: "失敗", skipped: "送らなかった" };
const SKIP_REASON_LABELS: Record<string, string> = {
  not_linked: "未連携",
  inactive: "退職",
  disabled: "送信オフ",
  daily_limit: "1日の上限",
};

// G04 タスクの詳細・編集(管理、PC。CMN-03 EV-04・EV-06・EV-07)
export default async function AdminTaskDetailPage({ params, searchParams }: PageProps<"/admin/tasks/[id]">) {
  const { id } = await params;
  await requireAccess("tasks_admin", `/admin/tasks/${id}`);
  const query = await searchParams;

  const task = await getTask(id);
  if (!task) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/tasks" label="一覧へ" />
        </div>
        <Alert tone="error">このタスクは見つかりません。</Alert>
      </div>
    );
  }

  const employees = await listActiveEmployees();
  const logs = await listTaskNotificationLogs(task.id);
  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;
  const info = taskTypeInfo(task.type);

  // 担当の人の選択肢は在籍中の人だけ(今の担当が退職者なら未選択にし、選び直してもらう。CH-03)
  const employeeOptions = employees.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }));
  const featureOptions = (Object.keys(FEATURES) as FeatureKey[]).map((k) => ({
    value: k,
    label: `${FEATURES[k].label}（${k}）`,
  }));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/tasks" label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold break-words">{task.title}</h1>
        <Badge tone={task.status === "open" ? "warning" : "neutral"}>{TASK_STATUS_LABELS[task.status]}</Badge>
        {task.priority === "urgent" && <Badge tone="danger">急ぎ</Badge>}
      </div>
      {saved && <Alert tone="success">{saved}</Alert>}

      <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-ink-muted">種類</dt>
          <dd>{taskTypeLabel(task.type)}</dd>
          <dt className="text-ink-muted">作成</dt>
          <dd className="tabular-nums">
            {formatDateTime(task.createdAt)}（{task.createdByName ?? "自動"}）
          </dd>
          <dt className="text-ink-muted">担当</dt>
          <dd>
            {assigneeLabel(task)}
            {task.assigneeActive === false && "（退職）"}
          </dd>
          <dt className="text-ink-muted">期限</dt>
          <dd className="tabular-nums">{task.dueDate ? formatDate(task.dueDate) : "なし"}</dd>
          {task.body && (
            <>
              <dt className="text-ink-muted">内容</dt>
              <dd className="break-words whitespace-pre-wrap">{task.body}</dd>
            </>
          )}
          {task.status !== "open" && (
            <>
              <dt className="text-ink-muted">{TASK_STATUS_LABELS[task.status]}</dt>
              <dd className="tabular-nums">
                {task.completedAt ? formatDateTime(task.completedAt) : "—"}（{task.completedByName ?? "自動"}）
              </dd>
              {task.completionNote && (
                <>
                  <dt className="text-ink-muted">ひとこと</dt>
                  <dd className="break-words whitespace-pre-wrap">{task.completionNote}</dd>
                </>
              )}
            </>
          )}
        </dl>
        {task.linkUrl && (
          <div>
            <LinkButton href={task.linkUrl}>元の画面を開く</LinkButton>
          </div>
        )}
      </section>

      {task.status === "open" ? (
        <>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">担当・期限</h2>
            <TaskAssignmentForm
              action={saveTaskAssignment.bind(null, task.id)}
              initial={{
                kind: task.assigneeRole ? "role" : task.assigneeFeatureKey ? "feature" : "employee",
                employeeId: task.assigneeActive ? (task.assigneeEmployeeId ?? "") : "",
                role: task.assigneeRole ?? "",
                featureKey: task.assigneeFeatureKey ?? "",
                dueDate: task.dueDate ?? "",
                urgent: task.priority === "urgent",
              }}
              employees={employeeOptions}
              roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
              featureKeys={featureOptions}
            />
          </section>
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">完了・取消</h2>
            {!info.manualComplete && (
              <p className="text-sm text-ink-muted">この種類は、元の画面で対応すると自動で完了になります。</p>
            )}
            <TaskCloseForm action={closeTaskByAdmin.bind(null, task.id)} manualComplete={info.manualComplete} />
          </section>
        </>
      ) : (
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
          <TaskAdminReopenForm action={reopenTaskByAdmin.bind(null, task.id)} />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-bold">通知の記録</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-ink-muted">このタスクのすぐの通知の記録はありません（毎朝のまとめ通知は人ごとに記録しています）。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm tabular-nums">
            {logs.map((l, i) => (
              <li key={i}>
                {formatDateTime(l.createdAt)} {KIND_LABELS[l.kind] ?? l.kind} {l.employeeName ?? "—"}{" "}
                {LOG_STATUS_LABELS[l.status]}
                {l.skipReason && `（${SKIP_REASON_LABELS[l.skipReason] ?? l.skipReason}）`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
