// 問い合わせ(D-01)の共通処理。D-02〜D-06 からも使う(03 の 0.4 classifyInquiry・0.5 saveReplyDraft)。
// 呼ぶ側のページ・操作で requireAccess("inquiries", …) を済ませておくこと。
import { createHash } from "node:crypto";
import { query, transaction } from "@/utils/db";
import { callGeminiJson, getAiUsage, type AiFailureDetail, type AiUnavailableReason } from "@/utils/gemini";
import {
  INQUIRY_CATEGORIES,
  INQUIRY_CHANNELS,
  INQUIRY_LIMITS,
  isInquiryCategory,
  type InquiryChannel,
  type ReplyDraftSource,
  type ReplyKind,
} from "@/utils/inquiryRules";
import { quoteCustomerText } from "@/utils/prompts/common";
import { CLASSIFY_INSTRUCTION, CLASSIFY_SCHEMA, type ClassifyAnswer } from "@/utils/prompts/D-01";
import { formatDateTime } from "@/utils/format";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// CH-05 重複確認用の値: 経路・メールアドレス・件名・本文の、前後の空白と改行をそろえたものから作る
const normalizeForHash = (value: string): string =>
  value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");

export const inquiryContentHash = (input: {
  channel: InquiryChannel;
  email: string | null;
  subject: string | null;
  body: string;
}): string =>
  createHash("sha256")
    .update(
      [input.channel, (input.email ?? "").toLowerCase(), normalizeForHash(input.subject ?? ""), normalizeForHash(input.body)].join(
        "\u0000"
      )
    )
    .digest("hex");

// ---- 0.4 classifyInquiry ----

export type ClassifyResult =
  | { ok: true }
  | { ok: false; reason: AiUnavailableReason | "not_found" | "skipped"; detail: AiFailureDetail; message: string };

// auto: 取り込みのときの自動の分類。「残りわずか」になったら呼ばない(04 CH-06【仮】D-01-仮-05)
export const classifyInquiry = async (
  inquiryId: string,
  requestedBy: string | null,
  { auto = false }: { auto?: boolean } = {}
): Promise<ClassifyResult> => {
  // 手順1: 問い合わせを読む。続きなら最初の問い合わせの種類と要約も読む
  const [row] = await query(
    (sql) => sql<
      {
        id: string;
        channel: InquiryChannel;
        subject: string | null;
        body: string;
        received_at: Date;
        parent_category: string | null;
        parent_summary: string | null;
      }[]
    >`
      select i.id, i.channel, i.subject, i.body, i.received_at,
             p.category as parent_category, p.ai_summary as parent_summary
      from inquiries i left join inquiries p on p.id = i.parent_inquiry_id
      where i.id = ${inquiryId}`
  );
  if (!row) return { ok: false, reason: "not_found", detail: null, message: "この問い合わせは見つかりません。" };

  if (auto) {
    const usage = await getAiUsage();
    if (usage.state !== "available")
      return { ok: false, reason: "skipped", detail: null, message: "AIの残りが少ないため、種類は手で選んでください。" };
  }

  // 手順2: AIを呼ぶ。お客様の名前・メールの列は渡さない(CH-07)。本文は先頭から切る(CH-04)
  const parts = [
    `経路: ${INQUIRY_CHANNELS[row.channel]}`,
    `受信日時: ${formatDateTime(row.received_at)}`,
    row.parent_category || row.parent_summary
      ? `前の問い合わせ: 種類 ${row.parent_category ?? "未分類"}／要約 ${row.parent_summary ?? "なし"}`
      : "",
    quoteCustomerText("件名", row.subject ?? ""),
    quoteCustomerText("お客様の文", row.body.slice(0, INQUIRY_LIMITS.aiBody)),
  ].filter(Boolean);
  const result = await callGeminiJson<ClassifyAnswer>({
    featureId: "D-01",
    purpose: "classify",
    targetTable: "inquiries",
    targetId: row.id,
    instruction: CLASSIFY_INSTRUCTION,
    input: parts.join("\n\n"),
    schema: CLASSIFY_SCHEMA,
    requestedBy,
  });
  if (!result.ok) return { ok: false, reason: result.reason, detail: result.detail, message: result.message };

  // 手順3: CH-09 種類が決まった値でなければ other・自信 low
  const valid = isInquiryCategory(result.data.category);
  const category = valid ? result.data.category : "other";
  const confidence = valid ? result.data.confidence : "low";

  // 手順4・5: AIの結果を保存し、担当者がまだ選んでいなければ種類にも入れる
  await query(
    (sql) => sql`
      update inquiries set
        ai_category = ${category},
        ai_confidence = ${confidence},
        ai_summary = ${result.data.summary.slice(0, INQUIRY_LIMITS.summary)},
        ai_extracted = ${result.data.extracted ? sql.json(result.data.extracted as never) : null},
        ai_classified_at = now(),
        category = case when category_source = 'manual' then category else ${category} end,
        category_source = case when category_source = 'manual' then category_source else 'ai' end,
        updated_by = coalesce(${requestedBy}, updated_by)
      where id = ${row.id}`
  );
  return { ok: true };
};

// ---- 0.5 saveReplyDraft ----

export type SaveReplyDraftInput = {
  inquiryId: string;
  kind: ReplyKind;
  draftSource: ReplyDraftSource;
  templateId?: string | null;
  aiDraft?: string | null;
  // 空なら ai_draft と同じにする
  body?: string | null;
  facts?: Record<string, unknown> | null;
  createdBy: string;
};

export const CLOSED_INQUIRY_MESSAGE = "完了した問い合わせです。やり直すを押してください。";

export const saveReplyDraft = async (
  input: SaveReplyDraftInput
): Promise<{ ok: true; replyId: string } | { ok: false; message: string }> =>
  transaction(async (tx) => {
    // 手順1: 完了・対応不要なら保存しない
    const [inq] = await tx<{ status: string }[]>`select status from inquiries where id = ${input.inquiryId} for update`;
    if (!inq) return { ok: false as const, message: "この問い合わせは見つかりません。" };
    if (inq.status === "closed" || inq.status === "ignored") return { ok: false as const, message: CLOSED_INQUIRY_MESSAGE };

    // 手順2
    const body = (input.body ?? input.aiDraft ?? "").slice(0, INQUIRY_LIMITS.reply);
    const [row] = await tx<{ id: string }[]>`
      insert into inquiry_replies (inquiry_id, kind, draft_source, template_id, ai_draft, body, facts, status, created_by, updated_by)
      values (${input.inquiryId}, ${input.kind}, ${input.draftSource}, ${input.templateId ?? null}, ${input.aiDraft ?? null},
              ${body}, ${input.facts ? tx.json(input.facts as never) : null}, 'draft', ${input.createdBy}, ${input.createdBy})
      returning id`;

    // 手順3: 未対応なら対応中にし、担当者が空なら押した人にする
    await tx`
      update inquiries set
        status = case when status = 'new' then 'in_progress' else status end,
        assigned_to = coalesce(assigned_to, ${input.createdBy}),
        updated_by = ${input.createdBy}
      where id = ${input.inquiryId}`;
    return { ok: true as const, replyId: row.id };
  });

// 種類の表示名(未分類は「未分類」)
export const categoryLabel = (category: string | null): string =>
  category && isInquiryCategory(category) ? INQUIRY_CATEGORIES[category] : "未分類";
