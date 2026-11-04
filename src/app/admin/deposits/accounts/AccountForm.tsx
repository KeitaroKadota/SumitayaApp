"use client";

// G04 銀行口座の登録・編集の入力(E-06 02 G04 のモーダル、03 EV-10)。項目は 01 の 6.1 のとおり。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { LinkButton } from "@/components/LinkButton";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { ACCOUNT_TYPES, MAX_BANK_NAME, MAX_BRANCH_NAME } from "@/utils/deposits";
import type { FormState } from "@/utils/formState";

const TYPE_OPTIONS = Object.entries(ACCOUNT_TYPES).map(([value, label]) => ({ value, label }));

export function AccountForm({
  initial,
  formatOptions,
  closeHref,
  action,
}: {
  initial: Record<string, string>;
  formatOptions: { value: string; label: string }[];
  closeHref: string;
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initial });
  const v = state.values;
  const e = state.errors;
  const text = (id: string, label: string, opts: { required?: boolean; description?: string; maxLength?: number; className?: string } = {}) => (
    <Field id={id} label={label} required={opts.required} description={opts.description} error={e[id]}>
      <TextInput
        id={id}
        name={id}
        required={opts.required}
        maxLength={opts.maxLength}
        defaultValue={v[id] ?? ""}
        invalid={!!e[id]}
        aria-describedby={fieldDescribedBy(id, { description: opts.description, error: e[id] })}
        className={opts.className}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {text("bank_name", "銀行名", { required: true, maxLength: MAX_BANK_NAME })}
        {text("branch_name", "支店名", { maxLength: MAX_BRANCH_NAME })}
      </div>
      <RadioGroup name="account_type" label="種類" required options={TYPE_OPTIONS} defaultValue={v.account_type} error={e.account_type} />
      {text("account_number_last4", "口座番号（下4けた）", {
        required: true,
        description: "口座番号は下4けただけを登録します。",
        className: "w-32",
      })}
      <Checkbox name="has_online_banking" value="1" defaultChecked={v.has_online_banking === "1"} label="ネットバンキングがある" />
      <Field id="csv_format" label="CSVの形" description="空のときは、この口座の明細は取り込めません。" error={e.csv_format}>
        <Select id="csv_format" name="csv_format" defaultValue={v.csv_format ?? ""} invalid={!!e.csv_format} className="max-w-md">
          <option value="">−（取り込まない）</option>
          {formatOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </Field>
      <Checkbox name="is_target" value="1" defaultChecked={v.is_target === "1"} label="消込の対象にする" />
      {text("sort_order", "並び順", { description: "小さい順に並べます（0〜999）。", className: "w-32" })}
      <Checkbox name="is_active" value="1" defaultChecked={v.is_active === "1"} label="使っている" />
      <div className="flex justify-end gap-2">
        <LinkButton href={closeHref}>キャンセル</LinkButton>
        <SubmitButton pendingText="保存中…">保存する</SubmitButton>
      </div>
    </form>
  );
}
