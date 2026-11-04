"use client";

// G04 問い合わせの詳細のフォーム(D-01 EV-08・EV-09・EV-15)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { emptyFormState, type FormState } from "@/utils/formState";
import {
  CUSTOM_SPEC_FIELDS,
  FAQ_TOPICS,
  INQUIRY_LIMITS,
  INQUIRY_STATUSES,
  RETURN_REASONS,
  type InquiryExtracted,
  type InquiryStatus,
} from "@/utils/inquiryRules";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;
type Option = { value: string; label: string };

// EV-09 状態・担当者
export function StatusAssigneeForm({
  action,
  status,
  nextStatuses,
  assignedTo,
  staff,
}: {
  action: Action;
  status: InquiryStatus;
  nextStatuses: InquiryStatus[];
  assignedTo: string;
  staff: Option[];
}) {
  const [state, formAction] = useActionState(action, emptyFormState);
  // 今の状態と、手で移れる状態(完了・対応不要はボタンで行う)
  const options = [status, ...nextStatuses.filter((s) => s !== "closed" && s !== "ignored")];
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      {state.formError && (
        <div className="w-full">
          <Alert tone="error">{state.formError}</Alert>
        </div>
      )}
      <Field id="status" label="状態" error={state.errors.status}>
        <Select id="status" name="status" defaultValue={state.values.status ?? status} className="w-48">
          {options.map((s) => (
            <option key={s} value={s}>
              {INQUIRY_STATUSES[s]}
            </option>
          ))}
        </Select>
      </Field>
      <Field id="assigned_to" label="担当" error={state.errors.assigned_to}>
        <Select id="assigned_to" name="assigned_to" defaultValue={state.values.assigned_to ?? assignedTo} className="w-40">
          <option value="">（なし）</option>
          {staff.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton variant="secondary" pendingText="保存中…">
        保存する
      </SubmitButton>
    </form>
  );
}

// EV-15 社内メモ
export function MemoForm({ action, memo }: { action: Action; memo: string }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const description = `お客様には出しません。${INQUIRY_LIMITS.memo.toLocaleString("ja-JP")}文字まで。`;
  return (
    <form action={formAction} className="flex flex-col gap-2">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <Field id="memo" label="社内メモ" description={description} error={state.errors.memo}>
        <TextArea
          id="memo"
          name="memo"
          maxLength={INQUIRY_LIMITS.memo}
          defaultValue={state.values.memo ?? memo}
          invalid={!!state.errors.memo}
          aria-describedby={fieldDescribedBy("memo", { description, error: state.errors.memo })}
        />
      </Field>
      <div className="flex justify-end">
        <SubmitButton variant="secondary" pendingText="保存中…">
          メモを保存する
        </SubmitButton>
      </div>
    </form>
  );
}

// 空の行を2つ足して出す(画面で行を増やす仕組みは持たない)
const EXTRA_PRODUCT_ROWS = 2;

// EV-08 抜き出した情報を直す
export function ExtractedForm({ action, extracted }: { action: Action; extracted: InquiryExtracted }) {
  const [state, formAction] = useActionState(action, emptyFormState);
  const v = (name: string, fallback: string | number | null | undefined) => state.values[name] ?? (fallback ?? "").toString();
  const products = extracted.products ?? [];
  const rows = Math.min(products.length + EXTRA_PRODUCT_ROWS, INQUIRY_LIMITS.extractedProducts + EXTRA_PRODUCT_ROWS);
  const err = state.errors;
  const topics = state.values.x_faq_topics !== undefined ? state.values.x_faq_topics.split(",") : (extracted.faq_topics ?? []);

  const text = (name: string, label: string, fallback: string | null | undefined) => (
    <Field id={name} label={label} error={err[name]}>
      <TextInput
        id={name}
        name={name}
        maxLength={INQUIRY_LIMITS.extractedText}
        defaultValue={v(name, fallback)}
        invalid={!!err[name]}
        aria-describedby={fieldDescribedBy(name, { error: err[name] })}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="grid gap-3 md:grid-cols-2">
        {text("x_customer_name", "お客様の名前", extracted.customer_name)}
        {text("x_order_number", "注文番号", extracted.order_number)}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">商品の候補</legend>
        <input type="hidden" name="x_product_rows" value={rows} />
        {err.x_product_rows && <p className="text-sm text-danger">⚠ {err.x_product_rows}</p>}
        {Array.from({ length: rows }, (_, i) => {
          const p = products[i];
          return (
            <div key={i} className="grid grid-cols-2 gap-2 md:grid-cols-5">
              {(["name", "code", "size", "color"] as const).map((k) => (
                <TextInput
                  key={k}
                  name={`x_product_${i}_${k}`}
                  aria-label={`${i + 1}行目の${{ name: "商品名", code: "商品コード", size: "サイズ", color: "色" }[k]}`}
                  placeholder={{ name: "商品名", code: "商品コード", size: "サイズ", color: "色" }[k]}
                  maxLength={INQUIRY_LIMITS.extractedText}
                  defaultValue={v(`x_product_${i}_${k}`, p?.[k])}
                />
              ))}
              <TextInput
                name={`x_product_${i}_quantity`}
                aria-label={`${i + 1}行目の数量`}
                placeholder="数量"
                inputMode="numeric"
                defaultValue={v(`x_product_${i}_quantity`, p?.quantity)}
                invalid={!!err[`x_product_${i}_quantity`]}
              />
              {err[`x_product_${i}_quantity`] && (
                <p className="col-span-full text-sm text-danger">⚠ {err[`x_product_${i}_quantity`]}</p>
              )}
            </div>
          );
        })}
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <Field id="x_desired_date" label="希望日" error={err.x_desired_date}>
          <TextInput
            id="x_desired_date"
            name="x_desired_date"
            type="date"
            defaultValue={v("x_desired_date", extracted.desired_date)}
            invalid={!!err.x_desired_date}
            aria-describedby={fieldDescribedBy("x_desired_date", { error: err.x_desired_date })}
          />
        </Field>
        <Field id="x_return_reason" label="返品の理由" error={err.x_return_reason}>
          <Select id="x_return_reason" name="x_return_reason" defaultValue={v("x_return_reason", extracted.return_reason)}>
            <option value="">（なし）</option>
            {Object.entries(RETURN_REASONS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-bold">よくある質問の話題</legend>
        <div className="flex flex-wrap gap-x-4">
          {Object.entries(FAQ_TOPICS).map(([value, label]) => (
            <Checkbox key={value} name="x_faq_topics" value={value} label={label} defaultChecked={topics.includes(value as never)} />
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-bold">特注の仕様</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(CUSTOM_SPEC_FIELDS).map(([key, label]) =>
            text(`x_custom_${key}`, label, extracted.custom_spec?.[key as keyof typeof CUSTOM_SPEC_FIELDS])
          )}
        </div>
      </fieldset>

      <Field id="x_other_topics" label="ほかの話題" error={err.x_other_topics}>
        <TextArea
          id="x_other_topics"
          name="x_other_topics"
          maxLength={INQUIRY_LIMITS.extractedLongText}
          defaultValue={v("x_other_topics", extracted.other_topics)}
          invalid={!!err.x_other_topics}
          aria-describedby={fieldDescribedBy("x_other_topics", { error: err.x_other_topics })}
        />
      </Field>

      <div className="flex justify-end">
        <SubmitButton pendingText="保存中…">保存する</SubmitButton>
      </div>
    </form>
  );
}
