import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { formatDate, formatDateTime } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { categoryLabel } from "@/utils/inquiries";
import {
  AI_CONFIDENCES,
  CUSTOM_SPEC_FIELDS,
  FAQ_TOPICS,
  INQUIRY_CATEGORIES,
  INQUIRY_CATEGORY_SHORT,
  INQUIRY_CHANNELS,
  INQUIRY_STATUSES,
  REPLY_DRAFT_SOURCES,
  REPLY_KINDS,
  RETURN_REASONS,
  SENT_VIA,
  canChangeStatus,
  defaultSentVia,
  manualNextStatuses,
  type InquiryCategory,
  type InquiryExtracted,
} from "@/utils/inquiryRules";
import { listActiveEmployees } from "@/utils/masters";
import { AiDraft } from "@/components/AiDraft";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import {
  changeCategory,
  changeStatus,
  createFreeReply,
  discardReplyAction,
  quickChangeStatus,
  reclassifyInquiry,
  saveExtracted,
  saveMemo,
} from "../actions";
import { getInquiry, listReplies, listThreadMessages, type InquiryMessage } from "../inquiryData";
import { STATUS_TONES } from "../statusTone";
import { ExtractedForm, MemoForm, StatusAssigneeForm } from "./InquiryForms";
import { ReplyDraftCard } from "./ReplyDraftCard";

// AIで見分け直す(最大30秒)ため、操作の最大時間を60秒にする
export const maxDuration = 60;

const DONE_MESSAGES: Record<string, string> = {
  imported: "取り込みました。",
  category: "種類を保存しました。",
  extracted: "抜き出した情報を保存しました。",
  saved: "保存しました。",
  memo: "社内メモを保存しました。",
  reply_created: "返信文の枠を作りました。",
  sent: "送信済みとして記録しました。",
  discarded: "使わないにしました。",
  status_closed: "完了にしました。",
  status_ignored: "対応不要にしました。",
  status_in_progress: "対応中にしました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  category: "種類を選び直してください。",
  closed: "完了した問い合わせです。やり直すを押してください。",
  reply: "返信文の枠を作れませんでした。時間をおいてもう一度お試しください。",
  not_draft: "この返信文は送信済みか、使わないにしたため、操作できません。",
  status: "この状態には変えられません。",
  save: "保存できませんでした。時間をおいてもう一度お試しください。",
};
// AIで見分けられなかったときの文(?ai=。D-01 01 7.4)
const AI_MESSAGES: Record<string, { tone: "success" | "warning"; text: string }> = {
  ok: { tone: "success", text: "AIで種類を見分けました。内容を確認してください。" },
  skipped: { tone: "warning", text: "AIの残りが少ないため、AIでは見分けませんでした。種類を手で選んでください。" },
  quota: { tone: "warning", text: "本日のAIの利用回数に達しました。種類は手で選び、返信はひな形から作ってください。" },
  no_key: { tone: "warning", text: "AIの設定（APIキー）がありません。種類を手で選んでください。" },
  limit: { tone: "warning", text: "本日のAIの利用回数に達しました。種類は手で選び、返信はひな形から作ってください。" },
  bad_key: {
    tone: "warning",
    text: "AIのAPIキーが正しくないため、AIを使えませんでした。種類を手で選んでください。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  },
  bad_model: {
    tone: "warning",
    text: "AIのモデル名が見つからないため、AIを使えませんでした。種類を手で選んでください。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  },
  failed: { tone: "warning", text: "AIで見分けられませんでした。手で選んでください。" },
};

// 種類ごとのパネル(D-02・D-03・D-04・D-06 が作る。今は置き場所だけ)
const PANEL_FEATURES: Partial<Record<InquiryCategory, string>> = {
  stock: "D-02 在庫照会",
  faq: "D-03 よくある質問",
  custom: "D-04 特注",
  return: "D-06 返品",
};

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

function MessageView({ m }: { m: InquiryMessage }) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="text-ink-muted">
        経路: {INQUIRY_CHANNELS[m.channel]}　受信: {formatDateTime(m.receivedAt)}
      </p>
      <p>
        {m.customerName ?? "（名前なし）"}
        {m.customerEmail && <span className="text-ink-muted"> &lt;{m.customerEmail}&gt;</span>}
      </p>
      <p>件名: {m.subject ?? "（件名なし）"}</p>
      <hr className="border-line" />
      <p className="whitespace-pre-wrap break-words">{m.body}</p>
    </div>
  );
}

