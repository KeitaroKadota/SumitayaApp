"use client";

// G04 シフトの入力(E-02 EV-07 1日ずつ・EV-08 削除・EV-09 まとめて)。
import { useActionState, useMemo, useState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
type LocationOption = { id: string; name: string };

const KIND_OPTIONS = [
  { value: "work", label: "出勤" },
  { value: "paid_leave", label: "有給" },
  { value: "paid_leave_half", label: "半休" },
  { value: "special_leave", label: "特休" },
  { value: "absence", label: "欠勤" },
];
const LEAVE_OPTIONS = [
  { value: "paid_leave", label: "有給休暇" },
  { value: "special_leave", label: "特別休暇" },
  { value: "absence", label: "欠勤" },
];

function TimeFields({
  values,
  errors,
  locations,
  prefix,
}: {
  values: Record<string, string>;
  errors: Record<string, string>;
  locations: LocationOption[];
  prefix: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <Field id={`${prefix}_start`} label="開始" required error={errors.start_time}>
        <TextInput id={`${prefix}_start`} name="start_time" type="time" defaultValue={values.start_time ?? ""} invalid={!!errors.start_time} className="w-32" />
      </Field>
      <Field id={`${prefix}_end`} label="終了" required error={errors.end_time}>
        <TextInput id={`${prefix}_end`} name="end_time" type="time" defaultValue={values.end_time ?? ""} invalid={!!errors.end_time} className="w-32" />
      </Field>
      <Field id={`${prefix}_break`} label="休憩（分）" error={errors.break_minutes}>
        <TextInput
          id={`${prefix}_break`}
          name="break_minutes"
          inputMode="numeric"
          defaultValue={values.break_minutes ?? "0"}
          invalid={!!errors.break_minutes}
          aria-describedby={fieldDescribedBy(`${prefix}_break`, { error: errors.break_minutes })}
          className="w-24"
        />
      </Field>
      <Field id={`${prefix}_location`} label="場所" error={errors.location_id}>
        <Select id={`${prefix}_location`} name="location_id" defaultValue={values.location_id ?? ""} invalid={!!errors.location_id} className="w-44">
          <option value="">指定なし</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}

// EV-07・EV-08 1日のシフト
export function ShiftForm({
  action,
  deleteAction,
  initial,
  locations,
  closedDayName,
  hasShift,
}: {
  action: Action;
  deleteAction: () => Promise<void>;
  initial: Record<string, string>;
  locations: LocationOption[];
  closedDayName: string | null;
  hasShift: boolean;
}) {
  const [state, formAction] = useActionState(action, { ...emptyFormState, values: initial });
  const [kind, setKind] = useState(state.values.kind ?? "work");
  const showTimes = kind === "work" || kind === "paid_leave_half";
  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        {state.formError && <Alert tone="error">{state.formError}</Alert>}
        <RadioGroup name="kind" label="区分" required options={KIND_OPTIONS} value={kind} onChange={setKind} error={state.errors.kind} />
        {showTimes && <TimeFields values={state.values} errors={state.errors} locations={locations} prefix="shift" />}
        <Field id="shift_note" label="メモ" error={state.errors.note}>
          <TextInput id="shift_note" name="note" maxLength={200} defaultValue={state.values.note ?? ""} invalid={!!state.errors.note} />
        </Field>
        {closedDayName && <Alert tone="warning">この日は{closedDayName}です。</Alert>}
        <div className="flex justify-end">
          <SubmitButton pendingText="保存中…">保存する</SubmitButton>
        </div>
      </form>
      {hasShift && (
        <form action={deleteAction}>
          <ConfirmSubmitButton confirmMessage="このシフトを削除してよいですか？" pendingText="削除中…">
            削除する
          </ConfirmSubmitButton>
        </form>
      )}
    </div>
  );
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: "月" },
  { value: 2, label: "火" },
  { value: 3, label: "水" },
  { value: 4, label: "木" },
  { value: 5, label: "金" },
  { value: 6, label: "土" },
  { value: 0, label: "日" },
];

const addDays = (date: string, days: number) => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};
const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

