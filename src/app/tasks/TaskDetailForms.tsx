"use client";

// G02 タスクの詳細のフォーム(CMN-03 EV-02「完了にする」・EV-04「未完了に戻す」)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Field, fieldDescribedBy } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TASK_NOTE_MAX } from "@/utils/taskTypes";
import type { TaskActionState } from "./actions";

const initialState: TaskActionState = { error: null, note: "" };
const NOTE_DESCRIPTION = `${TASK_NOTE_MAX}文字まで。空でもかまいません。`;

// 手で完了にできる種類のときだけ画面に置く
export function TaskCompleteForm({
  action,
}: {
  action: (prev: TaskActionState, formData: FormData) => Promise<TaskActionState>;
}) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field id="note" label="ひとこと（完了のメモ）" description={NOTE_DESCRIPTION}>
        <TextArea
          id="note"
          name="note"
          maxLength={TASK_NOTE_MAX}
          defaultValue={state.note}
          aria-describedby={fieldDescribedBy("note", { description: NOTE_DESCRIPTION })}
        />
      </Field>
      <SubmitButton size="lg" pendingText="保存中…" className="w-full">
        完了にする
      </SubmitButton>
    </form>
  );
}

export function TaskReopenForm({ action }: { action: (prev: TaskActionState) => Promise<TaskActionState> }) {
  const [state, formAction] = useActionState(action, initialState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton variant="secondary" size="lg" pendingText="保存中…" className="w-full">
        未完了に戻す
      </SubmitButton>
    </form>
  );
}
