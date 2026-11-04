import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { saveCustomer } from "../actions";
import { CustomerForm } from "../CustomerForm";

// G10 取引先の新規登録(詳細と同じ画面。CMN-02 EV-15)
export default async function NewCustomerPage() {
  await requireAccess("customers", "/admin/customers/new");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/customers" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">取引先の新規登録</h1>
      {/* 【仮】敬称は御中、種別は町内会を初期値にする(00_仮決め一覧 CMN02-仮-16) */}
      <CustomerForm
        mode="new"
        action={saveCustomer.bind(null, null)}
        initialValues={{ honorific: "御中", customer_type: "neighborhood" }}
        isActive
      />
    </div>
  );
}
