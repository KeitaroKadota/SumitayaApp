"use server";

// 問い合わせの操作(D-01 EV-03・EV-06〜EV-15)。機能キー inquiries(社長・店舗)。
// 想定内のエラーは throw せず戻り値で返し、入力した内容を残したまま画面に出す(useActionState)。
// お客様への返信は送らない。「送信済みにする」は送ったという記録だけ(楽楽自動応対・モールの画面で担当者が送る)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { isUniqueViolation } from "@/utils/dbErrors";
import { formatDateTime } from "@/utils/format";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import {
  CLOSED_INQUIRY_MESSAGE,
  UUID_PATTERN,
  classifyInquiry,
  inquiryContentHash,
  saveReplyDraft,
  type ClassifyResult,
} from "@/utils/inquiries";
import {
  AFTER_SENT_STATUSES,
  CUSTOM_SPEC_FIELDS,
  FAQ_TOPICS,
  INQUIRY_LIMITS,
  RETURN_REASONS,
  canChangeStatus,
  checkReceivedAt,
  isInquiryCategory,
  isInquiryChannel,
  isInquiryStatus,
  isSentVia,
  parseReceivedAt,
  type AfterSentStatus,
  type CustomSpec,
  type ExtractedProduct,
  type FaqTopic,
  type InquiryExtracted,
  type ReturnReason,
} from "@/utils/inquiryRules";
import { listActiveEmployees } from "@/utils/masters";
import { formText, isValidDateStr, isValidEmail } from "@/utils/textNormalize";
import {
  discardReply,
  findDuplicateInquiry,
  getInquiry,
  getReply,
  insertInquiry,
  listParentCandidates,
  markReplySent,
  updateCategory,
  updateExtracted,
  updateMemo,
  updateReplyBody,
  updateStatusAndAssignee,
  type NewInquiryInput,
} from "./inquiryData";

const LIST_URL = "/admin/inquiries";
const NEW_URL = `${LIST_URL}/new`;
const detailUrl = (id: string) => `${LIST_URL}/${encodeURIComponent(id)}`;
const SAVE_FAILED = "保存できませんでした。時間をおいてもう一度お試しください。";
const NOT_FOUND = "この問い合わせは見つかりません。";
const REPLY_NOT_DRAFT = "この返信文は送信済みか、使わないにしたため、操作できません。新しい案を作ってください。";

// AIで見分けられなかったときに詳細画面へ渡す印(?ai=)
const aiQueryOf = (result: ClassifyResult | null): string => {
  if (!result) return "";
  if (result.ok) return "ai=ok";
  if (result.reason === "skipped") return "ai=skipped";
  if (result.detail) return `ai=${result.detail}`;
  return result.reason === "quota" || result.reason === "disabled" ? "ai=quota" : "ai=failed";
};

// ---- EV-03 「取り込む」(G02) ----

export type ImportState = FormState & { duplicate: { id: string; receivedAt: string } | null };

