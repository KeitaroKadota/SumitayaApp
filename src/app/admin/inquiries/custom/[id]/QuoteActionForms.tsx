"use client";

// D-04 G03 の右の欄の操作(03 EV-06〜EV-09・EV-12・EV-14)。
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { buttonClassName, type ButtonVariant } from "@/components/Button";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { CUSTOM_QUOTE_LIMITS } from "@/utils/customQuote";
import { emptyFormState, type FormState } from "@/utils/formState";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

// 押したボタンの mode(ai・template)をフォームの値に入れて送る(D-03 の FaqAnswerPanel と同じ作り)
export function ModeButton({
  mode,
  variant,
  disabled = false,
  children,
}: {
  mode: "ai" | "template";
  variant: ButtonVariant;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("mode") === mode;
  return (
    <button type="submit" name="mode" value={mode} disabled={pending || disabled} className={buttonClassName(variant)}>
      {mine ? "作成中…" : children}
    </button>
  );
}

// EV-14 「工場に依頼したことを記録」。すでに依頼済みのときは、上書きしてよいか確かめる
export function FactoryRequestForm({ action, alreadyRequested }: { action: Action; alreadyRequested: boolean }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const error = state.errors.request_memo;
  const description = `工場に伝えたこと・渡し方など（${CUSTOM_QUOTE_LIMITS.text.toLocaleString("ja-JP")}文字まで）。`;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id="request_memo" label="依頼のメモ" description={description} error={error}>
        <TextArea
          id="request_memo"
          name="request_memo"
          rows={3}
          maxLength={CUSTOM_QUOTE_LIMITS.text}
          defaultValue={state.values.request_memo ?? ""}
          invalid={!!error}
          aria-describedby={fieldDescribedBy("request_memo", { description, error })}
        />
      </Field>
      <div className="flex justify-end">
        {alreadyRequested ? (
          <ConfirmSubmitButton variant="secondary" pendingText="記録中…" confirmMessage="前の依頼の記録を上書きします。よいですか？">
            工場に依頼したことを記録
          </ConfirmSubmitButton>
        ) : (
          <SubmitButton variant="secondary" pendingText="記録中…">
            工場に依頼したことを記録
          </SubmitButton>
        )}
      </div>
    </form>
  );
}

// EV-12 受注にする(確かめてから)・工場に依頼済みに戻す(社長だけ)
export function QuickStatusForm({
  action,
  to,
  label,
  confirmMessage,
  variant = "secondary",
}: {
  action: Action;
  to: "won" | "factory_requested";
  label: string;
  confirmMessage: string;
  variant?: ButtonVariant;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <input type="hidden" name="to" value={to} />
      <ConfirmSubmitButton variant={variant} pendingText="保存中…" confirmMessage={confirmMessage}>
        {label}
      </ConfirmSubmitButton>
    </form>
  );
}

// EV-12 失注にする・取消(理由は必須。CH-12)
export function ReasonStatusForm({ action, to, label }: { action: Action; to: "lost" | "cancelled"; label: string }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const id = `reason_${to}`;
  const error = state.errors.reason;
  return (
    <details className="rounded-md border border-line p-3" open={!!state.formError}>
      <summary className="cursor-pointer text-sm font-bold text-primary">{label}…</summary>
      <form action={formAction} className="mt-2 flex flex-col gap-2">
        {state.formError && <Alert tone="error">{state.formError}</Alert>}
        <input type="hidden" name="to" value={to} />
        <Field id={id} label="理由" required description={`${CUSTOM_QUOTE_LIMITS.reason}文字まで`} error={error}>
          <TextInput
            id={id}
            name="reason"
            required
            maxLength={CUSTOM_QUOTE_LIMITS.reason}
            defaultValue={state.values.reason ?? ""}
            invalid={!!error}
          />
        </Field>
        <div className="flex justify-end">
          <SubmitButton variant="danger" pendingText="保存中…">
            {label}
          </SubmitButton>
        </div>
      </form>
    </details>
  );
}
