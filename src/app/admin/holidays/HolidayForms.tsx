"use client";

// G11 祝日・休業日の入力(CMN-02 EV-19 追加・EV-20 変更のモーダル)。
import { useActionState, useRef } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";

const MODE_OPTIONS = [
  { value: "closed", label: "臨時休業" },
  { value: "open", label: "臨時営業（休業日の行を営業にする）" },
];
const CLOSED_OPTIONS = [
  { value: "1", label: "休み" },
  { value: "0", label: "営業" },
];

// EV-19 休業日の追加
export function HolidayAddForm({ action }: { action: (prev: FormState, formData: FormData) => Promise<FormState> }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = state.values;
  const e = state.errors;

  return (
    <form action={formAction} className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">休業日の追加</h2>
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="flex flex-wrap items-start gap-4">
        <Field id="holiday_date" label="日付" required error={e.date}>
          <TextInput
            id="holiday_date"
            name="date"
            type="date"
            required
            defaultValue={v.date ?? ""}
            invalid={!!e.date}
            aria-describedby={fieldDescribedBy("holiday_date", { error: e.date })}
            className="w-48"
          />
        </Field>
        <Field id="holiday_name" label="名前" required error={e.name}>
          <TextInput
            id="holiday_name"
            name="name"
            required
            placeholder="例: 年末休業"
            defaultValue={v.name ?? ""}
            invalid={!!e.name}
            aria-describedby={fieldDescribedBy("holiday_name", { error: e.name })}
            className="w-64"
          />
        </Field>
      </div>
      <RadioGroup name="mode" label="種類" options={MODE_OPTIONS} defaultValue={v.mode ?? "closed"} error={e.mode} />
      <div>
        <SubmitButton pendingText="追加中…">追加する</SubmitButton>
      </div>
    </form>
  );
}

// EV-20 「変更する」の小さな画面(モーダル)。名前・店は 休み／営業・メモを直す
export function HolidayEditButton({
  label,
  holiday,
  action,
}: {
  label: string;
  holiday: { id: string; name: string; isClosed: boolean; note: string | null };
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, formAction] = useActionState(action, {
    errors: {},
    formError: null,
    values: { name: holiday.name, is_closed: holiday.isClosed ? "1" : "0", note: holiday.note ?? "" },
  });
  const v = state.values;
  const e = state.errors;

  return (
    <>
      <Button variant="secondary" onClick={() => dialogRef.current?.showModal()}>
        変更する
      </Button>
      {/* dialog は Esc で閉じる(00_画面共通ルール 10章) */}
      <dialog
        ref={dialogRef}
        aria-label={`${label}の変更`}
        className="m-auto w-full max-w-md rounded-lg border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/40"
      >
        <form action={formAction} className="flex flex-col gap-4">
          <h2 className="text-lg font-bold">{label}の変更</h2>
          {state.formError && <Alert tone="error">{state.formError}</Alert>}
          <Field id={`name-${holiday.id}`} label="名前" required error={e.name}>
            <TextInput id={`name-${holiday.id}`} name="name" required defaultValue={v.name ?? ""} invalid={!!e.name} />
          </Field>
          <RadioGroup name="is_closed" label="店は" options={CLOSED_OPTIONS} defaultValue={v.is_closed} error={e.is_closed} />
          <Field id={`note-${holiday.id}`} label="メモ" error={e.note}>
            <TextInput id={`note-${holiday.id}`} name="note" defaultValue={v.note ?? ""} invalid={!!e.note} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => dialogRef.current?.close()}>
              閉じる
            </Button>
            <SubmitButton pendingText="保存中…">保存する</SubmitButton>
          </div>
        </form>
      </dialog>
    </>
  );
}
