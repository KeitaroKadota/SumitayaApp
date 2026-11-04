// D-06 のパネル(G01)と、返品の案に付ける根拠・注意。D-01 の詳細画面(page.tsx)から使うサーバーの部品。
// 呼ぶ側のページで requireAccess("inquiries", …) を済ませておくこと。
import Link from "next/link";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { formatDateShort } from "@/utils/format";
import { RETURN_REASONS } from "@/utils/inquiryRules";
import { purposeLabel } from "@/utils/replyTemplateRules";
import {
  listReturnTemplates,
  listReturnsByInquiry,
  loadReturnOrder,
  searchOrdersForReturn,
  type ReturnOrder,
  type ReturnOrderOption,
  type ReturnRequestSummary,
} from "@/utils/returnRequests";
import {
  RETURN_DECISIONS,
  RETURN_POLICY,
  RETURN_STATUSES,
  REQUEST_TYPES,
  SHIPPING_PAID_BY,
  isReturnDecision,
  isShippingPaidBy,
} from "@/utils/returnRules";
import type { InquiryDetail, InquiryReply } from "../inquiryData";
import { submitReturnPanel } from "../returnReplyActions";
import { RETURN_STATUS_TONES } from "../returns/returnView";
import { ReturnRequestPanel } from "./ReturnRequestPanel";

// AIで作れずにひな形で作ったときの文(?return_ai=。EV-04 手順3)
const RETURN_AI_FALLBACK: Record<string, string> = {
  no_key: "AIの設定（APIキー）がありません。",
  limit: "本日のAIの利用回数に達しました。",
  bad_key: "AIのAPIキーが正しくありません。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  bad_model: "AIのモデル名が見つかりません。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  failed: "",
};
export const returnFallbackMessage = (code: string): string | undefined =>
  code in RETURN_AI_FALLBACK ? `AIで作れませんでした。ひな形で案を作ります。${RETURN_AI_FALLBACK[code]}` : undefined;

// 返品の決まりの目安(【仮】。担当者が見て決める。00_仮決め一覧 D-06-仮-01〜03)
function PolicyGuide() {
  return (
    <details className="rounded-md border border-line p-3 text-sm">
      <summary className="cursor-pointer font-bold">返品の決まりの目安（仮。すみたや様に確認中）</summary>
      <ul className="mt-2 flex flex-col gap-1">
        <li>期限: {RETURN_POLICY.deadline}</li>
        <li>返品できない商品: {RETURN_POLICY.notReturnable}</li>
        <li>送料: {RETURN_POLICY.shippingStore}。{RETURN_POLICY.shippingCustomer}</li>
        <li>返送先: {RETURN_POLICY.returnAddress ?? "未確認"}</li>
      </ul>
      <p className="mt-2 text-ink-muted">
        受け付けるか・送料をどちらが負担するかは、担当者が決めてください（システムでは判定しません）。期限・手順・返送先の文は、返品のひな形の本文に【決まり】〜【ここまで】で囲んで書きます。
      </p>
    </details>
  );
}

