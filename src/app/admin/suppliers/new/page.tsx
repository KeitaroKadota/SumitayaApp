import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { saveSupplier } from "../actions";
import { SupplierForm } from "../SupplierForm";

// G08 仕入先の新規登録(詳細と同じ画面。CMN-02 EV-15)
export default async function NewSupplierPage() {
  await requireAccess("suppliers", "/admin/suppliers/new");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/suppliers" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">仕入先の新規登録</h1>
      <SupplierForm mode="new" action={saveSupplier.bind(null, null)} initialValues={{}} isActive />
    </div>
  );
}
