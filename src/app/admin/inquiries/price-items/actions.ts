"use server";

// 特注の概算の単価表の保存(D-04 03 EV-13)。機能キー inquiry_settings(社長・店舗)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま行の横に出す(useActionState)。行は消さない(使わない、にする)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isPriceKind } from "@/utils/customQuote";
import { findOverlappingRange, validatePriceItemInput } from "@/utils/customQuoteInput";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { UUID_PATTERN } from "@/utils/inquiries";
import { insertPriceItem, listAllPriceItems, updatePriceItem } from "./priceItemData";

const LIST_URL = "/admin/inquiries/price-items";
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// 保存の後に戻る一覧の条件(区分・使わないものも出す)だけを残す
const backQuery = (formData: FormData): string => {
  const sp = new URLSearchParams({ saved: "1" });
  const kind = String(formData.get("filter_kind") ?? "");
  if (isPriceKind(kind)) sp.set("kind", kind);
  if (formData.get("filter_all") === "1") sp.set("all", "1");
  return sp.toString();
};

// EV-13 手順2・3。itemId が null なら新規
export async function savePriceItem(itemId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiry_settings", LIST_URL);
  const values = formValues(formData);
  if (itemId && !UUID_PATTERN.test(itemId)) return { errors: {}, formError: "この行は見つかりません。", values };

  // CH-13
  const result = validatePriceItemInput(values, formData.get("is_active") === "1");
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  try {
    // CH-14 枚数の範囲が重ならない
    const items = await listAllPriceItems();
    if (itemId && !items.some((i) => i.id === itemId)) return { errors: {}, formError: "この行は見つかりません。", values };
    const overlap = findOverlappingRange(result.input, items, itemId);
    if (overlap) {
      const errors = { qty_from: `同じ区分・品目・名前の行（${overlap}）と枚数の範囲が重なっています。` };
      return { errors, formError: errorSummary(errors), values };
    }
    if (itemId) await updatePriceItem(itemId, result.input, me.id);
    else await insertPriceItem(result.input, me.id);
  } catch (e) {
    console.error("単価表を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath(LIST_URL);
  redirect(`${LIST_URL}?${backQuery(formData)}`);
}
