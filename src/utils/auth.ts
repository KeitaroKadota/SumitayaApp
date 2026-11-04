// ログイン・権限チェックの共通関数(CMN-01 03 の 0章)。
// 各画面(page)と各操作(Server Action)の先頭で1行呼ぶ。layout だけでチェックしない
// (layout は画面を移るときに再実行されないことがあり、Server Action は layout を通らないため。Next.js の authentication.md)。
import { cache } from "react";
import { redirect } from "next/navigation";
import { getSession, issuedAfterPasswordChange } from "@/utils/session";
import { findAccountById } from "@/utils/employeeAccount";
import { loginUrlWithNext } from "@/utils/loginNext";
import { canAccess, type FeatureKey, type Role } from "@/utils/permissions";

// 本人の情報。パスワードの暗号などは含めない
export type CurrentEmployee = {
  id: string;
  lastName: string;
  firstName: string;
  roles: Role[];
  mustChangePassword: boolean;
};

// 0.1 ログイン中の本人を取り出す。未ログインなら null。
// 1回の表示の中で何度呼んでもDBを読むのは1回だけにする(React の cache)。
export const getCurrentEmployee = cache(async (): Promise<CurrentEmployee | null> => {
  const session = await getSession();
  if (!session) return null;

  const account = await findAccountById(session.employeeId);
  if (!account) return null;
  // CH-10 在籍中か
  if (!account.isActive) return null;
  // CH-11 ログインがパスワード変更より後か
  if (!issuedAfterPasswordChange(session.issuedAt, account.passwordChangedAt)) return null;

  return {
    id: account.id,
    lastName: account.lastName,
    firstName: account.firstName,
    roles: account.roles,
    mustChangePassword: account.mustChangePassword,
  };
});

// 0.2 ログインしていなければログイン画面へ。初期パスワードのままならパスワード変更画面へ。
export const requireLogin = async (next: string): Promise<CurrentEmployee> => {
  const me = await getCurrentEmployee();
  if (!me) redirect(loginUrlWithNext(next));
  if (me.mustChangePassword) redirect("/change-password?forced=1");
  return me;
};

// 0.3 権限がなければ「権限がありません」へ。例: const me = await requireAccess("employees", "/admin/employees");
export const requireAccess = async (feature: FeatureKey, next: string): Promise<CurrentEmployee> => {
  const me = await requireLogin(next);
  if (!canAccess(me.roles, feature)) redirect("/no-permission");
  return me;
};

// 0.4 権限表を引く(DBを読まない)。メニュー・タイルの出し分けにも使う
export { canAccess };

export const fullName = (me: { lastName: string; firstName: string }): string => `${me.lastName} ${me.firstName}`;
