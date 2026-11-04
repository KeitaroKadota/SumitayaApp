"use server";

// よくある質問の保存(D-03 03 EV-06)。機能キー inquiry_settings(社長・店舗)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { findSameQuestion, getFaqEntry, insertFaqEntry, updateFaqEntry } from "@/utils/faq";
import { validateFaqInput } from "@/utils/faqRules";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { todayJST } from "@/utils/jst";
import { formText } from "@/utils/textNormalize";

const LIST_URL = "/admin/inquiries/faq";
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";

// CH-07 の警告を出したか(「それでも保存」を出す)
export type FaqFormState = FormState & { duplicate: string | null };

// EV-06 「保存する」(G03)。faqId が null なら新規
export async function saveFaq(faqId: string | null, _prev: FaqFormState, formData: FormData): Promise<FaqFormState> {
  const me = await requireAccess("inquiry_settings", faqId ? `${LIST_URL}/${encodeURIComponent(faqId)}` : `${LIST_URL}/new`);
  const values = formValues(formData);

  const current = faqId ? await getFaqEntry(faqId) : null;
  if (faqId && !current) return { errors: {}, formError: "このよくある質問は見つかりません。", values, duplicate: null };

  // 手順1: CH-05・CH-06
  const result = validateFaqInput(
    {
      topic: formText(formData, "topic"),
      question: formText(formData, "question"),
      answer: String(formData.get("answer") ?? ""),
      keywords: formText(formData, "keywords"),
      sourceName: formText(formData, "source_name"),
      sourceUrl: formText(formData, "source_url"),
      checkedOn: formText(formData, "checked_on"),
      sortOrder: formText(formData, "sort_order"),
    },
    formData.get("is_active") === "1",
    todayJST()
  );
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values, duplicate: null };

  try {
    // 手順2: CH-07 同じ質問(使うものだけ見る)。「それでも保存」で保存できる
    if (result.input.isActive && formData.get("force_duplicate") !== "1") {
      const same = await findSameQuestion(result.input.question, current?.id ?? null);
      if (same)
        return {
          errors: {},
          formError: `同じ質問のよくある質問があります（${same}）。それでも保存しますか？`,
          values,
          duplicate: same,
        };
    }
    // 手順3
    if (current) await updateFaqEntry(current.id, result.input, me.id);
    else await insertFaqEntry(result.input, me.id);
  } catch (e) {
    console.error("よくある質問を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values, duplicate: null };
  }

  // 手順4
  revalidatePath(LIST_URL);
  redirect(`${LIST_URL}?saved=1`);
}
