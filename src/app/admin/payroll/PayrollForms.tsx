"use client";

// 給与CSVの入力(E-03 の G01 「締める」・G02 締めの確認・G03 締めの解除)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";
import { CLOSE_NOTE_MAX, REOPEN_REASON_MAX } from "@/utils/payrollRules";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

// EV-03 G01 の「締める」。押せないときは理由を出す(チェックはサーバーでも行う)
export function PrepareCloseForm({ action, blocker }: { action: Action; blocker: string | null }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  return (
    <form action={formAction} className="flex flex-col items-end gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {blocker && <p className="text-sm text-ink-muted">{blocker}</p>}
      <SubmitButton pendingText="チェック中…" disabled={!!blocker}>
        締める
      </SubmitButton>
    </form>
  );
}

// EV-04 G02 の「締める」。未対応の法令・確認の異常があるときは「確認しました」の印が必須(CH-04)
export function ClosePayrollForm({
  action,
  periodStart,
  needConfirm,
  blocked,
  cancelHref,
}: {
  action: Action;
  periodStart: string;
  needConfirm: boolean;
  blocked: boolean;
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = state.values;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <input type="hidden" name="period_start" value={periodStart} />
      {needConfirm && (
        <Checkbox name="confirmed" value="1" required defaultChecked={v.confirmed === "1"} label="上の内容を確認しました" />
      )}
      <Field id="close_note" label="メモ" error={state.errors.note}>
        <TextInput
          id="close_note"
          name="note"
          maxLength={CLOSE_NOTE_MAX}
          defaultValue={v.note ?? ""}
          invalid={!!state.errors.note}
          aria-describedby={fieldDescribedBy("close_note", { error: state.errors.note })}
        />
      </Field>
      <p className="text-sm">締めると、この期間の打刻・シフトは直せなくなります。</p>
      <div className="flex justify-between gap-2">
        <LinkButton href={cancelHref}>キャンセル</LinkButton>
        <SubmitButton pendingText="締めています…" disabled={blocked}>
          締める
        </SubmitButton>
      </div>
    </form>
  );
}

// EV-06 G03 の「解除する」(理由は必須)
export function ReopenPayrollForm({ action, cancelHref }: { action: Action; cancelHref: string }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const e = state.errors.reason;
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id="reopen_reason" label="理由" required error={e}>
        <TextInput
          id="reopen_reason"
          name="reason"
          required
          maxLength={REOPEN_REASON_MAX}
          placeholder="例: 山田さんの11/20の退勤の修正のため"
          defaultValue={state.values.reason ?? ""}
          invalid={!!e}
          aria-describedby={fieldDescribedBy("reopen_reason", { error: e })}
        />
      </Field>
      <div className="flex justify-between gap-2">
        <LinkButton href={cancelHref}>キャンセル</LinkButton>
        <SubmitButton variant="danger" pendingText="解除中…">
          解除する
        </SubmitButton>
      </div>
    </form>
  );
}
