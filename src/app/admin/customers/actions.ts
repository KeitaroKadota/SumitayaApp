"use server";

// 取引先マスタの操作(CMN-02 EV-15・EV-16)。機能キー customers(社長・経理)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import {
  CUSTOMER_TYPES,
  HONORIFICS,
  MAX_TRANSFER_TEXT,
  type CustomerType,
  type Honorific,
} from "@/utils/masterRules";
import { parsePartnerCommon } from "@/utils/partnerRules";
import { formText, hiraganaToKatakana } from "@/utils/textNormalize";
import { customerCodeTaken, getCustomer, insertCustomer, setCustomerActive, updateCustomer, type CustomerInput } from "./customerData";

const LIST_URL = "/admin/customers";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CODE_TAKEN = "このコードは、ほかの取引先が使っています。";

// CH-34 振込名義: 半角カナは全角カナに、ひらがなはカタカナに直す。全角の括弧(NFKC で半角になる)は全角に戻す
const normalizePayerName = (value: string): string =>
  hiraganaToKatakana(value.normalize("NFKC"))
    .replace(/\(/g, "（")
    .replace(/\)/g, "）")
    .trim();
const PAYER_NAME_PATTERN = /^[ァ-ヺー\s（）、]+$/;

// EV-15 手順2・3(取引先): CH-15〜CH-18・CH-34
const validate = async (
  formData: FormData,
  excludeId: string | null
): Promise<{ ok: true; input: CustomerInput } | { ok: false; errors: Record<string, string> }> => {
  const errors: Record<string, string> = {};
  const common = parsePartnerCommon(formData, "customer_code", errors);

  const honorific = formText(formData, "honorific");
  if (!(HONORIFICS as readonly string[]).includes(honorific)) errors.honorific = "敬称を選んでください。";
  const customerType = formText(formData, "customer_type");
  if (!(customerType in CUSTOMER_TYPES)) errors.customer_type = "種別を選んでください。";

  const payerNameKana = normalizePayerName(formText(formData, "payer_name_kana"));
  if (payerNameKana && !PAYER_NAME_PATTERN.test(payerNameKana))
    errors.payer_name_kana = "振込名義はカタカナで入力してください。";
  else if (payerNameKana.length > MAX_TRANSFER_TEXT)
    errors.payer_name_kana = `振込名義は${MAX_TRANSFER_TEXT}文字以内で入力してください。`;

  if (common.code && !errors.customer_code && (await customerCodeTaken(common.code, excludeId)))
    errors.customer_code = CODE_TAKEN;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    input: {
      ...common,
      honorific: honorific as Honorific,
      customerType: customerType as CustomerType,
      payerNameKana: payerNameKana || null,
    },
  };
};

// EV-15 「保存する」(G10)。customerId が null なら新規
export async function saveCustomer(customerId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("customers", customerId ? detailUrl(customerId) : `${LIST_URL}/new`);
  const values = formValues(formData);

  const current = customerId ? await getCustomer(customerId) : null;
  if (customerId && !current) return { errors: {}, formError: "この取引先は見つかりません。", values };

  const result = await validate(formData, current?.id ?? null);
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  let id: string;
  try {
    if (current) {
      await updateCustomer(current.id, result.input, me.id);
      id = current.id;
    } else {
      id = await insertCustomer(result.input, me.id);
    }
  } catch (e) {
    if (isUniqueViolation(e, "customers_customer_code_key")) {
      const errors = { customer_code: CODE_TAKEN };
      return { errors, formError: errorSummary(errors), values };
    }
    console.error("取引先を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
  redirect(`${detailUrl(id)}?saved=1`);
}

// EV-16 「取引をやめる」「取引中に戻す」(G10)
export async function setCustomerActiveAction(customerId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("customers", detailUrl(customerId));
  const current = await getCustomer(customerId);
  if (!current) redirect(LIST_URL);
  const isActive = formData.get("is_active") === "1";
  await setCustomerActive(current.id, isActive, me.id);

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=${isActive ? "activated" : "deactivated"}`);
}
