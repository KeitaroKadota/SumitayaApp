// G02 経費の申請(撮影。スマホ。E-07 03 EV-02)。機能キー expenses_apply(全員)。
// 撮影するとすぐに保存・読み取りを行い、終わったら /expenses/[id] の確認の画面へ移る。
import { fullName, requireAccess } from "@/utils/auth";
import { EXPENSES_URL } from "@/utils/expenseClaimsServer";
import { isStorageConfigured } from "@/utils/storage";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { createExpenseFromReceipt } from "../actions";
import { ReceiptCapture } from "../ReceiptCapture";

// 撮影のあとの操作は AI の読み取り(30秒で打ち切り)を待つので、操作の時間の上限を長めにする
export const maxDuration = 60;

export default async function NewExpensePage() {
  const me = await requireAccess("expenses_apply", `${EXPENSES_URL}/new`);
  const configured = isStorageConfigured();

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href={EXPENSES_URL} label="一覧へ" />
        </div>
        <h1 className="text-xl font-bold">経費の申請</h1>
        <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
          <h2 className="font-bold">領収書</h2>
          <p className="text-sm text-ink-muted">
            領収書を撮影すると、日付・金額・支払先を読み取ります。紙の領収書は捨てずに保管してください。
          </p>
          <ReceiptCapture action={createExpenseFromReceipt} endpoint={`${EXPENSES_URL}/files`} configured={configured} />
        </section>
      </main>
    </>
  );
}
