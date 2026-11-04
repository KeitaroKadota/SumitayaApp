import { redirect } from "next/navigation";
import { requireLogin } from "@/utils/auth";
import { canUseAdmin } from "@/utils/permissions";

// G05 管理画面のトップ(EV-11 手順2)。管理画面の機能が1つも使えなければ「権限がありません」へ
export default async function AdminTopPage() {
  const me = await requireLogin("/admin");
  if (!canUseAdmin(me.roles)) redirect("/no-permission");

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">管理画面</h1>
      <p className="text-sm text-ink-muted">左のメニューから、使う画面を選んでください。</p>
    </div>
  );
}