// EV-09 まとめて入力。入力が変わるたびに対象の日数・上書き・休業日で除く件数を出す(画面の中の計算。保存しない)
export function BulkShiftForm({
  action,
  employees,
  locations,
  defaultFrom,
  defaultTo,
  existingKeys,
  closedDates,
  knownFrom,
  knownTo,
}: {
  action: Action;
  employees: { id: string; name: string }[];
  locations: LocationOption[];
  defaultFrom: string;
  defaultTo: string;
  // すでにあるシフト(「従業員ID|日付」)と休業日。knownFrom〜knownTo の分だけ
  existingKeys: string[];
  closedDates: string[];
  knownFrom: string;
  knownTo: string;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = state.values;
  const e = state.errors;
  const [selected, setSelected] = useState<string[]>(v.employee_ids ? v.employee_ids.split(",") : []);
  const [from, setFrom] = useState(v.from ?? defaultFrom);
  const [to, setTo] = useState(v.to ?? defaultTo);
  const [weekdays, setWeekdays] = useState<number[]>(v.weekdays ? v.weekdays.split(",").map(Number) : [1, 2, 5, 6, 0]);
  const [mode, setMode] = useState(v.mode ?? "times");
  const [skipClosed, setSkipClosed] = useState(v.skip_closed ? v.skip_closed === "1" : true);
  const [overwrite, setOverwrite] = useState(v.overwrite === "1");

  const preview = useMemo(() => {
    if (!from || !to || from > to) return null;
    const existing = new Set(existingKeys);
    const closed = new Set(closedDates);
    let target = 0;
    let overwriteCount = 0;
    let kept = 0;
    let excluded = 0;
    let unknown = false;
    for (let d = from, i = 0; d <= to && i < 400; d = addDays(d, 1), i++) {
      if (!weekdays.includes(weekdayOf(d))) continue;
      if (d < knownFrom || d > knownTo) unknown = true;
      if (skipClosed && closed.has(d)) {
        excluded += selected.length;
        continue;
      }
      for (const id of selected) {
        if (existing.has(`${id}|${d}`)) {
          if (overwrite) {
            overwriteCount += 1;
            target += 1;
          } else kept += 1;
        } else target += 1;
      }
    }
    return { target, overwriteCount, kept, excluded, unknown };
  }, [from, to, weekdays, selected, skipClosed, overwrite, existingKeys, closedDates, knownFrom, knownTo]);

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-bold">従業員</legend>
        <div className="flex flex-wrap gap-x-4">
          {employees.map((emp) => (
            <Checkbox
              key={emp.id}
              name="employee_ids"
              value={emp.id}
              checked={selected.includes(emp.id)}
              onChange={() => setSelected(toggle(selected, emp.id))}
              label={emp.name}
            />
          ))}
        </div>
        {e.employee_ids && <p className="text-sm text-danger">⚠ {e.employee_ids}</p>}
      </fieldset>
      <div className="flex flex-wrap items-start gap-3">
        <Field id="bulk_from" label="期間の始まり" required error={e.from}>
          <TextInput id="bulk_from" name="from" type="date" value={from} onChange={(ev) => setFrom(ev.target.value)} invalid={!!e.from} className="w-44" />
        </Field>
        <Field id="bulk_to" label="期間の終わり" required>
          <TextInput id="bulk_to" name="to" type="date" value={to} onChange={(ev) => setTo(ev.target.value)} className="w-44" />
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-bold">曜日</legend>
        <div className="flex flex-wrap gap-x-4">
          {WEEKDAY_OPTIONS.map((w) => (
            <Checkbox
              key={w.value}
              name="weekdays"
              value={String(w.value)}
              checked={weekdays.includes(w.value)}
              onChange={() => setWeekdays(toggle(weekdays, w.value))}
              label={w.label}
            />
          ))}
        </div>
        {e.weekdays && <p className="text-sm text-danger">⚠ {e.weekdays}</p>}
      </fieldset>
      <RadioGroup
        name="mode"
        label="内容"
        options={[
          { value: "times", label: "時刻（出勤）" },
          { value: "leave", label: "区分（休み）" },
        ]}
        value={mode}
        onChange={setMode}
        error={e.mode}
      />
      {mode === "times" ? (
        <TimeFields values={v} errors={e} locations={locations} prefix="bulk" />
      ) : (
        <Field id="bulk_leave" label="区分" required error={e.leave_kind}>
          <Select id="bulk_leave" name="leave_kind" defaultValue={v.leave_kind ?? "paid_leave"} invalid={!!e.leave_kind} className="w-44">
            {LEAVE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="flex flex-col">
        <Checkbox name="skip_closed" value="1" checked={skipClosed} onChange={() => setSkipClosed(!skipClosed)} label="休業日（定休日・祝日・臨時休業）は入れない" />
        <Checkbox name="overwrite" value="1" checked={overwrite} onChange={() => setOverwrite(!overwrite)} label="すでに入っているシフトも上書きする" />
      </div>
      {preview && (
        <p className="text-sm tabular-nums" role="status">
          対象: {preview.target}日分（上書き {preview.overwriteCount}件・休業日で除外 {preview.excluded}件
          {preview.kept > 0 ? `・すでにあるため飛ばす ${preview.kept}件` : ""}）
          {preview.unknown && <span className="block text-ink-muted">表示中の月から離れた日の件数は、入力するときに数え直します。</span>}
        </p>
      )}
      <div className="flex justify-end">
        <SubmitButton pendingText="入力中…">入力する</SubmitButton>
      </div>
    </form>
  );
}
