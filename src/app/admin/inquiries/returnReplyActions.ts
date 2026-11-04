"use server";

// D-06 返品のパネル(G01)の操作(03 EV-02〜EV-06)。機能キー inquiries(社長・店舗)。
// お客様への返信は送らない。作った案は D-01 の返信欄(saveReplyDraft)に入れ、担当者が確認してから送る。
// 受け付けるか・送料の負担は担当者が選んだものを使い、システムでは判定しない。AIには「書く」ことだけをさせる。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { getSignatureText } from "@/utils/faq";
import { fillPlaceholders } from "@/utils/faqRules";
import { callGeminiJson, type AiFailureDetail } from "@/utils/gemini";
import { CLOSED_INQUIRY_MESSAGE, UUID_PATTERN, saveReplyDraft } from "@/utils/inquiries";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";
import { todayJST } from "@/utils/jst";
import { quoteCustomerText } from "@/utils/prompts/common";
import { RETURN_REPLY_INSTRUCTION, RETURN_REPLY_SCHEMA, type ReturnReplyAnswer } from "@/utils/prompts/D-06";
import {
  findExchangeProducts,
  insertReturnRequest,
  listReturnTemplates,
  listReturnsByInquiry,
  loadReturnOrder,
  searchOrdersForReturn,
  type ReturnOrder,
  type ReturnOrderOption,
  type ReturnTemplateOption,
} from "@/utils/returnRequests";
import {
  RETURN_DECISIONS,
  RETURN_LIMITS,
  RETURN_REASONS,
  REQUEST_TYPES,
  SHIPPING_PAID_BY_REPLY,
  checkAiReturnAmounts,
  checkDecision,
  checkReturnItems,
  checkReturnSearchText,
  checkRuleBlocks,
  isRequestType,
  isReturnReason,
  purposeOfDecision,
  returnItemsText,
  ruleBlocksOf,
  statusOfDecision,
  stripRuleMarkers,
  type RequestType,
  type ReturnDecision,
  type ReturnItemInput,
  type ReturnItemRaw,
  type ShippingPaidBy,
} from "@/utils/returnRules";
import { formatReplyDate } from "@/utils/stockAnswer";
import { getInquiry, type InquiryDetail } from "./inquiryData";

const LIST_URL = "/admin/inquiries";
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;

// ---- EV-02 「探す」・注文を選ぶ ----

export type ReturnSearchResult = { ok: true; items: ReturnOrderOption[] } | { ok: false; message: string };

