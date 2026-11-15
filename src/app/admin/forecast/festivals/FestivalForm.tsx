"use client";

// G03 祭礼の編集(小窓の中身。A-03 EV-05)
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { errorSummary, type FormState } from "@/utils/formState";

export function FestivalForm({
  action,
  initial,
  categories,
  closeHref,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initial: Record<string, string>;
  categories: { value: string; label: string }[];
  closeHref: string;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initial });
  const v = state.values;
  const e = state.errors;
  const selected = new Set((v.category_codes ?? "").split(",").filter(Boolean));
  const text = (id: string, name: string, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}, description?: string) => (
    <Field id={id} label={label} required={props.required} error={e[name]} description={description}>
      <TextInput
        id={id}
        name={name}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        aria-describedby={fieldDescribedBy(id, { description, error: e[name] })}
        {...props}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {Object.keys(e).length > 0 && <Alert tone="error">{errorSummary(e)}</Alert>}
      {text("fe_series", "series_key", "つなぐ名前", { required: true, maxLength: 50 }, "年をまたいで同じ名前にします（例: 浜松まつり）")}
      {text("fe_name", "name", "名前", { required: true, maxLength: 100 }, "例: 浜松まつり 2027")}
      <div className="flex flex-wrap gap-3">
        {text("fe_start", "start_date", "初日", { type: "date", required: true, className: "w-44" })}
        {text("fe_end", "end_date", "最終日", { type: "date", required: true, className: "w-44" })}
        {text("fe_region", "region", "地域", { maxLength: 100, className: "w-48" })}
      </div>
      <div className="flex flex-wrap gap-3">
        {text("fe_before", "influence_days_before", "売れ始め（初日の何日前から）", { inputMode: "numeric", className: "w-28" })}
        {text("fe_after", "influence_days_after", "最終日の何日後まで", { inputMode: "numeric", className: "w-28" })}
        {text("fe_factor", "adjust_factor", "補正の倍率", { inputMode: "decimal", className: "w-28" }, "記念の大会などで増えそうなら 1.2 など")}
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-bold">対象の分類（選ばなければすべての商品）</legend>
        <div className="flex flex-wrap gap-x-4">
          {categories.map((c) => (
            <Checkbox key={c.value} name="category_codes" value={c.value} label={c.label} defaultChecked={selected.has(c.value)} />
          ))}
        </div>
        {e.category_codes && <p className="text-sm text-danger">⚠ {e.category_codes}</p>}
      </fieldset>
      <Checkbox name="is_held" value="1" label="開催する（中止なら外す）" defaultChecked={v.is_held === "1"} />
      {text("fe_note", "note", "メモ", { maxLength: 500 })}
      <div className="flex gap-2">
        <SubmitButton pendingText="保存中…">保存</SubmitButton>
        <LinkButton href={closeHref}>やめる</LinkButton>
      </div>
    </form>
  );
}
