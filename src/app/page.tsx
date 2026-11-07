import Link from "next/link";
import { canAccess, fullName, requireLogin } from "@/utils/auth";
import { getLineLinkStatus } from "@/utils/lineAccount";
import { canUseAdmin, formatRoles } from "@/utils/permissions";
import { countMyOpenTasks } from "@/utils/tasks";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { HomeTile, HomeTiles, ReceiptIcon, TaskIcon } from "@/components/HomeTiles";
import { LinkButton } from "@/components/LinkButton";
import { LogoutButton } from "@/components/LogoutButton";
import { StaffHeader } from "@/components/StaffHeader";
import { TimecardCard } from "./timecard/TimecardCard";

// G04 ホーム(スマホ。EV-10)
export default async function HomePage({ searchParams }: PageProps<"/">) {
  const me = await requireLogin("/");
  const { password_changed } = await searchParams;
  // CMN-03: タスクのタイルの件数と、LINE が未連携の人への案内(DBの接続1本の決まりのため順番に読む)
  const taskCounts = canAccess(me.roles, "tasks") ? await countMyOpenTasks(me) : null;
  const line = await getLineLinkStatus(me.id);

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-5">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-ink-muted">{formatRoles(me.roles)}</p>
          <h1 className="text-xl font-bold break-words">こんにちは、{fullName(me)}さん</h1>
        </div>

        {password_changed === "1" && <Alert tone="success">パスワードを変更しました。</Alert>}

        {/* 打刻の枠(E-01 の G01。勤怠の対象でない人には何も出さない) */}
        {canAccess(me.roles, "timecard") && <TimecardCard employeeId={me.id} />}

        {line && !line.linked && (
          <Alert tone="info">
            LINE通知を設定してください。タスクのお知らせがLINEに届きます。{" "}
            <Link href="/settings/line" className="font-bold text-primary underline">
              LINE通知の設定へ
            </Link>
          </Alert>
        )}

        {/* 機能のタイル(権限のある機能だけ。canAccess で出し分け、各機能を作るたびに足す。00_画面共通ルール 5.1) */}
        <HomeTiles>
          {taskCounts && (
            <HomeTile
              href="/tasks"
              label="タスク"
              icon={<TaskIcon />}
              badges={
                <>
                  <Badge tone="neutral">未完了 {taskCounts.open}件</Badge>
                  {taskCounts.overdue > 0 && <Badge tone="danger">期限切れ {taskCounts.overdue}件</Badge>}
                </>
              }
            />
          )}
          {/* E-07 経費(0.4 で差し戻しの件数は外した) */}
          {canAccess(me.roles, "expenses_apply") && <HomeTile href="/expenses" label="経費" icon={<ReceiptIcon />} />}
        </HomeTiles>

        <div className="flex flex-col gap-2">
          {canUseAdmin(me.roles) && (
            <LinkButton href="/admin" variant="primary" size="lg" className="w-full">
              管理画面へ
            </LinkButton>
          )}
          <LinkButton href="/change-password" size="lg" className="w-full">
            パスワード変更
          </LinkButton>
          <LinkButton href="/settings/line" size="lg" className="w-full">
            LINE通知の設定
          </LinkButton>
          <LogoutButton />
        </div>
      </main>
    </>
  );
}
