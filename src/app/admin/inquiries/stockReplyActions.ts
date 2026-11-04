"use server";

// D-02 在庫照会のパネル(G01)の操作(03 EV-02〜EV-05)。機能キー inquiries(社長・店舗)。
// お客様への返信は送らない。作った案は D-01 の返信欄(saveReplyDraft)に入れ、担当者が確認してから送る。
// 在庫の有無・出荷できる日・入荷予定日は計算(stockAnswer.ts)で出し、AIには「書く」ことだけをさせる。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { fillPlaceholders } from "@/utils/faqRules";
import { getSignatureText } from "@/utils/faq";
import { callGeminiJson, type AiFailureDetail } from "@/utils/gemini";
import { CLOSED_INQUIRY_MESSAGE, UUID_PATTERN, saveReplyDraft } from "@/utils/inquiries";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";
import { STOCK_LIMITS, STOCK_REPLY_SHOW_QUANTITY } from "@/utils/inquirySettings";
import { quoteCustomerText } from "@/utils/prompts/common";
import { STOCK_REPLY_INSTRUCTION, STOCK_REPLY_SCHEMA, type StockReplyAnswer } from "@/utils/prompts/D-02";
import { listStockTemplates, type StockTemplateOption } from "@/utils/replyTemplates";
import {
  STOCK_JUDGEMENTS,
  checkAiStockText,
  checkSelectedCount,
  checkStockSearchText,
  formatReplyDate,
  parseWantedQuantity,
  purposeOfAnswer,
  stockPlaceholderValues,
  toFactsItems,
  type StockAnswer,
  type StockAnswerRow,
} from "@/utils/stockAnswer";
import { loadStockAnswer, searchStockProducts, type StockProductOption, type StockSelection } from "@/utils/stockAnswerData";
import { getInquiry, type InquiryDetail } from "./inquiryData";

const LIST_URL = "/admin/inquiries";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

// ---- EV-02 「探す」 ----

export type StockSearchResult = { ok: true; items: StockProductOption[] } | { ok: false; message: string };

