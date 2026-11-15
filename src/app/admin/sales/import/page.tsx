import { requireAccess } from "@/utils/auth";
import { SALES_KINDS } from "@/utils/csvImport/kinds/salesColumns";
import { BackLink, LinkButton } from "@/components/LinkButton";
import { SalesImportForm } from "./SalesImportForm";

// G02 売上の取り込み(確認→登録)(A-01 EV-01)
export default async function SalesImportPage() {
  // EV-01 手順1
  await requireAccess("sales", "/admin/sales/import");

  return (
    <div className="flex flex-col gap-4">
      <div>
        <BackLink href="/admin/sales" label="売上へ" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">売上の取り込み</h1>
        <LinkButton href="/admin/sales/import/history">取り込みの記録</LinkButton>
      </div>
      {/* 手順2 取り込みの種類を選択肢に出す */}
      <SalesImportForm kinds={SALES_KINDS.map((k) => ({ value: k.kind, label: k.label }))} />
    </div>
  );
}
