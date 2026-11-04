"use client";

// G03 の「在籍」欄(CMN-02 EV-05・EV-06)。在籍中なら退職の登録、退職者なら「在籍に戻す」を出す。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";

const RETIRED_ON_DESCRIPTION = "空なら今日の日付で登録します。";

export function RetireSection({
  isActive,
  retiredOnLabel,
  openTaskCount,
  retireAction,
  reinstateAction,
}: {
  isActive: boolean;
  retiredOnLabel: string | null;
  // CH-07 その人が担当の未完了のタスクの件数(CMN-03 の countOpenTasksOfEmployee)
  openTaskCount: number;
  retireAction: (prev: FormState, formData: FormData) => Promise<FormState>;
  reinstateAction: () => Promise<void>;
}) {
  const [state, formAction] = useActionState(retireAction, emptyFormState);
  const error = state.errors.retired_on;

  const confirmMessage = [
    "退職を登録してよいですか？退職にすると、この人はログインできなくなります。",
    openTaskCount > 0
      ? `未完了のタスクが ${openTaskCount} 件あります。退職の後、全員のタスクの画面で担当を変えてください。`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">在籍</h2>
      {isActive ? (
        <form action={formAction} className="flex flex-col gap-3">
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <div className="flex flex-wrap items-end gap-3">
            <Field id="retired_on" label="退職日" description={RETIRED_ON_DESCRIPTION} error={error}>
              <TextInput
                id="retired_on"
                name="retired_on"
                type="date"
                defaultValue={state.values.retired_on ?? ""}
                invalid={!!error}
                aria-describedby={fieldDescribedBy("retired_on", { description: RETIRED_ON_DESCRIPTION, error })}
                className="w-48"
              />
            </Field>
            <ConfirmSubmitButton confirmMessage={confirmMessage} pendingText="登録中…">
              退職を登録する
            </ConfirmSubmitButton>
          </div>
        </form>
      ) : (
        <form action={reinstateAction} className="flex flex-wrap items-center gap-3">
          <p className="text-sm">退職日 {retiredOnLabel ?? "—"}</p>
          <SubmitButton variant="secondary" pendingText="保存中…">
            在籍に戻す
          </SubmitButton>
        </form>
      )}
    </section>
  );
}