export async function searchOrdersForReturnPanel(q: string): Promise<ReturnSearchResult> {
  await requireAccess("inquiries", LIST_URL);
  const text = String(q ?? "");
  // CH-01
  const error = checkReturnSearchText(text);
  if (error) return { ok: false, message: error };
  try {
    const items = await searchOrdersForReturn(text, { orderNumber: null, email: null });
    if (items.length === 0)
      return {
        ok: false,
        message: "注文が見つかりません。CROSS MALL の受注CSVを最近取り込んでいるか確かめてください。手で入れることもできます。",
      };
    return { ok: true, items };
  } catch (e) {
    console.error("注文を探せませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "探せませんでした。時間をおいてもう一度お試しください。" };
  }
}

export type ReturnOrderResult = { ok: true; order: ReturnOrder } | { ok: false; message: string };

// 手順3: 選んだ注文の明細(名入れ・加工の内容を含む)
export async function loadReturnOrderForPanel(orderId: string): Promise<ReturnOrderResult> {
  await requireAccess("inquiries", LIST_URL);
  if (!UUID_PATTERN.test(String(orderId ?? ""))) return { ok: false, message: "注文を選び直してください。" };
  try {
    const order = await loadReturnOrder(orderId);
    return order ? { ok: true, order } : { ok: false, message: "この注文は見つかりません。" };
  } catch (e) {
    console.error("注文を読めませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "注文を読めませんでした。時間をおいてもう一度お試しください。" };
  }
}

// ---- EV-04 「AIで返信文の案を作る」・EV-05 「ひな形で案を作る」・EV-06 「受付を登録」 ----

export type ReturnPanelState = { error: string | null };

// フォームから読んだ返品の内容
type PanelInput = {
  order: ReturnOrder | null;
  manual: boolean;
  orderNumber: string | null;
  requestType: RequestType;
  reason: string;
  reasonNote: string | null;
  decision: ReturnDecision;
  shippingPaidBy: ShippingPaidBy | null;
  // 交換先の名前を付けた商品(選んでいない・チェックで落ちたときは空)
  items: (ReturnItemInput & { exchangeName: string | null })[];
  itemsError: string | null;
};

const text = (formData: FormData, name: string): string => String(formData.get(name) ?? "").trim();

// 画面の返品する商品の行
const rawItemsOf = (formData: FormData, manual: boolean): ReturnItemRaw[] => {
  if (manual) {
    const names = formData.getAll("manual_name").map(String);
    const qtys = formData.getAll("manual_qty").map(String);
    const codes = formData.getAll("manual_exchange_code").map(String);
    return names.slice(0, RETURN_LIMITS.manualRows).map((name, i) => ({
      orderItemId: null,
      productName: name,
      quantity: qtys[i] ?? "",
      exchangeProductId: "",
      exchangeProductCode: codes[i] ?? "",
    }));
  }
  return formData
    .getAll("item_id")
    .map(String)
    .filter((id) => UUID_PATTERN.test(id))
    .map((id) => ({
      orderItemId: id,
      productName: "",
      quantity: text(formData, `qty_${id}`),
      exchangeProductId: text(formData, `exchange_${id}`),
      exchangeProductCode: text(formData, `exchange_code_${id}`),
    }));
};

// CH-02・CH-03(交換先を商品マスタで引く)
const resolveItems = async (
  raws: ReturnItemRaw[],
  requestType: RequestType,
  order: ReturnOrder | null
): Promise<{ ok: true; items: PanelInput["items"] } | { ok: false; message: string }> => {
  const checked = checkReturnItems(raws, requestType, order ? order.items : null);
  if (!checked.ok) return checked;
  if (requestType !== "exchange") return { ok: true, items: checked.items.map((i) => ({ ...i, exchangeName: null })) };
  const products = await findExchangeProducts(
    checked.items.map((i) => i.exchangeProductId ?? "").filter(Boolean),
    checked.items.map((i) => i.exchangeProductCode ?? "").filter(Boolean)
  );
  const items: PanelInput["items"] = [];
  for (const i of checked.items) {
    const p = products.find((x) => (i.exchangeProductId ? x.id === i.exchangeProductId : x.productCode === i.exchangeProductCode));
    if (!p) return { ok: false, message: `「${i.productName}」の交換先の商品が見つかりません。使用中の商品を選んでください。` };
    items.push({ ...i, exchangeProductId: p.id, exchangeProductCode: null, exchangeName: p.label });
  }
  return { ok: true, items };
};

const readPanel = async (
  inquiry: InquiryDetail,
  formData: FormData,
  forRegister: boolean
): Promise<{ ok: true; input: PanelInput } | { ok: false; message: string }> => {
  // CH-04
  const decided = checkDecision({ decision: text(formData, "decision"), shippingPaidBy: text(formData, "shipping_paid_by") }, forRegister);
  if (!decided.ok) return decided;
  const requestType = text(formData, "request_type");
  if (!isRequestType(requestType)) return { ok: false, message: "返品か交換かを選んでください。" };
  const reason = text(formData, "reason");
  if (forRegister && !isReturnReason(reason)) return { ok: false, message: "理由を選んでください。" };
  const reasonNote = text(formData, "reason_note");
  if (reasonNote.length > RETURN_LIMITS.reasonNote) return { ok: false, message: `詳しい理由は${RETURN_LIMITS.reasonNote}文字以内で入力してください。` };

  const manual = text(formData, "manual") === "1";
  const orderId = text(formData, "order_id");
  let order: ReturnOrder | null = null;
  if (!manual && orderId) {
    if (!UUID_PATTERN.test(orderId)) return { ok: false, message: "注文を選び直してください。" };
    order = await loadReturnOrder(orderId);
    if (!order) return { ok: false, message: "この注文は見つかりません。探し直してください。" };
  }
  const manualOrderNumber = text(formData, "manual_order_number");
  if (manualOrderNumber.length > RETURN_LIMITS.orderNumber) return { ok: false, message: `注文番号は${RETURN_LIMITS.orderNumber}文字以内で入力してください。` };
  const orderNumber = order ? order.order.orderNo : manualOrderNumber || inquiry.aiExtracted?.order_number?.trim() || null;

  // 受け付ける・お断りするときは、商品が要る(【仮】案を作るときも同じ。00_仮決め一覧 D-06-仮-09)
  const needsItems = forRegister || decided.decision !== "ask_order";
  if (needsItems && !manual && !order) return { ok: false, message: "注文を選ぶか、「注文が見つからない（手で入れる）」を押して商品を入れてください。" };
  let items: PanelInput["items"] = [];
  let itemsError: string | null = null;
  if (manual || order) {
    const resolved = await resolveItems(rawItemsOf(formData, manual), requestType, order);
    if (resolved.ok) items = resolved.items;
    else if (needsItems) return resolved;
    else itemsError = resolved.message;
  }
  return {
    ok: true,
    input: {
      order,
      manual,
      orderNumber,
      requestType,
      reason,
      reasonNote: reasonNote || null,
      decision: decided.decision,
      shippingPaidBy: decided.shippingPaidBy,
      items,
      itemsError,
    },
  };
};

// 名前が分からなければ「お客様」(D-02 01 6.3)
const customerNameOf = (inquiry: InquiryDetail): string => inquiry.customerName ?? inquiry.aiExtracted?.customer_name ?? "お客様";

const missingWarning = (missing: string[]): string[] =>
  missing.length > 0 ? [`入らなかった欄: ${missing.map((m) => `{${m}}`).join("・")}`] : [];

const fallbackCodeOf = (detail: AiFailureDetail, reason: string): string =>
  detail ?? (reason === "quota" || reason === "disabled" ? "limit" : "failed");

// 差し込み欄の値(01 6.4)
const placeholderValues = (input: PanelInput, returnNumber: string | null): Record<string, string | null> => ({
  注文番号: input.orderNumber,
  注文日: input.order ? formatReplyDate(input.order.order.orderedOn) : null,
  返品の商品: input.items.length > 0 ? returnItemsText(input.items) : null,
  送料の負担: input.shippingPaidBy ? SHIPPING_PAID_BY_REPLY[input.shippingPaidBy] : null,
  返品の番号: returnNumber,
});

// 案の根拠(facts)
const returnFacts = (
  input: PanelInput,
  purpose: string,
  returnNumber: string | null,
  warnings: string[],
  subject: string | null
): Record<string, unknown> => ({
  order_id: input.order?.order.id ?? null,
  order_number: input.orderNumber,
  items: input.items.map((i) => ({ name: i.productName, quantity: i.quantity, exchange: i.exchangeName })),
  decision: input.decision,
  shipping_paid_by: input.shippingPaidBy,
  request_type: input.requestType,
  purpose,
  ...(returnNumber ? { return_number: returnNumber } : {}),
  ...(subject ? { subject } : {}),
  ...(warnings.length > 0 ? { warnings } : {}),
});

export async function submitReturnPanel(inquiryId: string, _prev: ReturnPanelState, formData: FormData): Promise<ReturnPanelState> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const inquiry = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!inquiry) redirect(LIST_URL);
  if (inquiry.status === "closed" || inquiry.status === "ignored") return { error: CLOSED_INQUIRY_MESSAGE };
  const mode = text(formData, "mode");
  const rootId = inquiry.parentInquiryId ?? inquiry.id;

  let read: Awaited<ReturnType<typeof readPanel>>;
  try {
    read = await readPanel(inquiry, formData, mode === "register");
  } catch (e) {
    console.error("返品のパネルを読めませんでした:", e instanceof Error ? e.message : e);
    return { error: "注文を読めませんでした。時間をおいてもう一度お試しください。" };
  }
  if (!read.ok) return { error: read.message };
  const input = read.input;

  if (mode === "register") return register(inquiry, rootId, input, me.id);

  // EV-04 手順1・2 / EV-05 手順2: 決定に合う用途のひな形(並び順の先頭)
  let template: ReturnTemplateOption | undefined;
  let signature: string | null;
  let returnNumber: string | null;
  const purpose = purposeOfDecision(input.decision, input.requestType);
  try {
    template = (await listReturnTemplates()).find((t) => t.purpose === purpose);
    signature = await getSignatureText();
    returnNumber = (await listReturnsByInquiry(rootId)).find((r) => r.status !== "cancelled")?.returnNumber ?? null;
  } catch (e) {
    console.error("ひな形を読めませんでした:", e instanceof Error ? e.message : e);
    return { error: "ひな形を読めませんでした。時間をおいてもう一度お試しください。" };
  }
  // ひな形が無ければ、AIも呼ばない(返品の決まりの文が要るため)
  if (!template) return { error: "ひな形がありません（返品の決まりの文が要るため、「返信のひな形」の画面で返品のひな形を先に作ってください）。" };
  const values = placeholderValues(input, returnNumber);
  const name = customerNameOf(inquiry);
  const baseWarnings = input.itemsError ? [`商品は入れませんでした: ${input.itemsError}`] : [];

  let fallback: string | null = null;
  if (mode === "ai") {
    const result = await draftWithAi({ inquiry, input, template, values, signature, name, returnNumber, baseWarnings, by: me.id });
    if (result.ok) finish(inquiry.id, result.saved, "return_ai");
    fallback = result.fallback;
  }

  // EV-05 手順2: 差し込み欄に値を入れ、決まりの囲み記号を外す
  const all = { ...values, お客様名: name, 署名: signature };
  const filled = fillPlaceholders(stripRuleMarkers(template.body), all);
  const subject = template.subject ? fillPlaceholders(template.subject, all).text : null;
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "return",
    draftSource: "template",
    templateId: template.id,
    aiDraft: filled.text,
    facts: returnFacts(input, purpose, returnNumber, [...baseWarnings, ...missingWarning(filled.missing)], subject),
    createdBy: me.id,
  });
  finish(inquiry.id, saved, "return_template", fallback);
}

