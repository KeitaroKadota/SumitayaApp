import { requireAccess } from "@/utils/auth";
import { listActiveSuppliers } from "@/utils/masters";
import { isStorageConfigured } from "@/utils/storage";
import { BackLink } from "@/components/LinkButton";
import { registerReceivedInvoice } from "../actions";
import { LIST_URL } from "../payablesView";
import { RegisterForm } from "./RegisterForm";

// 「登録して読み取る」は AI の読み取り(30秒で打ち切り)を待つので、操作の時間の上限を長めにする
export const maxDuration = 60;

// G02 請求書の登録(撮影・アップロード)(E-04 03 EV-02)。PC・スマホ
export default async function NewPayablePage() {
  await requireAccess("payables", "/admin/payables/new");
  // 手順1: 取引中の仕入先(名前順)
  const suppliers = await listActiveSuppliers();
  // 手順2: ファイルの保存先の設定
  const configured = isStorageConfigured();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <div>
        <BackLink href={LIST_URL} label="一覧へ" />
      </div>
      <h1 className="text-2xl font-bold">請求書を登録する</h1>
      <RegisterForm
        action={registerReceivedInvoice}
        suppliers={suppliers.map((s) => ({ id: s.id, name: s.name }))}
        configured={configured}
        endpoint="/admin/payables/files"
      />
    </div>
  );
}
