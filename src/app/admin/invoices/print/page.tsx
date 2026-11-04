import { requireAccess } from "@/utils/auth";
import { formatDateShort, formatJaDate, formatQuantity, parseIdList } from "@/utils/format";
import {
  PRINT_MAX_INVOICES,
  addresseeOf,
  bankTextOf,
  calcInvoiceTotals,
  formatInvoiceQty,
  invoiceNoLabel,
  pdfFileName,
  taxSummaryRows,
  type TotalsView,
} from "@/utils/invoices";
import {
  INVOICES_URL,
  currentRounding,
  getCompanySettings,
  getCustomersByIds,
  getInvoicesForPrint,
  toInvoiceInput,
} from "@/utils/invoicesServer";
import { InvoiceSheetStyle } from "@/components/InvoiceSheetStyle";
import { PrintButton } from "@/components/PrintButton";

// G03 請求書の印刷(E-05 03 EV-07。A4縦・1件1枚・PDFはブラウザの印刷で保存)。読むだけでデータは変えない。
// 一覧の「選んだものを印刷する」、G02 の「印刷して確認する」「印刷する」から新しいタブで開く(?ids=id,…)。
// 発行済み・取消は請求書に写した値で、下書きは今の取引先・自社の情報で作る(0.3 と同じ項目)。
// 管理画面の左メニューは出さない(AdminSidebar が /print で終わるパスでは何も出さない)。
export default async function InvoicePrintPage({ searchParams }: PageProps<"/admin/invoices/print">) {
  const params = await searchParams;
  // 手順1: 空・重複を除き、100件まで
  const ids = parseIdList(params.ids).slice(0, PRINT_MAX_INVOICES);
  await requireAccess("receivables", `${INVOICES_URL}/print${ids.length > 0 ? `?ids=${ids.join(",")}` : ""}`);

  // 手順2・3: 見つからないIDは黙って外す。下書きは今の取引先・自社の情報(行が無ければ発行者の欄は空)
  const targets = await getInvoicesForPrint(ids);
  const hasDraft = targets.some((t) => t.invoice.status === "draft");
  const company = hasDraft ? await getCompanySettings() : null;
  const customers = hasDraft
    ? await getCustomersByIds(targets.filter((t) => t.invoice.status === "draft" && t.invoice.customerId).map((t) => t.invoice.customerId as string))
    : new Map();

  return (
    <main className="iv-root">
      <InvoiceSheetStyle />
      <div className="iv-toolbar print:hidden">
        <a href={INVOICES_URL} className="text-sm font-bold text-primary hover:underline">
          ← 一覧へ戻る
        </a>
        <span className="text-xs text-ink-muted">
          {targets.length}件。ブラウザの印刷で「A4・縦」を選んでください。「PDFに保存」も選べます。
          {targets.length === 1 && `（ファイル名の例: ${pdfFileName(targets[0].invoice.invoiceNo, targets[0].invoice.customerName ?? targets[0].invoice.currentCustomerName)}）`}
        </span>
        <PrintButton />
      </div>

      {targets.length === 0 ? (
        // 手順6
        <p className="iv-empty">印刷する請求書がありません。一覧で選んでください。</p>
      ) : (
        targets.map(({ invoice, lines }) => {
          const draft = invoice.status === "draft";
          const c = draft && invoice.customerId ? customers.get(invoice.customerId) : undefined;
          // 宛名・発行者・振込先(手順3)
          const to = draft
            ? {
                name: c?.name ?? null,
                honorific: c?.honorific ?? null,
                postalCode: c?.postalCode ?? null,
                address: c?.address ?? null,
                contact: c?.contactName ?? null,
              }
            : {
                name: invoice.customerName,
                honorific: invoice.customerHonorific,
                postalCode: invoice.customerPostalCode,
                address: invoice.customerAddress,
                contact: invoice.customerContact,
              };
          const issuer = draft
            ? {
                name: company?.companyName || null,
                registrationNo: company?.registrationNo ?? null,
                postalCode: company?.postalCode ?? null,
                address: company?.address ?? null,
                tel: company?.tel ?? null,
                bankText: bankTextOf(company),
              }
            : {
                name: invoice.issuerName,
                registrationNo: invoice.issuerRegistrationNo,
                postalCode: invoice.issuerPostalCode,
                address: invoice.issuerAddress,
                tel: invoice.issuerTel,
                bankText: invoice.bankText,
              };
          // 手順4: 金額は保存した値(下書きは計算し直した値)
          const input = toInvoiceInput(invoice, lines);
          const calc = draft ? calcInvoiceTotals(input.lines, input.priceBasis, currentRounding(company)) : null;
          const totals: TotalsView = calc ?? invoice;
          const amounts = calc ? calc.amounts : lines.map((l) => l.amount);
          const basisLabel = invoice.priceBasis === "inclusive" ? "税込" : "税抜";
          const showPeriod = Boolean(invoice.periodStart && invoice.periodEnd);
          const hasReduced = lines.some((l) => l.taxRate === 8);
          // 手順5: 透かし(CH-15)
          const watermark = draft ? "下書き" : invoice.status === "void" ? "取消" : null;

          return (
            <section key={invoice.id} className="iv-paper">
              {watermark && (
                <div className="iv-watermark" aria-hidden="true">
                  {watermark}
                </div>
              )}
              <div className="iv-head">
                <h1>請求書</h1>
                <div className="iv-small">
                  No. {invoiceNoLabel(invoice.status, invoice.invoiceNo)}
                  <br />
                  発行日 {invoice.issuedOn ? formatJaDate(invoice.issuedOn) : "−"}
                  {watermark && (
                    <>
                      <br />（{watermark}）
                    </>
                  )}
                </div>
              </div>

              <div className="iv-parties">
                <div className="iv-to-block">
                  {to.postalCode && <div>〒{to.postalCode}</div>}
                  {to.address && <div>{to.address}</div>}
                  <div className="iv-to">{addresseeOf(to.name, to.honorific)}</div>
                  {to.contact && <div className="iv-contact">ご担当 {to.contact}様</div>}
                </div>
                <div className="iv-issuer">
                  {issuer.name && <div className="name">{issuer.name}</div>}
                  {issuer.postalCode && <div>〒{issuer.postalCode}</div>}
                  {issuer.address && <div>{issuer.address}</div>}
                  {issuer.tel && <div>TEL {issuer.tel}</div>}
                  {issuer.registrationNo && <div>登録番号 {issuer.registrationNo}</div>}
                </div>
              </div>

              {invoice.subject && <div className="iv-lead">件名: {invoice.subject}</div>}
              <div className="iv-lead">下記のとおりご請求申し上げます。</div>
              <div className="iv-total">
                <div className="lbl">ご請求金額（税込）</div>
                <div className="amt">¥{formatQuantity(totals.total)}</div>
                {invoice.dueOn && <div className="due">お支払期限 {formatJaDate(invoice.dueOn)}</div>}
              </div>

              {showPeriod && invoice.periodStart && invoice.periodEnd && (
                <div className="iv-period">
                  取引期間 {formatJaDate(invoice.periodStart)}〜{formatJaDate(invoice.periodEnd)}
                </div>
              )}
              <table className="iv-table">
                <thead>
                  <tr>
                    <th style={{ width: 80 }}>日付</th>
                    <th>品名</th>
                    <th className="r" style={{ width: 70 }}>
                      数量
                    </th>
                    <th className="r" style={{ width: 90 }}>
                      単価（{basisLabel}）
                    </th>
                    <th className="r" style={{ width: 90 }}>
                      金額（{basisLabel}）
                    </th>
                    <th className="r" style={{ width: 50 }}>
                      税率
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l.id}>
                      <td className="nw">{l.transactionOn ? formatDateShort(l.transactionOn) : "−"}</td>
                      <td>
                        {l.description}
                        {l.taxRate === 8 && "※"}
                      </td>
                      <td className="r">{formatInvoiceQty(l.quantity100, l.unit ?? "")}</td>
                      <td className="r">{l.unitPrice === null ? "−" : formatQuantity(l.unitPrice)}</td>
                      <td className="r">{formatQuantity(amounts[i] ?? 0)}</td>
                      <td className="r">{l.taxRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* 税率ごとの合計と消費税額(01 9.1 の 4・5) */}
              <div className="iv-sums">
                {taxSummaryRows(totals, invoice.priceBasis).map((r) => (
                  <div key={r.key} className="row">
                    <span>
                      {r.label} {formatQuantity(r.amount)}円{r.amountNote}
                    </span>
                    {r.taxLabel && (
                      <span>
                        {r.taxLabel} {formatQuantity(r.tax ?? 0)}円
                      </span>
                    )}
                  </div>
                ))}
                <div className="row">
                  <span>合計（税抜）</span>
                  <span>{formatQuantity(totals.subtotal)}円</span>
                </div>
                <div className="row">
                  <span>消費税</span>
                  <span>{formatQuantity(totals.tax)}円</span>
                </div>
                <div className="row grand">
                  <span>ご請求金額</span>
                  <span>{formatQuantity(totals.total)}円（税込）</span>
                </div>
              </div>
              {hasReduced && <div className="iv-mark">※は軽減税率（8％）対象です。</div>}

              {issuer.bankText && (
                <div className="iv-pay">
                  <div className="ttl">お振込先</div>
                  <div>{issuer.bankText}</div>
                </div>
              )}
              {invoice.note && <div className="iv-note">備考: {invoice.note}</div>}
            </section>
          );
        })
      )}
    </main>
  );
}
