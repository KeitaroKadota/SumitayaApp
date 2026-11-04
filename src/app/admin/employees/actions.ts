"use server";

// 従業員マスタの操作(CMN-02 EV-02・EV-04〜EV-06)。社長だけが使える(機能キー employees)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { formText, isValidDateStr } from "@/utils/textNormalize";
import {
  countOtherActivePresidents,
  emailUsedByOthers,
  getEmployeeDetail,
  insertEmployee,
  isUuid,
  reinstateEmployee,
  retireEmployee,
  updateEmployee,
} from "./employeeData";
import { validateEmployeeForm } from "./employeeValidation";

const LIST_URL = "/admin/employees";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// 同時に同じ番号・IDを登録した場合の重複のエラー(EV-02 手順5)
const uniqueErrors = (e: unknown): Record<string, string> | null => {
  if (isUniqueViolation(e, "employees_employee_code_key"))
    return { employee_code: "この社員番号は、ほかの従業員が使っています。" };
  if (isUniqueViolation(e, "employees_login_id_key")) return { login_id: "このログインIDは、ほかの従業員が使っています。" };
  return null;
};

// EV-02 「登録する」(G02)
export async function createEmployee(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("employees", `${LIST_URL}/new`);
  const values = formValues(formData);

  const result = await validateEmployeeForm(formData, null);
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  let id: string;
  try {
    id = await insertEmployee(result.input, me.id);
  } catch (e) {
    const errors = uniqueErrors(e);
    if (errors) return { errors, formError: errorSummary(errors), values };
    console.error("従業員を登録できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // CH-04 同じメールアドレスのほかの従業員がいれば、画面に注意を出す(保存は止めない)
  const warn = result.input.email && (await emailUsedByOthers(result.input.email, id)) ? "&warn=email_dup" : "";
  revalidatePath(LIST_URL);
  redirect(`${detailUrl(id)}?created=1${warn}`);
}

// EV-04 「保存する」(G03)。基本情報・ログインID・権限をまとめて保存する
export async function saveEmployee(employeeId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("employees", detailUrl(employeeId));
  const values = formValues(formData);

  const current = await getEmployeeDetail(employeeId);
  if (!current) return { errors: {}, formError: "この従業員は見つかりません。", values };
  // 手順2: 退職者は保存しない
  if (!current.isActive)
    return { errors: {}, formError: "退職者は編集できません。在籍に戻してから編集してください。", values };

  const result = await validateEmployeeForm(formData, { id: current.id, homeLocationId: current.homeLocationId });
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  // CMN-01 CH-14: この人が社長でなくなる(またはログインIDが無くなる)なら、ほかに在籍中の社長が1人以上いること
  const wasPresident = current.roles.includes("president") && current.loginId !== null;
  const remainsPresident = result.input.roles.includes("president") && result.input.loginId !== null;
  if (wasPresident && !remainsPresident && (await countOtherActivePresidents(current.id)) === 0) {
    const errors = { roles: "在籍中の社長が1人もいなくなるため、社長の権限・ログインIDは外せません。" };
    return { errors, formError: errorSummary(errors), values };
  }

  try {
    await updateEmployee(current.id, result.input, me.id);
  } catch (e) {
    const errors = uniqueErrors(e);
    if (errors) return { errors, formError: errorSummary(errors), values };
    console.error("従業員を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  const warn = result.input.email && (await emailUsedByOthers(result.input.email, current.id)) ? "&warn=email_dup" : "";
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  // 自分の社長の権限を外したときは、この画面を開けなくなる(G06 権限がありません)
  redirect(`${detailUrl(current.id)}?saved=1${warn}`);
}

// EV-05 「退職を登録する」(G03)。確認のダイアログは画面で出す
export async function retireEmployeeAction(employeeId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("employees", detailUrl(employeeId));
  const values = formValues(formData);
  if (!isUuid(employeeId)) return { errors: {}, formError: "この従業員は見つかりません。", values };

  const current = await getEmployeeDetail(employeeId);
  if (!current) return { errors: {}, formError: "この従業員は見つかりません。", values };
  if (!current.isActive) return { errors: {}, formError: "この従業員はすでに退職しています。", values };

  // CH-06 退職日(空なら今日)。入社日と同じか後
  const retiredOn = formText(formData, "retired_on") || todayJST();
  if (!isValidDateStr(retiredOn)) {
    const errors = { retired_on: "退職日を正しい日付で入力してください。" };
    return { errors, formError: null, values };
  }
  if (current.hiredOn && retiredOn < current.hiredOn) {
    const errors = { retired_on: "退職日は入社日より後の日付にしてください。" };
    return { errors, formError: null, values };
  }

  // CMN-01 CH-14: 最後の社長は退職にできない
  if (current.roles.includes("president") && current.loginId && (await countOtherActivePresidents(current.id)) === 0) {
    return { errors: {}, formError: "在籍中の社長が1人もいなくなるため、退職を登録できません。", values };
  }

  try {
    // LINE の結び付けは消さない。未完了のタスクは自動では変えない(EV-05 手順5・6)
    await retireEmployee(current.id, retiredOn, me.id);
  } catch (e) {
    console.error("退職を登録できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=retired`);
}

// EV-06 「在籍に戻す」(G03)
export async function reinstateEmployeeAction(employeeId: string): Promise<void> {
  const me = await requireAccess("employees", detailUrl(employeeId));
  const current = await getEmployeeDetail(employeeId);
  if (!current) redirect(LIST_URL);
  if (!current.isActive) await reinstateEmployee(current.id, me.id);

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=reinstated`);
}
