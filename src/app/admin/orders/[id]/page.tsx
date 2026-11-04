import { requireAccess } from "@/utils/auth";
import { listOpenOrderExceptions } from "@/utils/crossmall/laterLinks";
import { SHOP_LABELS } from "@/utils/crossmall/types";
import { formatDate, formatDateTime, formatQuantity, formatYen } from "@/utils/format";
import { getOrderWithItems } from "@/utils/orders";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { BackLink } from "@/components/LinkButton";

const PAYMENT_STATUS_LABELS = { paid: "支払済み", unpaid: "未払い", unknown: "支払の状態は不明" } as const;

// 郵便番号の表示(7桁なら 123-4567)
const postal = (code: string | null) => (code && /^\d{7}$/.test(code) ? `〒${code.slice(0, 3)}-${code.slice(3)}` : code ? `〒${code}` : "");

// G02 受注の詳細(B-01 EV-02)。この画面では注文を直せない(CROSS MALL 側で直して取り込み直す)
export default async function OrderDetailPage({ params }: PageProps<"/admin/orders/[id]">) {
  const { id } = await params;
  // 手順1
  await requireAccess("orders", `/admin/orders/${id}`);

  // 手順2
  const order = await getOrderWithItems(id);
  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/orders" label="一覧へ" />
        </div>
        <Alert tone="error">この注文は見つかりません。</Alert>
      </div>
    );
  }
  // 手順3: この注文の未対応の例外(B-02。【仮】B-02 はまだ無いので空。00_仮決め一覧 B-01-仮-14)
  const exceptions = await listOpenOrderExceptions(order.id);

  const rowClass = "grid grid-cols-[8rem_1fr] gap-2 border-b border-line py-2 last:border-b-0";
  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/orders" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">受注の詳細</h1>

      {exceptions.length > 0 && (
        <Alert tone="warning">
          <p className="font-bold">例外（B-02）</p>
          {exceptions.map((e) => (
            <p key={e}>{e}</p>
          ))}
        </Alert>
      )}

      <section className="rounded-lg border border-line bg-surface px-5 py-2 text-sm">
        <div className={rowClass}>
          <span className="text-ink-muted">注文番号</span>
          <span className="tabular-nums">
            {order.shopOrderNo ?? "−"}（{SHOP_LABELS[order.shop]}） CROSS MALL受注番号 {order.crossmallOrderNo}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">注文日時</span>
          <span className="tabular-nums">
            {formatDateTime(order.orderedAt)}　状態 {order.crossmallStatus ?? "−"}
            {order.isCancelled && <Badge tone="danger">キャンセル</Badge>}　出荷日{" "}
            {order.shippedOn ? formatDate(order.shippedOn) : "−"}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">支払</span>
          <span>
            {order.paymentMethod ?? "−"}（{PAYMENT_STATUS_LABELS[order.paymentStatus]}）
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">注文者</span>
          <span>
            {order.customerName}
            {order.customerKana && `（${order.customerKana}）`} {order.customerPhone ?? ""} {order.customerEmail ?? ""}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">届け先</span>
          <span>
            {postal(order.shipPostalCode)} {order.shipPrefecture ?? ""}
            {order.shipAddress1 ?? ""} {order.shipAddress2 ?? ""} {order.shipName} {order.shipPhone ?? ""}
          </span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">希望日</span>
          <span>{order.requestedDeliveryDate ? formatDate(order.requestedDeliveryDate) : "−"}</span>
        </div>
        <div className={rowClass}>
          <span className="text-ink-muted">備考</span>
          <span className="whitespace-pre-wrap">{order.customerNote ?? "−"}</span>
        </div>
      </section>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className="px-3 py-2 text-right">No</th>
              <th className="px-3 py-2">商品コード</th>
              <th className="px-3 py-2">商品名・選択項目</th>
              <th className="px-3 py-2 text-right">数量</th>
              <th className="px-3 py-2 text-right">単価（円）</th>
              <th className="px-3 py-2 text-right">金額（円）</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((i) => (
              <tr key={i.lineNo} className="border-b border-line last:border-b-0 align-top">
                <td className="px-3 py-2 text-right tabular-nums">{i.lineNo}</td>
                <td className="px-3 py-2 tabular-nums">
                  {i.productCode}
                  {/* 商品マスタに無い商品コード(CH-08) */}
                  {!i.productId && (
                    <span className="ml-1">
                      <Badge tone="warning">⚠未登録</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  {i.productName}
                  {i.optionText && <p className="text-ink-muted">{i.optionText}</p>}
                  {i.hasCustomization && <p>名入れ: あり（{i.customizationText ?? ""}）</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(i.quantity)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(i.unitPrice)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(i.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-right text-sm tabular-nums">
        商品 {formatYen(order.subtotal)} 送料 {formatYen(order.shippingFee)} 値引 {formatYen(order.discount)} 税{" "}
        {formatYen(order.tax)} 合計 {formatYen(order.total, "included")}
      </p>
      <p className="text-sm text-ink-muted">最後の取り込み {formatDateTime(order.updatedAt)}</p>
      <p className="text-sm text-ink-muted">※この画面では注文を直せません。CROSS MALL で直してから、受注CSVを取り込み直してください。</p>

      <details className="rounded-lg border border-line bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-bold">取り込んだ元のデータを見る</summary>
        <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap break-all">
          {JSON.stringify(order.rawRow, null, 2)}
        </pre>
      </details>
    </div>
  );
}
