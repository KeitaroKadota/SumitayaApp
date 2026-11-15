"use server";

// 発注の操作(A-03 EV-08 手で発注を作る・EV-09 下書きの保存・EV-13 発注したことを記録・EV-14 取消・EV-15 残りを打ち切る)
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formValues } from "@/utils/formState";
import { currentRounding, getCompanySettings } from "@/utils/invoicesServer";
import { todayJST } from "@/utils/jst";
import { cancelDraft, closeOrder, createManualDraft, markOrdered, saveDraft, type DraftLineInput } from "@/utils/purchaseOrdersAdmin";
import { formText } from "@/utils/textNormalize";

const LIST = "/admin/purchase-orders";
const detail = (id: string) => `${LIST}/${id}`;

export type PoFormState = {
  errors: Record<string, string>;
  formError: string | null;
  values: Record<string, string>;
  warnings: string[];
  saved: boolean;
};

// EV-08 仕入先を選んだら、明細の無い下書きを作って G06 へ
export async function createManualAction(formData: FormData): Promise<void> {
  const me = await requireAccess("sales", LIST);
  const id = await createManualDraft(formText(formData, "supplier_id"), me.id);
  if (!id) redirect(`${LIST}?new=1&error=supplier`);
  revalidatePath(LIST);
  redirect(detail(id));
}

// EV-09 下書きの「保存」
export async function saveDraftAction(id: string, _prev: PoFormState, formData: FormData): Promise<PoFormState> {
  const me = await requireAccess("sales", detail(id));
  const values = formValues(formData);
  const lineIds = formData.getAll("line_id").filter((v): v is string => typeof v === "string");
  const removes = new Set(formData.getAll("remove").filter((v): v is string => typeof v === "string"));
  const lines: DraftLineInput[] = lineIds.map((lineId) => ({
    lineId,
    quantity: formText(formData, `qty_${lineId}`),
    unitPrice: formText(formData, `price_${lineId}`),
    remove: removes.has(lineId),
  }));
  const company = await getCompanySettings();
  let result: Awaited<ReturnType<typeof saveDraft>>;
  try {
    result = await saveDraft(
      id,
      {
        lines,
        addCode: formText(formData, "add_code"),
        addQuantity: formText(formData, "add_quantity"),
        addUnitPrice: formText(formData, "add_unit_price"),
        expectedDate: formText(formData, "expected_date"),
        note: formText(formData, "note"),
        internalNote: formText(formData, "internal_note"),
      },
      currentRounding(company),
      todayJST(),
      me.id
    );
  } catch (e) {
    console.error("発注を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "保存できませんでした。何も保存していません。もう一度お試しください。", values, warnings: [], saved: false };
  }
  if (!result.ok) return { errors: result.errors, formError: result.formError, values, warnings: [], saved: false };
  revalidatePath(detail(id));
  revalidatePath(LIST);
  // 足す行の欄は空に戻す
  return { errors: {}, formError: null, values: { ...values, add_code: "", add_quantity: "", add_unit_price: "" }, warnings: result.warnings, saved: true };
}

// EV-13 「発注したことを記録」
export async function markOrderedAction(id: string, _prev: PoFormState, formData: FormData): Promise<PoFormState> {
  const me = await requireAccess("sales", detail(id));
  const values = formValues(formData);
  let result: Awaited<ReturnType<typeof markOrdered>>;
  try {
    result = await markOrdered(
      id,
      { orderDate: formText(formData, "order_date"), sendMethod: formText(formData, "send_method"), expectedDate: formText(formData, "expected_date") },
      todayJST(),
      me.id
    );
  } catch (e) {
    console.error("発注を記録できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: "記録できませんでした。もう一度お試しください。", values, warnings: [], saved: false };
  }
  if (!result.ok) return { errors: result.errors, formError: result.formError, values, warnings: [], saved: false };
  revalidatePath(detail(id));
  revalidatePath(LIST);
  redirect(`${detail(id)}?ordered=1`);
}

// EV-14 「取消」(下書きだけ)
export async function cancelDraftAction(id: string): Promise<void> {
  const me = await requireAccess("sales", detail(id));
  const ok = await cancelDraft(id, me.id);
  revalidatePath(LIST);
  revalidatePath("/admin/forecast");
  redirect(`${detail(id)}?${ok ? "cancelled=1" : "error=status"}`);
}

// EV-15 「残りを打ち切る」(発注済み・一部入荷だけ)
export async function closeOrderAction(id: string): Promise<void> {
  const me = await requireAccess("sales", detail(id));
  const ok = await closeOrder(id, me.id);
  revalidatePath(LIST);
  redirect(`${detail(id)}?${ok ? "closed=1" : "error=status"}`);
}
