"use server";

// 特注の仕様確認・概算見積の操作(D-04 03 EV-02・EV-05〜EV-09・EV-12・EV-14)。機能キー inquiries(社長・店舗)。
// お客様への返信は送らない。作った案は元の問い合わせ(D-01)の返信欄(saveReplyDraft)に入れ、担当者が確認してから送る。
// 概算の金額は計算(calcEstimate)だけで出す。AIは聞き返し・概算の案内の文を書くだけ。工場あてのタスク・通知は出さない。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import {
  appendNote,
  calcEstimate,
  canChangeQuoteStatus,
  canRecordFactoryRequest,
  estimateAmounts,
  factoryRequestMissing,
  findMissingItems,
  hasEstimateNotice,
  importSpecFromMessages,
  isClosedQuoteStatus,
  type QuoteSpec,
  type SpecCandidate,
} from "@/utils/customQuote";
import { checkClosedReason, checkRequestMemo, specChanged, validateQuoteSpecInput, type QuoteContact } from "@/utils/customQuoteInput";
import { isUniqueViolation } from "@/utils/dbErrors";
import { getSignatureText } from "@/utils/faq";
import { extractYenAmounts, fillPlaceholders } from "@/utils/faqRules";
import { formatQuantity, formatYen } from "@/utils/format";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import { callGeminiJson, type AiFailureDetail } from "@/utils/gemini";
import { CLOSED_INQUIRY_MESSAGE, UUID_PATTERN, saveReplyDraft } from "@/utils/inquiries";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";
import { todayJST } from "@/utils/jst";
import { listActiveEmployees } from "@/utils/masters";
import { quoteCustomerText } from "@/utils/prompts/common";
import {
  CUSTOM_ASK_INSTRUCTION,
  CUSTOM_ESTIMATE_INSTRUCTION,
  CUSTOM_REPLY_SCHEMA,
  type CustomReplyAnswer,
} from "@/utils/prompts/D-04";
import { formText } from "@/utils/textNormalize";
import { getInquiry } from "../inquiryData";
import { listAllPriceItems } from "../price-items/priceItemData";
import {
  findQuoteByInquiry,
  getQuote,
  insertQuote,
  listCustomTemplates,
  listQuoteThread,
  recordFactoryRequest,
  saveEstimate,
  updateQuoteAssignee,
  updateQuoteSpec,
  updateQuoteStatus,
  type CustomQuote,
  type ThreadMessage,
} from "./quoteData";
import { estimateBreakdownText, estimateTotalText, factoryRequestText, factorySummaryRows } from "./quoteText";

const LIST_URL = "/admin/inquiries/custom";
const quoteUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;
const inquiryUrl = (id: string) => `/admin/inquiries/${encodeURIComponent(id)}`;
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const CLOSED_QUOTE = "受注・失注・取消にした案件です。";

const loadQuote = async (quoteId: string): Promise<CustomQuote | null> => (UUID_PATTERN.test(quoteId) ? getQuote(quoteId) : null);

// 抜き出した特注の仕様(D-01 の custom_spec と希望日)
const extractedOf = (m: ThreadMessage) => ({ customSpec: m.extracted?.custom_spec ?? null, desiredDate: m.extracted?.desired_date ?? null });

const EMPTY_SPEC: QuoteSpec = {
  itemType: null,
  fabricItemId: null,
  fabricNote: null,
  sizeBreakdown: null,
  quantity: null,
  printItemId: null,
  printNone: false,
  printText: null,
  desiredDate: null,
  specNote: null,
};

// 候補を、空の案件に入れる(EV-02 手順3)
const applyCandidates = (
  organizationName: string | null,
  spec: QuoteSpec,
  candidates: SpecCandidate[]
): { organizationName: string | null; spec: QuoteSpec } => {
  const s = { ...spec };
  let org = organizationName;
  for (const c of candidates) {
    if (c.changed) continue;
    if (c.field === "organization_name") org = c.value;
    else if (c.field === "item_type") s.itemType = c.value;
    else if (c.field === "fabric_item_id") s.fabricItemId = c.value;
    else if (c.field === "fabric_note") s.fabricNote = c.value;
    else if (c.field === "print_item_id") s.printItemId = c.value;
    else if (c.field === "print_text") s.printText = c.value;
    else if (c.field === "desired_date") s.desiredDate = c.value;
    else if (c.field === "spec_note") s.specNote = appendNote(s.specNote, c.value);
  }
  return { organizationName: org, spec: s };
};

