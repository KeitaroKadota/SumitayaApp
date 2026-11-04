import { redirect } from "next/navigation";
import { fullName, getCurrentEmployee } from "@/utils/auth";
import { passwordErrorMessage } from "@/utils/passwordMessages";
import { PASSWORD_MIN_LENGTH } from "@/utils/accountRules";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { TextInput } from "@/components/TextInput";
import { SubmitButton } from "@/components/SubmitButton";
import { BackLink } from "@/components/LinkButton";
import { StaffHeader } from "@/components/StaffHeader";
import { changePassword } from "./actions";

// G02 パスワード変更(EV-04)。初期パスワードのままの人を送る先なので、requireLogin は使わない
export default async function ChangePasswordPage({ searchParams }: PageProps<"/change-password">) {
  const me = await getCurrentEmployee();
  if (!me) redirect("/login?next=/change-password");

  const { error, forced } = await searchParams;
  const isForced = me.mustChangePassword || forced === "1";
  const errorMessage = passwordErrorMessage(error);

  return (
    <>
      <StaffHeader name={fullName(me)} />
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        {!isForced && (
          <div>
            <BackLink href="/" label="ホームへ" />
          </div>
        )}
        <h1 className="text-xl font-bold">パスワードの変更</h1>

        {isForced && <Alert tone="info">初回ログインのため、パスワードを変更してください。</Alert>}
        {errorMessage && <Alert tone="error">{errorMessage}</Alert>}

        <form action={changePassword} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
          {isForced && <input type="hidden" name="forced" value="1" />}
          <Field id="current_password" label="今のパスワード" required>
            <TextInput
              id="current_password"
              name="current_password"
              type="password"
              required
              autoComplete="current-password"
            />
          </Field>
          <Field id="new_password" label={`新しいパスワード（${PASSWORD_MIN_LENGTH}文字以上）`} required>
            <TextInput
              id="new_password"
              name="new_password"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
            />
          </Field>
          <Field id="new_password_confirm" label="新しいパスワード（確認）" required>
            <TextInput
              id="new_password_confirm"
              name="new_password_confirm"
              type="password"
              required
              minLength={PASSWORD_MIN_LENGTH}
              autoComplete="new-password"
            />
          </Field>
          <SubmitButton size="lg" pendingText="変更中…" className="w-full">
            変更する
          </SubmitButton>
        </form>
      </main>
    </>
  );
}
