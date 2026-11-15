"use client";

// C-02 G02 照合の結果の表と「この内容で検収する」「発注なしで検収する」(03 EV-03・EV-04、04 CH-09・CH-10)。
// 受け入れる数は既定で届いた数(整数にならないときは空)。検収済みのときは受け入れた数を出すだけ(readOnly)。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { Badge, type BadgeTone } from "@/components/Badge";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { SubmitButton } from "@/components/SubmitButton";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import type { FormState } from "@/utils/formState";

export type ReceivingRow = {
  // 納品書の明細(id あり)か、未納の発注の明細(id なし)
  id: string | null;
  lineNo: number | null;
  name: string;
  // 届いた(自社の単位。「1箱×10」などの添え書き)・発注残・単価・発注単価(表示用の文字)
  delivered: string;
  deliveredNote: string | null;
  openQty: string;
  unitPrice: string;
  orderUnitPrice: string;
  // 単価が違う印
  priceWarn: boolean;
  resultLabel: string;
  resultTone: BadgeTone;
  // 受け入れる数の入力(在庫にしない品・未納の行は入力なし)
  input: boolean;
  defaultQty: string;
  acceptedQty: string;
};

export function ReceivingForm({
  action,
  rows,
  version,
  readOnly,
  hasPurchaseOrder,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  rows: ReceivingRow[];
  version: string;
  readOnly: boolean;
  hasPurchaseOrder: boolean;
}) {
  const initialValues: Record<string, string> = {};
  for (const r of rows) if (r.id && r.input) initialValues[`qty_${r.id}`] = r.defaultQty;
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = state.values;
  const e = state.errors;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="version" value={version} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left">
            <tr>
              <th className="px-2 py-2">No</th>
              <th className="px-2 py-2">商品</th>
              <th className="px-2 py-2 text-right">届いた</th>
              <th className="px-2 py-2 text-right">発注残</th>
              <th className="px-2 py-2 text-right">単価（円）</th>
              <th className="px-2 py-2 text-right">発注単価（円）</th>
              <th className="px-2 py-2">{readOnly ? "受け入れた" : "受け入れる"}</th>
              <th className="px-2 py-2">結果</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const name = r.id ? `qty_${r.id}` : "";
              const err = r.id ? e[name] : undefined;
              return (
                <tr key={r.id ?? `open-${i}`} className="border-b border-line align-top last:border-b-0">
                  <td className="px-2 py-2 tabular-nums">{r.lineNo ?? ""}</td>
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap">
                    {r.delivered}
                    {r.deliveredNote && <span className="block text-xs text-ink-muted">{r.deliveredNote}</span>}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.openQty}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${r.priceWarn ? "font-bold text-danger" : ""}`}>
                    {r.unitPrice}
                    {r.priceWarn && " ⚠"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.orderUnitPrice}</td>
                  <td className="px-2 py-2">
                    {readOnly || !r.input || !r.id ? (
                      <span className="tabular-nums">{r.input ? r.acceptedQty : ""}</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <TextInput
                          id={name}
                          name={name}
                          inputMode="numeric"
                          aria-label={`明細${r.lineNo ?? ""}の受け入れる数`}
                          defaultValue={v[name] ?? ""}
                          invalid={!!err}
                          className="w-24 text-right"
                        />
                        {err && <span className="text-xs text-danger">{err}</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={r.resultTone}>{r.resultLabel}</Badge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <>
          <Field
            id="note"
            label="判断の理由"
            description="一致していない明細・届いた数より少なく受け入れる明細があるとき、発注なしで検収するときは必須です（500文字まで）。"
            error={e.note}
          >
            <TextArea
              id="note"
              name="note"
              maxLength={500}
              defaultValue={v.note ?? ""}
              invalid={!!e.note}
              aria-describedby={fieldDescribedBy("note", {
                description: "一致していない明細・届いた数より少なく受け入れる明細があるとき、発注なしで検収するときは必須です（500文字まで）。",
                error: e.note,
              })}
            />
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <ConfirmSubmitButton
              variant="secondary"
              name="intent"
              value="no_order"
              confirmMessage="発注と照らし合わせずに検収します。よろしいですか"
              pendingText="検収中…"
            >
              発注なしで検収する
            </ConfirmSubmitButton>
            <SubmitButton variant="primary" pendingText="検収中…" disabled={!hasPurchaseOrder}>
              この内容で検収する
            </SubmitButton>
          </div>
        </>
      )}
    </form>
  );
}
