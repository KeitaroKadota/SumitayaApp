import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { formatDateTime, formatYen } from "@/utils/format";
import { COMPANY_MISSING, INVOICE_LIMITS, isCompanyReady, issueBlockers, pdfFileName } from "@/utils/invoices";
import {
  INVOICES_URL,
  canVoidOrCorrect,
  currentRounding,
  getCompanySettings,
  getInvoice,
  invoicePrintUrl,
  invoiceUrl,
  listInvoiceCustomers,
  toInvoiceInput,
} from "@/utils/invoicesServer";
import { todayJST } from "@/utils/jst";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field } from "@/components/Field";
import { BackLink } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { correctInvoice, deleteInvoiceDraft, saveInvoice, voidInvoiceAction } from "../actions";
import { companyForCheck, toFormCustomer, toFormLines, toFormValues } from "../formData";
import { InvoiceForm } from "../InvoiceForm";
import { InvoiceReadOnly, PaymentBadge, StatusBadge } from "../invoicesView";

const str = (v: string | string[] | undefined): string => (typeof v === "string" ? v : "");

const DONE_MESSAGES: Record<string, string> = {
  saved: "保存しました。",
};
const ERROR_MESSAGES: Record<string, string> = {
  conflict: "ほかの人がこの請求書を更新しました。画面を開き直してください。",
  status: "この請求書は、今の状態ではこの操作ができません。",
  save: "保存できませんでした。時間をおいてもう一度お試しください。",
  issue_failed: "発行できませんでした。時間をおいてもう一度お試しください。",
  no_limit: "今月の請求書番号の上限に達しました。",
  replace_blocked: "訂正の元の請求書に入金の消込があるか、取り消されているため、発行できません。入金消込の画面で確認してください。",
  paid: "入金の消込があるため取り消せません。入金消込の画面で消込を外してから行ってください。",
  void_reason: "取り消す理由を入力してください。",
  void_reason_long: `取り消す理由は${INVOICE_LIMITS.voidReason}文字以内で入力してください。`,
};
const PAID_REASON = "入金の消込を外してから行ってください（入金消込の画面）。";

