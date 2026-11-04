import { requireAccess } from "@/utils/auth";
import { COMPANY_MISSING, DEFAULT_PRICE_BASIS, INVOICE_NOTE, isCompanyReady } from "@/utils/invoices";
import { INVOICES_URL, currentRounding, getCompanySettings, listInvoiceCustomers } from "@/utils/invoicesServer";
import { todayJST } from "@/utils/jst";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { saveInvoice } from "../actions";
import { InvoiceForm } from "../InvoiceForm";
import { companyForCheck, toFormCustomer } from "../formData";

// G02 請求書の作成(E-05 03 EV-02)。発行日は今日、単価の入力は DEFAULT_PRICE_BASIS、明細は空の1行
export default async function NewInvoicePage() {
  await requireAccess("receivables", `${INVOICES_URL}/new`);
  const today = todayJST();

  // 手順1・2: 在籍中の取引先と、自社の情報(無ければ注意を出す。下書きは作れる。CH-02)
  const customers = await listInvoiceCustomers();
  const company = await getCompanySettings();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BackLink href={INVOICES_URL} label="一覧へ" />
        <h1 className="text-2xl font-bold">請求書（下書き）</h1>
      </div>
      {!isCompanyReady(company) && <Alert tone="warning">{COMPANY_MISSING}</Alert>}
      <InvoiceForm
        action={saveInvoice.bind(null, null)}
        deleteAction={null}
        invoiceId={null}
        version=""
        initialValues={{ issued_on: today, price_basis: DEFAULT_PRICE_BASIS, note: INVOICE_NOTE }}
        initialLines={[]}
        customers={customers.map(toFormCustomer)}
        company={companyForCheck(company)}
        rounding={currentRounding(company)}
        today={today}
        extraBlockers={[]}
      />
    </div>
  );
}
