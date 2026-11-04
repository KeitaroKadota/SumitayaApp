import { fullName, getCurrentEmployee } from "@/utils/auth";
import { LogoutButton } from "@/components/LogoutButton";
import { AdminSidebar } from "./AdminSidebar";
import { visibleAdminMenu } from "./adminMenu";

// G05 管理画面の枠(EV-11 手順1)。使えるメニューだけを左に出す。
// 権限のチェックはここでは行わず、各ページの先頭で requireAccess を呼ぶ(CMN-01 03 の 0章)。
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const me = await getCurrentEmployee();
  if (!me || me.mustChangePassword) {
    // 未ログインならメニューを出さない(各ページがログイン画面などへ移す)
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen md:flex">
      <AdminSidebar name={fullName(me)} menu={visibleAdminMenu(me.roles)} logoutSlot={<LogoutButton />} />
      <div className="min-w-0 flex-1 p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </div>
    </div>
  );
}
