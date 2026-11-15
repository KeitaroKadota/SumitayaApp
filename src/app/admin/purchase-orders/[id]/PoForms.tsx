"use client";

// G06 発注の詳細のフォーム(A-03 EV-09 下書きの保存・EV-13 発注したことを記録)
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Checkbox } from "@/components/Checkbox";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { formatQuantity } from "@/utils/format";
import { SEND_METHODS } from "@/utils/purchaseOrderRules";
import type { PoFormState } from "../actions";

type Action = (prev: PoFormState, formData: FormData) => Promise<PoFormState>;

export type DraftLineView = {
  id: string;
  lineNo: number;
  productCode: string;
  supplierItemCode: string | null;
  productName: string;
  suggestedQty: number | null;
  quantity: number;
  unitPrice: number;
  taxRate: number;
  receivedQty: number;
};

const td = "px-3 py-2";

// EV-09 下書きの編集(発注数・単価・行の追加と削除、入荷予定日・連絡・メモ)
export function PoDraftForm({ action, lines, initial }: { action: Action; lines: DraftLineView[]; initial: Record<string, string> }) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initial, warnings: [], saved: false });
  const v = state.values;
  const e = state.errors;
  const lineErrors = Object.entries(e).filter(([k]) => k.startsWith("qty_") || k.startsWith("price_"));

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      {lineErrors.length > 0 && (
        <Alert tone="error">
          {lineErrors.map(([k, m]) => (
            <p key={k}>{m}</p>
          ))}
        </Alert>
      )}
      {state.saved && <Alert tone="success">保存しました。</Alert>}
      {state.warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}

      <p className="text-xs text-ink-muted">単価・金額は円・税抜</p>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className={td}>行</th>
              <th className={td}>コード</th>
              <th className={td}>仕入先の品番</th>
              <th className={td}>商品名</th>
              <th className={`${td} text-right`}>提案</th>
              <th className={td}>発注数</th>
              <th className={td}>単価</th>
              <th className={`${td} text-right`}>税率</th>
              <th className={td}>消す</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line last:border-b-0">
                <td className={`${td} tabular-nums`}>
                  {l.lineNo}
                  <input type="hidden" name="line_id" value={l.id} />
                </td>
                <td className={`${td} tabular-nums`}>{l.productCode}</td>
                <td className={td}>{l.supplierItemCode ?? "−"}</td>
                <td className={td}>{l.productName}</td>
                <td className={`${td} text-right tabular-nums`}>{l.suggestedQty !== null ? formatQuantity(l.suggestedQty) : "−"}</td>
                <td className={td}>
                  <TextInput
                    name={`qty_${l.id}`}
                    inputMode="numeric"
                    aria-label={`${l.lineNo}行目の発注数`}
                    defaultValue={v[`qty_${l.id}`] ?? String(l.quantity)}
                    invalid={!!e[`qty_${l.id}`]}
                    className="w-24 text-right"
                  />
                </td>
                <td className={td}>
                  <TextInput
                    name={`price_${l.id}`}
                    inputMode="numeric"
                    aria-label={`${l.lineNo}行目の単価`}
                    defaultValue={v[`price_${l.id}`] ?? String(l.unitPrice)}
                    invalid={!!e[`price_${l.id}`]}
                    className="w-28 text-right"
                  />
                  {l.unitPrice === 0 && <p className="text-xs text-warning">⚠ 単価が0です</p>}
                </td>
                <td className={`${td} text-right tabular-nums`}>{l.taxRate}％</td>
                <td className={td}>
                  <Checkbox name="remove" value={l.id} label="消す" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <fieldset className="flex flex-wrap items-end gap-3 rounded-lg border border-line p-3">
        <legend className="px-1 text-sm font-bold">行を足す</legend>
        <Field id="add_code" label="商品コード" error={e.add_code}>
          <TextInput id="add_code" name="add_code" defaultValue={v.add_code ?? ""} invalid={!!e.add_code} className="w-44"
            aria-describedby={fieldDescribedBy("add_code", { error: e.add_code })} />
        </Field>
        <Field id="add_quantity" label="発注数" error={e.add_quantity}>
          <TextInput id="add_quantity" name="add_quantity" inputMode="numeric" defaultValue={v.add_quantity ?? ""} invalid={!!e.add_quantity} className="w-24" />
        </Field>
        <Field id="add_unit_price" label="単価（空なら商品の原価）" error={e.add_unit_price}>
          <TextInput id="add_unit_price" name="add_unit_price" inputMode="numeric" defaultValue={v.add_unit_price ?? ""} invalid={!!e.add_unit_price} className="w-28" />
        </Field>
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Field id="expected_date" label="入荷予定日" error={e.expected_date}>
          <TextInput id="expected_date" name="expected_date" type="date" defaultValue={v.expected_date ?? ""} invalid={!!e.expected_date} className="w-44" />
        </Field>
      </div>
      <Field id="note" label="仕入先への連絡（発注書に出ます）" error={e.note}>
        <TextInput id="note" name="note" maxLength={500} defaultValue={v.note ?? ""} invalid={!!e.note} />
      </Field>
      <Field id="internal_note" label="社内のメモ" error={e.internal_note}>
        <TextInput id="internal_note" name="internal_note" maxLength={500} defaultValue={v.internal_note ?? ""} invalid={!!e.internal_note} />
      </Field>
      <div>
        <SubmitButton pendingText="保存中…">保存</SubmitButton>
      </div>
    </form>
  );
}

// EV-13 「発注したことを記録」(発注日・方法・入荷予定日)
export function PoOrderForm({ action, initial }: { action: Action; initial: Record<string, string> }) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initial, warnings: [], saved: false });
  const v = state.values;
  const e = state.errors;
  return (
    <form action={formAction} className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
      <h2 className="font-bold">発注したことを記録</h2>
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="flex flex-wrap items-end gap-3">
        <Field id="order_date" label="発注日" required error={e.order_date}>
          <TextInput id="order_date" name="order_date" type="date" required defaultValue={v.order_date ?? ""} invalid={!!e.order_date} className="w-44" />
        </Field>
        <Field id="ord_expected" label="入荷予定日" required error={e.expected_date}>
          <TextInput id="ord_expected" name="expected_date" type="date" required defaultValue={v.expected_date ?? ""} invalid={!!e.expected_date} className="w-44" />
        </Field>
      </div>
      <RadioGroup
        name="send_method"
        label="方法"
        required
        options={Object.entries(SEND_METHODS).map(([value, label]) => ({ value, label }))}
        defaultValue={v.send_method ?? "fax"}
        error={e.send_method}
      />
      <div>
        <SubmitButton pendingText="記録中…">記録する</SubmitButton>
      </div>
    </form>
  );
}
