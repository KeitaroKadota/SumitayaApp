"use server";

// 仕入先の品番の対応表(C-01 G04)の操作(03 EV-12、04 CH-13)。機能キー purchasing(社長・店舗・経理)。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { parseItemCodeForm } from "@/utils/deliverySlipRules";
import { ITEM_CODES_URL, isActiveSupplier, isUuid, saveItemCode } from "@/utils/deliverySlipServer";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { findProductByCode } from "@/utils/masters";
import { formText } from "@/utils/textNormalize";

// 「保存」(id があれば上書き、無ければ新しい行を足す)
export async function saveSupplierItemCode(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("purchasing", ITEM_CODES_URL);
  const values = formValues(formData);
  const supplierId = formText(formData, "supplier_id");
  const id = formText(formData, "id");
  if (!isUuid(supplierId) || (id && !isUuid(id)) || (!id && !(await isActiveSupplier(supplierId))))
    return { errors: {}, formError: "仕入先を選び直してください。", values };

  // CH-13 仕入先・品番・自社の商品は必須。品番は CH-06 と同じようにそろえる。入数は1〜9,999
  const parsed = parseItemCodeForm(values);
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };
  const product = await findProductByCode(parsed.productCode);
  if (!product) {
    const errors = { product_code: `商品コード「${parsed.productCode}」は商品マスタにありません。` };
    return { errors, formError: errorSummary(errors), values };
  }

  try {
    const ok = await saveItemCode({
      id: id || null,
      supplierId,
      supplierItemCode: parsed.supplierItemCode,
      supplierItemName: parsed.supplierItemName,
      productId: product.id,
      packQuantity: parsed.packQuantity,
      isActive: id ? parsed.isActive : true,
      by: me.id,
    });
    if (!ok) return { errors: {}, formError: "この対応は見つかりません。画面を開き直してください。", values };
  } catch (e) {
    // CH-13 同じ仕入先・同じ品番が他にあればだめ
    if (isUniqueViolation(e, "supplier_item_codes_supplier_code_key")) {
      const errors = { supplier_item_code: "この仕入先には、同じ品番の対応がすでにあります。" };
      return { errors, formError: errorSummary(errors), values };
    }
    console.error("品番の対応を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。時間をおいてもう一度お試しください。", values };
  }
  revalidatePath(ITEM_CODES_URL);
  // 新しく足したときは欄を空に戻す
  return { errors: {}, formError: null, values: id ? values : {} };
}