export async function importInquiry(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const me = await requireAccess("inquiries", NEW_URL);
  const values = formValues(formData);
  const errors: Record<string, string> = {};

  // 手順1・2: CH-01〜CH-04
  const channel = formText(formData, "channel");
  if (!isInquiryChannel(channel)) errors.channel = "経路を選んでください。";

  const receivedRaw = formText(formData, "received_at");
  const receivedAt = parseReceivedAt(receivedRaw);
  const receivedError = receivedRaw ? checkReceivedAt(receivedAt, new Date()) : "受信日時を入力してください。";
  if (receivedError) errors.received_at = receivedError;

  const customerName = formText(formData, "customer_name");
  if (customerName.length > INQUIRY_LIMITS.customerName)
    errors.customer_name = `お客様の名前は${INQUIRY_LIMITS.customerName}文字以内で入力してください。`;

  const email = formText(formData, "customer_email").toLowerCase();
  if (email && !isValidEmail(email)) errors.customer_email = "メールアドレスの形を確かめてください（例: yamada@example.com）。";

  const subject = formText(formData, "subject");
  if (subject.length > INQUIRY_LIMITS.subject) errors.subject = `件名は${INQUIRY_LIMITS.subject}文字以内で入力してください。`;

  const externalId = formText(formData, "external_id");
  if (externalId.length > INQUIRY_LIMITS.externalId)
    errors.external_id = `問い合わせ番号は${INQUIRY_LIMITS.externalId}文字以内で入力してください。`;

  const body = formText(formData, "body");
  if (!body) errors.body = "本文を貼り付けてください。";
  else if (body.length > INQUIRY_LIMITS.body) errors.body = `本文は${INQUIRY_LIMITS.body.toLocaleString("ja-JP")}文字以内にしてください。`;

  const parentId = formText(formData, "parent_inquiry_id");
  if (parentId && !UUID_PATTERN.test(parentId)) errors.parent_inquiry_id = "続きのメッセージを選び直してください。";

  if (Object.keys(errors).length > 0 || !isInquiryChannel(channel) || !receivedAt)
    return { errors, formError: errorSummary(errors), values, duplicate: null };

  const input: NewInquiryInput = {
    channel,
    receivedAt,
    customerName: customerName || null,
    customerEmail: email || null,
    subject: subject || null,
    externalId: externalId || null,
    body,
    contentHash: inquiryContentHash({ channel, email: email || null, subject: subject || null, body }),
    parentInquiryId: parentId || null,
  };

  let id: string;
  try {
    // 手順3: CH-05 重複。「それでも取り込む」が無ければ止める(同じ番号の重複は DB の制約で止まる)
    const duplicate = await findDuplicateInquiry(input);
    const sameExternalId = duplicate && input.externalId;
    if (duplicate && (formData.get("force_duplicate") !== "1" || sameExternalId)) {
      return {
        errors: {},
        formError: sameExternalId
          ? "同じ経路に、同じ問い合わせ番号の問い合わせがあります。番号を確かめてください。"
          : `同じ内容の問い合わせがあります（${formatDateTime(duplicate.receivedAt)}）。それでも取り込みますか？`,
        values,
        duplicate: { id: duplicate.id, receivedAt: duplicate.receivedAt.toISOString() },
      };
    }
    // 手順4
    const inserted = await insertInquiry(input, me.id);
    if (inserted === "parent_not_found") {
      const errs = { parent_inquiry_id: "選んだ問い合わせが見つかりません。選び直してください。" };
      return { errors: errs, formError: errorSummary(errs), values, duplicate: null };
    }
    id = inserted;
  } catch (e) {
    if (isUniqueViolation(e, "inquiries_channel_external_id_key")) {
      const errs = { external_id: "同じ経路に、同じ問い合わせ番号の問い合わせがあります。" };
      return { errors: errs, formError: errorSummary(errs), values, duplicate: null };
    }
    console.error("問い合わせを保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values, duplicate: null };
  }

  // 手順5: AIで種類を見分ける(使えなくても取り込みは成功)
  let classified: ClassifyResult | null = null;
  if (formData.get("classify") === "1") {
    try {
      classified = await classifyInquiry(id, me.id, { auto: true });
    } catch (e) {
      console.error("問い合わせの種類を見分けられませんでした:", e instanceof Error ? e.message : e);
      classified = { ok: false, reason: "error", detail: null, message: "" };
    }
  }

  revalidatePath(LIST_URL);
  // 手順6
  const ai = aiQueryOf(classified);
  redirect(`${detailUrl(id)}?done=imported${ai ? `&${ai}` : ""}`);
}

// EV-02 手順3: メールアドレスを入れたら、続きのメッセージの候補を返す
export async function findParentCandidates(email: string): Promise<{ value: string; label: string }[]> {
  await requireAccess("inquiries", NEW_URL);
  const normalized = email.trim().toLowerCase();
  if (!normalized || !isValidEmail(normalized)) return [];
  try {
    const rows = await listParentCandidates(normalized);
    return rows.map((r) => ({
      value: r.id,
      label: `${formatDateTime(r.receivedAt)} ${r.subject ?? r.summary ?? "（件名なし）"}`.slice(0, 80),
    }));
  } catch (e) {
    console.error("続きのメッセージの候補を読めませんでした:", e instanceof Error ? e.message : e);
    return [];
  }
}

// ---- EV-06 種類を選び直す ----

export async function changeCategory(inquiryId: string, formData: FormData): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  if (!UUID_PATTERN.test(inquiryId)) redirect(LIST_URL);
  // CH-09
  const category = formText(formData, "category");
  if (!isInquiryCategory(category)) redirect(`${detailUrl(inquiryId)}?error=category`);
  const current = await getInquiry(inquiryId);
  if (!current) redirect(LIST_URL);
  await updateCategory(current.id, category, me.id);
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?done=category`);
}

// ---- EV-07 「AIで見分け直す」 ----

export async function reclassifyInquiry(inquiryId: string): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  if (!UUID_PATTERN.test(inquiryId)) redirect(LIST_URL);
  let result: ClassifyResult;
  try {
    result = await classifyInquiry(inquiryId, me.id);
  } catch (e) {
    console.error("問い合わせの種類を見分けられませんでした:", e instanceof Error ? e.message : e);
    result = { ok: false, reason: "error", detail: null, message: "" };
  }
  if (!result.ok && result.reason === "not_found") redirect(LIST_URL);
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(inquiryId));
  redirect(`${detailUrl(inquiryId)}?${aiQueryOf(result)}`);
}

// ---- EV-08 抜き出した情報を直して保存する ----

export async function saveExtracted(inquiryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const values = formValues(formData);
  const current = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!current) return { errors: {}, formError: NOT_FOUND, values };

  const errors: Record<string, string> = {};
  const short = (name: string, label: string): string | null => {
    const v = formText(formData, name);
    if (v.length > INQUIRY_LIMITS.extractedText) errors[name] = `${label}は${INQUIRY_LIMITS.extractedText}文字以内で入力してください。`;
    return v || null;
  };

  const customerName = short("x_customer_name", "お客様の名前");
  const orderNumber = short("x_order_number", "注文番号");

  // 商品の候補(1行ずつ。すべて空の行は捨てる)
  const products: ExtractedProduct[] = [];
  const rowCount = Math.min(Number(formText(formData, "x_product_rows")) || 0, INQUIRY_LIMITS.extractedProducts + 2);
  for (let i = 0; i < rowCount; i++) {
    const name = short(`x_product_${i}_name`, "商品名");
    const code = short(`x_product_${i}_code`, "商品コード");
    const size = short(`x_product_${i}_size`, "サイズ");
    const color = short(`x_product_${i}_color`, "色");
    const qtyRaw = formText(formData, `x_product_${i}_quantity`).normalize("NFKC");
    let quantity: number | null = null;
    if (qtyRaw) {
      if (/^\d{1,6}$/.test(qtyRaw)) quantity = Number(qtyRaw);
      else errors[`x_product_${i}_quantity`] = "数量は数字で入力してください。";
    }
    if (name || code || size || color || quantity !== null) products.push({ name, code, size, color, quantity });
  }
  if (products.length > INQUIRY_LIMITS.extractedProducts)
    errors.x_product_rows = `商品の候補は${INQUIRY_LIMITS.extractedProducts}件までにしてください。`;

  // CH-02 希望日(年-月-日。過去の日付は警告だけ)
  const desiredDate = formText(formData, "x_desired_date");
  if (desiredDate && !isValidDateStr(desiredDate)) errors.x_desired_date = "希望日は「2026-11-23」の形で入力してください。";

  const faqTopics = formData
    .getAll("x_faq_topics")
    .map(String)
    .filter((t): t is FaqTopic => t in FAQ_TOPICS);

  const customSpec: CustomSpec = {};
  for (const [key, label] of Object.entries(CUSTOM_SPEC_FIELDS)) {
    const v = short(`x_custom_${key}`, label);
    if (v) customSpec[key as keyof CustomSpec] = v;
  }

  const returnReason = formText(formData, "x_return_reason");
  if (returnReason && !(returnReason in RETURN_REASONS)) errors.x_return_reason = "返品の理由を選び直してください。";

  const otherTopics = formText(formData, "x_other_topics");
  if (otherTopics.length > INQUIRY_LIMITS.extractedLongText)
    errors.x_other_topics = `ほかの話題は${INQUIRY_LIMITS.extractedLongText}文字以内で入力してください。`;

  if (Object.keys(errors).length > 0) return { errors, formError: errorSummary(errors), values };

  const extracted: InquiryExtracted = {
    customer_name: customerName,
    order_number: orderNumber,
    products: products.length > 0 ? products : null,
    desired_date: desiredDate || null,
    faq_topics: faqTopics.length > 0 ? faqTopics : null,
    custom_spec: Object.keys(customSpec).length > 0 ? customSpec : null,
    return_reason: (returnReason || null) as ReturnReason | null,
    other_topics: otherTopics || null,
  };
  try {
    await updateExtracted(current.id, extracted, me.id);
  } catch (e) {
    console.error("抜き出した情報を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  revalidatePath(detailUrl(current.id));
  // 過去の希望日は警告だけ出して保存する(CH-02)
  const past = desiredDate && desiredDate < new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  redirect(`${detailUrl(current.id)}?done=extracted${past ? "&warn=past_date" : ""}`);
}

// ---- EV-09 状態・担当者を変える、完了にする、対応不要にする ----

export async function changeStatus(inquiryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const values = formValues(formData);
  const current = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!current) return { errors: {}, formError: NOT_FOUND, values };

  const errors: Record<string, string> = {};
  const status = formText(formData, "status");
  // CH-10 状態の移り方(今と同じ状態はそのまま)
  if (!isInquiryStatus(status) || (status !== current.status && !canChangeStatus(current.status, status)))
    errors.status = "この状態には変えられません。";

  let assignedTo: string | null = current.assignedTo;
  if (formData.has("assigned_to")) {
    const v = formText(formData, "assigned_to");
    if (!v) assignedTo = null;
    else if (v === current.assignedTo) assignedTo = v;
    else {
      const staff = await listActiveEmployees({ featureKey: "inquiries" });
      if (!staff.some((e) => e.id === v)) errors.assigned_to = "担当者を選び直してください。";
      else assignedTo = v;
    }
  }
  if (Object.keys(errors).length > 0 || !isInquiryStatus(status)) return { errors, formError: errorSummary(errors), values };

  try {
    await updateStatusAndAssignee(current.id, status, assignedTo, me.id);
  } catch (e) {
    console.error("問い合わせの状態を保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?done=${status === current.status ? "saved" : `status_${status}`}`);
}