// ---- EV-02 「この問い合わせから特注の案件を作る」 ----

export async function createQuoteFromInquiry(inquiryId: string): Promise<void> {
  const me = await requireAccess("inquiries", inquiryUrl(inquiryId));
  const inquiry = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!inquiry) redirect("/admin/inquiries");
  const rootId = inquiry.parentInquiryId ?? inquiry.id;

  // 手順1: CH-01 同じ問い合わせの案件がまだ無い(あれば既存の案件を開く)
  const existing = await findQuoteByInquiry(rootId);
  if (existing) redirect(quoteUrl(existing.id));

  // 手順3: お客様の名前・メールと、AIが抜き出した仕様の候補を入れる(新しいメッセージの値を先に使う)
  const root = rootId === inquiry.id ? inquiry : await getInquiry(rootId);
  if (!root) redirect("/admin/inquiries");
  const thread = await listQuoteThread(rootId);
  const items = await listAllPriceItems();
  const candidates = importSpecFromMessages({ organizationName: null, spec: EMPTY_SPEC }, [...thread].reverse().map(extractedOf), items);
  const { organizationName, spec } = applyCandidates(null, EMPTY_SPEC, candidates);
  const contact: QuoteContact = {
    organizationName,
    customerName: (root.customerName ?? root.aiExtracted?.customer_name ?? null)?.slice(0, 100) ?? null,
    customerEmail: root.customerEmail,
    customerPhone: null,
  };

  // 手順2・4: 番号を振り、足りない項目を入れて作る
  let result: Awaited<ReturnType<typeof insertQuote>>;
  try {
    result = await insertQuote(
      { ...contact, inquiryId: rootId, spec, missingItems: findMissingItems(spec) },
      Number(todayJST().slice(0, 4)),
      me.id
    );
  } catch (e) {
    // 同時に押されたとき(CH-01 の重複不可の制約)は、できた案件を開く
    if (isUniqueViolation(e)) {
      const made = await findQuoteByInquiry(rootId);
      if (made) redirect(quoteUrl(made.id));
    }
    console.error("特注の案件を作れませんでした:", e instanceof Error ? e.message : e);
    redirect(`${inquiryUrl(inquiry.id)}?error=save`);
  }
  if (!result.ok) redirect(quoteUrl(result.existingId));

  // 手順5
  revalidatePath(LIST_URL);
  revalidatePath(inquiryUrl(inquiry.id));
  redirect(`${quoteUrl(result.id)}?done=created`);
}

// ---- EV-05 「仕様を保存」・EV-08 「概算を計算」(intent=estimate) ----