function ExtractedView({ x }: { x: InquiryExtracted }) {
  const rows: [string, string][] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value) rows.push([label, value]);
  };
  push("お客様の名前", x.customer_name);
  push("注文番号", x.order_number);
  push(
    "商品",
    (x.products ?? [])
      .map((p) => [p.name, p.code, p.size, p.color].filter(Boolean).join(" ") + (p.quantity ? ` ${p.quantity}点` : ""))
      .filter(Boolean)
      .join("／")
  );
  push("希望日", x.desired_date ? formatDate(x.desired_date) : null);
  push("よくある質問の話題", (x.faq_topics ?? []).map((t) => FAQ_TOPICS[t] ?? t).join("・"));
  push(
    "特注の仕様",
    Object.entries(x.custom_spec ?? {})
      .filter(([, v]) => v)
      .map(([k, v]) => `${CUSTOM_SPEC_FIELDS[k as keyof typeof CUSTOM_SPEC_FIELDS] ?? k}: ${v}`)
      .join("／")
  );
  push("返品の理由", x.return_reason ? (RETURN_REASONS[x.return_reason] ?? x.return_reason) : null);
  push("ほかの話題", x.other_topics);
  if (rows.length === 0) return <p className="text-sm text-ink-muted">抜き出した情報はありません。</p>;
  return (
    <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

// 根拠(facts)の要点。D-02〜D-06 が入れた値を「名前: 値」で並べる
const factsText = (facts: Record<string, unknown>): string =>
  Object.entries(facts)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join("／");

// G04 問い合わせの詳細(D-01 EV-05)。開いただけでは状態を変えない
export default async function InquiryDetailPage({ params, searchParams }: PageProps<"/admin/inquiries/[id]">) {
  const { id } = await params;
  await requireAccess("inquiries", `/admin/inquiries/${id}`);
  const query = await searchParams;

  // 手順1
  const inquiry = /^[0-9a-f-]{36}$/i.test(id) ? await getInquiry(id) : null;
  if (!inquiry) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/inquiries" label="一覧へ" />
        </div>
        <Alert tone="error">この問い合わせは見つかりません。</Alert>
      </div>
    );
  }

  // 手順2〜5
  const thread = await listThreadMessages(inquiry);
  const replies = await listReplies(inquiry.id);
  const staff = await listActiveEmployees({ featureKey: "inquiries" });
  const usage = await getAiUsage();

  const done = DONE_MESSAGES[str(query.done)];
  const error = ERROR_MESSAGES[str(query.error)];
  const ai = AI_MESSAGES[str(query.ai)];
  const pastDateWarning = str(query.warn) === "past_date";

  const closedOrIgnored = inquiry.status === "closed" || inquiry.status === "ignored";
  const drafts = replies.filter((r) => r.status === "draft");
  const sent = replies.filter((r) => r.status === "sent");
  const discarded = replies.filter((r) => r.status === "discarded");
  const title = `${inquiry.subject ?? "（件名なし）"}${inquiry.customerName ? `（${inquiry.customerName} 様）` : ""}`;
  const staffOptions = staff.map((e) => ({ value: e.id, label: `${e.lastName} ${e.firstName}` }));
  const panel = inquiry.category ? PANEL_FEATURES[inquiry.category] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries" label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold break-words">{title}</h1>
        <Badge tone={STATUS_TONES[inquiry.status]}>{INQUIRY_STATUSES[inquiry.status]}</Badge>
      </div>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {ai && <Alert tone={ai.tone}>{ai.text}</Alert>}
      {pastDateWarning && <Alert tone="warning">希望日が過去の日付です。お客様の文を確かめてください（保存はしました）。</Alert>}
      <AiUsageNotice usage={usage} />

      {/* EV-09 状態・担当者、完了にする、対応不要にする */}
      <section className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <StatusAssigneeForm
          action={changeStatus.bind(null, inquiry.id)}
          status={inquiry.status}
          nextStatuses={manualNextStatuses(inquiry.status)}
          assignedTo={inquiry.assignedTo ?? ""}
          staff={staffOptions}
        />
        <div className="flex flex-wrap gap-2">
          {canChangeStatus(inquiry.status, "closed") && (
            <form action={quickChangeStatus.bind(null, inquiry.id)}>
              <input type="hidden" name="status" value="closed" />
              {drafts.length > 0 ? (
                <ConfirmSubmitButton
                  variant="secondary"
                  pendingText="保存中…"
                  confirmMessage="完了にしてよいですか？使わなかった案は破棄します。"
                >
                  完了にする
                </ConfirmSubmitButton>
              ) : (
                <SubmitButton variant="secondary" pendingText="保存中…">
                  完了にする
                </SubmitButton>
              )}
            </form>
          )}
          {canChangeStatus(inquiry.status, "ignored") && (
            <form action={quickChangeStatus.bind(null, inquiry.id)}>
              <input type="hidden" name="status" value="ignored" />
              <ConfirmSubmitButton
                variant="danger"
                pendingText="保存中…"
                confirmMessage="対応不要にしてよいですか？迷惑メール・営業メール・重複などのときに使います。"
              >
                対応不要にする
              </ConfirmSubmitButton>
            </form>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左: 届いた内容 */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">届いた内容</h2>
            <MessageView m={inquiry} />
          </section>
          {thread.length > 0 && (
            <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
              <h2 className="text-lg font-bold">同じやり取りのメッセージ（{thread.length}件）</h2>
              {thread.map((m) => (
                <details key={m.id} className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm font-bold">
                    {formatDateTime(m.receivedAt)} {m.parentInquiryId ? "続き" : "最初の問い合わせ"}
                    <Link href={`/admin/inquiries/${m.id}`} className="ml-2 text-primary hover:underline">
                      開く
                    </Link>
                  </summary>
                  <div className="mt-2">
                    <MessageView m={m} />
                  </div>
                </details>
              ))}
            </section>
          )}
          <section className="rounded-lg border border-line bg-surface p-5">
            <MemoForm action={saveMemo.bind(null, inquiry.id)} memo={inquiry.memo ?? ""} />
          </section>
        </div>

        {/* 右: 種類・抜き出した情報・返信欄 */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            {/* EV-06 種類を選び直す(選ぶとすぐ保存する) */}
            <form action={changeCategory.bind(null, inquiry.id)} className="flex flex-wrap items-end gap-3">
              <Field id="category" label="種類">
                <AutoSubmitSelect id="category" name="category" defaultValue={inquiry.category ?? ""} className="w-56">
                  {!inquiry.category && (
                    <option value="" disabled>
                      未分類（選んでください）
                    </option>
                  )}
                  {Object.entries(INQUIRY_CATEGORIES).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </Field>
              <noscript>
                <SubmitButton variant="secondary">保存する</SubmitButton>
              </noscript>
              {inquiry.category && (
                <Badge tone={inquiry.categorySource === "ai" ? "ai" : "success"}>
                  {inquiry.categorySource === "ai" ? "AIのまま" : "担当者が選んだ"}
                </Badge>
              )}
            </form>

            {/* EV-07 AIで見分け直す */}
            <form action={reclassifyInquiry.bind(null, inquiry.id)} className="flex flex-col gap-1">
              <div>
                <SubmitButton variant="secondary" pendingText="見分け中…" disabled={usage.state === "stopped"}>
                  AIで見分け直す
                </SubmitButton>
              </div>
              {usage.state === "stopped" && <p className="text-sm text-ink-muted">AIが停止中のため押せません。種類は手で選んでください。</p>}
            </form>

            {inquiry.aiClassifiedAt && (
              <AiDraft title="AIの見分け" createdAt={inquiry.aiClassifiedAt}>
                <div className="flex flex-col gap-2 text-sm">
                  <p>
                    種類: {inquiry.aiCategory ? INQUIRY_CATEGORY_SHORT[inquiry.aiCategory] : "−"}（自信:{" "}
                    {inquiry.aiConfidence ? AI_CONFIDENCES[inquiry.aiConfidence] : "−"}）
                    {inquiry.aiConfidence === "low" && <span className="ml-2 text-warning">⚠ 要確認</span>}
                  </p>
                  {inquiry.aiSummary && <p>要約: {inquiry.aiSummary}</p>}
                </div>
              </AiDraft>
            )}

            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-bold">抜き出した情報</h3>
              <ExtractedView x={inquiry.aiExtracted ?? {}} />
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-bold text-primary">直す</summary>
                <div className="mt-3">
                  <ExtractedForm action={saveExtracted.bind(null, inquiry.id)} extracted={inquiry.aiExtracted ?? {}} />
                </div>
              </details>
            </div>

            {/* 種類ごとのパネル(D-02・D-03・D-04・D-06 の画面がここに入る) */}
            <div className="rounded-md border border-dashed border-line-strong p-3 text-sm text-ink-muted">
              {!inquiry.category
                ? "種類を選んでください。"
                : panel
                  ? `${categoryLabel(inquiry.category)}の返信の案（${panel}）は、この場所に出します（準備中）。いまは下の「手で返信文を書く」から作ってください。`
                  : "その他の問い合わせは、下の「手で返信文を書く」から返信文を作ってください。"}
            </div>
          </section>

          {/* 返信欄(EV-10〜EV-14) */}
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
            <h2 className="text-lg font-bold">返信文</h2>
            {replies.length === 0 && <p className="text-sm text-ink-muted">返信文はまだありません。</p>}

            {drafts.map((r, idx) => {
              const card = (
                <ReplyDraftCard
                  replyId={r.id}
                  initialBody={r.body}
                  defaultSentVia={defaultSentVia(inquiry.channel)}
                  discardAction={discardReplyAction.bind(null, r.id)}
                />
              );
              const heading = `案${drafts.length - idx} ${REPLY_KINDS[r.kind]}`;
              return (
                <div key={r.id} id={`reply-${r.id}`} className="flex flex-col gap-2 rounded-md border border-line p-3">
                  {r.draftSource === "ai" ? (
                    <AiDraft title={heading} createdAt={r.createdAt}>
                      {r.facts && <p className="mb-2 text-sm">根拠: {factsText(r.facts)}</p>}
                      {card}
                    </AiDraft>
                  ) : (
                    <>
                      <p className="text-sm font-bold">
                        {heading}（{REPLY_DRAFT_SOURCES[r.draftSource]}）{formatDateTime(r.createdAt)} 作成
                      </p>
                      {r.facts && <p className="text-sm">根拠: {factsText(r.facts)}</p>}
                      {card}
                    </>
                  )}
                </div>
              );
            })}

            {sent.map((r) => (
              <div key={r.id} className="flex flex-col gap-2 rounded-md border border-line p-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
                  <Badge tone="success">送信済み</Badge>
                  {REPLY_KINDS[r.kind]}
                </p>
                <p className="text-sm text-ink-muted">
                  送信の記録: {r.sentAt ? formatDateTime(r.sentAt) : "−"} {r.sentVia ? SENT_VIA[r.sentVia] : ""} {r.sentByName ?? ""}
                </p>
                <p className="text-sm whitespace-pre-wrap break-words">{r.body}</p>
              </div>
            ))}

            {discarded.length > 0 && (
              <details className="rounded-md border border-line p-3">
                <summary className="cursor-pointer text-sm font-bold">使わなかった案（{discarded.length}件）</summary>
                {discarded.map((r) => (
                  <div key={r.id} className="mt-2 flex flex-col gap-1 border-t border-line pt-2 text-sm">
                    <p className="font-bold">
                      {REPLY_KINDS[r.kind]}（{formatDateTime(r.createdAt)} 作成）
                    </p>
                    <p className="whitespace-pre-wrap break-words text-ink-muted">{r.body}</p>
                  </div>
                ))}
              </details>
            )}

            {/* EV-14 手で返信文を書く(完了・対応不要のときは「対応中」に戻してから) */}
            {closedOrIgnored ? (
              <p className="text-sm text-ink-muted">完了・対応不要の問い合わせです。返信するときは、状態を「対応中」に戻してください。</p>
            ) : (
              <form action={createFreeReply.bind(null, inquiry.id)}>
                <SubmitButton variant="secondary" pendingText="作成中…">
                  ＋ 手で返信文を書く
                </SubmitButton>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
