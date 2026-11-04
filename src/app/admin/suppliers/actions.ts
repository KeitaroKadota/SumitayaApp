"use server";

// 仕入先マスタの操作(CMN-02 EV-15・EV-16)。機能キー suppliers(社長・店舗・経理)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import {
  MAX_OCR_HINT,
  MAX_SUPPLIER_ALIASES,
  MAX_TEXT,
  MAX_TRANSFER_TEXT,
  ORDER_METHODS,
  PAYMENT_METHODS,
  type OrderMethod,
  type PaymentMethod,
} from "@/utils/masterRules";
import { parsePartnerCommon, parsePhoneField } from "@/utils/partnerRules";
import { parseLeadTimeDays } from "@/utils/productRules";
import { formText, toHalfWidth } from "@/utils/textNormalize";
import { getSupplier, insertSupplier, setSupplierActive, supplierCodeTaken, updateSupplier, type SupplierInput } from "./supplierData";

const LIST_URL = "/admin/suppliers";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CODE_TAKEN = "このコードは、ほかの仕入先が使っています。";

// EV-15 手順2・3(仕入先): CH-15〜CH-19・CH-31〜CH-33
const validate = async (
  formData: FormData,
  excludeId: string | null
): Promise<{ ok: true; input: SupplierInput; warnings: string[] } | { ok: false; errors: Record<string, string> }> => {
  const errors: Record<string, string> = {};
  const common = parsePartnerCommon(formData, "supplier_code", errors);
  const fax = parsePhoneField(formData, "fax", "FAX", errors);

  // CH-33 別名: 「、」で分け、それぞれ1〜100文字・10件まで。同じ別名は1つにまとめる
  const aliases = [
    ...new Set(
      formText(formData, "aliases")
        .split("、")
        .map((a) => a.trim())
        .filter(Boolean)
    ),
  ];
  if (aliases.length > MAX_SUPPLIER_ALIASES) errors.aliases = `別名は${MAX_SUPPLIER_ALIASES}件までにしてください。`;
  else if (aliases.some((a) => a.length > MAX_TEXT)) errors.aliases = `別名は1つ${MAX_TEXT}文字以内で入力してください。`;

  const orderMethod = formText(formData, "order_method");
  if (orderMethod && !(orderMethod in ORDER_METHODS)) errors.order_method = "発注方法を選び直してください。";

  // CH-19 届くまでの日数
  const lead = parseLeadTimeDays(formText(formData, "lead_time_days"));
  if (!lead.ok) errors.lead_time_days = lead.error;

  // CH-31 登録番号: 全角を半角に、英字を大文字にして T＋数字13けた
  const registrationNo = toHalfWidth(formText(formData, "registration_no")).replace(/\s/g, "").toUpperCase();
  if (registrationNo && !/^T\d{13}$/.test(registrationNo))
    errors.registration_no = "登録番号は T と13けたの数字で入力してください（例: T1234567890123）。";

  // CH-32 支払方法・振込先
  const paymentMethod = formText(formData, "payment_method");
  if (paymentMethod && !(paymentMethod in PAYMENT_METHODS)) errors.payment_method = "支払方法を選び直してください。";
  const transferTo = formText(formData, "transfer_to");
  if (transferTo.length > MAX_TRANSFER_TEXT) errors.transfer_to = `振込先は${MAX_TRANSFER_TEXT}文字以内で入力してください。`;

  // CH-33 読み取りの注意
  const ocrHint = formText(formData, "ocr_hint");
  if (ocrHint.length > MAX_OCR_HINT) errors.ocr_hint = `読み取りの注意は${MAX_OCR_HINT}文字以内で入力してください。`;

  // CH-16 コードの重複
  if (common.code && !errors.supplier_code && (await supplierCodeTaken(common.code, excludeId)))
    errors.supplier_code = CODE_TAKEN;

  if (Object.keys(errors).length > 0 || !lead.ok) return { ok: false, errors };

  // CH-32 振込で振込先が空なら注意(保存は止めない)
  const warnings = paymentMethod === "transfer" && !transferTo ? ["transfer_to"] : [];
  return {
    ok: true,
    warnings,
    input: {
      ...common,
      aliases,
      fax,
      orderMethod: (orderMethod || null) as OrderMethod | null,
      leadTimeDays: lead.value,
      registrationNo: registrationNo || null,
      paymentMethod: (paymentMethod || null) as PaymentMethod | null,
      transferTo: transferTo || null,
      ocrHint: ocrHint || null,
    },
  };
};

// EV-15 「保存する」(G08)。supplierId が null なら新規
export async function saveSupplier(supplierId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("suppliers", supplierId ? detailUrl(supplierId) : `${LIST_URL}/new`);
  const values = formValues(formData);

  const current = supplierId ? await getSupplier(supplierId) : null;
  if (supplierId && !current) return { errors: {}, formError: "この仕入先は見つかりません。", values };

  const result = await validate(formData, current?.id ?? null);
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  let id: string;
  try {
    if (current) {
      await updateSupplier(current.id, result.input, me.id);
      id = current.id;
    } else {
      id = await insertSupplier(result.input, me.id);
    }
  } catch (e) {
    if (isUniqueViolation(e, "suppliers_supplier_code_key")) {
      const errors = { supplier_code: CODE_TAKEN };
      return { errors, formError: errorSummary(errors), values };
    }
    console.error("仕入先を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
  redirect(`${detailUrl(id)}?saved=1${result.warnings.length > 0 ? "&warn=transfer_to" : ""}`);
}

// EV-16 「取引をやめる」「取引中に戻す」(G08)。CH-29 の確認は画面のダイアログで出す
export async function setSupplierActiveAction(supplierId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("suppliers", detailUrl(supplierId));
  const current = await getSupplier(supplierId);
  if (!current) redirect(LIST_URL);
  const isActive = formData.get("is_active") === "1";
  // 商品の「主な仕入先」はそのまま(表示に「取引終了」と出す)
  await setSupplierActive(current.id, isActive, me.id);

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=${isActive ? "activated" : "deactivated"}`);
}