// EV-09 「完了にする」「対応不要にする」のボタン(状態だけを変える。担当者はそのまま)
export async function quickChangeStatus(inquiryId: string, formData: FormData): Promise<void> {
  const result = await changeStatus(inquiryId, { errors: {}, formError: null, values: {} }, formData);
  // 成功すれば changeStatus の中で詳細へ移る
  redirect(`${UUID_PATTERN.test(inquiryId) ? detailUrl(inquiryId) : LIST_URL}?error=${result.errors.status ? "status" : "save"}`);
}

// ---- EV-15 社内メモ ----

export async function saveMemo(inquiryId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const values = formValues(formData);
  const current = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!current) return { errors: {}, formError: NOT_FOUND, values };
  const memo = formText(formData, "memo");
  if (memo.length > INQUIRY_LIMITS.memo) {
    const errors = { memo: `社内メモは${INQUIRY_LIMITS.memo.toLocaleString("ja-JP")}文字以内で入力してください。` };
    return { errors, formError: errorSummary(errors), values };
  }
  try {
    await updateMemo(current.id, memo || null, me.id);
  } catch (e) {
    console.error("社内メモを保存できませんでした:", e instanceof Error ? e.message : e);
    return { errors: {}, formError: SAVE_FAILED, values };
  }
  revalidatePath(detailUrl(current.id));
  redirect(`${detailUrl(current.id)}?done=memo`);
}

