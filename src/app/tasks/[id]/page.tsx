import { redirect } from "next/navigation";
import { fullName, requireAccess } from "@/utils/auth";
import { formatDate, formatDateTime } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { canHandleTask, getTask } from "@/utils/tasks";
import { TASK_STATUS_LABELS, assigneeLabel, taskTypeInfo, taskTypeLabel } from "@/utils/taskTypes";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { completeTaskFromDetail, reopenTaskFromDetail } from "../actions";
import { TaskCompleteForm, TaskReopenForm } from "../TaskDetailForms";

// 期限を過ぎた日数(期限・今日とも YYYY-MM-DD)
const daysPast = (dueDate: string, today: string): number =>
  Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000);

// 担当の区切り(人・区分・機能キーのどれあてか)
const assigneeKind = (task: { assigneeRole: unknown; assigneeFeatureKey: unknown }) =>
  task.assigneeRole ? "区分あて" : task.assigneeFeatureKey ? "機能キーあて" : "人あて";

// G02 タスクの詳細(スマホ。CMN-03 EV-03)
export default async function TaskDetailPage({ params, searchParams }: PageProps<"/tasks/[id]">) {
  const { id } = await params;
  // 手順1
  const me = await requireAccess("tasks", `/tasks/${id}`);
  const query = await searchParams;

  // 手順2
  const task = await getTask(id);
  if (task && !canHandleTask(me, task)) redirect("/no-permission");

  const today = todayJST();

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href="/tasks" label="一覧へ" />
        </div>
        {!task ? (
          <Alert tone="error">このタスクは見つかりません。</Alert>
        ) : (
          <>
            <h1 className="text-xl font-bold break-words">{task.title}</h1>
            {query.done === "1" && <Alert tone="success">完了にしました。</Alert>}
            {query.reopened === "1" && <Alert tone="success">未完了に戻しました。</Alert>}

            <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-ink-muted">状態</dt>
              <dd className="flex flex-wrap gap-2">
                <Badge tone={task.status === "open" ? "warning" : "neutral"}>{TASK_STATUS_LABELS[task.status]}</Badge>
                {task.priority === "urgent" && <Badge tone="danger">急ぎ</Badge>}
              </dd>
              <dt className="text-ink-muted">種類</dt>
              <dd>{taskTypeLabel(task.type)}</dd>
              <dt className="text-ink-muted">担当</dt>
              <dd className="break-words">
                {assigneeLabel(task)}（{assigneeKind(task)}）
              </dd>
              <dt className="text-ink-muted">期限</dt>
              <dd className="tabular-nums">
                {task.dueDate ? formatDate(task.dueDate) : "なし"}
                {task.status === "open" && task.dueDate && task.dueDate < today && (
                  <span className="text-danger">（{daysPast(task.dueDate, today)}日過ぎています）</span>
                )}
              </dd>
              <dt className="text-ink-muted">作成</dt>
              <dd className="tabular-nums">
                {formatDateTime(task.createdAt)}（{task.createdByName ?? "自動"}）
              </dd>
            </dl>

            {task.body && (
              <p className="rounded-lg border border-line bg-surface p-4 text-sm break-words whitespace-pre-wrap">
                {task.body}
              </p>
            )}

            {task.linkUrl && (
              <LinkButton href={task.linkUrl} size="lg" className="w-full">
                元の画面を開く
              </LinkButton>
            )}

            {task.status === "open" ? (
              taskTypeInfo(task.type).manualComplete ? (
                <TaskCompleteForm action={completeTaskFromDetail.bind(null, task.id)} />
              ) : (
                <p className="text-sm text-ink-muted">元の画面で対応すると自動で完了になります</p>
              )
            ) : (
              <>
                {/* 手順3: 完了・取消なら、完了した人・時刻・ひとことを出す */}
                <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-2 text-sm">
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
                </dl>
                <TaskReopenForm action={reopenTaskFromDetail.bind(null, task.id)} />
              </>
            )}
          </>
        )}
      </main>
    </>
  );
}
