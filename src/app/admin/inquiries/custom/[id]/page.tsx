import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import {
  CUSTOM_QUOTE_STATUSES,
  calcEstimate,
  canChangeQuoteStatus,
  canRecordFactoryRequest,
  factoryRequestMissing,
  isClosedQuoteStatus,
  itemTypeOptions,
  priceOptions,
} from "@/utils/customQuote";
import { formatDate, formatDateTime, formatYen } from "@/utils/format";
import { getAiUsage } from "@/utils/gemini";
import { UUID_PATTERN } from "@/utils/inquiries";
import { listActiveEmployees } from "@/utils/masters";
import { AiUsageNotice } from "@/components/AiUsageNotice";
import { Alert } from "@/components/Alert";
import { AutoSubmitSelect } from "@/components/AutoSubmitSelect";
import { Badge } from "@/components/Badge";
import { buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { listAllPriceItems } from "../../price-items/priceItemData";
import {
  changeQuoteAssignee,
  changeQuoteStatusAction,
  createAskDraft,
  createEstimateDraft,
  recordFactoryRequestAction,
  saveQuoteSpec,
} from "../actions";
import { getQuote, listCustomTemplates, listQuoteThread } from "../quoteData";
import { ESTIMATE_LINE_LABELS } from "../quoteText";
import { QUOTE_STATUS_TONES, missingItemText, quoteCandidates, specFormValues } from "../quoteView";
import { FactoryRequestForm, ModeButton, QuickStatusForm, ReasonStatusForm } from "./QuoteActionForms";
import { QUOTE_SPEC_FORM_ID, QuoteSpecForm } from "./QuoteSpecForm";

// AIで案を作る(最大30秒)ため、操作の最大時間を60秒にする
export const maxDuration = 60;

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

const DONE_MESSAGES: Record<string, string> = {
  created: "特注の案件を作りました。AIが抜き出した仕様を確かめてください。",
  spec: "仕様を保存しました。",
  estimated: "仕様を保存し、概算を計算しました。",
  assignee: "担当を保存しました。",
  requested: "工場に依頼したことを記録しました。",
  won: "受注にしました。製造の手配は今までどおり行ってください。",
  lost: "失注にしました。",
  cancelled: "取消にしました。",
  reverted: "工場に依頼済みに戻しました。",
};
// 案を作ったとき(EV-06 手順5・EV-07・EV-09)
const DRAFT_DONE = new Set(["ask_ai", "ask_template", "estimate_ai", "estimate_template"]);
const ERROR_MESSAGES: Record<string, string> = {
  assignee: "担当を選び直してください。",
  closed_quote: "受注・失注・取消にした案件です。",
  inquiry_closed: "元の問い合わせが完了・対応不要です。問い合わせの画面で「対応中」に戻してください。",
  no_missing: "足りない項目はありません。",
  template: "ひな形を選び直してください。",
  no_template: "ひな形がありません。問い合わせの画面の「手で返信文を書く」から作ってください。",
  no_estimate: "先に概算を計算してください。",
  reply: "返信文の案を保存できませんでした。時間をおいてもう一度お試しください。",
};
// AIで作れずにひな形に切り替えたときの文(?ai_fallback=)
const AI_FALLBACK: Record<string, string> = {
  no_key: "AIの設定（APIキー）がありません。",
  limit: "本日のAIの利用回数に達しました。",
  bad_key: "AIのAPIキーが正しくありません。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  bad_model: "AIのモデル名が見つかりません。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  failed: "",
};

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

// D-04 G03 特注の案件の詳細(03 EV-04)
export default async function CustomQuoteDetailPage({ params, searchParams }: PageProps<"/admin/inquiries/custom/[id]">) {
  const { id } = await params;
  const me = await requireAccess("inquiries", `/admin/inquiries/custom/${id}`);
  const query = await searchParams;

  const quote = UUID_PATTERN.test(id) ? await getQuote(id) : null;
  if (!quote) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/inquiries/custom" label="一覧へ" />
        </div>
        <Alert tone="error">この案件は見つかりません。</Alert>
      </div>
    );
  }

  // EV-04 手順2: 案件・元の問い合わせ・続き・単価表
  const [thread, items, staff, usage, askTemplates] = [
    await listQuoteThread(quote.inquiryId),
    await listAllPriceItems(),
    await listActiveEmployees({ featureKey: "inquiries" }),
    await getAiUsage(),
    await listCustomTemplates("custom_ask"),
  ];
  const root = thread.find((m) => m.id === quote.inquiryId);
  const childCount = thread.filter((m) => m.parentInquiryId).length;
  const candidates = quoteCandidates(quote, thread, items);
  const readOnly = isClosedQuoteStatus(quote.status);
  const aiStopped = usage.state === "stopped";
  const isPresident = me.roles.includes("president");
  const factoryMissing = factoryRequestMissing(quote.spec);
  const inquiryHref = `/admin/inquiries/${quote.inquiryId}`;

  const doneCode = str(query.done);
  const done = DONE_MESSAGES[doneCode];
  const replyId = str(query.reply);
  const error = ERROR_MESSAGES[str(query.error)];
  const fallbackCode = str(query.ai_fallback);
  const fallback = fallbackCode in AI_FALLBACK ? `AIで作れませんでした。ひな形で案を作ります。${AI_FALLBACK[fallbackCode]}` : null;
  // EV-08 手順2: 計算できなかった理由(今の仕様で計算し直して出す)
  const estimateFailed = str(query.est) === "failed" ? calcEstimate(quote.spec, items) : null;
  const closedDone = doneCode === "won" || doneCode === "lost" || doneCode === "cancelled";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/custom" label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold break-words">
            {quote.quoteNumber} {quote.organizationName ?? "（団体名なし）"}
          </h1>
          <Badge tone={QUOTE_STATUS_TONES[quote.status]}>{CUSTOM_QUOTE_STATUSES[quote.status]}</Badge>
        </div>
        <form action={changeQuoteAssignee.bind(null, quote.id)} className="flex items-end gap-2">
          <Field id="assigned_to" label="担当">
            <AutoSubmitSelect id="assigned_to" name="assigned_to" defaultValue={quote.assignedTo ?? ""} className="w-40">
              <option value="">（なし）</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.lastName} {e.firstName}
                </option>
              ))}
            </AutoSubmitSelect>
          </Field>
          <noscript>
            <SubmitButton variant="secondary">保存する</SubmitButton>
          </noscript>
        </form>
      </div>

      {root && (
        <p className="text-sm">
          元の問い合わせ: {formatDate(root.receivedAt)} {root.customerName ? `${root.customerName} 様` : ""}「{root.subject ?? "（件名なし）"}」
          <Link href={inquiryHref} className="ml-2 font-bold text-primary hover:underline">
            開く
          </Link>
          {childCount > 0 && <span className="ml-2 text-ink-muted">（続き{childCount}件）</span>}
        </p>
      )}

      {done && <Alert tone="success">{done}</Alert>}
      {DRAFT_DONE.has(doneCode) && (
        <Alert tone="success">
          返信文の案を作りました。問い合わせの画面で確認・送信してください。
          <Link href={`${inquiryHref}${UUID_PATTERN.test(replyId) ? `#reply-${replyId}` : ""}`} className="ml-2 font-bold underline">
            開く
          </Link>
        </Alert>
      )}
      {/* EV-12 手順3: 元の問い合わせが完了でなければ聞く */}
      {closedDone && root && root.status !== "closed" && root.status !== "ignored" && (
        <Alert tone="info">
          問い合わせも完了にしますか？
          <Link href={inquiryHref} className="ml-2 font-bold underline">
            問い合わせを開く
          </Link>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {fallback && <Alert tone="warning">{fallback}</Alert>}
      {str(query.warn) === "past_date" && (
        <Alert tone="warning">希望納期が過去の日付です。お客様の文を確かめてください（保存はしました）。</Alert>
      )}
      {query.cleared === "1" && <Alert tone="warning">仕様が変わったので概算を計算し直してください。</Alert>}
      {estimateFailed && !estimateFailed.ok && (
        <Alert tone="error">概算を計算できません: {estimateFailed.reasons.join(" ")}</Alert>
      )}
      <AiUsageNotice usage={usage} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左: 仕様(EV-03・EV-05) */}
        <Section id="spec" title="仕様">
          {readOnly && <p className="text-sm text-ink-muted">受注・失注・取消にした案件のため、仕様は直せません。</p>}
          <QuoteSpecForm
            key={quote.updatedAt.getTime()}
            action={saveQuoteSpec.bind(null, quote.id)}
            initialValues={specFormValues(quote, items)}
            itemTypes={itemTypeOptions(items)}
            fabricOptions={priceOptions(items, "fabric")}
            printOptions={priceOptions(items, "print")}
            candidates={candidates}
            readOnly={readOnly}
          />
        </Section>

        {/* 右 */}
        <div className="flex min-w-0 flex-col gap-4">
          {/* EV-06・EV-07 足りない項目と聞き返し */}
          <Section title="足りない項目">
            {quote.missingItems.length === 0 ? (
              <p className="text-sm">✓ 必ず聞く項目はそろっています。</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {quote.missingItems.map((m) => (
                  <li key={m}>✕ {missingItemText(quote, m)}</li>
                ))}
              </ul>
            )}
            {!readOnly && quote.missingItems.length > 0 && (
              <form action={createAskDraft.bind(null, quote.id)} className="flex flex-col gap-2">
                <Field id="ask_template_id" label="ひな形">
                  <Select id="ask_template_id" name="template_id" defaultValue={askTemplates[0]?.id ?? ""} className="max-w-xs">
                    {askTemplates.length === 0 ? (
                      <option value="">（聞き返しのひな形がありません）</option>
                    ) : (
                      askTemplates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))
                    )}
                  </Select>
                </Field>
                <div className="flex flex-wrap gap-2">
                  <ModeButton mode="ai" variant="primary" disabled={aiStopped}>
                    AIで聞き返しの案を作る
                  </ModeButton>
                  <ModeButton mode="template" variant="secondary" disabled={askTemplates.length === 0}>
                    ひな形で案を作る
                  </ModeButton>
                </div>
                {aiStopped && <p className="text-sm text-ink-muted">AIが停止中のため、「ひな形で案を作る」を使ってください。</p>}
              </form>
            )}
          </Section>

          {/* EV-08・EV-09 概算 */}
          <Section title="概算">
            {quote.estimate ? (
              <>
                <table className="w-full text-sm">
                  <tbody>
                    {quote.estimate.lines.map((l) => (
                      <tr key={l.priceItemId} className="border-b border-line">
                        <td className="py-1 pr-2 whitespace-nowrap">{ESTIMATE_LINE_LABELS[l.kind]}</td>
                        <td className="py-1 pr-2">
                          {l.name} {formatYen(l.unitPrice)}×{l.qty}
                          {l.unit === "per_piece" ? "枚" : "回"}
                        </td>
                        <td className="py-1 text-right tabular-nums">{formatYen(l.amount)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="py-1" colSpan={2}>
                        小計（税抜）
                      </td>
                      <td className="py-1 text-right tabular-nums">{formatYen(quote.estimate.subtotal)}</td>
                    </tr>
                    <tr>
                      <td className="py-1" colSpan={2}>
                        消費税
                      </td>
                      <td className="py-1 text-right tabular-nums">{formatYen(quote.estimate.tax)}</td>
                    </tr>
                    <tr className="font-bold">
                      <td className="py-1" colSpan={2}>
                        合計（税込）
                      </td>
                      <td className="py-1 text-right tabular-nums">{formatYen(quote.estimate.total)}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="text-sm text-ink-muted">計算した日時: {formatDateTime(quote.estimate.estimatedAt)}</p>
              </>
            ) : (
              <p className="text-sm text-ink-muted">まだ計算していません。</p>
            )}
            {!readOnly && (
              <div className="flex flex-col gap-2">
                <div>
                  {/* 仕様を保存してから計算する(左の仕様のフォームを送る) */}
                  <button type="submit" form={QUOTE_SPEC_FORM_ID} name="intent" value="estimate" className={buttonClassName("secondary")}>
                    概算を計算
                  </button>
                </div>
                <form action={createEstimateDraft.bind(null, quote.id)} className="flex flex-wrap gap-2">
                  <ModeButton mode="ai" variant="primary" disabled={aiStopped || !quote.estimate}>
                    AIで概算の案内の案を作る
                  </ModeButton>
                  <ModeButton mode="template" variant="secondary" disabled={!quote.estimate}>
                    ひな形で概算の案を作る
                  </ModeButton>
                </form>
                {!quote.estimate && <p className="text-sm text-ink-muted">概算の案は、先に概算を計算すると作れます。</p>}
              </div>
            )}
          </Section>

          {/* EV-10・EV-14 工場への見積依頼 */}
          <Section title="工場への見積依頼">
            {factoryMissing.length > 0 ? (
              <p className="text-sm text-ink-muted">依頼の仕様を出すには、次の項目を入れてください: {factoryMissing.join("・")}</p>
            ) : (
              <div>
                <Link href={`/admin/inquiries/custom/${quote.id}/print`} className={buttonClassName("secondary")}>
                  依頼の仕様を出す・印刷
                </Link>
              </div>
            )}
            {canRecordFactoryRequest(quote.status) && factoryMissing.length === 0 && (
              <FactoryRequestForm
                action={recordFactoryRequestAction.bind(null, quote.id)}
                alreadyRequested={quote.factoryRequestedAt !== null}
              />
            )}
            {quote.factoryRequestedAt && (
              <div className="flex flex-col gap-1 text-sm">
                <p>
                  依頼済み: {formatDateTime(quote.factoryRequestedAt)} {quote.factoryRequestedByName ?? ""}
                </p>
                {quote.factoryRequestText && (
                  <details className="rounded-md border border-line p-3">
                    <summary className="cursor-pointer font-bold">依頼した内容</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">{quote.factoryRequestText}</p>
                  </details>
                )}
              </div>
            )}
          </Section>

          {/* EV-12 受注・失注・取消 */}
          <Section title="結果">
            {quote.status === "won" && quote.wonAt && <p className="text-sm">受注: {formatDateTime(quote.wonAt)}</p>}
            {(quote.status === "lost" || quote.status === "cancelled") && (
              <p className="text-sm">
                {CUSTOM_QUOTE_STATUSES[quote.status]}: {quote.closedAt ? formatDateTime(quote.closedAt) : ""} 理由: {quote.closedReason ?? "−"}
              </p>
            )}
            <div className="flex flex-col gap-2">
              {canChangeQuoteStatus(quote.status, "won", isPresident) && (
                <QuickStatusForm
                  action={changeQuoteStatusAction.bind(null, quote.id)}
                  to="won"
                  label="受注にする"
                  confirmMessage="受注にしてよいですか？"
                  variant="primary"
                />
              )}
              {canChangeQuoteStatus(quote.status, "lost", isPresident) && (
                <ReasonStatusForm action={changeQuoteStatusAction.bind(null, quote.id)} to="lost" label="失注にする" />
              )}
              {canChangeQuoteStatus(quote.status, "cancelled", isPresident) && (
                <ReasonStatusForm action={changeQuoteStatusAction.bind(null, quote.id)} to="cancelled" label="取消にする" />
              )}
              {/* 間違えたとき(社長だけ。CH-12) */}
              {(quote.status === "won" || quote.status === "lost") && canChangeQuoteStatus(quote.status, "factory_requested", isPresident) && (
                <QuickStatusForm
                  action={changeQuoteStatusAction.bind(null, quote.id)}
                  to="factory_requested"
                  label="工場に依頼済みに戻す"
                  confirmMessage="受注・失注を取り消して、工場に依頼済みに戻します。よいですか？"
                />
              )}
              {quote.status === "cancelled" && <p className="text-sm text-ink-muted">取消にした案件は、状態を変えられません。</p>}
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
