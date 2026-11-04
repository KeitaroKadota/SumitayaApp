import { canAccess, fullName, getCurrentEmployee } from "@/utils/auth";
import { countUnmatchedDeposits } from "@/utils/depositsServer";
import { countSubmittedExpenses } from "@/utils/expenseClaimsServer";
import { countPayablesByTab } from "@/utils/payablesServer";
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

  // 左メニューの件数のバッジ(E-04 の確認待ちの請求書、E-06 の未消込の入金)。数えられなくてもメニューは出す
  const badges: { payables_review?: number; deposits_unmatched?: number; expenses_submitted?: number } = {};
  if (canAccess(me.roles, "payables")) {
    try {
      badges.payables_review = (await countPayablesByTab()).needs_review;
    } catch (e) {
      console.error("確認待ちの請求書を数えられませんでした:", e instanceof Error ? e.message : e);
    }
  }
  if (canAccess(me.roles, "receivables")) {
    try {
      badges.deposits_unmatched = await countUnmatchedDeposits();
    } catch (e) {
      console.error("未消込の入金を数えられませんでした:", e instanceof Error ? e.message : e);
    }
  }

  if (canAccess(me.roles, "expenses_admin")) {
    try {
      badges.expenses_submitted = await countSubmittedExpenses();
    } catch (e) {
      console.error("承認待ちの経費を数えられませんでした:", e instanceof Error ? e.message : e);
    }
  }
  return (
    <div className="min-h-screen md:flex">
      <AdminSidebar name={fullName(me)} menu={visibleAdminMenu(me.roles)} badges={badges} logoutSlot={<LogoutButton />} />
      <div className="min-w-0 flex-1 p-6">
        <div className="mx-auto max-w-6xl">{children}</div>
      </div>
    </div>
  );
}