export async function searchStockForPanel(q: string): Promise<StockSearchResult> {
  await requireAccess("inquiries", LIST_URL);
  const text = String(q ?? "");
  // CH-01
  const error = checkStockSearchText(text);
  if (error) return { ok: false, message: error };
  try {
    const items = await searchStockProducts(text);
    if (items.length === 0) return { ok: false, message: "見つかりません。商品マスタに無い商品かもしれません。下の「手で返信文を書く」から返信文を作ってください。" };
    return { ok: true, items };
  } catch (e) {
    console.error("商品を探せませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "探せませんでした。時間をおいてもう一度お試しください。" };
  }
}

// ---- EV-03 商品を選ぶ・数を変える・外す(表を作り直す。保存はしない) ----

export type StockCalcResult = { ok: true; answer: StockAnswer } | { ok: false; message: string };

// 画面の選んだ商品(商品ID と 数の文字)を読む。CH-02・CH-06
const parseSelection = (
  ids: string[],
  quantities: string[],
  allowEmpty: boolean
): { ok: true; selection: StockSelection[] } | { ok: false; code: "none" | "too_many" | "quantity" } => {
  const selection: StockSelection[] = [];
  for (let i = 0; i < ids.length; i++) {
    if (!UUID_PATTERN.test(ids[i]) || selection.some((s) => s.productId === ids[i])) continue;
    const quantity = parseWantedQuantity(quantities[i] ?? "");
    if (quantity === null) return { ok: false, code: "quantity" };
    selection.push({ productId: ids[i], quantity });
  }
  if (selection.length === 0 && allowEmpty) return { ok: true, selection };
  if (checkSelectedCount(selection.length)) return { ok: false, code: selection.length === 0 ? "none" : "too_many" };
  return { ok: true, selection };
};

const SELECTION_MESSAGES = {
  none: "商品を1つ以上選んでください。",
  too_many: `商品は${STOCK_LIMITS.selectedMax}件までにしてください。`,
  quantity: `数は1〜${STOCK_LIMITS.quantityMax}の整数で入力してください。`,
} as const;

export async function calcStockForPanel(items: { productId: string; quantity: string }[]): Promise<StockCalcResult> {
  await requireAccess("inquiries", LIST_URL);
  const list = Array.isArray(items) ? items.slice(0, STOCK_LIMITS.selectedMax + 1) : [];
  const parsed = parseSelection(
    list.map((i) => String(i?.productId ?? "")),
    list.map((i) => String(i?.quantity ?? "")),
    true
  );
  if (!parsed.ok) return { ok: false, message: SELECTION_MESSAGES[parsed.code] };
  try {
    return { ok: true, answer: await loadStockAnswer(parsed.selection) };
  } catch (e) {
    console.error("在庫を読めませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "在庫を読めませんでした。時間をおいてもう一度お試しください。" };
  }
}

// ---- EV-04 「AIで返信文の案を作る」・EV-05 「ひな形で案を作る」 ----

// 名前が分からなければ「お客様」(01 6.3)
const customerNameOf = (inquiry: InquiryDetail): string =>
  inquiry.customerName ?? inquiry.aiExtracted?.customer_name ?? "お客様";

// 入らなかった欄の注意(04 CH-08)
const missingWarning = (missing: string[]): string[] =>
  missing.length > 0 ? [`入らなかった欄: ${missing.map((m) => `{${m}}`).join("・")}`] : [];

// AIで作れなかった理由(?stock_ai=。ひな形に切り替えたことと一緒に出す)
const fallbackCodeOf = (detail: AiFailureDetail, reason: string): string =>
  detail ?? (reason === "quota" || reason === "disabled" ? "limit" : "failed");

// パネルへ戻す(エラーの文を出す)
function backToPanel(inquiryId: string, q: string): never {
  redirect(`${detailUrl(inquiryId)}?${q}#stock-panel`);
}

// AIに渡す計算した値(1商品1行)。在庫の数は STOCK_REPLY_SHOW_QUANTITY のときだけ渡す
const factsForAi = (rows: StockAnswerRow[]): string =>
  rows
    .map((r) =>
      [
        `商品: ${r.displayName}`,
        `欲しい数: ${r.quantityWanted}`,
        `判定: ${STOCK_JUDGEMENTS[r.judgement].label}`,
        STOCK_REPLY_SHOW_QUANTITY && r.usableQuantity !== null ? `在庫数: ${r.usableQuantity}` : null,
        `出荷できる日: ${r.shipDate ? formatReplyDate(r.shipDate) : "なし"}`,
        `入荷予定日: ${r.incomingDate ? formatReplyDate(r.incomingDate) : "なし"}`,
        `要確認: ${r.needsConfirmation ? "あり（確定の言い方をしない）" : "なし"}`,
      ]
        .filter(Boolean)
        .join(" / ")
    )
    .join("\n");

export async function createStockReply(inquiryId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const inquiry = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!inquiry) redirect(LIST_URL);
  // 完了・対応不要なら作らない(AIの回数を使う前に止める。saveReplyDraft でも確かめる)
  if (inquiry.status === "closed" || inquiry.status === "ignored") backToPanel(inquiry.id, "error=closed");

  // CH-06・CH-02
  const parsed = parseSelection(formData.getAll("product_id").map(String), formData.getAll("quantity").map(String), false);
  if (!parsed.ok) backToPanel(inquiry.id, `stock_error=${parsed.code}`);

  // EV-04 手順2・EV-05 手順2: 押した時点の値で表を作り直す
  let answer: StockAnswer;
  let templates: StockTemplateOption[];
  let signature: string | null;
  try {
    answer = await loadStockAnswer(parsed.selection);
    templates = await listStockTemplates();
    signature = await getSignatureText();
  } catch (e) {
    console.error("在庫を読めませんでした:", e instanceof Error ? e.message : e);
    backToPanel(inquiry.id, "stock_error=load");
  }
  if (answer.rows.length === 0) backToPanel(inquiry.id, "stock_error=none");

  // ひな形: 担当者が選んだもの。選んでいなければ判定に合う用途の、並び順の先頭
  const templateId = String(formData.get("template_id") ?? "");
  const selected = templateId ? (templates.find((t) => t.id === templateId) ?? null) : null;
  if (templateId && !selected) backToPanel(inquiry.id, "stock_error=template");
  const purpose = purposeOfAnswer(answer.rows);
  const template = selected ?? templates.find((t) => t.purpose === purpose) ?? null;
  const name = customerNameOf(inquiry);

  let fallback: string | null = null;
  if (formData.get("mode") === "ai") {
    const result = await draftWithAi({ inquiry, answer, template, signature, name, by: me.id });
    if (result.ok) finish(inquiry.id, result.saved, "stock_ai");
    // 使えない → 「AIで作れませんでした。ひな形で案を作ります」と出し、EV-05 に進む
    fallback = result.fallback;
  }

  // EV-05 手順3: 用途に合うひな形が無い
  if (!template) backToPanel(inquiry.id, `stock_error=no_template${fallback ? `&stock_ai=${fallback}` : ""}`);
  // 手順4: 差し込み欄に値を入れる(CH-08 値が無い欄は空にして知らせる)
  const values = { ...stockPlaceholderValues(answer.rows), お客様名: name, 署名: signature };
  const filled = fillPlaceholders(template.body, values);
  const subject = template.subject ? fillPlaceholders(template.subject, values).text : null;
  const warnings = [...answer.warnings, ...missingWarning(filled.missing)];
  // 手順5
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "stock",
    draftSource: "template",
    templateId: template.id,
    aiDraft: filled.text,
    facts: stockFacts(answer, template.purpose, warnings, subject),
    createdBy: me.id,
  });
  finish(inquiry.id, saved, "stock_template", fallback);
}

