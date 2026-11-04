import { requireAccess } from "@/utils/auth";
import { BackLink } from "@/components/LinkButton";
import { cancelOrderImport } from "./actions";
import { CrossmallImportForm } from "./CrossmallImportForm";

// G03 受注CSVの取り込み(B-01 EV-03・EV-04)
export default async function OrderImportPage() {
  await requireAccess("orders", "/admin/orders/import");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/orders" label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">受注CSVの取り込み</h1>
      <CrossmallImportForm
        uploadUrl="/admin/orders/import/upload"
        description="CROSS MALL の「受注データ出力」でダウンロードしたCSVを選んでください。"
        keyLabel="受注番号"
        subLabel="注文日時"
        cancelAction={cancelOrderImport}
      />
    </div>
  );
}
