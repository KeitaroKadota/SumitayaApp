import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { PRODUCT_CSV_COLUMNS } from "@/utils/productCsv";
import { ProductImportForm } from "./ProductImportForm";

// G06 商品のCSV取り込み(CMN-02 EV-11〜EV-13)
export default async function ProductImportPage() {
  await requireAccess("products", "/admin/products/import");
  const columns = Object.values(PRODUCT_CSV_COLUMNS)
    .map((c) => c[0])
    .join("・");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/products" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">商品のCSV取り込み</h1>
      <ProductImportForm columnsText={`ひな形の列: ${columns}`} />
    </div>
  );
}
