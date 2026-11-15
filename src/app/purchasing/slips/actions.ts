"use server";

// 納品書を撮る・上げる(C-01 G02)の操作(03 EV-05・EV-06、04 CH-03・CH-04)。機能キー purchasing(社長・店舗・経理)。
// 読み取りに失敗しても伝票は残し、確認・修正の画面(G03)で手入力に切り替える(業務は止めない。01 7.4)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { SLIP_MAX_PAGES } from "@/utils/deliverySlipRules";
import {
  CAPTURE_URL,
  SLIPS_URL,
  arePagesUsable,
  createSlip,
  duplicateNoteOf,
  isActiveSupplier,
  readSlipWithAi,
  slipUrl,
} from "@/utils/deliverySlipServer";
import { formatDateShort } from "@/utils/format";
import { emptyFormState, type FormState } from "@/utils/formState";
import { formText } from "@/utils/textNormalize";

// CH-03: 同じ画像が上がっているときの文(「同じ画像が11/18（水）の納品書に使われています」)。保存は止めない
export async function slipDuplicateNote(duplicateOf: string): Promise<string | null> {
  await requireAccess("purchasing", CAPTURE_URL);
  try {
    const date = await duplicateNoteOf(duplicateOf);
    return date ? `同じ画像が${formatDateShort(date)}の納品書に使われています。` : null;
  } catch (e) {
    console.error("同じ画像の納品書を探せませんでした:", e instanceof Error ? e.message : e);
    return null;
  }
}

// ---- EV-05 「上げて読み取る」 ----

export async function createDeliverySlip(_prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("purchasing", CAPTURE_URL);
  const supplierId = formText(formData, "supplier_id");
  const values = { supplier_id: supplierId };

  // 手順2: CH-04 ページが1〜5枚、すべて本人が上げた納品書の用途のファイルで、ほかの納品書に使われていない
  const fileIds = formData.getAll("file_id").map((v) => String(v).trim()).filter(Boolean);
  if (fileIds.length === 0) return { ...emptyFormState, formError: "納品書の写真かPDFを選んでください。", values };
  if (fileIds.length > SLIP_MAX_PAGES) return { ...emptyFormState, formError: `1件の納品書に${SLIP_MAX_PAGES}ページまでです。`, values };
  if (supplierId && !(await isActiveSupplier(supplierId))) {
    const errors = { supplier_id: "仕入先を選び直してください。" };
    return { errors, formError: errors.supplier_id, values };
  }
  if (!(await arePagesUsable(fileIds, me.id)))
    return { ...emptyFormState, formError: "使えないページがあります。選び直してください。", values };

  // 手順3: 納品書を作る(読み取り: 待ち、伝票: 確かめ中)
  let id: string;
  try {
    id = await createSlip(fileIds, supplierId || null, me.id);
  } catch (e) {
    console.error("納品書を登録できませんでした:", e instanceof Error ? e.message : e);
    return { ...emptyFormState, formError: "登録できませんでした。時間をおいてもう一度お試しください。", values };
  }

  // 手順4: EV-06 読み取り(失敗しても伝票は残す。手入力に切り替わる)
  let outcome = "failed";
  try {
    outcome = await readSlipWithAi(id, me.id);
  } catch (e) {
    console.error("納品書を読み取れませんでした:", e instanceof Error ? e.message : e);
  }

  // 手順5: G03 へ
  revalidatePath(SLIPS_URL);
  redirect(`${slipUrl(id)}?read=${outcome}`);
}
