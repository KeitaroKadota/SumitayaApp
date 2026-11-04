"use client";

// G02 日の詳細の入力(E-02 EV-03 打刻の追加・EV-04 取り消し・EV-05 確認済みにする)。
import { useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

const KIND_OPTIONS = [
  { value: "clock_in", label: "出勤" },
  { value: "break_start", label: "休憩開始" },
  { value: "break_end", label: "休憩終了" },
  { value: "clock_out", label: "退勤" },
];

// EV-03 打刻を追加する。日付は勤務日の当日か翌日(夜12時をまたぐ退勤のため)
export function AddPunchForm({ action, workDate, nextDate }: { action: Action; workDate: string; nextDate: string }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = state.values;
  const e = state.errors;
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h3 className="font-bold">打刻を追加する</h3>
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="flex flex-wrap items-start gap-3">
        <Field id="punch_kind" label="種類" required error={e.kind}>
          <Select id="punch_kind" name="kind" defaultValue={v.kind ?? "clock_in"} invalid={!!e.kind} className="w-36">
            {KIND_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="punch_date" label="日付" required error={e.date}>
          <Select id="punch_date" name="date" defaultValue={v.date ?? workDate} invalid={!!e.date} className="w-44">
            <option value={workDate}>{workDate.replace(/-/g, "/")}（当日）</option>
            <option value={nextDate}>{nextDate.replace(/-/g, "/")}（翌日）</option>
          </Select>
        </Field>
        <Field id="punch_time" label="時刻" required error={e.time}>
          <TextInput
            id="punch_time"
            name="time"
            type="time"
            required
            defaultValue={v.time ?? ""}
            invalid={!!e.time}
            aria-describedby={fieldDescribedBy("punch_time", { error: e.time })}
            className="w-32"
          />
        </Field>
      </div>
      <Field id="punch_reason" label="理由" required error={e.reason}>
        <TextInput
          id="punch_reason"
          name="reason"
          required
          maxLength={200}
          placeholder="例: 本人の依頼（休憩の終わりの押し忘れ）"
          defaultValue={v.reason ?? ""}
          invalid={!!e.reason}
          aria-describedby={fieldDescribedBy("punch_reason", { error: e.reason })}
        />
      </Field>
      <Checkbox name="replace" value="1" defaultChecked={v.replace === "1"} label="同じ種類の打刻を取り消して置き換える（時刻を直すとき）" />
      {e.replace && <p className="text-sm text-danger">⚠ {e.replace}</p>}
      <div className="flex justify-end">
        <SubmitButton pendingText="追加中…">追加する</SubmitButton>
      </div>
    </form>
  );
}

// EV-04 取り消す。押すと理由の入力欄が出る
export function VoidPunchForm({ action, label }: { action: Action; label: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, emptyFormState);
  if (!open && !state.formError && !state.errors.reason) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        取り消す
      </Button>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id={`void_reason_${label}`} label="取り消しの理由" required error={state.errors.reason}>
        <TextInput
          id={`void_reason_${label}`}
          name="reason"
          required
          maxLength={200}
          defaultValue={state.values.reason ?? ""}
          invalid={!!state.errors.reason}
          className="w-64"
        />
      </Field>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={() => setOpen(false)}>
          やめる
        </Button>
        <ConfirmSubmitButton confirmMessage="この打刻を取り消してよいですか？取り消した打刻は記録として残ります。" pendingText="取り消し中…">
          取り消す
        </ConfirmSubmitButton>
      </div>
    </form>
  );
}

// EV-05 確認済みにする(法令・確認の異常だけ)
export function DismissAlertForm({ action, id }: { action: Action; id: string }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Field id={`dismiss_${id}`} label="確認済みにする理由" required error={state.errors.note}>
          <TextInput
            id={`dismiss_${id}`}
            name="note"
            required
            maxLength={200}
            placeholder="例: 店長の指示で休憩を短くした"
            defaultValue={state.values.note ?? ""}
            invalid={!!state.errors.note}
            className="w-72"
          />
        </Field>
        <SubmitButton variant="secondary" pendingText="保存中…">
          確認済みにする
        </SubmitButton>
      </div>
    </form>
  );
}
