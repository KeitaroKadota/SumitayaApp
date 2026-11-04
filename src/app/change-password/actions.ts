"use server";

import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/utils/auth";
import { findAccountById, savePassword } from "@/utils/employeeAccount";
import { hashPassword, verifyPassword } from "@/utils/password";
import { createSession } from "@/utils/session";
import { isValidNewPassword } from "@/utils/accountRules";

// EV-05 「変更する」
export async function changePassword(formData: FormData) {
  const me = await getCurrentEmployee();
  if (!me) redirect("/login");

  const currentPassword = String(formData.get("current_password") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const newPasswordConfirm = String(formData.get("new_password_confirm") ?? "");
  // 強制の変更のときは、エラーで戻しても案内を出したままにする
  const forced = me.mustChangePassword || formData.get("forced") === "1";
  const back = (error: string) => `/change-password?error=${error}${forced ? "&forced=1" : ""}`;

  // CH-05 新しいパスワードの決まり・CH-06 確認と一致
  if (!isValidNewPassword(newPassword)) redirect(back("policy"));
  if (newPassword !== newPasswordConfirm) redirect(back("mismatch"));

  // 今のパスワードを照合する
  const account = await findAccountById(me.id);
  if (!account?.passwordHash || !(await verifyPassword(currentPassword, account.passwordHash))) {
    redirect(back("current"));
  }
  // CH-07 今と同じでない
  if (await verifyPassword(newPassword, account.passwordHash)) redirect(back("same"));

  await savePassword({
    id: me.id,
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    resetLock: false,
    now: new Date(),
    updatedBy: me.id,
  });

  // ログイン状態を作り直す(今の端末はログインしたまま。ほかの端末は CH-11 でログアウトになる)
  await createSession(me.id);
  redirect("/?password_changed=1");
}