// G02 請求書の編集(下書き)・詳細(発行済み・取消)(E-05 02 G02、03 EV-02・EV-05〜EV-12)
export default async function InvoiceDetailPage({ params, searchParams }: PageProps<"/admin/invoices/[id]">) {
  const { id } = await params;
  await requireAccess("receivables", invoiceUrl(id));
  const query = await searchParams;

  const loaded = await getInvoice(id);
  if (!loaded) redirect(`${INVOICES_URL}?error=not_found`);
  const { invoice, lines } = loaded;
  const today = todayJST();
  const company = await getCompanySettings();
  const doneCode = str(query.done);
  const errorCode = str(query.error);
  const done =
    doneCode === "issued"
      ? `発行しました（${invoice.invoiceNo ?? ""}）。下の「印刷する」から印刷・PDFに保存してください。`
      : doneCode === "correction" && invoice.replacesInvoiceNo
        ? `${invoice.replacesInvoiceNo} の訂正の下書きを開きました。`
        : DONE_MESSAGES[doneCode];
  const error = errorCode === "issue_blocked" ? null : ERROR_MESSAGES[errorCode];
  const printUrl = invoicePrintUrl([invoice.id]);
  const printLink = (variant: "primary" | "secondary") => (
    <a href={printUrl} target="_blank" rel="noopener" className={buttonClassName(variant)}>
      印刷する
    </a>
  );

  // ---- 下書き(直せる) ----
  if (invoice.status === "draft") {
    const customers = await listInvoiceCustomers(invoice.customerId);
    const customer = customers.find((c) => c.id === invoice.customerId) ?? null;
    // CH-11 訂正の元の請求書がまだ発行済みで、入金の消込が無いか
    const extraBlockers: string[] = [];
    if (invoice.replacesInvoiceId) {
      if (invoice.replacesStatus !== "issued") extraBlockers.push(`元の請求書（${invoice.replacesInvoiceNo ?? ""}）は、もう発行済みではありません。`);
      else if (invoice.replacesPaymentStatus !== "unpaid")
        extraBlockers.push(`元の請求書（${invoice.replacesInvoiceNo ?? ""}）に入金の消込があります。${PAID_REASON}`);
    }
    // 発行を押して止まったときは、満たしていない条件をフォームの上にも並べる(CH-09)
    const blocked =
      errorCode === "issue_blocked"
        ? [
            ...extraBlockers,
            ...issueBlockers(toInvoiceInput(invoice, lines), {
              company,
              customer: customer ? { name: customer.name, isActive: customer.isActive } : null,
              today,
              rounding: currentRounding(company),
            }),
          ]
        : [];

    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackLink href={INVOICES_URL} label="一覧へ" />
          <h1 className="text-2xl font-bold">請求書（下書き）</h1>
          <StatusBadge status="draft" />
        </div>
        {invoice.replacesInvoiceNo && (
          <Alert tone="info">
            {invoice.replacesInvoiceNo} の訂正です。発行すると {invoice.replacesInvoiceNo} は取消になります。
          </Alert>
        )}
        {!isCompanyReady(company) && <Alert tone="warning">{COMPANY_MISSING}</Alert>}
        {done && <Alert tone="success">{done}</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        {blocked.length > 0 && (
          <Alert tone="error">
            <p>発行するには、次を直してください（{blocked.length}件）。</p>
            <ul className="list-disc pl-5">
              {blocked.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </Alert>
        )}
        <InvoiceForm
          action={saveInvoice.bind(null, invoice.id)}
          deleteAction={deleteInvoiceDraft.bind(null, invoice.id)}
          invoiceId={invoice.id}
          version={invoice.version}
          initialValues={toFormValues(invoice)}
          initialLines={toFormLines(lines)}
          customers={customers.map(toFormCustomer)}
          company={companyForCheck(company)}
          rounding={currentRounding(company)}
          today={today}
          extraBlockers={extraBlockers}
        />
      </div>
    );
  }

  // ---- 発行済み・取消(読むだけ) ----
  const changeable = canVoidOrCorrect(invoice);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink href={INVOICES_URL} label="一覧へ" />
        <h1 className="text-2xl font-bold tabular-nums">請求書 {invoice.invoiceNo}</h1>
        <StatusBadge status={invoice.status} />
        <PaymentBadge status={invoice.status} paymentStatus={invoice.paymentStatus} dueOn={invoice.dueOn} today={today} />
      </div>
      <p className="text-sm text-ink-muted">
        発行 {invoice.issuedAt ? formatDateTime(invoice.issuedAt) : "−"} {invoice.issuedByName ?? ""}
        {invoice.status === "void" &&
          `　取消 ${invoice.voidedAt ? formatDateTime(invoice.voidedAt) : "−"} ${invoice.voidedByName ?? ""}（理由: ${invoice.voidReason ?? ""}）`}
      </p>
      {done && <Alert tone="success">{done}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
      {invoice.status === "void" && (
        <Alert tone="info">
          この請求書は取り消しました（記録として残しています）。
          {invoice.replacedById && invoice.replacedByNo && <> 訂正で {invoice.replacedByNo} に差し替えました。</>}
        </Alert>
      )}

      <InvoiceReadOnly invoice={invoice} lines={lines} />

      {invoice.status === "issued" && (
        <section className="flex max-w-xl flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 className="font-bold">入金（E-06）</h2>
          {invoice.paymentStatus === "unpaid" ? (
            <p>未入金。入金の確認は「入金消込」の画面で行います。</p>
          ) : (
            <p>
              {invoice.paymentStatus === "paid" ? "入金済み" : "一部入金"}
              {invoice.paidAmount !== null && `　${formatYen(invoice.paidAmount)}`}
              {invoice.paidOn && `（${invoice.paidOn.replace(/-/g, "/")}）`}
            </p>
          )}
        </section>
      )}

      <p className="text-xs text-ink-muted">
        PDFに保存するときのファイル名の例: {pdfFileName(invoice.invoiceNo, invoice.customerName)}
      </p>

      <div className="flex flex-wrap items-start justify-between gap-3">
        {invoice.status === "issued" ? (
          <form action={voidInvoiceAction.bind(null, invoice.id)} className="flex max-w-md flex-col gap-2">
            <input type="hidden" name="version" value={invoice.version} />
            <details className="rounded-md border border-line p-3">
              <summary className="cursor-pointer text-sm font-bold text-danger">取り消す</summary>
              <div className="mt-3 flex flex-col gap-2">
                <Field id="void_reason" label="取り消す理由" required>
                  <TextArea id="void_reason" name="void_reason" maxLength={INVOICE_LIMITS.voidReason} disabled={!changeable} required />
                </Field>
                <ConfirmSubmitButton
                  confirmMessage="この請求書を取り消してよいですか？記録は残り、番号は使われなくなります。"
                  pendingText="取り消し中…"
                  disabled={!changeable}
                >
                  取り消す
                </ConfirmSubmitButton>
              </div>
            </details>
          </form>
        ) : (
          <div />
        )}
        <div className="flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-2">
            {invoice.status === "issued" && (
              <form action={correctInvoice.bind(null, invoice.id)}>
                <SubmitButton variant="secondary" pendingText="作成中…" disabled={!changeable}>
                  訂正する
                </SubmitButton>
              </form>
            )}
            {printLink(doneCode === "issued" ? "primary" : "secondary")}
          </div>
          {invoice.status === "issued" && !changeable && <p className="text-sm text-ink-muted">{PAID_REASON}</p>}
        </div>
      </div>
    </div>
  );
}
