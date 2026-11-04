"use server";

import { redirect } from "next/navigation";
import { verifyPassword } from "@/utils/password";
import { createSession } from "@/utils/session";
import { safeNextPath } from "@/utils/loginNext";
import { normalizeLoginId } from "@/utils/accountRules";
import { findAccountByLoginId, recordLoginFailure, recordLoginSuccess } from "@/utils/employeeAccount";

// EV-02 「ログインする」。失敗の理由は画面に出さず、どれも同じ ?error=1 で戻す(CH-03)
export async function login(formData: FormData) {
  const loginId = normalizeLoginId(String(formData.get("login_id") ?? ""));
  const password = String(formData.get("password") ?? "");
  // CH-09 戻り先はアプリ内のパスだけ(失敗してログイン画面に戻るときも引き継ぐ)
  const next = safeNextPath(String(formData.get("next") ?? ""));
  const errorUrl = next ? `/login?error=1&next=${encodeURIComponent(next)}` : "/login?error=1";

  // CH-01 入力がある
  if (!loginId || !password) redirect(errorUrl);

  const account = await findAccountByLoginId(loginId);
  // CH-10 在籍中、パスワードが発行済みか
  if (!account || !account.isActive || !account.passwordHash) redirect(errorUrl);

  const now = new Date();
  // CH-02 ロック中でない
  if (account.lockedUntil && account.lockedUntil > now) redirect(errorUrl);

  if (!(await verifyPassword(password, account.passwordHash))) {
    await recordLoginFailure(account.id, now);
    redirect(errorUrl);
  }

  await recordLoginSuccess(account.id, now);
  await createSession(account.id);
  // 初期パスワードのままなら、戻り先より変更を先にする(変更後はホームへ)
  redirect(account.mustChangePassword ? "/change-password?forced=1" : (next ?? "/"));
}
