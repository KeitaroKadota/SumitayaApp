"use server";

// 経費の申請の操作(E-07 03 EV-02・EV-03・EV-05・EV-07〜EV-10)。機能キー expenses_apply(全員)。本人の経費だけ(CH-02)。
// 操作はエラーを投げずに画面へ文で返す(入力のある操作は FormState、ボタンだけの操作は ?error= で G02 に戻す)。
// みるきーの src/app/expenses/actions.ts の作り(エラーを返す形、書く直前に読み直す、updated_at による衝突の確認)を流用した。
// AIは読み取りと勘定科目の案だけ。検算・二重計上・規程の確認は expenseClaims.ts の計算で行う。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess, type CurrentEmployee } from "@/utils/auth";
import {
  amountsFromReceipt,
  flagCodesOf,
  normalizeAiReceipt,
  parseExpenseForm,
  payeeKeyOf,
  runExpenseChecks,
  type AccountTitle,
} from "@/utils/expenseClaims";
import {
  EXPENSES_URL,
  applyReceiptRead,
  completeReturnedTask,
  deleteDraft,
  estimateAccountTitle,
  expenseUrl,
  findDuplicate,
  getOwnExpense,
  insertDraft,
  isCurrentVersion,
  isReceiptFileUsable,
  listAccountTitles,
  readReceiptWithAi,
  replaceReceipt,
  syncApproveTask,
  withdrawReturned,
  withdrawToDraft,
  writeExpense,
  type WriteTitle,
} from "@/utils/expenseClaimsServer";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { deleteFile } from "@/utils/storage";
import { formText } from "@/utils/textNormalize";
import { aiFailCode } from "./expensesView";

const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CONFLICT = "この経費はほかの人が更新しました。画面を開き直してください。";
const NOT_FOUND = "この経費は見つかりません。";
const FILE_UNUSABLE = "この写真は使えません。もう一度撮影してください。";

const refresh = (id?: string) => {
  revalidatePath(EXPENSES_URL);
  revalidatePath("/admin/expenses");
  if (id) revalidatePath(expenseUrl(id));
};

// 0.1・0.2 読み取って、勘定科目を推定し、経費に入れる。読めなかったときは理由のコード(?ai=)を返す
const readAndApply = async (id: string, fileId: string, me: CurrentEmployee, titles: AccountTitle[]): Promise<string | null> => {
  const ai = await readReceiptWithAi(id, fileId, titles, me.id);
  if (!ai.ok) return aiFailCode(ai.reason);
  const normalized = normalizeAiReceipt(
    ai.data,
    titles.filter((t) => t.isActive).map((t) => t.name)
  );
  if (!normalized) return "failed";
  try {
    const payeeKey = payeeKeyOf(normalized.values.payeeName);
    const estimate = await estimateAccountTitle(
      payeeKey,
      { titleName: normalized.titleName, titleReason: normalized.titleReason, itemsText: normalized.values.itemsText },
      titles,
      id
    );
    await applyReceiptRead(
      id,
      me.id,
      { values: normalized.values, amounts: amountsFromReceipt(normalized.values), payeeKey, raw: ai.data, requestId: ai.requestId },
      estimate
    );
    return null;
  } catch (e) {
    console.error("読み取った内容を保存できませんでした:", e instanceof Error ? e.message : e);
    return "failed";
  }
};

// ---- EV-02 「領収書を撮影する」: 保存した画像で下書きを作り、読み取る ----

