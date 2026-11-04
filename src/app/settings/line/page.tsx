import { fullName, requireLogin } from "@/utils/auth";
import { formatDate } from "@/utils/format";
import { getLineLinkStatus } from "@/utils/lineAccount";
import { LINE_TEST_MESSAGES, isLineTestResult } from "@/utils/lineTest";
import { Alert, type AlertTone } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { SubmitButton } from "@/components/SubmitButton";
import { sendMyLineTest, unlinkMyLine } from "./actions";

// お知らせ欄の文(02 の G06)
const ERROR_MESSAGES: Record<string, string> = {
  canceled: "LINEとの連携を中止しました。",
  duplicate: "このLINEアカウントは、ほかの従業員の通知に使われています。社長にお伝えください。",
  expired: "時間がたったため、やり直してください。",
  failed: "LINEとの連携に失敗しました。時間をおいてお試しください。",
};

// G06 LINE通知の設定(本人、スマホ。CMN-03 EV-09)
export default async function LineSettingsPage({ searchParams }: PageProps<"/settings/line">) {
  // 手順1
  const me = await requireLogin("/settings/line");
  const params = await searchParams;
  // 手順2
  const status = await getLineLinkStatus(me.id);

  // 手順3
  const notice: { tone: AlertTone; text: string } | null =
    params.linked === "1"
      ? { tone: "success", text: "LINE通知を設定しました。テストのメッセージを送りました。" }
      : params.unlinked === "1"
        ? {
            tone: "success",
            text: "LINEとの連携を解除しました。公式アカウントの友だちは残ります。不要な場合は、LINEの画面でブロック・削除してください。",
          }
        : typeof params.error === "string" && ERROR_MESSAGES[params.error]
          ? { tone: params.error === "canceled" ? "info" : "error", text: ERROR_MESSAGES[params.error] }
          : isLineTestResult(params.test)
            ? LINE_TEST_MESSAGES[params.test]
            : null;

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <div>
          <BackLink href="/" label="ホームへ" />
        </div>
        <h1 className="text-xl font-bold">LINE通知の設定</h1>
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

        <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          <p className="text-sm">
            <span className="text-ink-muted">状態</span>{" "}
            <span className="font-bold break-words">
              {status?.linked
                ? `連携済み${status.displayName ? `（LINE名: ${status.displayName}）` : ""}`
                : "未連携"}
            </span>
          </p>
          {status?.linked && status.linkedAt && (
            <p className="text-sm text-ink-muted">{formatDate(status.linkedAt)}から</p>
          )}

          {status?.linked ? (
            <div className="flex flex-col gap-3">
              <form action={sendMyLineTest}>
                <SubmitButton variant="secondary" size="lg" pendingText="送信中…" className="w-full">
                  テスト送信する
                </SubmitButton>
              </form>
              <form action={unlinkMyLine}>
                <ConfirmSubmitButton
                  confirmMessage="解除すると、LINEでお知らせが届かなくなります。"
                  pendingText="解除中…"
                  className="w-full"
                >
                  連携を解除する
                </ConfirmSubmitButton>
              </form>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm">
                タスクのお知らせを、LINEで受け取れます。下のボタンを押すとLINEが開きます。「許可する」を押し、公式アカウントを友だちに追加してください。
              </p>
              {/* LINE ログインへ移る Route Handler なので、先読みしない通常のリンクにする */}
              <a href="/auth/line/link" className={buttonClassName("primary", "lg", "w-full")}>
                LINEと連携する
              </a>
            </div>
          )}
          <p className="text-xs text-ink-muted">※LINEでこのシステムにログインすることはできません（ログインはIDとパスワード）。</p>
        </section>
      </main>
    </>
  );
}
