import { requireAccess } from "@/utils/auth";
import { Alert } from "@/components/Alert";
import { BackLink } from "@/components/LinkButton";
import { saveSupplier, setSupplierActiveAction } from "../actions";
import { countProductsUsingSupplier, getSupplier } from "../supplierData";
import { SupplierForm } from "../SupplierForm";

const SAVED_MESSAGES: Record<string, string> = {
  "1": "保存しました。",
  activated: "取引中に戻しました。",
  deactivated: "取引をやめました。",
};
const ACTIVE_FORM_ID = "supplier-active-form";

const str = (n: number | null) => (n === null ? "" : String(n));

// G08 仕入先の詳細・編集(CMN-02 EV-15・EV-16)
export default async function SupplierDetailPage({ params, searchParams }: PageProps<"/admin/suppliers/[id]">) {
  const { id } = await params;
  await requireAccess("suppliers", `/admin/suppliers/${id}`);
  const query = await searchParams;

  const supplier = await getSupplier(id);
  if (!supplier) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <BackLink href="/admin/suppliers" label="一覧へ" />
        </div>
        <Alert tone="error">この仕入先は見つかりません。</Alert>
      </div>
    );
  }
  // CH-29 主な仕入先にしている使用中の商品の件数(取引をやめるときの確認に出す。止めない)
  const productCount = supplier.isActive ? await countProductsUsingSupplier(supplier.id) : 0;
  const deactivateConfirm =
    productCount > 0
      ? `この仕入先は ${productCount} 件の商品の『主な仕入先』です。商品の設定はそのまま残ります。取引をやめますか？`
      : undefined;

  const saved = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] : undefined;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/suppliers" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">
        {supplier.name}
        {!supplier.isActive && <span className="ml-2 text-base text-ink-muted">（取引終了）</span>}
      </h1>
      {saved && <Alert tone="success">{saved}</Alert>}
      {query.warn === "transfer_to" && <Alert tone="warning">振込先が空です。</Alert>}

      <SupplierForm
        key={supplier.id}
        mode="edit"
        action={saveSupplier.bind(null, supplier.id)}
        isActive={supplier.isActive}
        activeFormId={ACTIVE_FORM_ID}
        deactivateConfirm={deactivateConfirm}
        initialValues={{
          supplier_code: supplier.code ?? "",
          name: supplier.name,
          name_kana: supplier.nameKana ?? "",
          aliases: supplier.aliases.join("、"),
          contact_name: supplier.contactName ?? "",
          phone: supplier.phone ?? "",
          fax: supplier.fax ?? "",
          email: supplier.email ?? "",
          postal_code: supplier.postalCode ?? "",
          address: supplier.address ?? "",
          order_method: supplier.orderMethod ?? "",
          lead_time_days: str(supplier.leadTimeDays),
          closing_day: str(supplier.closingDay),
          payment_month_offset: str(supplier.paymentMonthOffset),
          payment_day: str(supplier.paymentDay),
          payment_method: supplier.paymentMethod ?? "",
          transfer_to: supplier.transferTo ?? "",
          registration_no: supplier.registrationNo ?? "",
          ocr_hint: supplier.ocrHint ?? "",
          note: supplier.note ?? "",
        }}
      />
      <form id={ACTIVE_FORM_ID} action={setSupplierActiveAction.bind(null, supplier.id)} hidden>
        <input type="hidden" name="is_active" value={supplier.isActive ? "0" : "1"} />
      </form>
    </div>
  );
}
