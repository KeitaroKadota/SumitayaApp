// 請求書の印刷用ページ(E-05 G03 /admin/invoices/print)のスタイル。A4縦・1件1枚(00_画面共通ルール 9章)。
// みるきーの InvoiceSheetStyle.tsx を流用した(園児名の欄を外し、登録番号・税率ごとの合計の欄を足した)。
// 「下書き」「取消」の透かしは、みるきーの PrintSheetStyle.tsx の .ps-draft の作りを使う(紙ごとに出すため position: absolute)。
// 画面では紙(A4縦の幅)の見た目で並べ、印刷では余白12mmの紙に出す。2件目からは改ページ(break-before: page)。
// 明細が多い請求書は次のページへ続き、各ページに表の見出し(thead)を繰り返す。行の途中では切らない。
const INVOICE_SHEET_CSS = `
@page {
  size: A4 portrait;
  margin: 12mm 14mm;
}
.iv-root { padding: 16px; background: #f4f4f5; min-height: 100vh; }
.iv-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; max-width: 210mm; margin: 0 auto 12px; }
.iv-paper {
  position: relative; box-sizing: border-box; width: 210mm; max-width: 100%; min-height: 297mm; margin: 0 auto 16px; padding: 16mm 16mm;
  background: #fff; color: #1f1f1f; box-shadow: 0 4px 18px rgba(0,0,0,.18);
  font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", "Noto Sans JP", sans-serif;
  display: flex; flex-direction: column; gap: 6mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.iv-paper * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.iv-head { display: flex; justify-content: space-between; align-items: flex-start; }
.iv-head h1 { margin: 0; font-size: 28px; letter-spacing: .3em; font-weight: 700; }
.iv-small { font-size: 12px; line-height: 1.8; text-align: right; }
.iv-parties { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.iv-to-block { font-size: 12px; line-height: 1.7; }
.iv-to { font-size: 20px; border-bottom: 1.5px solid #1f1f1f; padding-bottom: 4px; min-width: 75mm; margin-top: 4px; }
.iv-contact { font-size: 12px; color: #333; margin-top: 4px; }
.iv-issuer { font-size: 12px; line-height: 1.7; text-align: left; min-width: 62mm; }
.iv-issuer .name { font-size: 15px; font-weight: 700; }
.iv-lead { font-size: 13px; }
.iv-total { display: flex; flex-wrap: wrap; align-items: center; gap: 24px; background: #f3f1ee; padding: 12px 20px; }
.iv-total .lbl { font-size: 14px; }
.iv-total .amt { font-size: 26px; font-weight: 700; }
.iv-total .due { font-size: 13px; margin-left: auto; }
.iv-period { font-size: 12px; }
table.iv-table { width: 100%; border-collapse: collapse; }
table.iv-table thead { display: table-header-group; }
table.iv-table tr { break-inside: avoid; page-break-inside: avoid; }
table.iv-table th, table.iv-table td { border-bottom: 1px solid #d6d3cf; padding: 6px 8px; font-size: 12.5px; text-align: left; vertical-align: top; }
table.iv-table th { background: #f3f1ee; font-weight: 600; color: #333; }
table.iv-table .r { text-align: right; white-space: nowrap; }
table.iv-table .nw { white-space: nowrap; }
.iv-sums { align-self: flex-end; min-width: 95mm; font-size: 12.5px; break-inside: avoid; }
.iv-sums .row { display: flex; justify-content: space-between; gap: 16px; padding: 2px 0; }
.iv-sums .grand { border-top: 1.5px solid #1f1f1f; margin-top: 4px; padding-top: 4px; font-weight: 700; font-size: 14px; }
.iv-mark { font-size: 11.5px; }
.iv-pay { border: 1px solid #d6d3cf; padding: 10px 16px; font-size: 12px; line-height: 1.8; break-inside: avoid; }
.iv-pay .ttl { font-weight: 600; }
.iv-note { font-size: 12px; white-space: pre-wrap; word-break: break-word; }
.iv-empty { max-width: 210mm; margin: 24px auto; font-size: 14px; }
.iv-watermark {
  position: absolute; left: 0; right: 0; top: 90mm; display: flex; justify-content: center; pointer-events: none; z-index: 10;
  font-size: 130px; font-weight: 800; color: rgba(220, 38, 38, .13); transform: rotate(-12deg);
}
@media print {
  html, body { background: #fff !important; }
  .iv-root { padding: 0; background: #fff; min-height: 0; }
  .iv-paper { width: auto; min-height: 0; margin: 0; padding: 0; box-shadow: none; }
  .iv-paper + .iv-paper { break-before: page; page-break-before: always; }
}
`;

export function InvoiceSheetStyle() {
  return <style>{INVOICE_SHEET_CSS}</style>;
}
