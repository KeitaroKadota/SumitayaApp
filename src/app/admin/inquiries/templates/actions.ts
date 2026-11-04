"use server";

// 返信のひな形の保存(D-02 03 EV-07)。機能キー inquiry_settings(社長・店舗)。
// ひな形は消さない。使わないときは「使う」を外す(過去の案の template_id が残るため)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { isActiveSignature, validateTemplateInput } from "@/utils/replyTemplateRules";
import { getReplyTemplate, hasOtherActiveSignature, insertReplyTemplate, updateReplyTemplate } from "@/utils/replyTemplates";
import { formText } from "@/utils/textNormalize";

const LIST_URL = "/admin/inquiries/templates";
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const SIGNATURE_TAKEN = "「使う」になっている署名がほかにあります。署名は1件だけ「使う」にできます。";

// EV-07 「保存する」(G03)。templateId が null なら新規
export async function saveReplyTemplate(templateId: string | null, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiry_settings", templateId ? `${LIST_URL}/${encodeURIComponent(templateId)}` : `${LIST_URL}/new`);
  const values = formValues(formData);

  const current = templateId ? await getReplyTemplate(templateId) : null;
  if (templateId && !current) return { errors: {}, formError: "このひな形は見つかりません。", values };

  // 手順1: CH-09・CH-10・CH-08
  const result = validateTemplateInput(
    {
      category: formText(formData, "category"),
      purpose: formText(formData, "purpose"),
      name: formText(formData, "name"),
      subject: formText(formData, "subject"),
      body: String(formData.get("body") ?? ""),
      sortOrder: formText(formData, "sort_order"),
    },
    formData.get("is_active") === "1"
  );
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };

  try {
    // CH-10 署名で「使う」は1件だけ
    if (isActiveSignature(result.input) && (await hasOtherActiveSignature(current?.id ?? null)))
      return { errors: { is_active: SIGNATURE_TAKEN }, formError: errorSummary({ is_active: SIGNATURE_TAKEN }), values };
    // 手順2
    if (current) await updateReplyTemplate(current.id, result.input, me.id);
    else await insertReplyTemplate(result.input, me.id);
  } catch (e) {
    // 同時に保存したときは、DBの重複不可の制約で止まる
    if (isUniqueViolation(e, "reply_templates_active_signature_key"))
      return { errors: { is_active: SIGNATURE_TAKEN }, formError: errorSummary({ is_active: SIGNATURE_TAKEN }), values };
    console.error("ひな形を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  // 手順3
  revalidatePath(LIST_URL);
  redirect(`${LIST_URL}?saved=1`);
}
