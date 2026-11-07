// D-04 のパネル(G01 特注のパネル)と、特注の案に付ける注意。D-01 の詳細画面(page.tsx)から使うサーバーの部品。
// 呼ぶ側のページで requireAccess("inquiries", …) を済ませておくこと。
import Link from "next/link";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { SubmitButton } from "@/components/SubmitButton";
import { CUSTOM_QUOTE_STATUSES, type SpecCandidate } from "@/utils/customQuote";
import { formatDate, formatYen } from "@/utils/format";
import { CUSTOM_SPEC_FIELDS, type CustomSpecField } from "@/utils/inquiryRules";
import { createQuoteFromInquiry } from "../custom/actions";
import { findQuoteByInquiry, listQuoteThread, type CustomQuote } from "../custom/quoteData";
import { QUOTE_STATUS_TONES, missingItemText, quoteCandidates } from "../custom/quoteView";
import { listAllPriceItems } from "../price-items/priceItemData";
import type { InquiryDetail, InquiryReply } from "../inquiryData";

// 0.3 で外した「ご予算」は出さない
const SHOWN_SPEC_FIELDS: CustomSpecField[] = ["group_name", "item", "design", "fabric", "size_and_quantity", "name_print", "desired_delivery"];

// EV-01 パネルを開く
export async function CustomQuotePanel({ inquiry, closed }: { inquiry: InquiryDetail; closed: boolean }) {
  const rootId = inquiry.parentInquiryId ?? inquiry.id;
  // 手順1: この問い合わせ(または最初の問い合わせ)につながる案件。案件があれば、続きの仕様の候補も読む
  let loaded: { quote: CustomQuote | null; candidates: SpecCandidate[] } | null = null;
  try {
    const quote = await findQuoteByInquiry(rootId);
    const candidates = quote ? quoteCandidates(quote, await listQuoteThread(rootId), await listAllPriceItems()) : [];
    loaded = { quote, candidates };
  } catch (e) {
    console.error("特注の案件を読めませんでした:", e instanceof Error ? e.message : e);
  }

  let content: React.ReactNode;
  if (!loaded) {
    content = <Alert tone="error">特注の案件を読めませんでした。時間をおいてもう一度お試しください。</Alert>;
  } else if (!loaded.quote) {
    // 手順2: AIが抜き出した仕様の要約と「案件を作る」
    const spec = inquiry.aiExtracted?.custom_spec ?? {};
    const summary = [
      ...SHOWN_SPEC_FIELDS.map((k) => (spec[k] ? `${CUSTOM_SPEC_FIELDS[k]} ${spec[k]}` : null)),
      inquiry.aiExtracted?.desired_date ? `${formatDate(inquiry.aiExtracted.desired_date)}まで` : null,
    ].filter(Boolean);
    content = (
      <>
        <p className="text-sm">AIが見つけた仕様: {summary.length > 0 ? summary.join("・") : "なし"}</p>
        {closed ? (
          <p className="text-sm text-ink-muted">完了・対応不要の問い合わせです。案件を作るときは、状態を「対応中」に戻してください。</p>
        ) : (
          <form action={createQuoteFromInquiry.bind(null, inquiry.id)}>
            <SubmitButton pendingText="作成中…">この問い合わせから特注の案件を作る</SubmitButton>
          </form>
        )}
      </>
    );
  } else {
    // 手順3: 番号・団体名・状態・足りない項目。続きのメッセージに、案件に入っていない仕様があれば知らせる
    const quote = loaded.quote;
    const href = `/admin/inquiries/custom/${quote.id}`;
    content = (
      <>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-bold">{quote.quoteNumber}</span>
          <span>{quote.organizationName ?? "（団体名なし）"}</span>
          <Badge tone={QUOTE_STATUS_TONES[quote.status]}>{CUSTOM_QUOTE_STATUSES[quote.status]}</Badge>
        </p>
        <p className="text-sm">
          足りない項目: {quote.missingItems.length > 0 ? quote.missingItems.map((m) => missingItemText(quote, m)).join("、") : "なし"}
        </p>
        {loaded.candidates.length > 0 && (
          <Alert tone="info">
            新しい返事に仕様があります。
            <Link href={`${href}#spec`} className="ml-2 font-bold underline">
              案件に取り込む
            </Link>
          </Alert>
        )}
        <p className="text-sm text-ink-muted">聞き返し・概算の案は、案件の画面で作ります。作った案は下の返信欄に入ります。</p>
        <div>
          <Link href={href} className="font-bold text-primary hover:underline">
            案件を開く
          </Link>
        </div>
      </>
    );
  }
  return (
    <div id="custom-panel" className="flex flex-col gap-3 rounded-md border border-line p-3">
      <h3 className="font-bold">特注</h3>
      {content}
    </div>
  );
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export const isCustomReplyKind = (kind: InquiryReply["kind"]): boolean => kind === "custom_ask" || kind === "custom_estimate";

// 特注の案(kind = custom_ask・custom_estimate)の上に出す根拠・注意(03 EV-06〜EV-09)
export function CustomDraftNotes({ reply }: { reply: InquiryReply }) {
  const facts = reply.facts ?? {};
  const quoteId = typeof facts.quote_id === "string" ? facts.quote_id : null;
  const quoteNumber = typeof facts.quote_number === "string" ? facts.quote_number : null;
  const missing = stringList(facts.missing_items);
  const warnings = stringList(facts.warnings);
  const subject = typeof facts.subject === "string" ? facts.subject : null;
  const total = typeof facts.estimate_total === "number" ? facts.estimate_total : null;
  return (
    <div className="mb-2 flex flex-col gap-2 text-sm">
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {quoteId && (
        <p>
          特注の案件:{" "}
          <Link href={`/admin/inquiries/custom/${quoteId}`} className="font-bold text-primary hover:underline">
            {quoteNumber ?? "開く"}
          </Link>
        </p>
      )}
      {missing.length > 0 && <p>聞き返す項目: {missing.join("・")}</p>}
      {total !== null && <p>概算の合計（税込）: {formatYen(total)}（計算の値）</p>}
      {subject && <p>件名の案: {subject}</p>}
    </div>
  );
}
