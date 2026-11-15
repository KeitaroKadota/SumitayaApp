"use client";

// C-01 G03 読み取り結果の確認・修正のフォーム(03 EV-08・EV-10、04 CH-06〜CH-10)。
// 欄の値は画面で持つ(エラーのときも入力を消さないため。E-04 の ReviewForm と同じ)。
// 計算(数量×単価＝金額、合計)は入力のたびに画面の中で checkSlip を使って見直し、✓／✖ と印(⚠)を出す(保存のときサーバーでも見直す)。
// 印の付いたセルは黄色にする。読み取りのときに付けた印(読み取れなかった など)は、その欄を直すまで残す。
// 「確定する」で計算が合わない項目が残っていれば、確認のダイアログを出す(EV-10 手順4)。
import { useActionState, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { Button, buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import {
  SLIP_LIMITS,
  SLIP_MAX_LINES,
  checkSlip,
  isReadFlag,
  parseSlipAmount,
  parseSlipQuantity,
  type CheckFlag,
  type SlipHeader,
  type SlipLineInput,
} from "@/utils/deliverySlipRules";
import type { FormState } from "@/utils/formState";

export type ReviewSlipLine = {
  key: string;
  id: string | null;
  code: string;
  name: string;
  spec: string;
  qty: string;
  unit: string;
  price: string;
  amount: string;
  // 自社の商品コードと、決まっている商品の名前
  product: string;
  productName: string | null;
  // 対応表で決まった(AIの読み取りのときに自動で入った)商品か
  productFromMap: boolean;
  nonstock: boolean;
  confidence: number | null;
  isEdited: boolean;
  flags: CheckFlag[];
};

const ARITHMETIC_CONFIRM = "計算が合わない項目があります。伝票のとおりなら、このまま確定してください。確定しますか？";

// 欄の名前(画面) ↔ 印の項目(checkSlip)
const HEADER_FIELDS: Record<string, string> = {
  supplier_id: "supplier",
  delivery_date: "deliveryDate",
  slip_no: "slipNo",
  subtotal: "subtotal",
  tax: "tax",
  total: "total",
};
const LINE_FIELDS: Record<string, string> = {
  code: "itemCode",
  name: "itemName",
  qty: "quantity",
  price: "unitPrice",
  amount: "amount",
  product: "product",
};

const num = (v: string) => parseSlipAmount(v).value;
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

function IntentButton({
  intent,
  variant,
  children,
  pendingText,
  onClick,
}: {
  intent: string;
  variant: "primary" | "secondary";
  children: React.ReactNode;
  pendingText: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} onClick={onClick} className={buttonClassName(variant)}>
      {mine ? pendingText : children}
    </button>
  );
}

export function SlipReviewForm({
  action,
  initialValues,
  initialLines,
  headerFlags,
  suppliers,
  version,
  readOnly,
  slipConfidence,
  hasAiResult,
  today,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  initialLines: ReviewSlipLine[];
  // 保存してある伝票の印
  headerFlags: CheckFlag[];
  suppliers: { id: string; name: string }[];
  version: string;
  readOnly: boolean;
  slipConfidence: number | null;
  hasAiResult: boolean;
  // 今日("YYYY-MM-DD"。日本時間。サーバーから渡す)
  today: string;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const [lines, setLines] = useState<ReviewSlipLine[]>(initialLines);
  const acceptRef = useRef<HTMLInputElement>(null);
  const e = state.errors;
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));
  const setLine = (key: string, patch: Partial<ReviewSlipLine>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // ---- 画面の中での見直し(EV-09 と同じ計算) ----
  const header: SlipHeader = {
    supplierId: vals.supplier_id || null,
    slipNo: vals.slip_no || null,
    deliveryDate: vals.delivery_date || null,
    orderRef: vals.order_ref || null,
    taxIncluded: vals.tax_included === "1",
    subtotal: parseSlipAmount(vals.subtotal ?? "", { min: 0 }).value,
    tax: parseSlipAmount(vals.tax ?? "", { min: 0 }).value,
    total: parseSlipAmount(vals.total ?? "", { min: 0 }).value,
    note: null,
  };
  if (header.taxIncluded && header.subtotal === null && header.total !== null && header.tax !== null)
    header.subtotal = header.total - header.tax;
  const changed = (l: ReviewSlipLine) => {
    const before = initialLines.find((x) => x.key === l.key);
    return !before || ["code", "name", "spec", "qty", "unit", "price", "amount"].some((f) => before[f as keyof ReviewSlipLine] !== l[f as keyof ReviewSlipLine]);
  };
  const liveLines: SlipLineInput[] = lines.map((l) => ({
    supplierItemCode: l.code || null,
    itemName: l.name,
    spec: l.spec || null,
    quantity: parseSlipQuantity(l.qty).value,
    unit: l.unit || null,
    unitPrice: num(l.price),
    amount: num(l.amount),
    productId: l.product ? l.product : null,
    isNonStock: l.nonstock,
    confidence: l.confidence,
    isEdited: l.isEdited || changed(l),
  }));
  const live = checkSlip({ header, lines: liveLines, slipConfidence, hasAiResult, today });

  // 読み取りのときの印は、その欄を直すまで残す
  const headerFlagsOf = (name: string): CheckFlag[] => {
    const field = HEADER_FIELDS[name] ?? name;
    const kept = vals[name] === initialValues[name] ? headerFlags.filter((f) => isReadFlag(f) && f.field === field) : [];
    return [...live.headerFlags.filter((f) => f.field === field), ...kept];
  };
  const lineFlagsOf = (l: ReviewSlipLine, i: number, name: string): CheckFlag[] => {
    const field = LINE_FIELDS[name] ?? name;
    const before = initialLines.find((x) => x.key === l.key);
    const unchanged = before && before[name as keyof ReviewSlipLine] === l[name as keyof ReviewSlipLine];
    const kept = unchanged ? l.flags.filter((f) => isReadFlag(f) && f.field === field) : [];
    return [...(live.lineFlags[i] ?? []).filter((f) => f.field === field), ...kept];
  };
  // 上にまとめて出す印(伝票の印と、明細を捨てたことの知らせ)
  const bannerFlags = [...live.headerFlags, ...headerFlags.filter((f) => isReadFlag(f) && f.field === "lines")];
  const lineBanner = live.lineFlags.flatMap((flags, i) =>
    [...new Set(flags.map((f) => f.message))].map((m) => `明細${i + 1}: ${m}`)
  );

  const flagText = (flags: CheckFlag[]) => [...new Set(flags.map((f) => f.message))].join("／");
  const flaggedClass = (flags: CheckFlag[]) => (flags.length > 0 ? "bg-warning-soft" : "");

  const text = (name: string, label: string, opts: { type?: string; numeric?: boolean; maxLength?: number } = {}) => {
    const flags = headerFlagsOf(name);
    return (
      <Field id={`s_${name}`} label={label} error={e[name]}>
        <TextInput
          id={`s_${name}`}
          name={name}
          type={opts.type}
          inputMode={opts.numeric ? "numeric" : undefined}
          value={vals[name] ?? ""}
          onChange={(ev) => set(name, ev.currentTarget.value)}
          invalid={!!e[name]}
          maxLength={opts.maxLength}
          disabled={readOnly}
          className={`${opts.numeric ? "text-right tabular-nums" : ""} ${flaggedClass(flags)}`}
        />
        {flags.length > 0 && <span className="text-xs font-bold text-warning">⚠ {flagText(flags)}</span>}
      </Field>
    );
  };

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        id: null,
        code: "",
        name: "",
        spec: "",
        qty: "",
        unit: "",
        price: "",
        amount: "",
        product: "",
        productName: null,
        productFromMap: false,
        nonstock: false,
        confidence: null,
        isEdited: true,
        flags: [],
      },
    ]);
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const cell = "px-1 py-1 align-top";
  const lineInput = (l: ReviewSlipLine, i: number, name: keyof ReviewSlipLine, opts: { numeric?: boolean; className?: string; label: string }) => {
    const flags = lineFlagsOf(l, i, name);
    const fieldName = `l${i}_${name}`;
    return (
      <div className="flex flex-col">
        <TextInput
          name={fieldName}
          aria-label={`明細${i + 1}の${opts.label}`}
          inputMode={opts.numeric ? "decimal" : undefined}
          value={String(l[name] ?? "")}
          onChange={(ev) => setLine(l.key, { [name]: ev.currentTarget.value })}
          invalid={!!e[fieldName]}
          disabled={readOnly}
          className={`min-h-9 px-2 text-sm ${opts.numeric ? "text-right tabular-nums" : ""} ${flaggedClass(flags)} ${opts.className ?? ""}`}
        />
        {flags.length > 0 && <span className="text-xs font-bold text-warning">⚠ {flagText(flags)}</span>}
      </div>
    );
  };

  const lineErrors = Object.entries(e).filter(([k]) => /^l\d+_/.test(k) || k === "lines");
  const linesSum = liveLines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const sumTarget = header.taxIncluded ? header.total : header.subtotal;
  const sumOk = sumTarget !== null && linesSum === sumTarget;
  const totalOk = header.subtotal !== null && header.tax !== null && header.total !== null && header.subtotal + header.tax === header.total;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="line_count" value={lines.length} />
      <input ref={acceptRef} type="hidden" name="accept_arithmetic" defaultValue="" />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {!readOnly && (bannerFlags.length > 0 || lineBanner.length > 0) && (
        <Alert tone="warning">
          <p className="font-bold">要確認</p>
          <ul className="list-disc pl-5">
            {[...new Set(bannerFlags.map((f) => f.message))].map((m) => (
              <li key={m}>{m}</li>
            ))}
            {lineBanner.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="s_supplier_id" label="仕入先" error={e.supplier_id}>
          <Select
            id="s_supplier_id"
            name="supplier_id"
            value={vals.supplier_id ?? ""}
            onChange={(ev) => set("supplier_id", ev.currentTarget.value)}
            invalid={!!e.supplier_id}
            disabled={readOnly}
            className={flaggedClass(headerFlagsOf("supplier_id"))}
          >
            <option value="">（選んでください）</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {initialValues.supplier_name_read && <span className="text-xs text-ink-muted">読んだ名前: {initialValues.supplier_name_read}</span>}
        </Field>
        {text("slip_no", "伝票番号", { maxLength: SLIP_LIMITS.slipNo })}
        {text("delivery_date", "納品日", { type: "date" })}
        {text("order_ref", "発注番号", { maxLength: SLIP_LIMITS.orderRef })}
      </div>
      <RadioGroup
        name="tax_included"
        label="明細の金額は"
        options={[
          { value: "0", label: "税抜" },
          { value: "1", label: "税込" },
        ]}
        value={vals.tax_included === "1" ? "1" : "0"}
        onChange={(v) => set("tax_included", v)}
        disabled={readOnly}
      />

      <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
        <h2 className="font-bold">明細</h2>
        {lineErrors.length > 0 && (
          <ul className="text-sm text-danger">
            {lineErrors.map(([k, msg]) => (
              <li key={k}>⚠ {msg}</li>
            ))}
          </ul>
        )}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="border-b border-line bg-canvas text-left">
              <tr>
                <th className="px-1 py-2">No</th>
                <th className="px-1 py-2">品番</th>
                <th className="px-1 py-2">品名</th>
                <th className="px-1 py-2">規格</th>
                <th className="px-1 py-2 text-right">数量</th>
                <th className="px-1 py-2">単位</th>
                <th className="px-1 py-2 text-right">単価（円）</th>
                <th className="px-1 py-2 text-right">金額（円）</th>
                <th className="px-1 py-2">自社の商品</th>
                <th className="px-1 py-2">
                  <span className="sr-only">行を外す</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const productFlags = lineFlagsOf(l, i, "product");
                const lowConfidence = (live.lineFlags[i] ?? []).some((f) => f.field === "confidence");
                return (
                  <tr key={l.key} className="border-b border-line last:border-b-0">
                    <td className={`${cell} tabular-nums`}>
                      <input type="hidden" name={`l${i}_id`} value={l.id ?? ""} />
                      {i + 1}
                      {lowConfidence && (
                        <span className="block text-xs font-bold text-warning" title="読み取りの確かさが低い明細です">
                          ⚠
                        </span>
                      )}
                    </td>
                    <td className={cell}>{lineInput(l, i, "code", { label: "品番", className: "w-24" })}</td>
                    <td className={cell}>{lineInput(l, i, "name", { label: "品名", className: "w-40" })}</td>
                    <td className={cell}>{lineInput(l, i, "spec", { label: "規格", className: "w-20" })}</td>
                    <td className={cell}>{lineInput(l, i, "qty", { numeric: true, label: "数量", className: "w-20" })}</td>
                    <td className={cell}>{lineInput(l, i, "unit", { label: "単位", className: "w-14" })}</td>
                    <td className={cell}>{lineInput(l, i, "price", { numeric: true, label: "単価", className: "w-24" })}</td>
                    <td className={cell}>{lineInput(l, i, "amount", { numeric: true, label: "金額", className: "w-24" })}</td>
                    <td className={`${cell} min-w-44`}>
                      <div className="flex flex-col gap-1">
                        <TextInput
                          name={`l${i}_product`}
                          aria-label={`明細${i + 1}の自社の商品コード`}
                          placeholder="商品コード"
                          value={l.product}
                          onChange={(ev) => setLine(l.key, { product: ev.currentTarget.value, productName: null, productFromMap: false })}
                          invalid={!!e[`l${i}_product`]}
                          disabled={readOnly || l.nonstock}
                          className={`min-h-9 px-2 text-sm ${l.nonstock ? "" : flaggedClass(productFlags)}`}
                        />
                        {l.productName && (
                          <span className="text-xs text-ink-muted">
                            {l.productFromMap ? "✓ " : ""}
                            {l.productName}
                          </span>
                        )}
                        {!l.nonstock && productFlags.length > 0 && <span className="text-xs font-bold text-warning">⚠ {flagText(productFlags)}</span>}
                        <label className="inline-flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            name={`l${i}_nonstock`}
                            value="1"
                            checked={l.nonstock}
                            onChange={(ev) => setLine(l.key, { nonstock: ev.currentTarget.checked })}
                            disabled={readOnly}
                            className="size-4 accent-primary"
                          />
                          在庫にしない（送料・加工賃など）
                        </label>
                      </div>
                    </td>
                    <td className={cell}>
                      {!readOnly && (
                        <button
                          type="button"
                          aria-label={`明細${i + 1}を外す`}
                          onClick={() => removeLine(l.key)}
                          className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-canvas"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!readOnly && lines.length < SLIP_MAX_LINES && (
          <div>
            <Button variant="secondary" onClick={addLine}>
              ＋明細を足す
            </Button>
          </div>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-3">
        {text("subtotal", "小計（税抜・円）", { numeric: true })}
        {text("tax", "税（円）", { numeric: true })}
        {text("total", "合計（税込・円）", { numeric: true })}
      </div>
      <p className="text-sm tabular-nums">
        計算: 明細の合計 {yen(linesSum)} {sumTarget === null ? "" : sumOk ? "✓" : "✖"}
        {header.subtotal !== null && header.tax !== null && (
          <>
            　小計＋税 {yen(header.subtotal + header.tax)} {header.total === null ? "" : totalOk ? "✓" : "✖"}
          </>
        )}
      </p>

      <Field id="s_note" label="メモ" error={e.note}>
        <TextArea
          id="s_note"
          name="note"
          value={vals.note ?? ""}
          onChange={(ev) => set("note", ev.currentTarget.value)}
          maxLength={SLIP_LIMITS.note}
          disabled={readOnly}
        />
      </Field>

      {!readOnly && (
        <div className="flex flex-wrap justify-end gap-2">
          <IntentButton intent="save" variant="secondary" pendingText="保存中…">
            保存
          </IntentButton>
          <IntentButton
            intent="confirm"
            variant="primary"
            pendingText="確定中…"
            onClick={(ev) => {
              // EV-10 手順4: 計算が合わない項目が残っていれば確認を出す(「やめる」なら確定しない)
              if (!acceptRef.current) return;
              if (live.hasArithmeticIssue) {
                if (!window.confirm(ARITHMETIC_CONFIRM)) {
                  ev.preventDefault();
                  return;
                }
                acceptRef.current.value = "1";
              } else {
                acceptRef.current.value = "";
              }
            }}
          >
            確定する
          </IntentButton>
        </div>
      )}
    </form>
  );
}
