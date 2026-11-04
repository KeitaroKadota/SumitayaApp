"use server";

// D-03 よくある質問への回答のパネル(G01)の操作(03 EV-02〜EV-04)。機能キー inquiries(社長・店舗)。
// お客様への返信は送らない。作った案は D-01 の返信欄(saveReplyDraft)に入れ、担当者が確認してから送る。
// AIの根拠は、選んだよくある質問(faq_entries)だけ。AIが使えないときは、ひな形にFAQの回答を並べる。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { callGeminiJson, type AiFailureDetail } from "@/utils/gemini";
import {
  getActiveFaqsByIds,
  getSignatureText,
  listFaqAnswerTemplates,
  searchActiveFaq,
  type FaqEntry,
  type FaqPanelItem,
  type ReplyTemplateOption,
} from "@/utils/faq";
import {
  amountsNotInFaq,
  checkFaqSearchText,
  checkSelectedFaqCount,
  fillPlaceholders,
  formatFaqAnswers,
} from "@/utils/faqRules";
import { CLOSED_INQUIRY_MESSAGE, UUID_PATTERN, saveReplyDraft } from "@/utils/inquiries";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";
import { quoteCustomerText } from "@/utils/prompts/common";
import { FAQ_REPLY_INSTRUCTION, FAQ_REPLY_SCHEMA, type FaqReplyAnswer } from "@/utils/prompts/D-03";
import { formatQuantity } from "@/utils/format";
import { getInquiry, type InquiryDetail } from "./inquiryData";

const LIST_URL = "/admin/inquiries";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

// ---- EV-02 「探す」 ----

export type FaqSearchResult = { ok: true; items: FaqPanelItem[] } | { ok: false; message: string };

export async function searchFaqForPanel(q: string): Promise<FaqSearchResult> {
  await requireAccess("inquiries", LIST_URL);
  const text = String(q ?? "");
  // CH-01
  const error = checkFaqSearchText(text);
  if (error) return { ok: false, message: error };
  try {
    return { ok: true, items: await searchActiveFaq(text) };
  } catch (e) {
    console.error("よくある質問を探せませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "探せませんでした。時間をおいてもう一度お試しください。" };
  }
}

// ---- EV-03 「AIで返信文の案を作る」・EV-04 「ひな形で案を作る」 ----

// 名前が分からなければ「お客様」(D-02 01 6.3)
const customerNameOf = (inquiry: InquiryDetail): string =>
  inquiry.customerName ?? inquiry.aiExtracted?.customer_name ?? "お客様";

// 入らなかった欄の注意(D-02 04 CH-08 と同じ文)
const missingWarning = (missing: string[]): string[] =>
  missing.length > 0 ? [`入らなかった欄: ${missing.map((m) => `{${m}}`).join("・")}`] : [];

// AIで作れなかった理由(?faq_ai=。ひな形に切り替えたことと一緒に出す)
const fallbackCodeOf = (detail: AiFailureDetail, reason: string): string =>
  detail ?? (reason === "quota" || reason === "disabled" ? "limit" : "failed");

// パネルを開いたまま詳細へ戻す(エラーの文を出す)
function backToPanel(inquiryId: string, q: string): never {
  redirect(`${detailUrl(inquiryId)}?panel=faq&${q}#faq-panel`);
}

export async function createFaqReply(inquiryId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const inquiry = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!inquiry) redirect(LIST_URL);
  // 完了・対応不要なら作らない(AIの回数を使う前に止める。saveReplyDraft でも確かめる)
  if (inquiry.status === "closed" || inquiry.status === "ignored") backToPanel(inquiry.id, "error=closed");

  // CH-02 根拠のFAQの件数(同じIDは1つにまとめる)
  const ids = [...new Set(formData.getAll("faq_ids").map(String).filter((v) => UUID_PATTERN.test(v)))];
  if (checkSelectedFaqCount(ids.length)) backToPanel(inquiry.id, `faq_error=${ids.length === 0 ? "none" : "too_many"}`);

  // EV-03 手順2: 選んだFAQを読み直す(使わないにされたものは外す)
  const faqs = await getActiveFaqsByIds(ids);
  if (faqs.length === 0) backToPanel(inquiry.id, "faq_error=reselect");

  // ひな形: 選んだもの(種類 faq・用途 faq_answer の使うもの)。選んでいなければ並び順の最初
  const templates = await listFaqAnswerTemplates();
  const templateId = String(formData.get("template_id") ?? "");
  const template = (templateId ? templates.find((t) => t.id === templateId) : templates[0]) ?? null;
  if (templateId && !template) backToPanel(inquiry.id, "faq_error=template");
  const signature = await getSignatureText();
  const name = customerNameOf(inquiry);

  let fallback: string | null = null;
  if (formData.get("mode") === "ai") {
    const result = await draftWithAi({ inquiry, faqs, template, signature, name, by: me.id });
    if (result.ok) finish(inquiry.id, result.saved, "faq_ai");
    // 使えない → 「AIで作れませんでした。ひな形で案を作ります」と出し、EV-04 に進む
    fallback = result.fallback;
  }

  // EV-04 手順2・3: ひな形の {FAQの回答} に、選んだFAQの質問と回答を並べて入れる
  const answers = formatFaqAnswers(faqs);
  const filled = template
    ? fillPlaceholders(template.body, { お客様名: name, 署名: signature, FAQの回答: answers })
    : // ひな形が無ければ、宛名と、FAQの回答を並べただけの文にする【仮】(00_仮決め一覧 D-03-仮-07)
      { text: `${name} 様\n\n${answers}`, missing: [] };
  const warnings = missingWarning(filled.missing);
  // 手順4
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "faq",
    draftSource: "template",
    templateId: template?.id ?? null,
    aiDraft: filled.text,
    facts: { used_faq_ids: faqs.map((f) => f.id), ...(warnings.length > 0 ? { warnings } : {}) },
    createdBy: me.id,
  });
  finish(inquiry.id, saved, "faq_template", fallback);
}

