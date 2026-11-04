import { formatDate } from "@/utils/format";
import type { LineLinkStatus } from "@/utils/lineAccount";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";
import { sendEmployeeLineTest, unlinkEmployeeLine } from "./lineActions";

// 従業員の詳細(CMN-02 の G03)の「LINE通知」欄(CMN-03 EV-13・EV-14)。状態の表示・テスト送信・連携の解除。
// 連携そのものは本人がスマホの「LINE通知の設定」(CMN-03 の G06)から行う。
// 呼ぶ側のページで requireAccess を済ませ、tasks_admin を使える人(社長)にだけ出すこと。
export function LinePanel({
  employeeId,
  name,
  status,
}: {
  employeeId: string;
  name: string;
  status: LineLinkStatus;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">LINE通知</h2>
      <p className="text-sm">
        <span className="text-ink-muted">状態</span>{" "}
        {status.linked
          ? `連携済み${status.displayName ? `（LINE名: ${status.displayName}）` : ""}${
              status.linkedAt ? ` ${formatDate(status.linkedAt)}から` : ""
            }`
          : "未連携"}
      </p>
      {status.linked && (
        <div className="flex flex-wrap gap-2">
          <form action={sendEmployeeLineTest.bind(null, employeeId)}>
            <SubmitButton variant="secondary" pendingText="送信中…">
              テスト送信する
            </SubmitButton>
          </form>
          <form action={unlinkEmployeeLine.bind(null, employeeId)}>
            <ConfirmSubmitButton confirmMessage={`${name}さんのLINE通知の連携を解除します。`} pendingText="解除中…">
              連携を解除する
            </ConfirmSubmitButton>
          </form>
        </div>
      )}
      <p className="text-xs text-ink-muted">※連携は本人がスマホの「LINE通知の設定」から行います</p>
    </section>
  );
}
