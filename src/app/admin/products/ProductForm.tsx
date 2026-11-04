"use client";

// G05 商品の詳細・編集(新規も同じ)の入力フォーム(CMN-02 EV-08)。
// 「使用中止にする」は別のフォーム(activeFormId)を送るボタンとして、主ボタンから離して左に置く(00_画面共通ルール 4.1)。
import { useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import type { FormState } from "@/utils/formState";
import { PRODUCT_CATEGORIES, TAX_RATES } from "@/utils/masterRules";

type SupplierOption = { id: string; name: string; leadTimeDays: number | null; isActive: boolean };

const TAX_INCLUDED_OPTIONS = [
  { value: "1", label: "税込" },
  { value: "0", label: "税抜" },
];
const TAX_RATE_OPTIONS = TAX_RATES.map((r) => ({ value: String(r), label: `${r}％` }));

export function ProductForm({
  mode,
  action,
  initialValues,
  suppliers,
  isActive,
  activeFormId,
  children,
}: {
  mode: "new" | "edit";
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  suppliers: SupplierOption[];
  isActive: boolean;
  // 使用中止・使用中に戻すのフォームの id(編集のときだけ)
  activeFormId?: string;
  // 分析の結果(表示だけ)
  children?: React.ReactNode;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;
  const [supplierId, setSupplierId] = useState(initialValues.main_supplier_id ?? "");
  const supplierLead = suppliers.find((s) => s.id === supplierId)?.leadTimeDays ?? null;
  const leadDescription =
    supplierLead !== null ? `空なら仕入先の値（${supplierLead}日）を使います。` : "空なら仕入先の値を使います。";

  const text = (name: string, label: string, opts: { required?: boolean; placeholder?: string; readOnly?: boolean } = {}) => (
    <Field id={name} label={label} required={opts.required} error={e[name]}>
      <TextInput
        id={name}
        name={name}
        required={opts.required}
        readOnly={opts.readOnly}
        placeholder={opts.placeholder}
        defaultValue={v[name] ?? ""}
        invalid={!!e[name]}
        aria-describedby={fieldDescribedBy(name, { error: e[name] })}
      />
    </Field>
  );
  const number = (name: string, label: string, unit: string, description?: string) => (
    <Field id={name} label={label} description={description} error={e[name]}>
      <div className="flex items-center gap-2">
        <TextInput
          id={name}
          name={name}
          inputMode="numeric"
          defaultValue={v[name] ?? ""}
          invalid={!!e[name]}
          className="text-right tabular-nums"
          aria-describedby={fieldDescribedBy(name, { description, error: e[name] })}
        />
        <span className="shrink-0 text-sm">{unit}</span>
      </div>
    </Field>
  );

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      <section className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          {mode === "new" ? (
            text("product_code", "商品コード", { required: true, placeholder: "例: HP-001-L" })
          ) : (
            // CH-08 登録した後は変えられない(読み取り専用。サーバーでも受け取った値を無視する)
            <Field id="product_code" label="商品コード" description="登録した後は変えられません。">
              <TextInput id="product_code" value={v.product_code ?? ""} readOnly className="bg-canvas" />
            </Field>
          )}
          {text("item_code", "品番")}
        </div>
        {text("name", "商品名", { required: true })}
        <div className="grid gap-4 md:grid-cols-3">
          {text("size", "サイズ")}
          {text("color", "色・柄")}
          <Field id="category_code" label="分類" error={e.category_code}>
            <Select id="category_code" name="category_code" defaultValue={v.category_code ?? ""} invalid={!!e.category_code}>
              <option value="">（なし）</option>
              {Object.entries(PRODUCT_CATEGORIES).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}（{code}）
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {text("jan_code", "JANコード")}
          <div className="flex flex-col gap-2">
            <Field id="main_supplier_id" label="主な仕入先" error={e.main_supplier_id}>
              <Select
                id="main_supplier_id"
                name="main_supplier_id"
                value={supplierId}
                onChange={(ev) => setSupplierId(ev.currentTarget.value)}
                invalid={!!e.main_supplier_id}
                aria-describedby={fieldDescribedBy("main_supplier_id", { error: e.main_supplier_id })}
              >
                <option value="">（なし）</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.isActive ? "" : "（取引終了）"}
                  </option>
                ))}
              </Select>
            </Field>
            <Checkbox name="is_in_house" value="1" label="自社縫製の商品" defaultChecked={v.is_in_house === "1"} />
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {number("cost_price", "原価（税抜）", "円")}
          <div className="flex flex-col gap-2">
            {number("sell_price", "売価", "円")}
            <RadioGroup
              name="sell_price_tax_included"
              label="売価の税区分"
              options={TAX_INCLUDED_OPTIONS}
              defaultValue={v.sell_price_tax_included ?? "1"}
              error={e.sell_price_tax_included}
            />
          </div>
        </div>
        <RadioGroup
          name="tax_rate"
          label="税率"
          required
          options={TAX_RATE_OPTIONS}
          defaultValue={v.tax_rate ?? "10"}
          error={e.tax_rate}
        />

        <h2 className="border-t border-line pt-4 text-lg font-bold">発注（A-03 で使う）</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {number("order_lot", "発注の単位", "枚")}
          {number("min_order_qty", "最低の発注数", "枚")}
          {number("lead_time_days", "届くまでの日数", "日", leadDescription)}
        </div>
        <Field id="note" label="メモ" error={e.note}>
          <TextArea id="note" name="note" defaultValue={v.note ?? ""} invalid={!!e.note} />
        </Field>

        {children}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {activeFormId &&
            (isActive ? (
              <Button type="submit" form={activeFormId} variant="danger">
                使用中止にする
              </Button>
            ) : (
              <Button type="submit" form={activeFormId} variant="secondary">
                使用中に戻す
              </Button>
            ))}
        </div>
        <SubmitButton pendingText={mode === "new" ? "登録中…" : "保存中…"}>
          {mode === "new" ? "登録する" : "保存する"}
        </SubmitButton>
      </div>
    </form>
  );
}