type DraftContext = {
  inquiry: InquiryDetail;
  faqs: FaqEntry[];
  template: ReplyTemplateOption | null;
  signature: string | null;
  name: string;
  by: string;
};

// EV-03 手順3〜7
const draftWithAi = async (
  ctx: DraftContext
): Promise<{ ok: true; saved: Awaited<ReturnType<typeof saveReplyDraft>> } | { ok: false; fallback: string }> => {
  const { inquiry, faqs } = ctx;
  // 手順3: 本文(メールアドレス・電話番号は callGeminiJson が伏せる)、選んだFAQ、ひな形を渡す。お客様の名前の列は渡さない
  const faqText = faqs.map((f) => `ID: ${f.id}\n質問: ${f.question}\n回答: ${f.answer}`).join("\n\n");
  const parts = [
    `【よくある質問（答えに使ってよいのはここだけ）】\n${faqText}\n【よくある質問（ここまで）】`,
    ctx.template ? `【ひな形（言い回しの見本）】\n${ctx.template.body}\n【ひな形（ここまで）】` : "",
    quoteCustomerText("件名", inquiry.subject ?? ""),
    quoteCustomerText("お客様の文", inquiry.body.slice(0, INQUIRY_LIMITS.aiBody)),
  ].filter(Boolean);
  const result = await callGeminiJson<FaqReplyAnswer>({
    featureId: "D-03",
    purpose: "draft_reply",
    targetTable: "inquiries",
    targetId: inquiry.id,
    instruction: FAQ_REPLY_INSTRUCTION,
    input: parts.join("\n\n"),
    schema: FAQ_REPLY_SCHEMA,
    requestedBy: ctx.by,
  });
  if (!result.ok) return { ok: false, fallback: fallbackCodeOf(result.detail, result.reason) };

  const warnings: string[] = [];
  // 手順4: CH-03 使ったFAQのIDが渡したものの中にある(違うIDは捨てる)
  const passed = new Set(faqs.map((f) => f.id));
  const usedIds = [...new Set(result.data.used_faq_ids.filter((id) => passed.has(id)))];
  if (usedIds.length === 0) warnings.push("根拠のFAQが分かりません。内容を確かめてください。");

  // 手順5: {お客様名}・{署名} を差し込む
  const filled = fillPlaceholders(result.data.body, { お客様名: ctx.name, 署名: ctx.signature });
  warnings.push(...missingWarning(filled.missing));

  // 手順6: CH-04 AIの文の金額が、渡したFAQの回答にある
  const unknown = amountsNotInFaq(filled.text, faqs.map((f) => f.answer));
  if (unknown.length > 0)
    warnings.push(`FAQに無い金額（${unknown.map((n) => `${formatQuantity(n)}円`).join("・")}）が入っています。確かめてください。`);

  const notCovered = result.data.not_covered.map((s) => s.trim()).filter(Boolean);
  // 手順7
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "faq",
    draftSource: "ai",
    templateId: ctx.template?.id ?? null,
    aiDraft: filled.text,
    facts: {
      used_faq_ids: usedIds,
      not_covered: notCovered,
      faq_topics: inquiry.aiExtracted?.faq_topics ?? [],
      ...(result.data.subject ? { subject: result.data.subject } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    },
    createdBy: ctx.by,
  });
  return { ok: true, saved };
};

// 手順8: 返信欄に案を出す
function finish(
  inquiryId: string,
  saved: Awaited<ReturnType<typeof saveReplyDraft>>,
  done: "faq_ai" | "faq_template",
  fallback: string | null = null
): never {
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(inquiryId));
  if (!saved.ok)
    redirect(`${detailUrl(inquiryId)}?panel=faq&error=${saved.message === CLOSED_INQUIRY_MESSAGE ? "closed" : "reply"}`);
  redirect(`${detailUrl(inquiryId)}?done=${done}${fallback ? `&faq_ai=${fallback}` : ""}#reply-${saved.replyId}`);
}
