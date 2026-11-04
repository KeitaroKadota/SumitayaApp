import { findPasswordResetTarget } from "@/utils/passwordResetLink";
import { passwordErrorMessage } from "@/utils/passwordMessages";
import { PASSWORD_MIN_LENGTH } from "@/utils/accountRules";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { TextInput } from "@/components/TextInput";
import { SubmitButton } from "@/components/SubmitButton";
import { submitPasswordReset } from "./actions";

// G03 パスワード再設定(EV-06)。メールのリンクから開くので、ログインは求めない
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;
  const tokenValue = typeof token === "string" ? token : "";

  // CH-08 リンクが有効か
  const account = await findPasswordResetTarget(tokenValue);
  const errorMessage = passwordErrorMessage(error);

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-10">
      <p className="text-center text-lg font-bold">
        <span className="border-b-2 border-accent pb-1">祭すみたや 業務システム</span>
      </p>
      <h1 className="text-xl font-bold">パスワードの再設定</h1>

      {!account ? (
        <Alert tone="error">このリンクは使えません。社長に再発行を依頼してください。</Alert>
      ) : (
        <>
          {errorMessage && <Alert tone="error">{errorMessage}</Alert>}
          <form
            action={submitPasswordReset}
            className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
          >
            <input type="hidden" name="token" value={tokenValue} />
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
            <SubmitButton size="lg" pendingText="設定中…" className="w-full">
              設定してログイン
            </SubmitButton>
          </form>
        </>
      )}
    </main>
  );
}
