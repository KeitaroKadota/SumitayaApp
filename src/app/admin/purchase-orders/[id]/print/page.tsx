import { notFound } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formatDate, formatQuantity, formatYen } from "@/utils/format";
import { currentRounding, getCompanySettings } from "@/utils/invoicesServer";
import { calcPoTotals, canOperate } from "@/utils/purchaseOrderRules";
import { getPurchaseOrder } from "@/utils/purchaseOrdersAdmin";
import { InvoiceSheetStyle } from "@/components/InvoiceSheetStyle";
import { PrintButton } from "@/components/PrintButton";

// G07 発注書(印刷用)(A-03 EV-12)。A4縦。請求書(E-05 G03)の紙の見た目(InvoiceSheetStyle)を使う。
// 管理画面の左メニューは出さない(AdminSidebar が /print で終わるパスでは何も出さない)。
export default async function PurchaseOrderPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // 手順1
  await requireAccess("sales", `/admin/purchase-orders/${id}/print`);
  const po = await getPurchaseOrder(id);
  if (!po) notFound();
  const back = `/admin/purchase-orders/${po.id}`;

  // 手順2 CH-09 取消の発注は開けない
  if (!canOperate(po.status, "print"))
    return (
      <main className="iv-root">
        <InvoiceSheetStyle />
        <p className="iv-empty">取消の発注は印刷できません。</p>
      </main>
    );
  // 手順2-2 自社の情報が無い・会社名が空なら止める
  const company = await getCompanySettings();
  if (!company || !company.companyName.trim())
    return (
      <main className="iv-root">
        <InvoiceSheetStyle />
        <p className="iv-empty">自社の情報が登録されていません。管理者に連絡してください。</p>
      </main>
    );

  const totals = calcPoTotals(po.lines, currentRounding(company));
  const multiRate = totals.byRate.length > 1;

  return (
    <main className="iv-root">
      <InvoiceSheetStyle />
      <div className="iv-toolbar print:hidden">
        <a href={back} className="text-sm font-bold text-primary hover:underline">
          ← 発注へ戻る
        </a>
        <span className="text-xs text-ink-muted">ブラウザの印刷で「A4・縦」を選んでください。「PDFに保存」も選べます。</span>
        <PrintButton />
      </div>
      <section className="iv-paper">
        <div className="iv-head">
          <h1>発注書</h1>
          <div className="iv-small">
            発注番号 {po.orderNo}
            <br />
            発注日 {formatDate(po.orderDate ?? new Date())}
          </div>
        </div>
        <div className="iv-parties">
          <div className="iv-to-block">
            <div className="iv-to">{po.supplier.name} 御中</div>
            {po.supplier.fax && <div className="iv-contact">FAX {po.supplier.fax}</div>}
          </div>
          <div className="iv-issuer">
            <div className="name">{company.companyName}</div>
            {company.postalCode && <div>〒{company.postalCode}</div>}
            {company.address && <div>{company.address}</div>}
            {(company.tel || company.fax) && (
              <div>
                {company.tel && `TEL ${company.tel}`} {company.fax && `FAX ${company.fax}`}
              </div>
            )}
            {company.email && <div>{company.email}</div>}
          </div>
        </div>
        <p className="iv-lead">下記のとおり発注いたします。</p>
        <table className="iv-table">
          <thead>
            <tr>
              <th>品番</th>
              <th>商品名</th>
              <th className="r">数量</th>
              <th className="r">単価（円）</th>
              <th className="r">金額（円）</th>
              <th className="r">税率</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((l) => (
              <tr key={l.id}>
                <td className="nw">{l.supplierItemCode ?? l.productCode}</td>
                <td>{l.productName}</td>
                <td className="r">{formatQuantity(l.quantity)}</td>
                <td className="r">{formatQuantity(l.unitPrice)}</td>
                <td className="r">{formatQuantity(l.amount)}</td>
                <td className="r">{l.taxRate}％</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="iv-sums">
          {multiRate
            ? totals.byRate.map((r) => (
                <div key={r.rate} className="row">
                  <span>{r.rate}％対象 {formatYen(r.amount)}（税抜）</span>
                  <span>消費税 {formatYen(r.tax)}</span>
                </div>
              ))
            : null}
          <div className="row">
            <span>小計</span>
            <span>{formatYen(totals.subtotal, "excluded")}</span>
          </div>
          <div className="row">
            <span>消費税</span>
            <span>{formatYen(totals.tax)}</span>
          </div>
          <div className="row grand">
            <span>合計</span>
            <span>{formatYen(totals.total, "included")}</span>
          </div>
        </div>
        {po.expectedDate && <p className="iv-period">納期（希望） {formatDate(po.expectedDate)}</p>}
        {po.note && <div className="iv-note">連絡事項: {po.note}</div>}
      </section>
    </main>
  );
}
