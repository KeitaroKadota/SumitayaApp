"use server";

// G04 銀行口座の登録・保存(E-06 03 EV-10、04 CH-12)。機能キー receivables(社長・経理)。
// 口座は削除せず「使っている」を外す。口座番号は下4けただけを保存する。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isBankCsvFormat } from "@/utils/bankCsv";
import { MAX_BANK_NAME, MAX_BRANCH_NAME, MAX_SORT_ORDER, isAccountType } from "@/utils/deposits";
import { getBankAccount, saveBankAccount } from "@/utils/depositsServer";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { formText, parseIntInRange, toHalfWidth } from "@/utils/textNormalize";
import { ACCOUNTS_URL, DEPOSITS_URL } from "../depositsUrl";

export async function saveBankAccountAction(id: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("receivables", ACCOUNTS_URL);
  const values = formValues(formData);
  if (id && !(await getBankAccount(id))) return { errors: {}, formError: "この口座は見つかりません。", values };

  // 手順1: CH-12
  const bankName = formText(formData, "bank_name");
  const branchName = formText(formData, "branch_name");
  const accountType = formText(formData, "account_type");
  const last4 = toHalfWidth(formText(formData, "account_number_last4")).replace(/[\s-]/g, "");
  const hasOnlineBanking = formData.get("has_online_banking") === "1";
  const csvFormat = formText(formData, "csv_format");
  const sortOrder = parseIntInRange(formText(formData, "sort_order"), 0, MAX_SORT_ORDER);

  const errors: Record<string, string> = {};
  if (!bankName) errors.bank_name = "銀行名を入力してください。";
  else if (bankName.length > MAX_BANK_NAME) errors.bank_name = `銀行名は${MAX_BANK_NAME}文字以内で入力してください。`;
  if (branchName.length > MAX_BRANCH_NAME) errors.branch_name = `支店名は${MAX_BRANCH_NAME}文字以内で入力してください。`;
  if (!isAccountType(accountType)) errors.account_type = "種類を選んでください。";
  // 4けたより長い番号は保存しない
  if (/^\d{5,}$/.test(last4)) errors.account_number_last4 = "下4けただけを入力してください。";
  else if (!/^\d{4}$/.test(last4)) errors.account_number_last4 = "口座番号の下4けたを数字で入力してください。";
  if (csvFormat && !isBankCsvFormat(csvFormat)) errors.csv_format = "CSVの形を選び直してください。";
  else if (csvFormat && !hasOnlineBanking) errors.csv_format = "ネットバンキングが無い口座には、CSVの形を設定できません。";
  if (sortOrder === "error") errors.sort_order = `並び順は0〜${MAX_SORT_ORDER}の数で入力してください。`;
  if (Object.keys(errors).length > 0) return { errors, formError: errorSummary(errors), values };

  // 手順2: 登録または更新
  try {
    const saved = await saveBankAccount(
      id,
      {
        bankName,
        branchName: branchName || null,
        accountType: accountType as "ordinary" | "current",
        last4,
        hasOnlineBanking,
        csvFormat: csvFormat || null,
        isTarget: formData.get("is_target") === "1",
        sortOrder: typeof sortOrder === "number" ? sortOrder : 0,
        isActive: formData.get("is_active") === "1",
      },
      me.id
    );
    if (!saved) return { errors: {}, formError: "この口座は見つかりません。", values };
  } catch (e) {
    console.error("口座を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。時間をおいてもう一度お試しください。", values };
  }

  // 手順3: 一覧に戻し「保存しました。」
  revalidatePath(ACCOUNTS_URL);
  revalidatePath(DEPOSITS_URL);
  redirect(`${ACCOUNTS_URL}?saved=1`);
}
