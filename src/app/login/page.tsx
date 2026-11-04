import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/utils/auth";
import { safeNextPath } from "@/utils/loginNext";
import { Alert } from "@/components/Alert";
import { Field } from "@/components/Field";
import { TextInput } from "@/components/TextInput";
import { SubmitButton } from "@/components/SubmitButton";
import { login } from "./actions";

// G01 ログイン(EV-01)
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, next } = await searchParams;
  // CH-09 戻り先はアプリ内のパスだけ。だめなら捨てる
  const nextPath = safeNextPath(typeof next === "string" ? next : null);

  const me = await getCurrentEmployee();
  if (me) redirect(nextPath ?? "/");

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 py-10">
      <p className="text-center text-lg font-bold">
        <span className="border-b-2 border-accent pb-1">祭すみたや 業務システム</span>
      </p>
      <h1 className="text-xl font-bold">ログイン</h1>

      {error && <Alert tone="error">ログインIDまたはパスワードが正しくありません。</Alert>}

      <form action={login} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
        {nextPath && <input type="hidden" name="next" value={nextPath} />}
        <Field id="login_id" label="ログインID" required>
          <TextInput id="login_id" name="login_id" required autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </Field>
        <Field id="password" label="パスワード" required>
          <TextInput id="password" name="password" type="password" required autoComplete="current-password" />
        </Field>
        <SubmitButton size="lg" pendingText="ログイン中…" className="w-full">
          ログインする
        </SubmitButton>
      </form>

      <p className="text-sm text-ink-muted">※パスワードを忘れた場合は、社長にお伝えください。</p>
    </main>
  );
}