// ---- EV-14 「手で返信文を書く」 ----

export async function createFreeReply(inquiryId: string): Promise<void> {
  const me = await requireAccess("inquiries", detailUrl(inquiryId));
  const current = UUID_PATTERN.test(inquiryId) ? await getInquiry(inquiryId) : null;
  if (!current) redirect(LIST_URL);
  // 本文は宛名だけ(名前が分からなければ「お客様」)
  const name = current.customerName ?? current.aiExtracted?.customer_name ?? "お客様";
  const result = await saveReplyDraft({
    inquiryId: current.id,
    kind: "free",
    draftSource: "manual",
    body: `${name} 様\n\n`,
    createdBy: me.id,
  });
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(current.id));
  if (!result.ok) redirect(`${detailUrl(current.id)}?error=${result.message === CLOSED_INQUIRY_MESSAGE ? "closed" : "reply"}`);
  redirect(`${detailUrl(current.id)}?done=reply_created#reply-${result.replyId}`);
}

// ---- EV-10 返信文を保存する(EV-11 のコピーの前にも呼ぶ) ----

export type ReplyActionResult = { ok: boolean; message: string };

export async function saveReplyBody(replyId: string, body: string): Promise<ReplyActionResult> {
  const me = await requireAccess("inquiries", LIST_URL);
  const reply = UUID_PATTERN.test(replyId) ? await getReply(replyId) : null;
  if (!reply) return { ok: false, message: "この返信文は見つかりません。" };
  // CH-11・CH-04・本文が空でない
  if (reply.status !== "draft") return { ok: false, message: REPLY_NOT_DRAFT };
  const text = String(body ?? "");
  if (!text.trim()) return { ok: false, message: "返信文を入力してください。" };
  if (text.length > INQUIRY_LIMITS.reply)
    return { ok: false, message: `返信文は${INQUIRY_LIMITS.reply.toLocaleString("ja-JP")}文字以内にしてください。` };
  try {
    if (!(await updateReplyBody(reply.id, text, me.id))) return { ok: false, message: REPLY_NOT_DRAFT };
  } catch (e) {
    console.error("返信文を保存できませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: SAVE_FAILED };
  }
  revalidatePath(detailUrl(reply.inquiryId));
  return { ok: true, message: "保存しました。" };
}

// ---- EV-12 「送信済みにする」 ----

export async function markSent(replyId: string, _prev: ReplyActionResult, formData: FormData): Promise<ReplyActionResult> {
  const me = await requireAccess("inquiries", LIST_URL);
  const reply = UUID_PATTERN.test(replyId) ? await getReply(replyId) : null;
  if (!reply) return { ok: false, message: "この返信文は見つかりません。" };
  // CH-11・CH-12
  if (reply.status !== "draft") return { ok: false, message: REPLY_NOT_DRAFT };
  const sentVia = formText(formData, "sent_via");
  if (!isSentVia(sentVia)) return { ok: false, message: "送った画面を選んでください。" };
  const after = formText(formData, "after_status");
  if (!(AFTER_SENT_STATUSES as readonly string[]).includes(after)) return { ok: false, message: "送った後の状態を選んでください。" };

  // 画面の本文に保存していない変更があれば、先に保存する
  const body = formData.get("body");
  if (typeof body === "string") {
    const saved = await saveReplyBody(reply.id, body);
    if (!saved.ok) return saved;
  }
  try {
    if (!(await markReplySent(reply.id, sentVia, after as AfterSentStatus, me.id))) return { ok: false, message: REPLY_NOT_DRAFT };
  } catch (e) {
    console.error("送信の記録を保存できませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, message: "記録できませんでした。時間をおいてもう一度お試しください。" };
  }
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(reply.inquiryId));
  redirect(`${detailUrl(reply.inquiryId)}?done=sent`);
}

// ---- EV-13 「使わない」 ----

export async function discardReplyAction(replyId: string): Promise<void> {
  const me = await requireAccess("inquiries", LIST_URL);
  const reply = UUID_PATTERN.test(replyId) ? await getReply(replyId) : null;
  if (!reply) redirect(LIST_URL);
  // CH-11
  const ok = reply.status === "draft" && (await discardReply(reply.id, me.id));
  revalidatePath(LIST_URL);
  revalidatePath(detailUrl(reply.inquiryId));
  redirect(`${detailUrl(reply.inquiryId)}?${ok ? "done=discarded" : "error=not_draft"}`);
}
