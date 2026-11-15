"use client";

// C-01 G04 品番の対応の1行(保存)と、「＋対応を足す」の行(03 EV-12 手順3)。
// 表の中にフォームを入れられないので、1行を1つのフォーム(グリッド)にした。
import { useActionState } from "react";
import { Alert } from "@/components/Alert";
import { SubmitButton } from "@/components/SubmitButton";
import { TextInput } from "@/components/TextInput";
import { SLIP_LIMITS } from "@/utils/deliverySlipRules";
import type { FormState } from "@/utils/formState";

// 列の幅(見出しの行は page.tsx に同じ値で書く)
const ITEM_CODE_GRID = "grid grid-cols-[8rem_minmax(8rem,1fr)_minmax(10rem,1fr)_5rem_4rem_6rem] items-start gap-2";

export function ItemCodeForm({
  action,
  supplierId,
  initial,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  supplierId: string;
  // 今の対応(新しく足す行は null)
  initial: { id: string; code: string; name: string; productCode: string; productName: string; pack: number; active: boolean } | null;
}) {
  const initialValues: Record<string, string> = initial
    ? {
        supplier_item_code: initial.code,
        supplier_item_name: initial.name,
        product_code: initial.productCode,
        pack_quantity: String(initial.pack),
        is_active: initial.active ? "1" : "",
      }
    : { pack_quantity: "1" };
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const v = { ...initialValues, ...state.values };
  const e = state.errors;
  const errorList = [...new Set(Object.values(e))];

  return (
    <form action={formAction} className="flex flex-col gap-1 border-b border-line py-2 last:border-b-0">
      <input type="hidden" name="supplier_id" value={supplierId} />
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <div className={ITEM_CODE_GRID}>
        <TextInput
          name="supplier_item_code"
          aria-label="仕入先の品番"
          defaultValue={v.supplier_item_code ?? ""}
          key={`code-${v.supplier_item_code ?? ""}`}
          maxLength={SLIP_LIMITS.itemCode}
          invalid={!!e.supplier_item_code}
          className="min-h-9 px-2 text-sm"
        />
        <TextInput
          name="supplier_item_name"
          aria-label="仕入先の品名"
          defaultValue={v.supplier_item_name ?? ""}
          key={`name-${v.supplier_item_name ?? ""}`}
          maxLength={SLIP_LIMITS.supplierItemName}
          invalid={!!e.supplier_item_name}
          className="min-h-9 px-2 text-sm"
        />
        <div className="flex flex-col">
          <TextInput
            name="product_code"
            aria-label="自社の商品コード"
            placeholder="商品コード"
            defaultValue={v.product_code ?? ""}
            key={`product-${v.product_code ?? ""}`}
            invalid={!!e.product_code}
            className="min-h-9 px-2 text-sm"
          />
          {initial && <span className="text-xs text-ink-muted">{initial.productName}</span>}
        </div>
        <TextInput
          name="pack_quantity"
          aria-label="入数"
          inputMode="numeric"
          defaultValue={v.pack_quantity ?? "1"}
          key={`pack-${v.pack_quantity ?? ""}`}
          invalid={!!e.pack_quantity}
          className="min-h-9 px-2 text-right text-sm tabular-nums"
        />
        {initial ? (
          <label className="inline-flex min-h-9 items-center gap-1 text-sm">
            <input type="checkbox" name="is_active" value="1" defaultChecked={initial.active} className="size-5 accent-primary" />
            <span className="sr-only">使用</span>
          </label>
        ) : (
          <span />
        )}
        <SubmitButton variant={initial ? "secondary" : "primary"} pendingText="保存中…" className="min-h-9">
          {initial ? "保存" : "足す"}
        </SubmitButton>
      </div>
      {state.formError && errorList.length === 0 && <Alert tone="error">{state.formError}</Alert>}
      {errorList.length > 0 && (
        <ul className="text-sm text-danger">
          {errorList.map((m) => (
            <li key={m}>⚠ {m}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
