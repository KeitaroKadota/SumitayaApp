"use client";

// G10 取引先の詳細(新規も同じ)の入力フォーム(CMN-02 EV-15)。
// 「取引をやめる」は別のフォーム(activeFormId)を送るボタンとして、主ボタンから離して左に置く(00_画面共通ルール 4.1)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { ClosingPaymentFields } from "@/components/ClosingPaymentFields";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import type { FormState } from "@/utils/formState";
import { CUSTOMER_TYPES, HONORIFICS } from "@/utils/masterRules";

const HONORIFIC_OPTIONS = HONORIFICS.map((h) => ({ value: h, label: h }));

export function CustomerForm({
  mode,
  action,
  initialValues,
  isActive,
  activeFormId,
}: {
  mode: "new" | "edit";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  isActive: boolean;
  activeFormId?: string;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;

  const text = (name: string, label: string, opts: { required?: boolean; description?: string } = {}) => (
    <Field id={name} label={label} required={opts.required} description={opts.description} error={e[name]}>
      <TextInput
        id={name}
        name={name}
        required={opts.required}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        aria-describedby={fieldDescribedBy(name, { description: opts.description, error: e[name] })}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-3">
          {text("customer_code", "コード")}
          {text("name", "名前", { required: true })}
          {text("name_kana", "ふりがな")}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <RadioGroup
            name="honorific"
            label="敬称"
            required
            options={HONORIFIC_OPTIONS}
            defaultValue={v.honorific ?? "御中"}
            error={e.honorific}
          />
          {/* 02 G10 のとおり選択(プルダウン)にする */}
          <Field id="customer_type" label="種別" required error={e.customer_type}>
            <Select id="customer_type" name="customer_type" defaultValue={v.customer_type ?? "neighborhood"} invalid={!!e.customer_type}>
              {Object.entries(CUSTOMER_TYPES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {text("contact_name", "担当者")}
          {text("phone", "電話")}
          {text("email", "メール")}
        </div>
        <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
          {text("postal_code", "郵便番号")}
          {text("address", "住所")}
        </div>

        <h2 className="border-t border-line pt-4 text-lg font-bold">請求（E-05・E-06）</h2>
        <ClosingPaymentFields values={v} error={e.closing_day} paymentLabel="支払期限" />
        {text("payer_name_kana", "振込名義（カナ）", {
          description: "銀行の明細に出る名義。複数あるときは「、」で区切ります。保存のときに全角カタカナにそろえます。",
        })}
        <Field id="note" label="メモ" error={e.note}>
          <TextArea id="note" name="note" defaultValue={v.note ?? ""} invalid={!!e.note} />
        </Field>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {activeFormId && (
            <button
              type="submit"
              form={activeFormId}
              className={buttonClassName(isActive ? "danger" : "secondary")}
            >
              {isActive ? "取引をやめる" : "取引中に戻す"}
            </button>
          )}
        </div>
        <SubmitButton pendingText={mode === "new" ? "登録中…" : "保存中…"}>
          {mode === "new" ? "登録する" : "保存する"}
        </SubmitButton>
      </div>
    </form>
  );
}