export async function saveQuoteSpec(quoteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", quoteUrl(quoteId));
  const values = formValues(formData);
  const quote = await loadQuote(quoteId);
  if (!quote) return { errors: {}, formError: "この案件は見つかりません。", values };
  if (isClosedQuoteStatus(quote.status)) return { errors: {}, formError: `${CLOSED_QUOTE}仕様は直せません。`, values };

  // 手順1: CH-02〜CH-04
  const items = await listAllPriceItems();
  const result = validateQuoteSpecInput(values, items, todayJST());
  if (!result.ok) return { errors: result.errors, formError: errorSummary(result.errors), values };
  const { contact, spec, warnings } = result;

  // 手順2・3: 足りない項目を計算し直す。概算の後に仕様を変えたら概算を空にする(足りない項目が出たら聞き取り中に戻す)
  const missing = findMissingItems(spec);
  const cleared = quote.estimate !== null && specChanged(quote.spec, spec);
  const backToHearing = cleared && quote.status === "estimated" && missing.length > 0;
  try {
    await updateQuoteSpec(quote.id, contact, spec, missing, { clearEstimate: cleared, status: backToHearing ? "hearing" : null }, me.id);
  } catch (e) {
    console.error("特注の仕様を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }

  const params = new URLSearchParams();
  if (warnings.length > 0) params.set("warn", "past_date");
  if (formData.get("intent") === "estimate") {
    // EV-08 手順2・3: 計算できなければ理由を出す(詳細の画面で計算し直して出す)
    const calc = calcEstimate(spec, items);
    if (calc.ok) {
      try {
        await saveEstimate(quote.id, calc.estimate, me.id);
      } catch (e) {
        console.error("概算を保存できませんでした:", e instanceof Error ? e.message : e);
        return { errors: {}, formError: SAVE_FAILED, values };
      }
      params.set("done", "estimated");
    } else {
      params.set("done", "spec");
      params.set("est", "failed");
      if (cleared) params.set("cleared", "1");
    }
  } else {
    params.set("done", "spec");
    if (cleared) params.set("cleared", "1");
  }
  revalidatePath(LIST_URL);
  revalidatePath(quoteUrl(quote.id));
  redirect(`${quoteUrl(quote.id)}?${params.toString()}`);
}

// ---- 担当者(02 の G03 の上) ----

export async function changeQuoteAssignee(quoteId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("inquiries", quoteUrl(quoteId));
  const quote = await loadQuote(quoteId);
  if (!quote) redirect(LIST_URL);
  const assignedTo = formText(formData, "assigned_to");
  if (assignedTo) {
    const staff = await listActiveEmployees({ featureKey: "inquiries" });
    if (!staff.some((e) => e.id === assignedTo)) redirect(`${quoteUrl(quote.id)}?error=assignee`);
  }
  await updateQuoteAssignee(quote.id, assignedTo || null, me.id);
  revalidatePath(LIST_URL);
  redirect(`${quoteUrl(quote.id)}?done=assignee`);
}

// ---- EV-06・EV-07・EV-09 返信の案 ----

// AIで作れなかった理由(?ai_fallback=。ひな形に切り替えたことと一緒に出す)
const fallbackCodeOf = (detail: AiFailureDetail, reason: string): string =>
  detail ?? (reason === "quota" || reason === "disabled" ? "limit" : "failed");

// 入らなかった欄の注意(D-02 04 CH-08 と同じ文)
const missingWarning = (missing: string[]): string[] =>
  missing.length > 0 ? [`入らなかった欄: ${missing.map((m) => `{${m}}`).join("・")}`] : [];

// AIに渡す、分かっている仕様(お客様の名前・連絡先・団体名は渡さない)
const knownSpecText = (quote: CustomQuote, items: Awaited<ReturnType<typeof listAllPriceItems>>): string =>
  factorySummaryRows(quote, items)
    .filter((r) => !["番号", "団体名", "概算（税込）"].includes(r.label) && r.value && r.value !== "−")
    .map((r) => `${r.label}: ${r.value}`)
    .join("\n") || "（まだ分かっている仕様はありません）";

// 最新のお客様の文(続きのメッセージがあれば一番新しいもの)
const latestMessage = (thread: ThreadMessage[]): ThreadMessage | undefined => thread[thread.length - 1];

// ひな形の差し込み欄の値(D-02 01 6.3 と D-04 01 6.3)
const placeholderValues = (quote: CustomQuote, signature: string | null): Record<string, string | null> => ({
  お客様名: quote.customerName ?? "お客様",
  署名: signature,
  団体名: quote.organizationName,
  品目: quote.spec.itemType,
  枚数: quote.spec.quantity ? `${formatQuantity(quote.spec.quantity)}枚` : null,
});

type DraftKind = "custom_ask" | "custom_estimate";

// 案を作る前の確かめ(案件・元の問い合わせの状態)
const prepareDraft = async (quoteId: string) => {
  const me = await requireAccess("inquiries", quoteUrl(quoteId));
  const quote = await loadQuote(quoteId);
  if (!quote) redirect(LIST_URL);
  if (isClosedQuoteStatus(quote.status)) redirect(`${quoteUrl(quote.id)}?error=closed_quote`);
  const thread = await listQuoteThread(quote.inquiryId);
  const root = thread.find((m) => m.id === quote.inquiryId);
  // 元の問い合わせが完了・対応不要なら作らない(AIの回数を使う前に止める。saveReplyDraft でも確かめる)
  if (!root || root.status === "closed" || root.status === "ignored") redirect(`${quoteUrl(quote.id)}?error=inquiry_closed`);
  const items = await listAllPriceItems();
  const signature = await getSignatureText();
  return { me, quote, thread, items, signature };
};

// 手順5: 案を作ったら、問い合わせの画面へのリンクを出す
function finishDraft(
  quoteId: string,
  inquiryId: string,
  saved: Awaited<ReturnType<typeof saveReplyDraft>>,
  done: string,
  fallback: string | null
): never {
  revalidatePath("/admin/inquiries");
  revalidatePath(inquiryUrl(inquiryId));
  revalidatePath(quoteUrl(quoteId));
  if (!saved.ok) redirect(`${quoteUrl(quoteId)}?error=${saved.message === CLOSED_INQUIRY_MESSAGE ? "inquiry_closed" : "reply"}`);
  redirect(`${quoteUrl(quoteId)}?done=${done}&reply=${saved.replyId}${fallback ? `&ai_fallback=${fallback}` : ""}`);
}

const callDraftAi = async (
  kind: DraftKind,
  ctx: Awaited<ReturnType<typeof prepareDraft>>,
  facts: string,
  templateBody: string | null
) => {
  const latest = latestMessage(ctx.thread);
  const parts = [
    facts,
    templateBody ? `【ひな形（言い回しの見本）】\n${templateBody}\n【ひな形（ここまで）】` : "",
    quoteCustomerText("件名", latest?.subject ?? ""),
    quoteCustomerText("お客様の文", (latest?.body ?? "").slice(0, INQUIRY_LIMITS.aiBody)),
  ].filter(Boolean);
  return callGeminiJson<CustomReplyAnswer>({
    featureId: "D-04",
    purpose: "draft_reply",
    targetTable: "custom_quotes",
    targetId: ctx.quote.id,
    instruction: kind === "custom_ask" ? CUSTOM_ASK_INSTRUCTION : CUSTOM_ESTIMATE_INSTRUCTION,
    input: parts.join("\n\n"),
    schema: CUSTOM_REPLY_SCHEMA,
    requestedBy: ctx.me.id,
  });
};

// EV-06 「AIで聞き返しの案を作る」・EV-07 「ひな形で案を作る」(mode = ai・template)
export async function createAskDraft(quoteId: string, formData: FormData): Promise<void> {
  const ctx = await prepareDraft(quoteId);
  const { me, quote } = ctx;
  // 手順1: 足りない項目が1つ以上ある
  if (quote.missingItems.length === 0) redirect(`${quoteUrl(quote.id)}?error=no_missing`);

  const templates = await listCustomTemplates("custom_ask");
  const templateId = formText(formData, "template_id");
  const template = (templateId ? templates.find((t) => t.id === templateId) : templates[0]) ?? null;
  if (templateId && !template) redirect(`${quoteUrl(quote.id)}?error=template`);
  const baseFacts = { quote_id: quote.id, quote_number: quote.quoteNumber, missing_items: quote.missingItems };

  let fallback: string | null = null;
  if (formData.get("mode") === "ai") {
    // 手順2: 最新のお客様の文(伏せる)・分かっている仕様・足りない項目・ひな形を渡す
    const facts = [
      `【分かっている仕様】\n${knownSpecText(quote, ctx.items)}\n【分かっている仕様（ここまで）】`,
      `【足りない項目（お聞きするのはここだけ）】\n${quote.missingItems.map((m) => `・${m}`).join("\n")}\n【足りない項目（ここまで）】`,
    ].join("\n\n");
    const result = await callDraftAi("custom_ask", ctx, facts, template?.body ?? null);
    if (result.ok) {
      const filled = fillPlaceholders(result.data.body, { お客様名: quote.customerName ?? "お客様", 署名: ctx.signature });
      const warnings = missingWarning(filled.missing);
      // 手順3: CH-08 聞き返しでは金額を書かない
      const amounts = [...new Set(extractYenAmounts(filled.text))];
      if (amounts.length > 0)
        warnings.push(`聞き返しの文に金額（${amounts.map((n) => formatYen(n)).join("・")}）が入っています。確かめてください。`);
      // 手順4
      const saved = await saveReplyDraft({
        inquiryId: quote.inquiryId,
        kind: "custom_ask",
        draftSource: "ai",
        templateId: template?.id ?? null,
        aiDraft: filled.text,
        facts: {
          ...baseFacts,
          ...(result.data.subject ? { subject: result.data.subject } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
        createdBy: me.id,
      });
      finishDraft(quote.id, quote.inquiryId, saved, "ask_ai", null);
    }
    // 使えない → EV-07 に進む
    fallback = fallbackCodeOf(result.detail, result.reason);
  }

  // EV-07 手順1: ひな形に値を入れる
  if (!template) redirect(`${quoteUrl(quote.id)}?error=no_template${fallback ? `&ai_fallback=${fallback}` : ""}`);
  const filled = fillPlaceholders(template.body, {
    ...placeholderValues(quote, ctx.signature),
    足りない項目: quote.missingItems.map((m) => `・${m}`).join("\n"),
  });
  const warnings = missingWarning(filled.missing);
  // 手順2
  const saved = await saveReplyDraft({
    inquiryId: quote.inquiryId,
    kind: "custom_ask",
    draftSource: "template",
    templateId: template.id,
    aiDraft: filled.text,
    facts: { ...baseFacts, ...(warnings.length > 0 ? { warnings } : {}) },
    createdBy: me.id,
  });
  finishDraft(quote.id, quote.inquiryId, saved, "ask_template", fallback);
}

// EV-09 「AIで概算の案内の案を作る」・「ひな形で概算の案を作る」(mode = ai・template)
export async function createEstimateDraft(quoteId: string, formData: FormData): Promise<void> {
  const ctx = await prepareDraft(quoteId);
  const { me, quote } = ctx;
  // 手順1: CH-09 概算が今の仕様で計算済み(仕様を変えると EV-05 で概算を空にする)
  const estimate = quote.estimate;
  if (!estimate) redirect(`${quoteUrl(quote.id)}?error=no_estimate`);

  const templates = await listCustomTemplates("custom_estimate");
  const template = templates[0] ?? null;
  const breakdown = estimateBreakdownText(estimate);
  const total = estimateTotalText(estimate);
  const baseFacts = {
    quote_id: quote.id,
    quote_number: quote.quoteNumber,
    estimate_total: estimate.total,
    estimate_lines: estimate.lines,
  };

  let fallback: string | null = null;
  if (formData.get("mode") === "ai") {
    // 手順2: 金額は渡した値だけを使わせる
    const facts = [
      `【分かっている仕様】\n${knownSpecText(quote, ctx.items)}\n【分かっている仕様（ここまで）】`,
      `【概算の内訳（金額はここの値だけを使う）】\n${breakdown}\n【概算の内訳（ここまで）】`,
      `概算の合計: ${total}`,
    ].join("\n\n");
    const result = await callDraftAi("custom_estimate", ctx, facts, template?.body ?? null);
    if (result.ok) {
      const filled = fillPlaceholders(result.data.body, { お客様名: quote.customerName ?? "お客様", 署名: ctx.signature });
      const warnings = missingWarning(filled.missing);
      // 手順3: CH-08 本文の金額が、概算の内訳・小計・税・合計のどれかと同じ
      const known = estimateAmounts(estimate);
      const unknown = [...new Set(extractYenAmounts(filled.text))].filter((n) => !known.has(n));
      if (unknown.length > 0)
        warnings.push(`計算と違う金額（${unknown.map((n) => formatYen(n)).join("・")}）が入っています。確かめてください。`);
      // CH-10 「概算」「正式なお見積り」の文がある
      if (!hasEstimateNotice(filled.text)) warnings.push("概算であることが書かれていません。確かめてください。");
      // 手順4
      const saved = await saveReplyDraft({
        inquiryId: quote.inquiryId,
        kind: "custom_estimate",
        draftSource: "ai",
        templateId: template?.id ?? null,
        aiDraft: filled.text,
        facts: {
          ...baseFacts,
          ...(result.data.subject ? { subject: result.data.subject } : {}),
          ...(warnings.length > 0 ? { warnings } : {}),
        },
        createdBy: me.id,
      });
      finishDraft(quote.id, quote.inquiryId, saved, "estimate_ai", null);
    }
    // AIが使えない → ひな形で作る
    fallback = fallbackCodeOf(result.detail, result.reason);
  }

  if (!template) redirect(`${quoteUrl(quote.id)}?error=no_template${fallback ? `&ai_fallback=${fallback}` : ""}`);
  const filled = fillPlaceholders(template.body, {
    ...placeholderValues(quote, ctx.signature),
    概算の内訳: breakdown,
    概算の合計: total,
  });
  const warnings = missingWarning(filled.missing);
  if (!hasEstimateNotice(filled.text)) warnings.push("概算であることが書かれていません。確かめてください。");
  const saved = await saveReplyDraft({
    inquiryId: quote.inquiryId,
    kind: "custom_estimate",
    draftSource: "template",
    templateId: template.id,
    aiDraft: filled.text,
    facts: { ...baseFacts, ...(warnings.length > 0 ? { warnings } : {}) },
    createdBy: me.id,
  });
  finishDraft(quote.id, quote.inquiryId, saved, "estimate_template", fallback);
}

// ---- EV-14 「工場に依頼したことを記録」 ----

export async function recordFactoryRequestAction(quoteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", quoteUrl(quoteId));
  const values = formValues(formData);
  const quote = await loadQuote(quoteId);
  if (!quote) return { errors: {}, formError: "この案件は見つかりません。", values };

  // 手順1: CH-11・CH-12・CH-02(依頼のメモの長さ)
  const missing = factoryRequestMissing(quote.spec);
  if (missing.length > 0)
    return { errors: {}, formError: `工場に依頼するには、次の項目を入れてください: ${missing.join("・")}`, values };
  if (!canRecordFactoryRequest(quote.status)) return { errors: {}, formError: `${CLOSED_QUOTE}依頼は記録できません。`, values };
  const memo = String(formData.get("request_memo") ?? "").trim();
  const memoError = checkRequestMemo(memo);
  if (memoError) return { errors: { request_memo: memoError }, formError: errorSummary({ request_memo: memoError }), values };

  // 手順2: 仕様のまとめと依頼のメモをつないだ文と、今の日時を保存し、工場に依頼済みにする
  const items = await listAllPriceItems();
  const text = factoryRequestText(factorySummaryRows(quote, items), memo);
  let ok = false;
  try {
    ok = await recordFactoryRequest(quote.id, text, me.id);
  } catch (e) {
    console.error("工場への依頼を記録できませんでした:", e instanceof Error ? e.message : e);
  }
  if (!ok) return { errors: {}, formError: "記録できませんでした。時間をおいてもう一度お試しください。", values };

  revalidatePath(LIST_URL);
  revalidatePath(quoteUrl(quote.id));
  redirect(`${quoteUrl(quote.id)}?done=requested`);
}

// ---- EV-12 受注にする・失注にする・取消(と、間違えたときに工場に依頼済みへ戻す) ----

const STATUS_DONE = { won: "won", lost: "lost", cancelled: "cancelled", factory_requested: "reverted" } as const;

export async function changeQuoteStatusAction(quoteId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", quoteUrl(quoteId));
  const values = formValues(formData);
  const quote = await loadQuote(quoteId);
  if (!quote) return { errors: {}, formError: "この案件は見つかりません。", values };

  const to = formText(formData, "to");
  if (to !== "won" && to !== "lost" && to !== "cancelled" && to !== "factory_requested")
    return { errors: {}, formError: "この状態には変えられません。", values };
  // 工場に依頼済みへは、ここでは受注・失注から戻すときだけ(依頼の記録は EV-14)
  if (to === "factory_requested" && quote.status !== "won" && quote.status !== "lost")
    return { errors: {}, formError: "この状態には変えられません。", values };

  // 手順1: CH-12 状態の移り方(受注・失注から戻せるのは社長だけ)。失注・取消は理由が必須
  if (!canChangeQuoteStatus(quote.status, to, me.roles.includes("president")))
    return { errors: {}, formError: "この状態には変えられません。", values };
  const reason = formText(formData, "reason");
  if (to === "lost" || to === "cancelled") {
    const e = checkClosedReason(reason);
    if (e) return { errors: { reason: e }, formError: errorSummary({ reason: e }), values };
  }

  // 手順2
  let ok = false;
  try {
    ok = await updateQuoteStatus(quote.id, quote.status, to, reason || null, me.id);
  } catch (e) {
    console.error("特注の案件の状態を変えられませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  if (!ok) return { errors: {}, formError: "ほかの人が先に変えました。画面を開き直してください。", values };

  revalidatePath(LIST_URL);
  revalidatePath(quoteUrl(quote.id));
  redirect(`${quoteUrl(quote.id)}?done=${STATUS_DONE[to]}`);
}