export async function createExpenseFromReceipt(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("expenses_apply", `${EXPENSES_URL}/new`);
  const values = formValues(formData);
  // 手順2・3(CH-03 はファイルの送り先で確かめ済み): 本人が上げた領収書の画像で、まだ使われていない
  const fileId = formText(formData, "file_id");
  if (!fileId || !(await isReceiptFileUsable(fileId, me.id))) return { errors: {}, formError: FILE_UNUSABLE, values };

  // 手順4: 下書きを作る(申請者＝自分、支払い方の初期値＝現金)
  let id: string;
  try {
    id = await insertDraft({ applicantId: me.id, receiptFileId: fileId });
  } catch (e) {
    console.error("経費の下書きを作れませんでした:", e instanceof Error ? e.message : e);
    await deleteFile(fileId, me.id).catch(() => {});
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // 手順5・6: 読み取り・勘定科目の推定(読めなければ手入力)。手順7 の二重計上の疑いは G02 を開いたときに出す
  const titles = await listAccountTitles();
  const aiFail = await readAndApply(id, fileId, me, titles);

  // 手順8
  refresh(id);
  redirect(`${expenseUrl(id)}${aiFail ? `?ai=${aiFail}` : ""}`);
}

// ---- EV-03 「領収書なしで入力する」 ----

export async function createExpenseWithoutReceipt(): Promise<void> {
  const me = await requireAccess("expenses_apply", EXPENSES_URL);
  let id: string;
  try {
    id = await insertDraft({ applicantId: me.id, receiptFileId: null });
  } catch (e) {
    console.error("経費の下書きを作れませんでした:", e instanceof Error ? e.message : e);
    redirect(`${EXPENSES_URL}?error=failed`);
  }
  refresh(id);
  redirect(expenseUrl(id));
}

// ---- EV-05 「撮り直す」 ----

export async function retakeReceipt(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("expenses_apply", expenseUrl(id));
  const values = formValues(formData);
  const expense = await getOwnExpense(id, me.id);
  if (!expense) return { errors: {}, formError: NOT_FOUND, values };
  // 手順1: 下書き・差し戻しのときだけ
  if (expense.status !== "draft" && expense.status !== "returned")
    return { errors: {}, formError: "この経費は撮り直せません。画面を開き直してください。", values };
  const fileId = formText(formData, "file_id");
  if (!fileId || !(await isReceiptFileUsable(fileId, me.id))) return { errors: {}, formError: FILE_UNUSABLE, values };

  // 手順2: 領収書を置き換え(前の画像は記録として残す)、読み取りの結果を置き換える
  let ok = false;
  try {
    ok = await replaceReceipt(expense.id, me.id, formText(formData, "version"), fileId);
  } catch (e) {
    console.error("領収書を置き換えられませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!ok) return { errors: {}, formError: CONFLICT, values };
  const aiFail = await readAndApply(expense.id, fileId, me, await listAccountTitles());
  refresh(expense.id);
  redirect(`${expenseUrl(expense.id)}${aiFail ? `?ai=${aiFail}` : "?done=reread"}`);
}

// ---- EV-07 「下書きを保存する」・EV-08 「申請する」「直して申請する」(intent = save・submit) ----

export async function saveExpense(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("expenses_apply", expenseUrl(id));
  const values = formValues(formData);
  const mode = formData.get("intent") === "submit" ? "submit" : "draft";

  // 手順1: CH-02、状態が下書き・差し戻し、CH-17
  const expense = await getOwnExpense(id, me.id);
  if (!expense) return { errors: {}, formError: NOT_FOUND, values };
  if (expense.status !== "draft" && expense.status !== "returned")
    return { errors: {}, formError: "この経費は直せません。画面を開き直してください。", values };
  const titles = await listAccountTitles();
  const today = todayJST();
  // 手順2: CH-04〜CH-08・CH-11 の1(申請のときだけ止める)
  const parsed = parseExpenseForm(values, mode, {
    today,
    hasReceipt: expense.receiptFileId !== null,
    titles,
    currentTitleId: expense.accountTitleId,
  });
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };
  const input = { ...parsed.input, payeeKey: payeeKeyOf(parsed.input.payeeName) };

  // EV-06: 推定と違う科目を選んだら手で選んだことにする(理由の文を消す)
  let title: WriteTitle =
    input.accountTitleId === expense.accountTitleId
      ? { id: expense.accountTitleId, source: expense.accountTitleSource, reason: expense.accountTitleReason }
      : input.accountTitleId
        ? { id: input.accountTitleId, source: "manual", reason: null }
        : { id: null, source: null, reason: null };

  let submit: { flags: string[]; duplicateOf: string | null } | null = null;
  try {
    if (mode === "submit") {
      // 手順3: 勘定科目が空なら、もう一度推定する(AIの案は読み取りのときのもの)
      if (!title.id) {
        const ai = expense.aiRaw
          ? normalizeAiReceipt(
              expense.aiRaw,
              titles.filter((t) => t.isActive).map((t) => t.name)
            )
          : null;
        const estimate = await estimateAccountTitle(
          input.payeeKey,
          ai ? { titleName: ai.titleName, titleReason: ai.titleReason, itemsText: input.itemsText } : null,
          titles,
          expense.id
        );
        if (estimate) title = { id: estimate.titleId, source: estimate.source, reason: estimate.reason };
      }
      // 手順4: 0.3 チェックの印
      const duplicate = await findDuplicate({
        id: expense.id,
        receiptFileId: expense.receiptFileId,
        payeeKey: input.payeeKey,
        spentOn: input.spentOn,
        total: input.total,
      });
      const titleName = titles.find((t) => t.id === title.id)?.name ?? null;
      const flags = runExpenseChecks({ ...input, titleName }, today, duplicate);
      submit = { flags: flagCodesOf(flags), duplicateOf: duplicate?.id ?? null };
    }
  } catch (e) {
    console.error("経費を確かめられませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // 手順5: CH-18 を見て書く(差し戻しの理由は経緯として残す)
  let ok = false;
  try {
    ok = await writeExpense(expense.id, me.id, formText(formData, "version"), input, title, submit);
  } catch (e) {
    console.error("経費を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!ok) return { errors: {}, formError: CONFLICT, values };

  // 手順6: 承認者にタスクを出し、差し戻しのタスクを完了にする(失敗しても申請は確定)
  if (submit) {
    const fresh = await getOwnExpense(expense.id, me.id).catch(() => null);
    await syncApproveTask(fresh?.submittedOn ?? today);
    if (expense.status === "returned") await completeReturnedTask(expense.id);
  }

  // 手順7
  refresh(expense.id);
  redirect(`${EXPENSES_URL}?done=${submit ? "submitted" : "saved"}`);
}

// ---- EV-09 「取り下げて直す」(承認待ち → 下書き)・「この申請を取り下げる」(差し戻し → 取り下げ) ----

export async function withdrawExpense(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("expenses_apply", expenseUrl(id));
  const expense = await getOwnExpense(id, me.id);
  if (!expense) redirect(`${EXPENSES_URL}?error=not_found`);
  const version = formText(formData, "version");
  const toDraft = formData.get("intent") === "to_draft";
  if (toDraft ? expense.status !== "submitted" : expense.status !== "returned") redirect(`${expenseUrl(expense.id)}?error=status`);

  let ok = false;
  try {
    ok = toDraft ? await withdrawToDraft(expense.id, me.id, version) : await withdrawReturned(expense.id, me.id, version);
  } catch (e) {
    console.error("経費を取り下げられませんでした:", e instanceof Error ? e.message : e);
    redirect(`${expenseUrl(expense.id)}?error=failed`);
  }
  if (!ok) redirect(`${expenseUrl(expense.id)}?error=conflict`);
  // 承認待ちから戻したときは、承認者のタスクをまとめ直す(残りが無ければ完了)
  if (toDraft) await syncApproveTask(expense.submittedOn);
  refresh(expense.id);
  redirect(toDraft ? `${expenseUrl(expense.id)}?done=to_draft` : `${EXPENSES_URL}?done=withdrawn`);
}

// ---- EV-10 「この下書きを削除する」 ----

export async function deleteExpenseDraft(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("expenses_apply", expenseUrl(id));
  const expense = await getOwnExpense(id, me.id);
  if (!expense) redirect(`${EXPENSES_URL}?error=not_found`);
  // 手順2: 下書きで、一度も申請していないものだけ
  if (expense.status !== "draft" || expense.submittedAt) redirect(`${expenseUrl(expense.id)}?error=status`);
  if (!(await isCurrentVersion(expense.id, formText(formData, "version")))) redirect(`${expenseUrl(expense.id)}?error=conflict`);

  let result: { ok: boolean; fileIds: string[] } = { ok: false, fileIds: [] };
  try {
    result = await deleteDraft(expense.id, me.id, formText(formData, "version"));
    // 領収書のファイルを消す(論理削除。C-01 の共通の保存)
    for (const fileId of result.fileIds) await deleteFile(fileId, me.id);
  } catch (e) {
    console.error("経費の下書きを削除できませんでした:", e instanceof Error ? e.message : e);
    redirect(`${expenseUrl(expense.id)}?error=failed`);
  }
  if (!result.ok) redirect(`${expenseUrl(expense.id)}?error=conflict`);
  refresh();
  redirect(`${EXPENSES_URL}?done=deleted`);
}