function ExistingReturns({ returns }: { returns: ReturnRequestSummary[] }) {
  if (returns.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 text-sm">
      <p className="font-bold">登録済みの返品</p>
      <ul className="flex flex-col gap-1">
        {returns.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{r.returnNumber}</span>
            <span>{REQUEST_TYPES[r.requestType]}</span>
            <Badge tone={RETURN_STATUS_TONES[r.status]}>{RETURN_STATUSES[r.status]}</Badge>
            <span className="text-ink-muted">{formatDateShort(r.createdAt)} 受付</span>
            <Link href={`/admin/inquiries/returns/${r.id}`} className="font-bold text-primary hover:underline">
              開く
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// G01 EV-01 パネルを開く
export async function ReturnPanelSection({
  inquiry,
  closed,
  aiStopped,
  registered,
}: {
  inquiry: InquiryDetail;
  closed: boolean;
  aiStopped: boolean;
  registered: boolean;
}) {
  const rootId = inquiry.parentInquiryId ?? inquiry.id;
  const extracted = inquiry.aiExtracted ?? {};
  let returns: ReturnRequestSummary[];
  let candidates: ReturnOrderOption[] = [];
  let initialOrder: ReturnOrder | null = null;
  let templatePurposes: string[] = [];
  try {
    // 手順1: この問い合わせ(または最初の問い合わせ)の返品
    returns = await listReturnsByInquiry(rootId);
    if (!closed) {
      // 手順2: 抜き出した注文番号・メールアドレスで探し、1件だけなら選んだ状態にする
      candidates = await searchOrdersForReturn("", {
        orderNumber: extracted.order_number ?? null,
        email: inquiry.customerEmail,
      });
      if (candidates.length === 1) initialOrder = await loadReturnOrder(candidates[0].id);
      templatePurposes = [...new Set((await listReturnTemplates()).map((t) => t.purpose))];
    }
  } catch (e) {
    console.error("返品のパネルを読めませんでした:", e instanceof Error ? e.message : e);
    return <Alert tone="error">注文を読めませんでした。時間をおいてもう一度お試しください。</Alert>;
  }

  const found = [
    extracted.order_number ? `注文番号 ${extracted.order_number}` : null,
    extracted.return_reason ? `理由 ${RETURN_REASONS[extracted.return_reason] ?? extracted.return_reason}` : null,
  ].filter(Boolean);
  const missingTemplates = (["return_accept", "exchange_accept", "return_ask_order", "return_reject"] as const).filter(
    (p) => !templatePurposes.includes(p)
  );

  return (
    <div className="flex flex-col gap-3">
      {registered && <Alert tone="success">返品の受付を登録しました。返信の送信は、問い合わせの返信欄から行ってください。</Alert>}
      <ExistingReturns returns={returns} />
      {closed ? (
        <p className="text-sm text-ink-muted">完了・対応不要の問い合わせです。返信するときは、状態を「対応中」に戻してください。</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-ink-muted">AIが見つけた情報: </span>
            {found.length > 0 ? found.join(" ／ ") : <span className="text-ink-muted">なし</span>}
          </p>
          <PolicyGuide />
          {missingTemplates.length > 0 && (
            <p className="text-sm text-ink-muted">
              まだ無い返品のひな形: {missingTemplates.map((p) => purposeLabel("return", p)).join("・")}。「返信のひな形」の画面で作ってください。
            </p>
          )}
          <ReturnRequestPanel
            action={submitReturnPanel.bind(null, inquiry.id)}
            initialQuery={extracted.order_number ?? ""}
            initialCandidates={candidates}
            initialOrder={initialOrder}
            initialReason={extracted.return_reason ?? ""}
            aiStopped={aiStopped}
          />
        </>
      )}
    </div>
  );
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

// 返品の案の上に出す根拠・注意(担当者の決定・送料の負担・商品・警告。CH-07・CH-08)
export function ReturnDraftNotes({ reply }: { reply: InquiryReply }) {
  const facts = reply.facts ?? {};
  const warnings = stringList(facts.warnings);
  const decision = typeof facts.decision === "string" && isReturnDecision(facts.decision) ? RETURN_DECISIONS[facts.decision] : null;
  const shipping =
    typeof facts.shipping_paid_by === "string" && isShippingPaidBy(facts.shipping_paid_by) ? SHIPPING_PAID_BY[facts.shipping_paid_by] : null;
  const items = Array.isArray(facts.items)
    ? facts.items.flatMap((i) => {
        if (!i || typeof i !== "object") return [];
        const o = i as Record<string, unknown>;
        if (typeof o.name !== "string" || typeof o.quantity !== "number") return [];
        return [`${o.name} ×${o.quantity}${typeof o.exchange === "string" && o.exchange ? ` → ${o.exchange}` : ""}`];
      })
    : [];
  const subject = typeof facts.subject === "string" ? facts.subject : null;
  const orderNumber = typeof facts.order_number === "string" ? facts.order_number : null;
  return (
    <div className="mb-2 flex flex-col gap-2 text-sm">
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      <p>
        担当者の決定: {decision ?? "−"}　送料の負担: {shipping ?? "−"}　注文番号: {orderNumber ?? "−"}
      </p>
      {items.length > 0 && <p>商品: {items.join("／")}</p>}
      {subject && <p>件名の案: {subject}</p>}
    </div>
  );
}
