"use server";

// 経費の承認の操作(E-07 03 EV-13〜EV-15)。機能キー expenses_approve(社長)。
// 承認・差し戻しは G04 のフォーム(FormState でモーダルにエラーを出す)、まとめて承認は G03 から(?error= で戻す)。
// 承認の条件(CH-14)・差し戻しの理由(CH-15)は expenseClaims.ts の計算で確かめる。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { approveBlockers, returnReasonError } from "@/utils/expenseClaims";
import {
  ADMIN_EXPENSES_URL,
  EXPENSES_URL,
  adminExpenseUrl,
  approveExpense,
  approveExpensesBulk,
  getExpense,
  issueReturnedTask,
  listAccountTitles,
  returnExpense,
  syncApproveTask,
} from "@/utils/expenseClaimsServer";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { formText } from "@/utils/textNormalize";
import { safeAdminBack, withMessage } from "./expensesAdminUrl";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CONFLICT = "この経費はほかの人が更新しました。画面を開き直してください。";

const refresh = () => {
  revalidatePath(ADMIN_EXPENSES_URL);
  revalidatePath(EXPENSES_URL);
};

// ---- EV-13 「承認する」・EV-15 「差し戻す」(intent = approve・return) ----

export async function decideExpense(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("expenses_approve", adminExpenseUrl(id));
  const values = formValues(formData);
  const back = safeAdminBack(formText(formData, "back"));
  const expense = await getExpense(id);
  if (!expense) return { errors: {}, formError: "この経費は見つかりません。", values };
  const version = formText(formData, "version");

  if (formData.get("intent") === "return") {
    // EV-15 手順1: CH-15(理由あり)、状態が承認待ち、CH-18
    const reason = formText(formData, "return_reason");
    const reasonError = returnReasonError(reason);
    if (reasonError) return { errors: { return_reason: reasonError }, formError: errorSummary({ return_reason: reasonError }), values };
    if (expense.status !== "submitted") return { errors: {}, formError: "承認待ちの経費ではありません。画面を開き直してください。", values };
    let ok = false;
    try {
      ok = await returnExpense(expense.id, version, reason, me.id);
    } catch (e) {
      console.error("経費を差し戻せませんでした:", e instanceof Error ? e.message : e);
      return { errors: {}, formError: SAVE_FAILED, values };
    }
    if (!ok) return { errors: {}, formError: CONFLICT, values };
    // 手順3: 本人にタスクを出し、承認のタスクをまとめ直す
    await issueReturnedTask(expense, reason);
    await syncApproveTask(expense.submittedOn);
    refresh();
    redirect(withMessage(back, { done: "returned" }));
  }

  // EV-13 手順1・2: 勘定科目(直した場合)・ひとこと、CH-14・CH-18
  const titleId = formText(formData, "account_title_id");
  const note = formText(formData, "approve_note") || null;
  const titles = await listAccountTitles();
  const title = titles.find((t) => t.id === titleId);
  const errors = approveBlockers({
    status: expense.status,
    titleId: title?.id ?? null,
    titleActive: title?.isActive ?? false,
    flags: expense.checkFlags,
    note,
  });
  if (errors.status) return { errors: {}, formError: errors.status, values };
  if (Object.keys(errors).length > 0 || !title) return { errors, formError: errorSummary(errors), values };

  // 手順3: 科目を直していれば source = manual
  let ok = false;
  try {
    ok = await approveExpense(expense.id, version, { id: title.id, changed: title.id !== expense.accountTitleId }, note, me.id);
  } catch (e) {
    console.error("経費を承認できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!ok) return { errors: {}, formError: CONFLICT, values };
  // 手順4: 同じタスクにまとめた申請が全部終わったら完了にする
  await syncApproveTask(expense.submittedOn);
  refresh();
  redirect(withMessage(back, { done: "approved" }));
}

// ---- EV-14 「選んだものを承認する」(問題なしのタブ) ----

export async function approveSelectedExpenses(formData: FormData): Promise<void> {
  const me = await requireAccess("expenses_approve", ADMIN_EXPENSES_URL);
  const back = safeAdminBack(formText(formData, "back"));
  // 「id:version」の並び
  const items = formData
    .getAll("item")
    .filter((v): v is string => typeof v === "string")
    .map((v) => {
      const [id, version] = v.split(":");
      return { id: id ?? "", version: version ?? "" };
    })
    .filter((i) => i.id && i.version);
  if (items.length === 0) redirect(withMessage(back, { error: "none" }));

  // 手順2: 全件について CH-14(印が無いこと、勘定科目があること)。1件でもだめなら全部やめ、どれがだめかを出す
  const titles = await listAccountTitles();
  const loaded = [];
  const blocked: string[] = [];
  for (const item of items) {
    const e = await getExpense(item.id);
    if (!e) {
      blocked.push("見つからない経費");
      continue;
    }
    const title = titles.find((t) => t.id === e.accountTitleId);
    const errors = approveBlockers({
      status: e.status,
      titleId: title?.id ?? null,
      titleActive: title?.isActive ?? false,
      flags: e.checkFlags,
      note: null,
    });
    if (Object.keys(errors).length > 0) blocked.push(`${e.applicantLastName} ${e.payeeName ?? ""}`.trim());
    loaded.push(e);
  }
  if (blocked.length > 0) redirect(withMessage(back, { error: "bulk", detail: blocked.slice(0, 10).join("、") }));

  // 手順3: まとめて承認する(1つのトランザクション)
  let ok = false;
  try {
    ok = await approveExpensesBulk(items, me.id);
  } catch (e) {
    console.error("経費をまとめて承認できませんでした:", e instanceof Error ? e.message : e);
    redirect(withMessage(back, { error: "failed" }));
  }
  if (!ok) redirect(withMessage(back, { error: "conflict" }));
  for (const day of new Set(loaded.map((e) => e.submittedOn))) await syncApproveTask(day);
  refresh();
  // 手順4
  redirect(withMessage(back, { done: "bulk", detail: String(items.length) }));
}
