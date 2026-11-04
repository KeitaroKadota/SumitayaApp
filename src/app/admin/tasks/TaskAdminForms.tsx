"use client";

// G04 タスクの詳細・編集(管理)のフォーム(CMN-03 EV-04・EV-06・EV-07)。
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { buttonClassName, type ButtonVariant } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";
import { TASK_NOTE_MAX } from "@/utils/taskTypes";

type Option = { value: string; label: string };

const ASSIGNEE_KINDS: Option[] = [
  { value: "employee", label: "人" },
  { value: "role", label: "区分" },
  { value: "feature", label: "機能キー" },
];

export function TaskAssignmentForm({
  action,
  initial,
  employees,
  roles,
  featureKeys,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial: { kind: string; employeeId: string; role: string; featureKey: string; dueDate: string; urgent: boolean };
  employees: Option[];
  roles: Option[];
  featureKeys: Option[];
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = (name: string, fallback: string) => state.values[name] ?? fallback;
  const [kind, setKind] = useState(initial.kind);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <RadioGroup
        name="assignee_kind"
        label="担当"
        options={ASSIGNEE_KINDS}
        value={kind}
        onChange={setKind}
        required
        error={state.errors.assignee_kind}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Field id="assignee_employee_id" label="人" error={state.errors.assignee_employee_id}>
          <Select
            id="assignee_employee_id"
            name="assignee_employee_id"
            defaultValue={v("assignee_employee_id", initial.employeeId)}
            disabled={kind !== "employee"}
            invalid={!!state.errors.assignee_employee_id}
          >
            <option value="">選んでください</option>
            {employees.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="assignee_role" label="区分" error={state.errors.assignee_role}>
          <Select
            id="assignee_role"
            name="assignee_role"
            defaultValue={v("assignee_role", initial.role)}
            disabled={kind !== "role"}
            invalid={!!state.errors.assignee_role}
          >
            <option value="">選んでください</option>
            {roles.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="assignee_feature_key" label="機能キー" error={state.errors.assignee_feature_key}>
          <Select
            id="assignee_feature_key"
            name="assignee_feature_key"
            defaultValue={v("assignee_feature_key", initial.featureKey)}
            disabled={kind !== "feature"}
            invalid={!!state.errors.assignee_feature_key}
          >
            <option value="">選んでください</option>
            {featureKeys.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Field id="due_on" label="期限" error={state.errors.due_on}>
          <TextInput
            id="due_on"
            name="due_on"
            type="date"
            defaultValue={v("due_on", initial.dueDate)}
            invalid={!!state.errors.due_on}
            aria-describedby={fieldDescribedBy("due_on", { error: state.errors.due_on })}
            className="w-48"
          />
        </Field>
        <Checkbox name="urgent" value="1" label="急ぎ" defaultChecked={v("urgent", initial.urgent ? "1" : "") === "1"} />
      </div>
      <div className="flex justify-end">
        <SubmitButton pendingText="保存中…">変更を保存する</SubmitButton>
      </div>
    </form>
  );
}

// 確認のダイアログ付きで、押したボタンの値(status)を送る
function CloseButton({
  status,
  variant,
  confirmMessage,
  children,
}: {
  status: "done" | "cancelled";
  variant: ButtonVariant;
  confirmMessage: string | null;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="status"
      value={status}
      disabled={pending}
      className={buttonClassName(variant)}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) e.preventDefault();
      }}
    >
      {pending ? "保存中…" : children}
    </button>
  );
}

const NOTE_DESCRIPTION = `${TASK_NOTE_MAX}文字まで。空でもかまいません。`;

// EV-07 手で完了にできない種類は「完了にする」で確認のダイアログを出す(02 の G04)
export function TaskCloseForm({
  action,
  manualComplete,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  manualComplete: boolean;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id="note" label="ひとこと" description={NOTE_DESCRIPTION} error={state.errors.note}>
        <TextArea
          id="note"
          name="note"
          maxLength={TASK_NOTE_MAX}
          defaultValue={state.values.note ?? ""}
          invalid={!!state.errors.note}
          aria-describedby={fieldDescribedBy("note", { description: NOTE_DESCRIPTION, error: state.errors.note })}
        />
      </Field>
      <div className="flex flex-wrap justify-between gap-2">
        <CloseButton status="cancelled" variant="danger" confirmMessage="このタスクを取り消してよいですか？">
          取り消す
        </CloseButton>
        <CloseButton
          status="done"
          variant="primary"
          confirmMessage={manualComplete ? null : "元の画面では解決していません。完了にしますか？"}
        >
          完了にする
        </CloseButton>
      </div>
    </form>
  );
}

export function TaskAdminReopenForm({ action }: { action: (prev: FormState) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div>
        <SubmitButton variant="secondary" pendingText="保存中…">
          未完了に戻す
        </SubmitButton>
      </div>
    </form>
  );
}
