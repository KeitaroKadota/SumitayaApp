"use client";

// G01 ABC分析の「計算する」の入力(A-02 EV-02)
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Field, fieldDescribedBy } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";

export function AbcCalcForm({
  action,
  defaultFrom,
  defaultTo,
  salesRangeText,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaultFrom: string;
  defaultTo: string;
  salesRangeText: string;
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = state.values;
  const err = state.errors.period;

  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-5">
      <h2 className="text-lg font-bold">計算する</h2>
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="abc_from" label="期間（始め）" error={err}>
          <TextInput
            id="abc_from"
            name="from"
            type="date"
            required
            defaultValue={v.from ?? defaultFrom}
            invalid={!!err}
            aria-describedby={fieldDescribedBy("abc_from", { error: err })}
            className="w-44"
          />
        </Field>
        <Field id="abc_to" label="期間（終わり）">
          <TextInput id="abc_to" name="to" type="date" required defaultValue={v.to ?? defaultTo} invalid={!!err} className="w-44" />
        </Field>
        <SubmitButton pendingText="計算中…">計算する</SubmitButton>
      </div>
      <p className="text-sm text-ink-muted">既定は直近12か月です。※計算すると、商品マスタのランクがすぐに書き換わります。</p>
      <p className="text-sm text-ink-muted">※売上が取り込まれている期間: {salesRangeText}</p>
    </form>
  );
}