// 案の根拠(facts)。在庫の時点を必ず残す(CH-04)
const stockFacts = (
  answer: StockAnswer,
  purpose: string,
  warnings: string[],
  subject: string | null
): Record<string, unknown> => ({
  items: toFactsItems(answer.rows),
  stock_as_of: answer.stockAsOf,
  purpose,
  ...(subject ? { subject } : {}),
  ...(warnings.length > 0 ? { warnings } : {}),
});

type DraftContext = {
  inquiry: InquiryDetail;
  answer: StockAnswer;
  template: StockTemplateOption | null;
  signature: string | null;
  name: string;
  by: string;
};

// EV-04 手順3〜7
const draftWithAi = async (
  ctx: DraftContext
): Promise<{ ok: true; saved: Awaited<ReturnType<typeof saveReplyDraft>> } | { ok: false; fallback: string }> => {
  const { inquiry, answer } = ctx;
  // 手順4: 本文(メールアドレス・電話番号は callGeminiJson が伏せる)、計算した値、ひな形を渡す。お客様の名前は渡さない
  const parts = [
    `【計算した値（使ってよい在庫・日付はここだけ）】\n${factsForAi(answer.rows)}\n【計算した値（ここまで）】`,
    ctx.template ? `【ひな形（言い回しの見本）】\n${ctx.template.body}\n【ひな形（ここまで）】` : "",
    quoteCustomerText("件名", inquiry.subject ?? ""),
    quoteCustomerText("お客様の文", inquiry.body.slice(0, INQUIRY_LIMITS.aiBody)),
  ].filter(Boolean);
  const result = await callGeminiJson<StockReplyAnswer>({
    featureId: "D-02",
    purpose: "draft_reply",
    targetTable: "inquiries",
    targetId: inquiry.id,
    instruction: STOCK_REPLY_INSTRUCTION,
    input: parts.join("\n\n"),
    schema: STOCK_REPLY_SCHEMA,
    requestedBy: ctx.by,
  });
  if (!result.ok) return { ok: false, fallback: fallbackCodeOf(result.detail, result.reason) };

  // 手順6: CH-07 AIの文の数字・日付が計算と合う(署名を入れる前の、AIが書いた文で見る)
  const warnings = [...answer.warnings, ...checkAiStockText(result.data.body, answer.rows)];
  // 手順5: {お客様名}・{署名} を差し込む
  const filled = fillPlaceholders(result.data.body, { お客様名: ctx.name, 署名: ctx.signature });
  warnings.push(...missingWarning(filled.missing));

  // 手順7
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "stock",
    draftSource: "ai",
    templateId: ctx.template?.id ?? null,
    aiDraft: filled.text,
    facts: stockFacts(answer, ctx.template?.purpose ?? purposeOfAnswer(answer.rows), warnings, result.data.subject ?? null),
    createdBy: ctx.by,
  });
  return { ok: true, saved };
};

// 手順8: 返信欄に案を出す
function finish(
  inquiryId: string,
  saved: Awaited<ReturnType<typeof saveReplyDraft>>,
  done: "stock_ai" | "stock_template",
  fallback: string | null = null
): never {
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(inquiryId));
  if (!saved.ok) redirect(`${detailUrl(inquiryId)}?error=${saved.message === CLOSED_INQUIRY_MESSAGE ? "closed" : "reply"}`);
  redirect(`${detailUrl(inquiryId)}?done=${done}${fallback ? `&stock_ai=${fallback}` : ""}#reply-${saved.replyId}`);
}
