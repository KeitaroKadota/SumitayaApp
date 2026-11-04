// E-07 経費の内容の表示(読むだけ。02 G02 の④、G04 の右側)。G02(スマホ)と G04(PC のモーダル)で使う。
import { EXPENSE_PAYMENT_METHODS, registrationNotice } from "@/utils/expenseClaims";
import type { Expense } from "@/utils/expenseClaimsServer";
import { formatDate, formatYen } from "@/utils/format";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="shrink-0 text-sm text-ink-muted sm:w-28">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

export function ExpenseDetail({ expense: e, showTitle = true }: { expense: Expense; showTitle?: boolean }) {
  const regNotice = registrationNotice(e.registrationNo);
  return (
    <dl className="flex flex-col gap-2">
      <Row label="支払った日">{e.spentOn ? formatDate(e.spentOn) : "−"}</Row>
      <Row label="支払先">{e.payeeName ?? "−"}</Row>
      <Row label="合計">
        <span className="font-bold tabular-nums">{formatYen(e.total, "included")}</span>
        <span className="flex flex-col text-sm tabular-nums">
          {e.total10 > 0 && <span>10％対象 {formatYen(e.total10)}（うち消費税 {formatYen(e.tax10)}）</span>}
          {e.total8 > 0 && <span>8％対象 {formatYen(e.total8)}（うち消費税 {formatYen(e.tax8)}）</span>}
          {e.totalExempt > 0 && <span>対象外 {formatYen(e.totalExempt)}</span>}
        </span>
      </Row>
      <Row label="登録番号">
        {e.registrationNo && <span className="tabular-nums">{e.registrationNo} </span>}
        {/* CH-13 注意だけ(印にはしない) */}
        {regNotice ? <span className="text-sm text-warning">{regNotice}</span> : <span className="text-sm text-success">✓形式OK</span>}
      </Row>
      {e.itemsText && <Row label="品目">{e.itemsText}</Row>}
      <Row label="用途">{e.purpose ?? "−"}</Row>
      <Row label="支払い方">{EXPENSE_PAYMENT_METHODS[e.paymentMethod]}</Row>
      {e.attendees && <Row label="相手先・人数">{e.attendees}</Row>}
      {!e.receiptFileId && <Row label="領収書がない理由">{e.noReceiptReason ?? "−"}</Row>}
      {showTitle && <Row label="勘定科目">{e.accountTitleName ?? "未選択"}</Row>}
    </dl>
  );
}
