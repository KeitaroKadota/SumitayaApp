import { fullName, getCurrentEmployee } from "@/utils/auth";
import { getAdminCounts } from "@/utils/adminCounts";
import { formatRoles } from "@/utils/permissions";
import { LogoutButton } from "@/components/LogoutButton";
import { AdminSidebar, type MenuBadges } from "./AdminSidebar";
import { visibleAdminMenu } from "./adminMenu";

// G05 管理画面の枠(EV-11 手順1)。使えるメニューだけを左に出す。
// 権限のチェックはここでは行わず、各ページの先頭で requireAccess を呼ぶ(CMN-01 03 の 0章)。
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const me = await getCurrentEmployee();
  if (!me || me.mustChangePassword) {
    // 未ログインならメニューを出さない(各ページがログイン画面などへ移す)
    return <>{children}</>;
  }

  // 左メニューの件数(EV-11 手順1-2)。トップのカードと同じ値。数えられなかったものは出さない
  const counts = await getAdminCounts(me.roles);
  const badges: MenuBadges = {};
  for (const [key, value] of Object.entries(counts) as [keyof MenuBadges, number | null][]) {
    if (value !== null) badges[key] = value;
  }

  return (
    <div className="min-h-screen md:flex">
      <AdminSidebar
        name={fullName(me)}
        roleLabel={formatRoles(me.roles)}
        menu={visibleAdminMenu(me.roles)}
        badges={badges}
        logoutSlot={<LogoutButton />}
      />
      {/* 中身は左メニューのすぐ右に寄せる(中央寄せにしない。2026-11-25 角田さん。00_画面共通ルール 5.2) */}
      <div className="min-w-0 flex-1 p-6 lg:px-8">
        <div className="max-w-[1600px]">{children}</div>
      </div>
    </div>
  );
}
