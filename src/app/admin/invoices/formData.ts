// G02 のフォームに渡す値を作る(サーバーの画面から使う。DBは読まない)。
import { quantityText, type CompanySettings } from "@/utils/invoices";
import type { Invoice, InvoiceCustomer, InvoiceLine } from "@/utils/invoicesServer";
import type { FormCustomer, FormLine } from "./InvoiceForm";

export const toFormCustomer = (c: InvoiceCustomer): FormCustomer => ({
  id: c.id,
  name: c.name,
  honorific: c.honorific,
  postalCode: c.postalCode,
  address: c.address,
  contactName: c.contactName,
  closingDay: c.closingDay,
  paymentMonthOffset: c.paymentMonthOffset,
  paymentDay: c.paymentDay,
  isActive: c.isActive,
});

const val = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export const toFormValues = (i: Invoice): Record<string, string> => ({
  customer_id: val(i.customerId),
  subject: val(i.subject),
  issued_on: val(i.issuedOn),
  period_start: val(i.periodStart),
  period_end: val(i.periodEnd),
  due_on: val(i.dueOn),
  price_basis: i.priceBasis,
  note: val(i.note),
});

export const toFormLines = (lines: InvoiceLine[]): FormLine[] =>
  lines.map((l) => ({
    key: l.id,
    date: val(l.transactionOn),
    desc: l.description,
    qty: l.quantity100 === null ? "" : quantityText(l.quantity100),
    unit: val(l.unit),
    price: val(l.unitPrice),
    rate: String(l.taxRate),
    product: val(l.productId),
  }));

// 画面での発行の条件(CH-02・CH-03)に使う分だけを渡す(振込先などは画面に送らない)
export const companyForCheck = (c: CompanySettings | null): CompanySettings | null =>
  c && {
    companyName: c.companyName,
    registrationNo: c.registrationNo,
    rounding: c.rounding,
    postalCode: null,
    address: null,
    tel: null,
    fax: null,
    email: null,
    bankName: null,
    bankBranch: null,
    bankAccountType: null,
    bankAccountNo: null,
    bankAccountHolder: null,
  };
