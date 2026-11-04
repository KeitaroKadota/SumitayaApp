"use server";

// 商品マスタの操作(CMN-02 EV-08・EV-09・EV-22・EV-23)。機能キー products(社長・店舗)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { ALIAS_SOURCES, type AliasSource } from "@/utils/masterRules";
import { findProductByCode } from "@/utils/masters";
import { relinkSalesProducts } from "@/utils/salesRelink";
import { formText, toHalfWidth } from "@/utils/textNormalize";
import {
  aliasOwnerCode,
  deleteAlias,
  getProduct,
  insertAlias,
  insertProduct,
  setProductActive,
  updateProduct,
} from "./productData";
import { validateProductForm } from "./productValidation";

const LIST_URL = "/admin/products";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// EV-08 「保存する」(G05)。productId が null なら新規
export async function saveProduct(productId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("products", productId ? detailUrl(productId) : `${LIST_URL}/new`);
  const values = formValues(formData);

  const current = productId ? await getProduct(productId) : null;
  if (productId && !current) return { errors: {}, formError: "この商品は見つかりません。", values };

  const result = await validateProductForm(
    formData,
    current ? { productCode: current.productCode, mainSupplierId: current.mainSupplierId } : null
  );
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  let id: string;
  try {
    if (current) {
      await updateProduct(current.id, result.input, me.id);
      id = current.id;
    } else {
      id = await insertProduct(result.productCode, result.input, me.id);
    }
  } catch (e) {
    if (isUniqueViolation(e, "products_product_code_key")) {
      const errors = { product_code: "この商品コードは、すでに登録されています。" };
      return { errors, formError: errorSummary(errors), values };
    }
    console.error("商品を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(id));
  const warn = result.warnings.length > 0 ? `&warn=${result.warnings.join(",")}` : "";
  redirect(`${detailUrl(id)}?saved=1${warn}`);
}

// EV-09 「使用中止にする」「使用中に戻す」(G05)
export async function setProductActiveAction(productId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("products", detailUrl(productId));
  const current = await getProduct(productId);
  if (!current) redirect(LIST_URL);
  const isActive = formData.get("is_active") === "1";
  await setProductActive(current.id, isActive, me.id);

  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=${isActive ? "activated" : "deactivated"}`);
}

// EV-22 読み替えのコードの「追加する」(G05)
export async function addProductAlias(productId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("products", detailUrl(productId));
  const values = formValues(formData);
  const current = await getProduct(productId);
  if (!current) return { errors: {}, formError: "この商品は見つかりません。", values };

  // 手順2: 前後の空白を取る。大文字・小文字は区別する(CH-37)
  const source = formText(formData, "source");
  const externalCode = toHalfWidth(formText(formData, "external_code")).trim();

  // CH-37 読み替えのコード
  const errors: Record<string, string> = {};
  if (!(source in ALIAS_SOURCES)) errors.source = "取り込み元を選んでください。";
  if (!externalCode) errors.external_code = "元のコードを入力してください。";
  else if (externalCode.length > 50) errors.external_code = "元のコードは50文字以内で入力してください。";
  if (Object.keys(errors).length > 0) return { errors, formError: null, values };

  const duplicateMessage = (owner: string) => `このコードは、すでに ${owner} に読み替えています。`;
  const owner = await aliasOwnerCode(source as AliasSource, externalCode);
  if (owner) return { errors: { external_code: duplicateMessage(owner) }, formError: null, values };

  try {
    await insertAlias(current.id, source as AliasSource, externalCode, me.id);
  } catch (e) {
    if (isUniqueViolation(e)) {
      const taken = (await aliasOwnerCode(source as AliasSource, externalCode)) ?? "ほかの商品";
      return { errors: { external_code: duplicateMessage(taken) }, formError: null, values };
    }
    console.error("読み替えのコードを追加できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // CH-37 元のコードが別の商品の商品コードと同じなら注意(読み替えが優先される)
  const sameCode = await findProductByCode(externalCode);
  const warn = sameCode && sameCode.id !== current.id ? "&warn=alias_same_code" : "";

  // 手順5: A-01 の結び付け直し(失敗しても追加は取り消さない)
  let relink = "";
  try {
    const relinked = await relinkSalesProducts();
    if (relinked !== null) relink = `&relinked=${relinked}`;
  } catch (e) {
    console.error("売上の商品の結び付け直しに失敗しました:", e instanceof Error ? e.message : e);
    relink = "&relink_failed=1";
  }

  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=alias_added${warn}${relink}`);
}

// EV-23 読み替えのコードの「削除する」(G05)。確認のダイアログは画面で出す
export async function deleteProductAlias(productId: string, formData: FormData): Promise<void> {
  await requireAccess("products", detailUrl(productId));
  const current = await getProduct(productId);
  if (!current) redirect(LIST_URL);
  await deleteAlias(current.id, formText(formData, "alias_id"));

  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?saved=alias_deleted`);
}
