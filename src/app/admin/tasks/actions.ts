"use server";

// 全員のタスク(管理)の操作(CMN-03 EV-04・EV-06・EV-07)。社長だけが使える(機能キー tasks_admin)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { notifyTask } from "@/utils/notify";
import { isRole, type Role } from "@/utils/permissions";
import { closeTask, getTask, reopenTask } from "@/utils/tasks";
import { TASK_NOTE_MAX, isFeatureKey } from "@/utils/taskTypes";
import { formText, isValidDateStr } from "@/utils/textNormalize";
import { isActiveEmployee, updateTaskAssignment } from "./taskAdminData";

const LIST_URL = "/admin/tasks";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const NOT_OPEN = "このタスクは未完了ではないため、変えられません。";

const revalidateTask = (id: string) => {
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
  revalidatePath("/tasks");
};

// EV-06 「変更を保存する」(G04)
export async function saveTaskAssignment(taskId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  // 手順1
  const me = await requireAccess("tasks_admin", detailUrl(taskId));
  const values = formValues(formData);

  const task = await getTask(taskId);
  if (!task) return { errors: {}, formError: "このタスクは見つかりません。", values };
  // CH-09 未完了のタスクだけ変えられる
  if (task.status !== "open") return { errors: {}, formError: NOT_OPEN, values };

  const errors: Record<string, string> = {};
  // CH-02 担当は人・区分・機能キーのちょうど1つ(選んだもの以外は空にする)
  const kind = formText(formData, "assignee_kind");
  let assigneeEmployeeId: string | null = null;
  let assigneeRole: Role | null = null;
  let assigneeFeatureKey: string | null = null;
  if (kind === "employee") {
    const id = formText(formData, "assignee_employee_id");
    // CH-03 担当者が在籍中の従業員
    if (!id) errors.assignee_employee_id = "担当の人を選んでください。";
    else if (!(await isActiveEmployee(id))) errors.assignee_employee_id = "在籍中の従業員を選んでください。";
    else assigneeEmployeeId = id;
  } else if (kind === "role") {
    // CH-04 区分が決まった値
    const role = formText(formData, "assignee_role");
    if (!isRole(role)) errors.assignee_role = "担当の区分を選んでください。";
    else assigneeRole = role;
  } else if (kind === "feature") {
    // CH-04 機能キーが権限表にある
    const key = formText(formData, "assignee_feature_key");
    if (!isFeatureKey(key)) errors.assignee_feature_key = "担当の機能キーを選んでください。";
    else assigneeFeatureKey = key;
  } else {
    errors.assignee_kind = "担当の人・区分・機能キーのどれか1つを選んでください。";
  }

  // CH-05 期限。今日より前は選べない(変えないときは過ぎた期限のままでよい)
  const dueDate = formText(formData, "due_on") || null;
  if (dueDate) {
    if (!isValidDateStr(dueDate)) errors.due_on = "期限は正しい日付で入力してください。";
    else if (dueDate !== task.dueDate && dueDate < todayJST()) errors.due_on = "期限は今日以降にしてください。";
  }
  const priority = formData.get("urgent") === "1" ? "urgent" : "normal";

  if (Object.keys(errors).length > 0) return { errors, formError: errorSummary(errors), values };

  // 手順4: 担当が変わり、急ぎなら、新しい担当にすぐ知らせる
  const assigneeChanged =
    assigneeEmployeeId !== task.assigneeEmployeeId ||
    assigneeRole !== task.assigneeRole ||
    assigneeFeatureKey !== task.assigneeFeatureKey;
  const renotify = assigneeChanged && priority === "urgent";

  try {
    const saved = await updateTaskAssignment({
      id: task.id,
      assigneeEmployeeId,
      assigneeRole,
      assigneeFeatureKey,
      dueDate,
      priority,
      resetNotified: renotify,
      by: me.id,
    });
    if (!saved) return { errors: {}, formError: NOT_OPEN, values };
  } catch (e) {
    console.error("タスクを保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  if (renotify) {
    // 通知の失敗は保存を失敗にしない
    try {
      await notifyTask(task.id);
    } catch (e) {
      console.error("タスクの通知を送れませんでした:", e instanceof Error ? e.message : e);
    }
  }

  revalidateTask(task.id);
  // 手順5
  redirect(`${detailUrl(task.id)}?saved=1`);
}

// EV-07 「完了にする」「取り消す」(G04)。押したボタンの値(status)で決める
export async function closeTaskByAdmin(taskId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("tasks_admin", detailUrl(taskId));
  const values = formValues(formData);
  const status = formData.get("status") === "cancelled" ? "cancelled" : "done";
  const note = formText(formData, "note");
  // CH-01 ひとことの長さ
  if (note.length > TASK_NOTE_MAX) {
    const errors = { note: `ひとことは${TASK_NOTE_MAX}文字以内で入力してください。` };
    return { errors, formError: errorSummary(errors), values };
  }

  // CH-09 未完了か(手で完了にできない種類の確認は画面のダイアログで行う)
  const closed = await closeTask({ id: taskId, status, by: me.id, note: note || null });
  if (!closed) return { errors: {}, formError: "ほかの人がすでに完了にしています。", values };

  revalidateTask(taskId);
  redirect(`${detailUrl(taskId)}?saved=${status}`);
}

// EV-04 「未完了に戻す」(G04)
export async function reopenTaskByAdmin(taskId: string): Promise<FormState> {
  const me = await requireAccess("tasks_admin", detailUrl(taskId));
  try {
    // CH-09 完了・取消のものだけ戻せる
    const reopened = await reopenTask(taskId, me.id);
    if (!reopened) return { errors: {}, formError: "このタスクは未完了に戻せません。", values: {} };
  } catch (e) {
    // CH-07 同じ発行元の未完了のタスクがほかにある
    if (isUniqueViolation(e, "tasks_open_source_key")) {
      return { errors: {}, formError: "同じ内容の未完了のタスクがすでにあります。", values: {} };
    }
    console.error("タスクを未完了に戻せませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values: {} };
  }
  revalidateTask(taskId);
  redirect(`${detailUrl(taskId)}?saved=reopened`);
}
