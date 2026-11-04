"use server";

// 入金消込の操作(E-06 03 EV-04・EV-06〜EV-09)。機能キー receivables(社長・経理)。
// 結果は G01 の URL(?done=・?error=)で知らせる。G03(モーダル)から送ったときのエラーはモーダルに出す。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { MAX_IGNORE_MEMO, isIgnoreReason } from "@/utils/deposits";
import {
  applyMatch,
  cancelBankImport,
  ignoreDeposit,
  isUuid,
  removeMatch,
  restoreDeposit,
} from "@/utils/depositsServer";
import { formText } from "@/utils/textNormalize";
import { DEPOSITS_URL, depositsUrl, isDepositsTab, isMonthStr, type DepositsQuery } from "./depositsUrl";

// 戻る先(画面を開いていたときのタブ・口座・月)をフォームの隠し項目から読む
const backOf = (formData: FormData): DepositsQuery => {
  const tab = formText(formData, "back_tab");
  const account = formText(formData, "back_account");
  const month = formText(formData, "back_month");
  return {
    tab: isDepositsTab(tab) ? tab : undefined,
    account: isUuid(account) ? account : undefined,
    month: isMonthStr(month) ? month : undefined,
  };
};

const done = (back: DepositsQuery, code: string, detail?: string): never => {
  revalidatePath(DEPOSITS_URL);
  redirect(depositsUrl({ ...back, done: code, detail }));
};

const fail = (back: DepositsQuery, code: string, select?: string): never => redirect(depositsUrl({ ...back, error: code, select }));

// EV-04(G01 の候補の行)・EV-06(G03)「消込する」
export async function matchDepositAction(formData: FormData): Promise<void> {
  const me = await requireAccess("receivables", DEPOSITS_URL);
  const back = backOf(formData);
  const txnId = formText(formData, "txn_id");
  const invoiceId = formText(formData, "invoice_id");
  const version = formText(formData, "version");
  // G03 から送ったときは、エラーをモーダルに出す
  const select = formText(formData, "from") === "modal" && isUuid(txnId) ? txnId : undefined;
  if (!isUuid(invoiceId)) fail(back, "invoice_required", select);

  let result: Awaited<ReturnType<typeof applyMatch>>;
  try {
    // 手順2〜4: 手数料の計算、CH-07・CH-10、0.3 の確定
    result = await applyMatch(txnId, invoiceId, version, me.id);
  } catch (e) {
    console.error("消込を保存できませんでした:", e instanceof Error ? e.message : e);
    return fail(back, "failed", select);
  }
  if (!result.ok) return fail(back, result.reason, select);
  // 手順5: G01 に戻す
  done(back, "matched", result.invoiceNo);
}

// EV-07「外す」(確認のダイアログは画面で出す)
export async function removeMatchAction(formData: FormData): Promise<void> {
  const me = await requireAccess("receivables", DEPOSITS_URL);
  const back = backOf(formData);
  let result: Awaited<ReturnType<typeof removeMatch>>;
  try {
    result = await removeMatch(formText(formData, "txn_id"), formText(formData, "version"), me.id);
  } catch (e) {
    console.error("消込を外せませんでした:", e instanceof Error ? e.message : e);
    return fail(back, "failed");
  }
  if (!result.ok) return fail(back, result.reason === "status" ? "not_matched" : result.reason);
  done(back, "removed");
}

// EV-08 手順1「対象外にする」。理由(必須)は 利息・カード売上・現金の預け入れ・その他 ＋メモ
export async function ignoreDepositAction(formData: FormData): Promise<void> {
  await requireAccess("receivables", DEPOSITS_URL);
  const back = backOf(formData);
  const reason = formText(formData, "reason");
  const memo = formText(formData, "memo");
  if (!isIgnoreReason(reason)) return fail(back, "ignore_reason");
  if (memo.length > MAX_IGNORE_MEMO) return fail(back, "ignore_memo");
  const text = memo ? `${reason}（${memo}）` : reason;
  let result: Awaited<ReturnType<typeof ignoreDeposit>>;
  try {
    result = await ignoreDeposit(formText(formData, "txn_id"), text);
  } catch (e) {
    console.error("対象外にできませんでした:", e instanceof Error ? e.message : e);
    return fail(back, "failed");
  }
  if (!result.ok) return fail(back, result.reason);
  done(back, "ignored");
}

// EV-08 手順2「未消込に戻す」
export async function restoreDepositAction(formData: FormData): Promise<void> {
  await requireAccess("receivables", DEPOSITS_URL);
  const back = backOf(formData);
  let result: Awaited<ReturnType<typeof restoreDeposit>>;
  try {
    result = await restoreDeposit(formText(formData, "txn_id"));
  } catch (e) {
    console.error("未消込に戻せませんでした:", e instanceof Error ? e.message : e);
    return fail(back, "failed");
  }
  if (!result.ok) return fail(back, result.reason);
  done(back, "restored");
}

// EV-09「取り込みを取り消す」(確認のダイアログは画面で出す)
export async function cancelImportAction(formData: FormData): Promise<void> {
  const me = await requireAccess("receivables", DEPOSITS_URL);
  const back = backOf(formData);
  let result: Awaited<ReturnType<typeof cancelBankImport>>;
  try {
    result = await cancelBankImport(formText(formData, "batch_id"), me.id);
  } catch (e) {
    console.error("取り込みを取り消せませんでした:", e instanceof Error ? e.message : e);
    return fail(back, "failed");
  }
  if (!result.ok) return fail(back, result.reason === "matched" ? "import_matched" : "import_not_found");
  done(back, "import_cancelled", String(result.deleted));
}