type DraftContext = {
  inquiry: InquiryDetail;
  input: PanelInput;
  template: ReturnTemplateOption;
  values: Record<string, string | null>;
  signature: string | null;
  name: string;
  returnNumber: string | null;
  baseWarnings: string[];
  by: string;
};

// AIに渡す値(注文者のメール・電話・住所は渡さない。商品名・数・注文日・注文番号だけ。01 7章)
const factsForAi = (input: PanelInput): string =>
  [
    `担当者の決定: ${RETURN_DECISIONS[input.decision]}`,
    `ご依頼: ${REQUEST_TYPES[input.requestType]}`,
    isReturnReason(input.reason) ? `理由: ${RETURN_REASONS[input.reason]}` : null,
    `送料の負担: ${input.shippingPaidBy ? SHIPPING_PAID_BY_REPLY[input.shippingPaidBy] : "なし"}`,
    `注文番号: ${input.orderNumber ?? "なし"}`,
    `注文日: ${input.order ? formatReplyDate(input.order.order.orderedOn) : "なし"}`,
    input.items.length > 0 ? `返品の商品:\n${returnItemsText(input.items)}` : "返品の商品: なし",
  ]
    .filter(Boolean)
    .join("\n");

// EV-04 手順3〜5
const draftWithAi = async (
  ctx: DraftContext
): Promise<{ ok: true; saved: Awaited<ReturnType<typeof saveReplyDraft>> } | { ok: false; fallback: string }> => {
  const { inquiry, input, template } = ctx;
  // ひな形の差し込み欄に先に値を入れる({お客様名}・{署名} は残す。お客様の名前はAIに渡さない)
  const prefilled = fillPlaceholders(template.body, { ...ctx.values, お客様名: "{お客様名}", 署名: "{署名}" });
  const blocks = ruleBlocksOf(prefilled.text);
  const parts = [
    `【こちらが決めた値（使ってよい値はここだけ）】\n${factsForAi(input)}\n【こちらが決めた値（ここまで）】`,
    `【ひな形（手順・期限・送料・返送先の文を含む）】\n${prefilled.text}\n【ひな形（ここまで）】`,
    quoteCustomerText("件名", inquiry.subject ?? ""),
    quoteCustomerText("お客様の文", inquiry.body.slice(0, INQUIRY_LIMITS.aiBody)),
  ];
  const result = await callGeminiJson<ReturnReplyAnswer>({
    featureId: "D-06",
    purpose: "draft_reply",
    targetTable: "inquiries",
    targetId: inquiry.id,
    instruction: RETURN_REPLY_INSTRUCTION,
    input: parts.join("\n\n"),
    schema: RETURN_REPLY_SCHEMA,
    requestedBy: ctx.by,
  });
  if (!result.ok) return { ok: false, fallback: fallbackCodeOf(result.detail, result.reason) };

  // 手順4: CH-07(決まりの文が残っている)・CH-08(金額)。署名を入れる前の、AIが書いた文で見る
  const body = stripRuleMarkers(result.data.body);
  const warnings = [
    ...ctx.baseWarnings,
    ...missingWarning(prefilled.missing),
    ...checkRuleBlocks(body, blocks),
    ...checkAiReturnAmounts(body, input.items, template.body),
  ];
  const filled = fillPlaceholders(body, { お客様名: ctx.name, 署名: ctx.signature });
  warnings.push(...missingWarning(filled.missing));

  // 手順5
  const saved = await saveReplyDraft({
    inquiryId: inquiry.id,
    kind: "return",
    draftSource: "ai",
    templateId: template.id,
    aiDraft: filled.text,
    facts: returnFacts(input, template.purpose, ctx.returnNumber, warnings, result.data.subject ?? null),
    createdBy: ctx.by,
  });
  return { ok: true, saved };
};

