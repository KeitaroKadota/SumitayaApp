"use client";

// G07 アカウント欄のボタン(EV-08・EV-09)。従業員の詳細画面(CMN-02)のフォームの中に置けるよう、
// form を使わず、押したときに Server Action を呼ぶ(みるきーの ActionButton.tsx と同じ考え方)。
import { useActionState, startTransition } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { issueInitialPassword, sendResetLink } from "./accountActions";
import type { AccountActionState } from "./accountMessages";

const initialState: AccountActionState = { error: null };

export function AccountActionButtons({
  employeeId,
  name,
  hasLoginId,
  hasEmail,
  isActive,
}: {
  employeeId: string;
  name: string;
  hasLoginId: boolean;
  hasEmail: boolean;
  isActive: boolean;
}) {
  const [issueState, issueAction, issuing] = useActionState(issueInitialPassword, initialState);
  const [resetState, resetAction, sending] = useActionState(sendResetLink, initialState);

  const call = (action: (formData: FormData) => void) => {
    const formData = new FormData();
    formData.set("employee_id", employeeId);
    startTransition(() => action(formData));
  };

  // 押せない理由をボタンの近くに文字で書く(00_画面共通ルール 4.1)
  const issueBlocked = !isActive ? "退職しているため発行できません。" : !hasLoginId ? "ログインIDが無いため発行できません。" : null;
  const resetBlocked = !isActive
    ? "退職しているため送れません。"
    : !hasLoginId
      ? "ログインIDが無いため送れません。"
      : !hasEmail
        ? "メールアドレスが無いため送れません。"
        : null;

  const error = issueState.error ?? resetState.error;
  const busy = issuing || sending;

  return (
    <div className="flex flex-col gap-2">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || issueBlocked !== null}
          onClick={() => {
            // 今のパスワードが使えなくなるので、押す前に確かめる(00_画面共通ルール 6.1)
            if (!window.confirm(`${name}さんの初期パスワードを発行してよいですか？今のパスワードは使えなくなります。`)) return;
            call(issueAction);
          }}
        >
          {issuing ? "発行中…" : "初期パスワードを発行"}
        </Button>
        <Button variant="secondary" disabled={busy || resetBlocked !== null} onClick={() => call(resetAction)}>
          {sending ? "送信中…" : "再設定リンクを送る"}
        </Button>
      </div>
      {(issueBlocked || resetBlocked) && (
        <p className="text-xs text-ink-muted">{[...new Set([issueBlocked, resetBlocked])].filter(Boolean).join(" ")}</p>
      )}
    </div>
  );
}
