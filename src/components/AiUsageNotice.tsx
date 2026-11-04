// G05 AIの残り回数の表示(D-01 02 G05)。AIの回数は全機能で共有なので、C-01・E-04・E-07 の画面でも使う。
// 値は src/utils/gemini.ts の getAiUsage() で求め、ページから渡す。色だけにせず、状態は文字で出す。
import { Alert } from "@/components/Alert";
import { formatTime } from "@/utils/format";
import type { AiUsage } from "@/utils/gemini";

// 「17時ごろに戻ります」(太平洋時間の0時を日本時間にした時刻)
const resetText = (resetsAt: string | null): string => (resetsAt ? `（${Number(formatTime(resetsAt).slice(0, 2))}時ごろに戻ります）` : "");

export function AiUsageNotice({ usage }: { usage: AiUsage }) {
  if (usage.state === "available") {
    return <p className="text-sm text-ink-muted">AIの残り: 本日あと{usage.remaining}回</p>;
  }
  if (usage.state === "low") {
    return (
      <Alert tone="warning">
        AIの残りはあと{usage.remaining}回です。種類の見分けは手で選ぶと回数を節約できます。
      </Alert>
    );
  }
  if (usage.stoppedReason === "no_key") {
    return (
      <Alert tone="warning">
        <span className="font-bold">AI停止中</span>　AIの設定（APIキー）がありません。種類は手で選び、返信はひな形から作ってください。
      </Alert>
    );
  }
  if (usage.stoppedReason === "db_error") {
    return (
      <Alert tone="warning">
        <span className="font-bold">AI停止中</span>　AIの利用回数を確かめられませんでした。種類は手で選び、返信はひな形から作ってください。
      </Alert>
    );
  }
  return (
    <Alert tone="warning">
      <span className="font-bold">AI停止中</span>　本日のAIの利用回数に達しました。種類は手で選び、返信はひな形から作ってください。
      {resetText(usage.resetsAt)}
    </Alert>
  );
}
