"use server";

// G07 アカウント欄の操作(CMN-01 EV-08・EV-09)。社長だけが使える(機能キー accounts)。
// 画面(従業員の詳細 /admin/employees/[id])は CMN-02 で作る。ここでは操作の中身だけを持つ。
// 想定内のエラーは throw せず戻り値で返す(useActionState で画面に出す。Next.js の error-handling.md)。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { findAccountById, savePassword } from "@/utils/employeeAccount";
import { generatePassword, hashPassword } from "@/utils/password";
import { createPasswordResetToken } from "@/utils/passwordResetLink";
import { sendInitialPasswordEmail, sendPasswordResetEmail } from "@/utils/accountEmail";
import { storeIssuedCredential } from "@/utils/issuedCredentials";
import type { AccountActionState } from "./accountMessages";

const detailUrl = (employeeId: string) => `/admin/employees/${encodeURIComponent(employeeId)}`;

// EV-08 「初期パスワードを発行」
export async function issueInitialPassword(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const employeeId = String(formData.get("employee_id") ?? "");
  const me = await requireAccess("accounts", detailUrl(employeeId));

  const target = await findAccountById(employeeId);
  if (!target) return { error: "対象の従業員が見つかりません。" };
  // CH-10 在籍中、ログインIDが登録済みか
  if (!target.isActive) return { error: "退職した従業員には発行できません。" };
  if (!target.loginId) return { error: "ログインIDを登録してから発行してください。" };

  // 10文字のランダムな文字(紛らわしい文字は使わない)。暗号化して保存し、ロックも解く。
  // password_changed_at が変わるので、本人のほかの端末のログインと送り済みの再設定リンクは使えなくなる(CH-08・CH-11)
  const password = generatePassword(10);
  await savePassword({
    id: target.id,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    resetLock: true,
    now: new Date(),
    updatedBy: me.id,
  });

  let emailed = false;
  if (target.email) {
    try {
      await sendInitialPasswordEmail({
        to: target.email,
        lastName: target.lastName,
        loginId: target.loginId,
        password,
      });
      emailed = true;
    } catch (e) {
      // パスワードは保存済みなので、画面で伝える(手順6)。ログインにパスワードそのものは書かない
      console.error("初期パスワードのメールを送れませんでした:", e instanceof Error ? e.message : e);
    }
  }
  if (!emailed) {
    // DBには元のパスワードを残さず、15分だけのCookieに入れて画面に1回だけ出す
    await storeIssuedCredential({
      employeeId: target.id,
      loginId: target.loginId,
      password,
      name: `${target.lastName} ${target.firstName}`,
    });
  }

  revalidatePath(detailUrl(target.id));
  const done = emailed ? "password_emailed" : target.email ? "password_shown_mail_failed" : "password_shown";
  redirect(`${detailUrl(target.id)}?done=${done}`);
}

// EV-09 「再設定リンクを送る」。この操作ではパスワードは変わらない
export async function sendResetLink(_prev: AccountActionState, formData: FormData): Promise<AccountActionState> {
  const employeeId = String(formData.get("employee_id") ?? "");
  await requireAccess("accounts", detailUrl(employeeId));

  const target = await findAccountById(employeeId);
  if (!target) return { error: "対象の従業員が見つかりません。" };
  // CH-10 在籍中、ログインID・メールアドレスが登録済みか
  if (!target.isActive) return { error: "退職した従業員には送れません。" };
  if (!target.loginId) return { error: "ログインIDを登録してから送ってください。" };
  if (!target.email) return { error: "メールアドレスを登録してから送ってください。" };

  try {
    const token = await createPasswordResetToken(target.id);
    await sendPasswordResetEmail({ to: target.email, lastName: target.lastName, token });
  } catch (e) {
    console.error("再設定リンクのメールを送れませんでした:", e instanceof Error ? e.message : e);
    return { error: "メールを送れませんでした。時間をおいてもう一度お試しください。" };
  }

  redirect(`${detailUrl(target.id)}?done=reset_link_sent`);
}
