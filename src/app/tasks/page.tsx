import Link from "next/link";
import { fullName, requireAccess } from "@/utils/auth";
import { formatDateShort } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { listMyOpenTasks, type Task } from "@/utils/tasks";
import { assigneeLabel, dueStateOf, taskTypeInfo, taskTypeLabel, type DueState } from "@/utils/taskTypes";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { completeTaskFromList } from "./actions";

const SECTIONS: { state: DueState[]; label: string }[] = [
  { state: ["overdue"], label: "期限切れ" },
  { state: ["today"], label: "今日まで" },
  { state: ["future", "none"], label: "これから・期限なし" },
];

const ERROR_MESSAGES: Record<string, string> = {
  cannot: "このタスクは完了にできません。",
  already: "ほかの人がすでに完了にしています。",
};

function TaskCard({ task, today }: { task: Task; today: string }) {
  const manual = taskTypeInfo(task.type).manualComplete;
  const overdue = dueStateOf(task.dueDate, today) === "overdue";
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        {task.priority === "urgent" && <Badge tone="danger">急ぎ</Badge>}
        <Link href={`/tasks/${task.id}`} className="min-w-0 font-bold break-words text-primary hover:underline">
          {task.title}
        </Link>
      </div>
      <p className="text-sm text-ink-muted">{taskTypeLabel(task.type)}</p>
      <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
        期限 {task.dueDate ? formatDateShort(task.dueDate) : "なし"}
        {overdue && <Badge tone="danger">期限切れ</Badge>}
      </p>
      {/* 人あては自分のため担当を出さない(02 の G01) */}
      {!task.assigneeEmployeeId && <p className="text-sm">担当: {assigneeLabel(task)}</p>}
      {manual ? (
        <form action={completeTaskFromList.bind(null, task.id)} className="self-end">
          <SubmitButton variant="secondary" pendingText="保存中…">
            完了
          </SubmitButton>
        </form>
      ) : (
        <p className="text-sm text-ink-muted">元の画面で直すと自動で完了します</p>
      )}
    </li>
  );
}

// G01 自分のタスク(スマホ。CMN-03 EV-01)
export default async function MyTasksPage({ searchParams }: PageProps<"/tasks">) {
  // 手順1
  const me = await requireAccess("tasks", "/tasks");
  const params = await searchParams;
  // 手順2〜4
  const tasks = await listMyOpenTasks(me);
  const today = todayJST();
  const error = typeof params.error === "string" ? ERROR_MESSAGES[params.error] : undefined;

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href="/" label="ホームへ" />
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">自分のタスク</h1>
          <p className="text-sm text-ink-muted tabular-nums">未完了 {tasks.length}件</p>
        </div>
        {params.done === "1" && <Alert tone="success">完了にしました。</Alert>}
        {error && <Alert tone="error">{error}</Alert>}

        {tasks.length === 0 ? (
          <EmptyState message="未完了のタスクはまだありません。" />
        ) : (
          SECTIONS.map((section) => {
            const items = tasks.filter((t) => section.state.includes(dueStateOf(t.dueDate, today)));
            if (items.length === 0) return null;
            return (
              <section key={section.label} className="flex flex-col gap-2">
                <h2 className="text-sm font-bold text-ink-muted">{section.label}</h2>
                <ul className="flex flex-col gap-3">
                  {items.map((task) => (
                    <TaskCard key={task.id} task={task} today={today} />
                  ))}
                </ul>
              </section>
            );
          })
        )}
      </main>
    </>
  );
}
