import { notFound } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatDateTime, formatQuantity, formatYen } from "@/utils/format";
import { todayJST } from "@/utils/jst";
import { PO_STATUSES, SEND_METHODS, calcPoTotals, canOperate } from "@/utils/purchaseOrderRules";
import { currentRounding, getCompanySettings } from "@/utils/invoicesServer";
import { defaultExpectedDate, getPurchaseOrder, supplierContactWarning } from "@/utils/purchaseOrdersAdmin";
import { Alert } from "@/components/Alert";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { BackLink } from "@/components/LinkButton";
import { buttonClassName } from "@/components/Button";
import { cancelDraftAction, closeOrderAction, markOrderedAction, saveDraftAction } from "../actions";
import { PoDraftForm, PoOrderForm } from "./PoForms";

const td = "px-3 py-2";

// G06 発注の詳細(下書きの編集・発注の記録)(A-03 EV-09・EV-12〜EV-15)
export default async function PurchaseOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  await requireAccess("sales", `/admin/purchase-orders/${id}`);
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  const today = todayJST();
  const draft = po.status === "draft";
  const company = await getCompanySettings();
  // 税率ごとの小計と消費税(0.4。画面の表示)
  const totals = calcPoTotals(po.lines, currentRounding(company));
  const contactWarning = supplierContactWarning(po);
  const openQty = po.lines.reduce((s, l) => s + Math.max(0, l.quantity - l.receivedQty), 0);
  const zeroPrice = po.lines.some((l) => l.unitPrice === 0);

  // 記録の流れ(作成 → 発注 → 打ち切り／取消)
  const history = [
    `${formatDateTime(po.createdAt)} 作成（${po.createdByName ?? "−"}）`,
    ...(po.orderedAt ? [`${formatDateTime(po.orderedAt)} 発注（${po.orderedByName ?? "−"}）`] : []),
    ...(po.closedAt ? [`${formatDateTime(po.closedAt)} 打ち切り（${po.closedByName ?? "−"}）`] : []),
    ...(po.cancelledAt ? [`${formatDateTime(po.cancelledAt)} 取消（${po.cancelledByName ?? "−"}）`] : []),
  ];
  const flag = (k: string) => typeof sp[k] === "string";

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/purchase-orders" label="発注の一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">
        発注 {po.orderNo}　{po.supplier.name}　<span className="text-lg">状態: {PO_STATUSES[po.status]}</span>
      </h1>
      <p className="text-sm text-ink-muted">
        {po.source === "suggestion" ? `提案から作成${po.runCreatedAt ? `（${formatDateTime(po.runCreatedAt)} の計算）` : ""}` : "手で作成"}
        {po.orderDate && `　発注日 ${formatDateShort(po.orderDate)}`}
        {po.sendMethod && `（${SEND_METHODS[po.sendMethod]}）`}
        {po.expectedDate && `　入荷予定 ${formatDateShort(po.expectedDate)}`}
      </p>

      {flag("created") && <Alert tone="success">発注の下書きを作りました。</Alert>}
      {flag("ordered") && <Alert tone="success">発注したことを記録しました。</Alert>}
      {flag("cancelled") && <Alert tone="success">取消しました。</Alert>}
      {flag("closed") && <Alert tone="success">残りを打ち切りました。</Alert>}
      {flag("error") && <Alert tone="error">今の状態ではこの操作はできません。</Alert>}
      {zeroPrice && draft && <Alert tone="warning">単価が0の行があります。</Alert>}

      {draft ? (
        <PoDraftForm
          action={saveDraftAction.bind(null, po.id)}
          lines={po.lines}
          initial={{ expected_date: po.expectedDate ?? "", note: po.note ?? "", internal_note: po.internalNote ?? "" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className={td}>行</th>
                <th className={td}>コード</th>
                <th className={td}>仕入先の品番</th>
                <th className={td}>商品名</th>
                <th className={`${td} text-right`}>発注数</th>
                <th className={`${td} text-right`}>単価（円・税抜）</th>
                <th className={`${td} text-right`}>税率</th>
                <th className={`${td} text-right`}>金額（円・税抜）</th>
                <th className={`${td} text-right`}>入荷済</th>
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-b border-line last:border-b-0">
                  <td className={`${td} tabular-nums`}>{l.lineNo}</td>
                  <td className={`${td} tabular-nums`}>{l.productCode}</td>
                  <td className={td}>{l.supplierItemCode ?? "−"}</td>
                  <td className={td}>{l.productName}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatQuantity(l.quantity)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatQuantity(l.unitPrice)}</td>
                  <td className={`${td} text-right tabular-nums`}>{l.taxRate}％</td>
                  <td className={`${td} text-right tabular-nums`}>{formatQuantity(l.amount)}</td>
                  <td className={`${td} text-right tabular-nums`}>{formatQuantity(l.receivedQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-sm tabular-nums">
        小計 {formatYen(totals.subtotal, "excluded")}　消費税 {formatYen(totals.tax)}
        {totals.byRate.length > 0 && `（${totals.byRate.map((r) => `${r.rate}％対象`).join("・")}）`}　合計 {formatYen(totals.total, "included")}
      </p>
      {!draft && po.note && <p className="text-sm">仕入先への連絡: {po.note}</p>}
      {!draft && po.internalNote && <p className="text-sm text-ink-muted">社内のメモ: {po.internalNote}</p>}

      <div className="flex flex-wrap items-center gap-2">
        {canOperate(po.status, "print") && (
          // EV-12 発注書は新しいタブで開く
          <a href={`/admin/purchase-orders/${po.id}/print`} target="_blank" rel="noopener" className={buttonClassName("secondary")}>
            発注書を印刷
          </a>
        )}
        {canOperate(po.status, "cancel") && (
          <form action={cancelDraftAction.bind(null, po.id)}>
            <ConfirmSubmitButton pendingText="取消中…" confirmMessage={`${po.orderNo} を取消してよいですか？`}>
              取消
            </ConfirmSubmitButton>
          </form>
        )}
        {canOperate(po.status, "close") && (
          <form action={closeOrderAction.bind(null, po.id)}>
            <ConfirmSubmitButton pendingText="処理中…" confirmMessage={`まだ届いていない ${openQty}個を、届かないものとして扱います。よろしいですか？`}>
              残りを打ち切る
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
      {canOperate(po.status, "print") && contactWarning && <Alert tone="warning">{contactWarning}</Alert>}

      {canOperate(po.status, "order") && (
        <PoOrderForm
          action={markOrderedAction.bind(null, po.id)}
          initial={{ order_date: today, expected_date: po.expectedDate ?? defaultExpectedDate(po, today), send_method: po.supplier.orderMethod ?? "fax" }}
        />
      )}

      <p className="text-xs text-ink-muted">記録: {history.join(" → ")}</p>
    </div>
  );
}
