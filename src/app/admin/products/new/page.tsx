import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { saveProduct } from "../actions";
import { listSupplierOptions } from "../productData";
import { ProductForm } from "../ProductForm";

// G05 商品の新規登録(詳細と同じ画面。CMN-02 EV-08)。読み替えのコードの欄は出さない
export default async function NewProductPage() {
  await requireAccess("products", "/admin/products/new");
  const suppliers = await listSupplierOptions(null);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/products" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">商品の新規登録</h1>
      <ProductForm
        mode="new"
        action={saveProduct.bind(null, null)}
        suppliers={suppliers}
        isActive
        // 【仮】売価は税込、税率は10%を初期値にする(00_仮決め一覧 CMN02-仮-06)
        initialValues={{ sell_price_tax_included: "1", tax_rate: "10" }}
      />
    </div>
  );
}
