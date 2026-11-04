"use client";

// G08 仕入先の詳細(新規も同じ)の入力フォーム(CMN-02 EV-15)。
// 「取引をやめる」は別のフォーム(activeFormId)を送るボタンとして、主ボタンから離して左に置く(00_画面共通ルール 4.1)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { ClosingPaymentFields } from "@/components/ClosingPaymentFields";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import type { FormState } from "@/utils/formState";
import { ORDER_METHODS, PAYMENT_METHODS } from "@/utils/masterRules";

export function SupplierForm({
  mode,
  action,
  initialValues,
  isActive,
  activeFormId,
  deactivateConfirm,
}: {
  mode: "new" | "edit";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  isActive: boolean;
  activeFormId?: string;
  // CH-29 取引をやめるときの確認の文(主な仕入先になっている商品の件数を入れる)
  deactivateConfirm?: string;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;

  const text = (name: string, label: string, opts: { required?: boolean; description?: string; className?: string } = {}) => (
    <Field id={name} label={label} required={opts.required} description={opts.description} error={e[name]}>
      <TextInput
        id={name}
        name={name}
        required={opts.required}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        className={opts.className}
        aria-describedby={fieldDescribedBy(name, { description: opts.description, error: e[name] })}
      />
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-3">
          {text("supplier_code", "コード")}
          {text("name", "名前", { required: true })}
          {text("name_kana", "ふりがな")}
        </div>
        {text("aliases", "別名", { description: "「、」で区切って10件まで（伝票・請求書に書かれる会社名の書き方の違い）。" })}
        <div className="grid gap-4 md:grid-cols-3">
          {text("contact_name", "担当者")}
          {text("phone", "電話")}
          {text("fax", "FAX")}
        </div>
        {text("email", "メール")}
        <div className="grid gap-4 md:grid-cols-[12rem_1fr]">
          {text("postal_code", "郵便番号")}
          {text("address", "住所")}
        </div>

        <h2 className="border-t border-line pt-4 text-lg font-bold">発注</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="order_method" label="発注方法" error={e.order_method}>
            <Select id="order_method" name="order_method" defaultValue={v.order_method ?? ""} invalid={!!e.order_method}>
              <option value="">（なし）</option>
              {Object.entries(ORDER_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {text("lead_time_days", "届くまでの日数（日）", { description: "休業日を含めた暦の日数。" })}
        </div>

        <h2 className="border-t border-line pt-4 text-lg font-bold">支払（E-04）</h2>
        <ClosingPaymentFields values={v} error={e.closing_day} paymentLabel="支払" />
        <div className="grid gap-4 md:grid-cols-3">
          <Field id="payment_method" label="支払方法" error={e.payment_method}>
            <Select id="payment_method" name="payment_method" defaultValue={v.payment_method ?? ""} invalid={!!e.payment_method}>
              <option value="">（なし）</option>
              {Object.entries(PAYMENT_METHODS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {text("transfer_to", "振込先", { description: "例: ○○銀行 ○○支店 普通 1234567" })}
        {text("registration_no", "登録番号", { description: "適格請求書（インボイス）の番号。例: T1234567890123" })}

        <h2 className="border-t border-line pt-4 text-lg font-bold">読み取り（C-01・E-04）</h2>
        <Field id="ocr_hint" label="読み取りの注意" description="例: 品番は右端の列。数量の単位は箱（500文字まで）。" error={e.ocr_hint}>
          <TextArea id="ocr_hint" name="ocr_hint" defaultValue={v.ocr_hint ?? ""} invalid={!!e.ocr_hint} />
        </Field>
        <Field id="note" label="メモ" error={e.note}>
          <TextArea id="note" name="note" defaultValue={v.note ?? ""} invalid={!!e.note} />
        </Field>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {activeFormId &&
            (isActive ? (
              <button
                type="submit"
                form={activeFormId}
                className={buttonClassName("danger")}
                onClick={(ev) => {
                  if (deactivateConfirm && !window.confirm(deactivateConfirm)) ev.preventDefault();
                }}
              >
                取引をやめる
              </button>
            ) : (
              <button type="submit" form={activeFormId} className={buttonClassName("secondary")}>
                取引中に戻す
              </button>
            ))}
        </div>
        <SubmitButton pendingText={mode === "new" ? "登録中…" : "保存中…"}>
          {mode === "new" ? "登録する" : "保存する"}
        </SubmitButton>
      </div>
    </form>
  );
}