// 返信欄に案を出す
function finish(
  inquiryId: string,
  saved: Awaited<ReturnType<typeof saveReplyDraft>>,
  done: "return_ai" | "return_template",
  fallback: string | null = null
): never {
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(inquiryId));
  if (!saved.ok) redirect(`${detailUrl(inquiryId)}?error=${saved.message === CLOSED_INQUIRY_MESSAGE ? "closed" : "reply"}`);
  redirect(`${detailUrl(inquiryId)}?done=${done}${fallback ? `&return_ai=${fallback}` : ""}#reply-${saved.replyId}`);
}

// EV-06 「受付を登録」
const register = async (inquiry: InquiryDetail, rootId: string, input: PanelInput, by: string): Promise<ReturnPanelState> => {
  // readPanel(forRegister)で、決定は受け付ける・お断りする、送料の負担・理由・商品は確かめ済み
  if (input.decision === "ask_order" || !input.shippingPaidBy || !isReturnReason(input.reason)) return { error: "入力を確かめてください。" };
  let result: Awaited<ReturnType<typeof insertReturnRequest>>;
  try {
    result = await insertReturnRequest(
      {
        inquiryId: rootId,
        orderId: input.order?.order.id ?? null,
        orderNumber: input.orderNumber,
        channel: input.order?.order.shop ?? null,
        customerName: input.order?.order.customerName || inquiry.customerName || inquiry.aiExtracted?.customer_name || null,
        requestType: input.requestType,
        reason: input.reason,
        reasonNote: input.reasonNote,
        shippingPaidBy: input.shippingPaidBy,
        status: statusOfDecision(input.decision),
        items: input.items,
      },
      Number(todayJST().slice(0, 4)),
      by
    );
  } catch (e) {
    console.error("返品の受付を登録できませんでした:", e instanceof Error ? e.message : e);
    return { error: "登録できませんでした。時間をおいてもう一度お試しください。" };
  }
  // CH-05・CH-02
  if (!result.ok)
    return {
      error:
        result.reason === "duplicate"
          ? `この問い合わせの返品は登録済みです（${result.existingNumber}）。上の「登録済みの返品」から開いてください。`
          : `「${result.productName}」は、ほかの返品と合わせると注文の数を超えます。`,
    };
  revalidatePath(detailUrl(inquiry.id));
  revalidatePath(`${LIST_URL}/returns`);
  redirect(`${detailUrl(inquiry.id)}?done=return_registered#return-panel`);
};
