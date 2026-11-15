"use client";

// G01 予測と発注の提案のフォーム(A-03 EV-02・EV-03)。結果のエラーはフォームの上に出す。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { SubmitButton } from "@/components/SubmitButton";
import type { ForecastActionState } from "./actions";

type Action = (prev: ForecastActionState, formData: FormData) => Promise<ForecastActionState>;
const EMPTY: ForecastActionState = { error: null, notes: [] };

// EV-02 「予測を計算する」。数十秒かかることがあるので「計算中…（閉じないでください）」を出し、二重に押せない
export function ForecastRunForm({ action, disabled }: { action: Action; disabled: boolean }) {
  const [state, formAction] = useActionState(action, EMPTY);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <div>
        <SubmitButton pendingText="計算中…（閉じないでください）" disabled={disabled}>
          予測を計算する
        </SubmitButton>
      </div>
    </form>
  );
}

// EV-03 「選んだ商品で発注の下書きを作る」。表(チェックボックス)は children で受け取る
export function DraftCreateForm({ action, children, canSubmit }: { action: Action; children: React.ReactNode; canSubmit: boolean }) {
  const [state, formAction] = useActionState(action, EMPTY);
  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.error && (
        <Alert tone="error">
          {state.error}
          {state.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {state.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {children}
      {canSubmit && (
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="作成中…">選んだ商品で発注の下書きを作る</SubmitButton>
          <p className="text-sm text-ink-muted">※仕入先ごとに1つの下書きになります</p>
        </div>
      )}
    </form>
  );
}
