"use server";

import { redirect } from "next/navigation";
import { findPasswordResetTarget } from "@/utils/passwordResetLink";
import { savePassword } from "@/utils/employeeAccount";
import { hashPassword, verifyPassword } from "@/utils/password";
import { createSession } from "@/utils/session";
import { isValidNewPassword } from "@/utils/accountRules";

// EV-07 「設定してログイン」
export async function submitPasswordReset(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const newPassword = String(formData.get("new_password") ?? "");
  const newPasswordConfirm = String(formData.get("new_password_confirm") ?? "");
  const back = (error: string) => `/reset-password?token=${encodeURIComponent(token)}&error=${error}`;

  // CH-08 リンクが有効(対象が在籍中であること CH-10 も含む)
  const account = await findPasswordResetTarget(token);
  if (!account) redirect("/reset-password?error=invalid");

  // CH-05・CH-06
  if (!isValidNewPassword(newPassword)) redirect(back("policy"));
  if (newPassword !== newPasswordConfirm) redirect(back("mismatch"));

  // CH-07 今と同じでない
  if (account.passwordHash && (await verifyPassword(newPassword, account.passwordHash))) redirect(back("same"));

  // password_changed_at が変わるので、同じリンクはもう使えなくなる(CH-08)
  await savePassword({
    id: account.id,
    passwordHash: await hashPassword(newPassword),
    mustChangePassword: false,
    resetLock: true,
    now: new Date(),
    updatedBy: account.id,
  });

  await createSession(account.id);
  redirect("/?password_changed=1");
}
