"use client";

// D-04 G04 概算の単価表の1行の入力(03 EV-13)。一覧の行を押すと、その行がこの入力欄になる。
import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { CUSTOM_QUOTE_LIMITS, PRICE_KINDS, PRICE_UNITS } from "@/utils/customQuote";
import type { FormState } from "@/utils/formState";

export function PriceItemForm({
  action,
  initialValues,
  filter,
  cancelHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  // 保存の後に戻る一覧の条件
  filter: { kind: string; all: boolean };
  cancelHref: string;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;

  const input = (name: string, label: string, opts: { className?: string; inputMode?: "numeric"; maxLength?: number } = {}) => (
    <Field id={`pi_${name}`} label={label} error={e[name]}>
      <TextInput
        id={`pi_${name}`}
        name={name}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        inputMode={opts.inputMode}
        maxLength={opts.maxLength}
        className={opts.className}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-3 p-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <input type="hidden" name="filter_kind" value={filter.kind} />
      {filter.all && <input type="hidden" name="filter_all" value="1" />}
      <div className="flex flex-wrap items-start gap-3">
        <Field id="pi_kind" label="区分" required error={e.kind}>
          <Select id="pi_kind" name="kind" required defaultValue={v.kind ?? ""} invalid={!!e.kind} className="w-28">
            <option value="" disabled>
              選ぶ
            </option>
            {Object.entries(PRICE_KINDS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {input("item_type", "品目（縫製では必須）", { className: "w-40", maxLength: CUSTOM_QUOTE_LIMITS.priceName })}
        {input("name", "名前", { className: "w-56", maxLength: CUSTOM_QUOTE_LIMITS.priceName })}
        <Field id="pi_unit" label="単位" required error={e.unit}>
          <Select id="pi_unit" name="unit" required defaultValue={v.unit ?? "per_piece"} invalid={!!e.unit} className="w-24">
            {Object.entries(PRICE_UNITS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {input("qty_from", "枚数（から）", { className: "w-24", inputMode: "numeric" })}
        {input("qty_to", "枚数（まで。空は上限なし）", { className: "w-24", inputMode: "numeric" })}
        {input("unit_price", "単価（税抜・円）", { className: "w-32", inputMode: "numeric" })}
        {input("sort_order", "並び順", { className: "w-20", inputMode: "numeric" })}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {input("note", "メモ（お客様には出しません）", { className: "w-96 max-w-full", maxLength: CUSTOM_QUOTE_LIMITS.text })}
        <Checkbox name="is_active" value="1" label="使う" defaultChecked={(v.is_active ?? "") === "1"} />
        <div className="ml-auto flex gap-2">
          <Link href={cancelHref} className={buttonClassName("secondary")}>
            やめる
          </Link>
          <SubmitButton pendingText="保存中…">保存する</SubmitButton>
        </div>
      </div>
    </form>
  );
}
