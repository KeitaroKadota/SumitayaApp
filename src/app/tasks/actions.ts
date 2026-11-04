"use server";

// 自分のタスクの操作(CMN-03 EV-02・EV-04)。機能キー tasks(全員)。
// 想定内のエラーは throw せず、G01 は ?error= で、G02 は戻り値(useActionState)で画面に出す。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { canHandleTask, closeTask, getTask, reopenTask, type Task } from "@/utils/tasks";
import { TASK_NOTE_MAX, taskTypeInfo } from "@/utils/taskTypes";
import type { CurrentEmployee } from "@/utils/auth";

export type TaskActionState = { error: string | null; note: string };

const LIST_URL = "/tasks";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

const CANNOT_COMPLETE = "このタスクは完了にできません。";
const ALREADY_DONE = "ほかの人がすでに完了にしています。";
const NOTE_TOO_LONG = `ひとことは${TASK_NOTE_MAX}文字以内で入力してください。`;
const DUPLICATE_OPEN = "同じ内容の未完了のタスクがすでにあります。";

// EV-02 手順2: CH-08(完了にしてよい人か)・CH-09(未完了か、手で完了にできる種類か)
const checkCompletable = (me: CurrentEmployee, task: Task | null): string | null => {
  if (!task || !canHandleTask(me, task)) return CANNOT_COMPLETE;
  if (task.status !== "open") return ALREADY_DONE;
  if (!taskTypeInfo(task.type).manualComplete) return CANNOT_COMPLETE;
  return null;
};

const revalidateTask = (id: string) => {
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
};

// EV-02 G01 の「完了」(ひとことなし・確認のダイアログなし)
export async function completeTaskFromList(taskId: string) {
  const me = await requireAccess("tasks", LIST_URL);
  const task = await getTask(taskId);
  const error = checkCompletable(me, task);
  if (error) redirect(`${LIST_URL}?error=${error === ALREADY_DONE ? "already" : "cannot"}`);

  const done = await closeTask({ id: taskId, status: "done", by: me.id, note: null });
  if (!done) redirect(`${LIST_URL}?error=already`);
  revalidateTask(taskId);
  redirect(`${LIST_URL}?done=1`);
}

// EV-02 G02 の「完了にする」(ひとこと付き)
export async function completeTaskFromDetail(taskId: string, _prev: TaskActionState, formData: FormData): Promise<TaskActionState> {
  const me = await requireAccess("tasks", detailUrl(taskId));
  const note = String(formData.get("note") ?? "").trim();
  // CH-01 ひとことの長さ
  if (note.length > TASK_NOTE_MAX) return { error: NOTE_TOO_LONG, note };

  const task = await getTask(taskId);
  const error = checkCompletable(me, task);
  if (error) return { error, note };

  const done = await closeTask({ id: taskId, status: "done", by: me.id, note: note || null });
  if (!done) return { error: ALREADY_DONE, note };
  revalidateTask(taskId);
  redirect(`${detailUrl(taskId)}?done=1`);
}

// EV-04 G02 の「未完了に戻す」
export async function reopenTaskFromDetail(taskId: string): Promise<TaskActionState> {
  const me = await requireAccess("tasks", detailUrl(taskId));
  const task = await getTask(taskId);
  // CH-08・CH-09
  if (!task || !canHandleTask(me, task) || task.status === "open") return { error: "このタスクは未完了に戻せません。", note: "" };

  try {
    const reopened = await reopenTask(taskId, me.id);
    if (!reopened) return { error: "このタスクは未完了に戻せません。", note: "" };
  } catch (e) {
    // CH-07 同じ発行元の未完了のタスクがほかにある
    if (isUniqueViolation(e, "tasks_open_source_key")) return { error: DUPLICATE_OPEN, note: "" };
    console.error("タスクを未完了に戻せませんでした:", e instanceof Error ? e.message : e);
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。", note: "" };
  }
  revalidateTask(taskId);
  redirect(`${detailUrl(taskId)}?reopened=1`);
}
