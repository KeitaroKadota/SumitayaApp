import Link from "next/link";
import { canAccess, requireAccess } from "@/utils/auth";
import { SHOP_LABELS } from "@/utils/crossmall/types";
import { formatDate, formatDateShort, formatDateTime, formatYen } from "@/utils/format";
import { UUID_PATTERN } from "@/utils/inquiries";
import { getReturnRequest } from "@/utils/returnRequests";
import {
  RETURN_LIMITS,
  RETURN_REASONS,
  RETURN_STATUSES,
  REQUEST_TYPES,
  SHIPPING_PAID_BY,
  canCancelReturn,
} from "@/utils/returnRules";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { TextInput } from "@/components/TextInput";
import { cancelReturnAction } from "../actions";
import { RETURN_STATUS_TONES } from "../returnView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

const ERROR_MESSAGES: Record<string, string> = {
  status: "この返品は取消にできません。",
  reason: "取消の理由を入力してください。",
  reason_long: `取消の理由は${RETURN_LIMITS.cancelReason}文字以内で入力してください。`,
};

// D-06 G03 返品の詳細(03 EV-07・EV-10)
export default async function ReturnRequestDetailPage({ params, searchParams }: PageProps<"/admin/inquiries/returns/[id]">) {
  const { id } = await params;
  const me = await requireAccess("inquiries", `/admin/inquiries/returns/${id}`);
  const query = await searchParams;

  // EV-07 手順2: 返品・明細・注文・元の問い合わせ・記録
  const request = UUID_PATTERN.test(id) ? await getReturnRequest(id) : null;
  if (!request) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/inquiries/returns" label="一覧へ" />
        </div>
        <Alert tone="error">この返品は見つかりません。</Alert>
      </div>
    );
  }
  const error = ERROR_MESSAGES[str(query.error)];
  const canSeeOrders = canAccess(me.roles, "orders");
  const rowClass = "grid grid-cols-[7rem_1fr] gap-x-3 border-b border-line py-2 last:border-b-0";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inquiries/returns" label="一覧へ" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">{request.returnNumber}</h1>
        <span className="text-lg">{REQUEST_TYPES[request.requestType]}</span>
        <Badge tone={RETURN_STATUS_TONES[request.status]}>状態: {RETURN_STATUSES[request.status]}</Badge>
      </div>
      {str(query.done) === "cancelled" && <Alert tone="success">取消にしました。</Alert>}
      {error && <Alert tone="error">{error}</Alert>}

      <section className="rounded-lg border border-line bg-surface px-5 py-2 text-sm">
        <div className={rowClass}>
          <span className="text-ink-muted">元の問い合わせ</span>
          <span>
            {formatDate(request.inquiry.receivedAt)} {request.inquiry.customerName ? `${request.inquiry.customerName} 様` : ""}「
            {request.inquiry.subject ?? "（件名なし）"}」
            <Link href={`/admin/inquiries/${request.inquiryId}`} className="ml-2 font-bold text-primary hover:underline">
              開く
            </Link>
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">注文</span>
          <span>
            {request.order ? (
              <>
                {SHOP_LABELS[request.order.shop]} {request.order.orderNo}（{formatDateShort(request.order.orderedAt)} 注文）
                {canSeeOrders && request.orderId && (
                  <Link href={`/admin/orders/${request.orderId}`} className="ml-2 font-bold text-primary hover:underline">
                    開く
                  </Link>
                )}
              </>
            ) : (
              `${request.orderNumber ?? "−"}（注文データに無し）`
            )}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">お客様</span>
          <span>{request.customerName ? `${request.customerName} 様` : "−"}</span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">商品</span>
          <ul className="flex flex-col gap-1">
            {request.items.map((i) => (
              <li key={i.id}>
                {i.productName} ×{i.quantity}
                {i.unitPrice !== null && <span className="text-ink-muted">（{formatYen(i.unitPrice, "included")}）</span>}
                {i.exchangeName && ` → 交換先 ${i.exchangeName}`}
              </li>
            ))}
          </ul>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">理由</span>
          <span>
            {RETURN_REASONS[request.reason]}
            {request.reasonNote && `（${request.reasonNote}）`}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">送料</span>
          <span>{SHIPPING_PAID_BY[request.shippingPaidBy]}</span>
        </div>
        {request.itemArrivedAt && (
          <div className={rowClass}>
            <span className="text-ink-muted">到着</span>
            <span>{formatDateTime(request.itemArrivedAt)}</span>
          </div>
        )}
        <div className={rowClass}>
          <span className="text-ink-muted">メモ</span>
          <span className="whitespace-pre-wrap break-words">{request.memo ?? "−"}</span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">記録</span>
          <span>
            {formatDateShort(request.createdAt)} 受付（{request.createdByName ?? "−"}）
            {request.updatedAt.getTime() !== request.createdAt.getTime() &&
              ` ／ ${formatDateTime(request.updatedAt)} 更新（${request.updatedByName ?? "−"}）`}
          </span>
        </div>
      </section>

      <p className="text-sm text-ink-muted">返金・交換の処理そのものは、モール・CROSS MALL の画面で行ってください。</p>

      {/* EV-10 取消(理由は必須。CH-06) */}
      {canCancelReturn(request.status) && (
        <details className="rounded-lg border border-line bg-surface p-4">
          <summary className="cursor-pointer text-sm font-bold text-primary">取消…</summary>
          <form action={cancelReturnAction.bind(null, request.id)} className="mt-3 flex flex-col gap-2">
            <Field id="reason" label="取消の理由" required description={`${RETURN_LIMITS.cancelReason}文字まで。メモに残します`}>
              <TextInput id="reason" name="reason" required maxLength={RETURN_LIMITS.cancelReason} />
            </Field>
            <div className="flex justify-end">
              <ConfirmSubmitButton confirmMessage="この返品を取消にしてよいですか？元に戻せません。" pendingText="保存中…">
                取消にする
              </ConfirmSubmitButton>
            </div>
          </form>
        </details>
      )}
    </div>
  );
}
