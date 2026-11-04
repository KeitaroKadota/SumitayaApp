// E-05 の画面で使う表示の部品(02 G01・G02 の Badge の色、宛先・明細・合計の読むだけの表示)。DBを読まない。
import { Badge, type BadgeTone } from "@/components/Badge";
import { formatDate, formatDateShort, formatQuantity, formatYen } from "@/utils/format";
import {
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  PRICE_BASES,
  addresseeOf,
  formatInvoiceQty,
  taxSummaryRows,
  type InvoiceStatus,
  type PaymentStatus,
  type PriceBasis,
  type TotalsView,
} from "@/utils/invoices";
import type { Invoice, InvoiceLine } from "@/utils/invoicesServer";

// 状態: 下書き＝neutral、発行済み＝success、取消＝neutral＋取り消し線
const STATUS_TONES: Record<InvoiceStatus, BadgeTone> = { draft: "neutral", issued: "success", void: "neutral" };

export function StatusBadge({ status }: { status: InvoiceStatus }) {
  return (
    <span className={status === "void" ? "line-through" : ""}>
      <Badge tone={STATUS_TONES[status]}>{INVOICE_STATUSES[status]}</Badge>
    </span>
  );
}

// 入金: 未入金＝warning、入金済み＝success。期限を過ぎた未入金は「期限切れ」(danger)。発行済みだけに出す
export function PaymentBadge({
  status,
  paymentStatus,
  dueOn,
  today,
}: {
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  dueOn: string | null;
  today: string;
}) {
  if (status !== "issued") return <span className="text-ink-muted">−</span>;
  if (paymentStatus === "unpaid" && dueOn && dueOn < today) return <Badge tone="danger">期限切れ</Badge>;
  return <Badge tone={paymentStatus === "paid" ? "success" : "warning"}>{PAYMENT_STATUSES[paymentStatus]}</Badge>;
}

// 宛名の表示。発行済み・取消は写した値、下書きは今の取引先
export const addresseeOfInvoice = (i: Invoice): string =>
  i.status === "draft" ? addresseeOf(i.currentCustomerName, i.currentCustomerHonorific) : addresseeOf(i.customerName, i.customerHonorific);

// 合計の表(税率ごとの合計と消費税、税抜合計、ご請求額)
export function TotalsBox({ totals, basis, title = "合計" }: { totals: TotalsView; basis: PriceBasis; title?: string }) {
  return (
    <section className="flex max-w-md flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm tabular-nums">
      <h2 className="mb-1 font-bold">{title}</h2>
      {taxSummaryRows(totals, basis).map((r) => (
        <p key={r.key} className="flex justify-between gap-4">
          <span>
            {r.label} {formatYen(r.amount)}
            {r.amountNote}
          </span>
          {r.taxLabel && (
            <span>
              {r.taxLabel} {formatYen(r.tax ?? 0)}
            </span>
          )}
        </p>
      ))}
      <p className="flex justify-between gap-4 border-t border-line pt-1">
        <span>税抜合計 {formatYen(totals.subtotal)}</span>
        <span>消費税 {formatYen(totals.tax)}</span>
      </p>
      <p className="text-lg font-bold">ご請求額（税込） {formatYen(totals.total)}</p>
    </section>
  );
}

// 発行済み・取消の請求書の中身(読むだけ。02 G02「発行済みのとき」)
export function InvoiceReadOnly({ invoice, lines }: { invoice: Invoice; lines: InvoiceLine[] }) {
  const basisLabel = PRICE_BASES[invoice.priceBasis];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 className="mb-1 font-bold">宛先</h2>
          <p className="text-base font-bold">{addresseeOfInvoice(invoice)}</p>
          {invoice.customerPostalCode && <p>〒{invoice.customerPostalCode}</p>}
          {invoice.customerAddress && <p className="break-words">{invoice.customerAddress}</p>}
          {invoice.customerContact && <p>ご担当 {invoice.customerContact}様</p>}
          <p>件名: {invoice.subject ?? "−"}</p>
        </section>
        <section className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 className="mb-1 font-bold">日付</h2>
          <p>発行日: {invoice.issuedOn ? formatDate(invoice.issuedOn) : "−"}</p>
          <p>
            取引期間: {invoice.periodStart ? formatDate(invoice.periodStart) : "−"} 〜 {invoice.periodEnd ? formatDate(invoice.periodEnd) : "−"}
          </p>
          <p>お支払期限: {invoice.dueOn ? formatDate(invoice.dueOn) : "−"}</p>
        </section>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className="px-3 py-2">日付</th>
              <th className="px-3 py-2">品名</th>
              <th className="px-3 py-2 text-right">数量</th>
              <th className="px-3 py-2 text-right">単価（{basisLabel}・円）</th>
              <th className="px-3 py-2 text-right">金額（{basisLabel}・円）</th>
              <th className="px-3 py-2">税率</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">{l.transactionOn ? formatDateShort(l.transactionOn) : "−"}</td>
                <td className="px-3 py-2 break-words">
                  {l.description}
                  {l.taxRate === 8 && "※"}
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatInvoiceQty(l.quantity100, l.unit ?? "")}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{l.unitPrice === null ? "−" : formatQuantity(l.unitPrice)}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">{formatQuantity(l.amount)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{l.taxRate}％</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <TotalsBox totals={invoice} basis={invoice.priceBasis} />
      {invoice.note && <p className="text-sm whitespace-pre-wrap break-words">備考: {invoice.note}</p>}
    </div>
  );
}
