import { requireAccess } from "@/utils/auth";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { saveCustomer, setCustomerActiveAction } from "../actions";
import { getCustomer } from "../customerData";
import { CustomerForm } from "../CustomerForm";

const SAVED_MESSAGES: Record<string, string> = {
  "1": "保存しました。",
  activated: "取引中に戻しました。",
  deactivated: "取引をやめました。",
};
const ACTIVE_FORM_ID = "customer-active-form";

const str = (n: number | null) => (n === null ? "" : String(n));

// G10 取引先の詳細・編集(CMN-02 EV-15・EV-16)
export default async function CustomerDetailPage({ params, searchParams }: PageProps<"/admin/customers/[id]">) {
  const { id } = await params;
  await requireAccess("customers", `/admin/customers/${id}`);
  const query = await searchParams;

  const customer = await getCustomer(id);
  if (!customer) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/customers" label="一覧へ" />
        </div>
        <Alert tone="error">この取引先は見つかりません。</Alert>
      </div>
    );
  }
  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/customers" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">
        {customer.name} {customer.honorific}
        {!customer.isActive && <span className="ml-2 text-base text-ink-muted">（取引終了）</span>}
      </h1>
      {saved && <Alert tone="success">{saved}</Alert>}

      <CustomerForm
        key={customer.id}
        mode="edit"
        action={saveCustomer.bind(null, customer.id)}
        isActive={customer.isActive}
        activeFormId={ACTIVE_FORM_ID}
        initialValues={{
          customer_code: customer.code ?? "",
          name: customer.name,
          name_kana: customer.nameKana ?? "",
          honorific: customer.honorific,
          customer_type: customer.customerType,
          contact_name: customer.contactName ?? "",
          phone: customer.phone ?? "",
          email: customer.email ?? "",
          postal_code: customer.postalCode ?? "",
          address: customer.address ?? "",
          closing_day: str(customer.closingDay),
          payment_month_offset: str(customer.paymentMonthOffset),
          payment_day: str(customer.paymentDay),
          payer_name_kana: customer.payerNameKana ?? "",
          note: customer.note ?? "",
        }}
      />
      <form id={ACTIVE_FORM_ID} action={setCustomerActiveAction.bind(null, customer.id)} hidden>
        <input type="hidden" name="is_active" value={customer.isActive ? "0" : "1"} />
      </form>
    </div>
  );
}
