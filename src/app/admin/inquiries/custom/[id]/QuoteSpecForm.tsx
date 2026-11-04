"use client";

// D-04 G03 特注の案件の詳細の「仕様」(03 EV-03・EV-05・EV-08)。
// 「概算を計算」のボタン(右の欄)は form 属性でこのフォームを送る(intent=estimate。仕様を保存してから計算する)。
// 新しい返事の仕様(EV-03)は欄の横に並べ、担当者が「入れる」を押した項目だけを欄に入れる(保存は「仕様を保存」)。
import { useActionState, useState } from "react";
import { Alert } from "@/components/Alert";
import { Button } from "@/components/Button";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { Select } from "@/components/Select";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { CUSTOM_QUOTE_LIMITS, CUSTOM_SIZES, type PriceOption, type SpecCandidate } from "@/utils/customQuote";
import { sizeFieldName } from "@/utils/customQuoteInput";
import type { FormState } from "@/utils/formState";

export const QUOTE_SPEC_FORM_ID = "quote-spec-form";

export function QuoteSpecForm({
  action,
  initialValues,
  itemTypes,
  fabricOptions,
  printOptions,
  candidates,
  readOnly,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  itemTypes: string[];
  fabricOptions: PriceOption[];
  printOptions: PriceOption[];
  candidates: SpecCandidate[];
  // 受注・失注・取消のときは直せない
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  // 欄の値は画面で持つ(候補を「入れる」で入れるため。エラーのときも入力は残る)
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const e = state.errors;
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));

  const apply = (c: SpecCandidate) => {
    if (c.field === "spec_note") set("spec_note", vals.spec_note ? `${vals.spec_note}\n${c.value}` : c.value);
    else if (c.field === "print_item_id") setVals((prev) => ({ ...prev, print_item_id: c.value, print_none: "" }));
    else set(c.field, c.value);
    setApplied((prev) => new Set(prev).add(c.field));
  };

  const text = (name: string, label: string, opts: { required?: boolean; type?: string; className?: string; maxLength?: number } = {}) => (
    <Field id={`q_${name}`} label={label} required={opts.required} error={e[name]}>
      <TextInput
        id={`q_${name}`}
        name={name}
        type={opts.type}
        value={vals[name] ?? ""}
        onChange={(ev) => set(name, ev.currentTarget.value)}
        invalid={!!e[name]}
        maxLength={opts.maxLength}
        disabled={readOnly}
        className={opts.className}
        aria-describedby={fieldDescribedBy(`q_${name}`, { error: e[name] })}
      />
    </Field>
  );

  const sizeSum = CUSTOM_SIZES.reduce((sum, s) => sum + (Number((vals[sizeFieldName(s)] ?? "").normalize("NFKC")) || 0), 0);
  const pending = candidates.filter((c) => !applied.has(c.field));

  return (
    <form id={QUOTE_SPEC_FORM_ID} action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {/* EV-03 新しい返事の仕様 */}
      {!readOnly && pending.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-ai bg-ai-soft p-3 text-sm">
          <p className="font-bold">新しい返事に仕様があります。入れる項目を選び、「仕様を保存」を押してください。</p>
          <ul className="flex flex-col gap-1">
            {pending.map((c) => (
              <li key={c.field} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words">
                  新しい返事: {c.label} {c.display}
                  {c.changed && <span className="text-ink-muted">（今の値と違います）</span>}
                </span>
                <Button variant="secondary" onClick={() => apply(c)}>
                  入れる
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {text("organization_name", "団体名", { maxLength: CUSTOM_QUOTE_LIMITS.name })}
        {text("customer_name", "ご担当", { maxLength: CUSTOM_QUOTE_LIMITS.name })}
        {text("customer_email", "メール", { type: "email" })}
        {text("customer_phone", "電話", { type: "tel", maxLength: CUSTOM_QUOTE_LIMITS.phone })}
      </div>

      <Field id="q_item_type" label="品目" required error={e.item_type}>
        <Select
          id="q_item_type"
          name="item_type"
          value={vals.item_type ?? ""}
          onChange={(ev) => set("item_type", ev.currentTarget.value)}
          invalid={!!e.item_type}
          disabled={readOnly}
        >
          <option value="">選ぶ</option>
          {/* 単価表から外れた品目も、選び直すまでは出しておく(CH-04) */}
          {vals.item_type && !itemTypes.includes(vals.item_type) && <option value={vals.item_type}>{vals.item_type}（単価表にありません）</option>}
          {itemTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </Field>
      {itemTypes.length === 0 && <p className="text-sm text-ink-muted">単価表に縫製の行がありません。先に単価表に品目を登録してください。</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="q_fabric_item_id" label="生地" required error={e.fabric_item_id}>
          <Select
            id="q_fabric_item_id"
            name="fabric_item_id"
            value={vals.fabric_item_id ?? ""}
            onChange={(ev) => set("fabric_item_id", ev.currentTarget.value)}
            invalid={!!e.fabric_item_id}
            disabled={readOnly}
          >
            <option value="">選ぶ（未定）</option>
            {vals.fabric_item_id && !fabricOptions.some((o) => o.id === vals.fabric_item_id) && (
              <option value={vals.fabric_item_id}>（使わない生地です。選び直してください）</option>
            )}
            {fabricOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        {text("fabric_note", "生地の希望", { maxLength: CUSTOM_QUOTE_LIMITS.text })}
      </div>

      <fieldset className="flex flex-col gap-2" disabled={readOnly}>
        <legend className="flex items-center gap-2 text-sm font-bold">サイズと枚数</legend>
        <div className="flex flex-wrap items-start gap-3">
          {CUSTOM_SIZES.map((s) => {
            const name = sizeFieldName(s);
            return (
              <Field key={s} id={`q_${name}`} label={s} error={e[name]}>
                <TextInput
                  id={`q_${name}`}
                  name={name}
                  inputMode="numeric"
                  value={vals[name] ?? ""}
                  onChange={(ev) => set(name, ev.currentTarget.value)}
                  invalid={!!e[name]}
                  className="w-20"
                />
              </Field>
            );
          })}
          <Field id="q_quantity" label="合計の枚数" required error={e.quantity}>
            <TextInput
              id="q_quantity"
              name="quantity"
              inputMode="numeric"
              value={vals.quantity ?? ""}
              onChange={(ev) => set("quantity", ev.currentTarget.value)}
              invalid={!!e.quantity}
              className="w-24"
            />
          </Field>
        </div>
        {sizeSum > 0 && <p className="text-sm text-ink-muted tabular-nums">内訳の合計 {sizeSum}枚（合計の枚数が空なら、この数を入れます）</p>}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Field id="q_print_item_id" label="名入れ" required error={e.print_item_id}>
          <Select
            id="q_print_item_id"
            name="print_item_id"
            value={vals.print_none === "1" ? "" : (vals.print_item_id ?? "")}
            onChange={(ev) => set("print_item_id", ev.currentTarget.value)}
            invalid={!!e.print_item_id}
            disabled={readOnly || vals.print_none === "1"}
          >
            <option value="">選ぶ</option>
            {vals.print_item_id && !printOptions.some((o) => o.id === vals.print_item_id) && (
              <option value={vals.print_item_id}>（使わない名入れです。選び直してください）</option>
            )}
            {printOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Checkbox
          name="print_none"
          value="1"
          label="名入れなし"
          checked={vals.print_none === "1"}
          disabled={readOnly}
          onChange={(ev) => setVals((prev) => ({ ...prev, print_none: ev.currentTarget.checked ? "1" : "", print_item_id: "" }))}
        />
      </div>
      {text("print_text", "名入れの文字・場所", { maxLength: CUSTOM_QUOTE_LIMITS.text })}
      {text("desired_date", "希望納期（使う日）", { type: "date", required: true, className: "w-48" })}

      <Field id="q_spec_note" label="メモ" error={e.spec_note}>
        <TextArea
          id="q_spec_note"
          name="spec_note"
          rows={4}
          maxLength={CUSTOM_QUOTE_LIMITS.text}
          value={vals.spec_note ?? ""}
          onChange={(ev) => set("spec_note", ev.currentTarget.value)}
          invalid={!!e.spec_note}
          disabled={readOnly}
        />
      </Field>

      {!readOnly && (
        <div className="flex justify-end">
          <SubmitButton pendingText="保存中…">仕様を保存</SubmitButton>
        </div>
      )}
    </form>
  );
}
