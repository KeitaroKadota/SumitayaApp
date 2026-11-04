import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { CrossmallImportForm } from "@/app/admin/orders/import/CrossmallImportForm";
import { cancelStockImport } from "./actions";

// G04 在庫CSVの取り込み(B-01 EV-05・EV-06)
export default async function StockImportPage() {
  await requireAccess("orders", "/admin/inventory/import");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/inventory" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">在庫CSVの取り込み</h1>
      <CrossmallImportForm
        uploadUrl="/admin/inventory/import/upload"
        description="CROSS MALL でダウンロードした在庫CSVを選んでください。"
        keyLabel="商品コード"
        subLabel="商品名"
        cancelAction={cancelStockImport}
      />
    </div>
  );
}
