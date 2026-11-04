"use client";

// E-05 G02 請求書の作成・編集(下書き)のフォーム(03 EV-02〜EV-06・EV-08・EV-12)。
// 欄の値は画面で持つ(エラーのときも入力を消さないため。E-04 の ReviewForm と同じ)。
// 明細の金額・合計は入力させず、入力のたびに計算して見せる(保存・発行のときはサーバーで計算し直す。CH-06)。
// 「発行する」は、発行できる条件(CH-09)を画面でも確かめ、満たさないときは押せず、理由を近くに出す。
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/Alert";
import { Button, buttonClassName } from "@/components/Button";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { formatQuantity, formatYen } from "@/utils/format";
import {
  DEFAULT_TAX_RATE,
  INVOICE_LIMITS,
  LATER_TRANSACTION_WARNING,
  PRICE_BASES,
  TAX_RATES,
  calcInvoiceTotals,
  calcLineAmount,
  defaultDueDate,
  hasLaterTransaction,
  issueBlockers,
  parseInvoiceForm,
  parseQuantityInput,
  parseUnitPriceInput,
  productDescription,
  productUnitPrice,
  type CompanySettings,
  type PriceBasis,
  type Rounding,
} from "@/utils/invoices";
import { formatClosingAndPayment } from "@/utils/masterRules";
import type { InvoiceFormState } from "./actions";
import { TotalsBox } from "./invoicesView";

export type FormCustomer = {
  id: string;
  name: string;
  honorific: string;
  postalCode: string | null;
  address: string | null;
  contactName: string | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  isActive: boolean;
};

export type FormLine = {
  key: string;
  date: string;
  desc: string;
  qty: string;
  unit: string;
  price: string;
  rate: string;
  product: string;
};

type ProductHit = {
  id: string;
  productCode: string;
  name: string;
  size: string | null;
  color: string | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  taxRate: number;
};

const emptyLine = (n: number): FormLine => ({
  key: `new-${Date.now()}-${n}`,
  date: "",
  desc: "",
  qty: "",
  unit: "",
  price: "",
  rate: String(DEFAULT_TAX_RATE),
  product: "",
});

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
  onClick?: () => void;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending} onClick={onClick} className={buttonClassName(variant)}>
      {mine ? pendingText : children}
    </button>
  );
}

// 「商品から選ぶ」のモーダル(EV-04)。在籍中の商品を名前・商品コードで探す
function ProductPicker({ onPick, onClose }: { onPick: (p: ProductHit) => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<ProductHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const search = async () => {
    if (!q.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/admin/invoices/products?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const body = (await res.json()) as { ok: boolean; items?: ProductHit[]; error?: string };
      if (!body.ok) setError(body.error ?? "商品を検索できませんでした。");
      else setItems(body.items ?? []);
    } catch {
      setError("商品を検索できませんでした。時間をおいてもう一度お試しください。");
    } finally {
      setLoading(false);
    }
  };

  return (
    <dialog
      ref={ref}
      aria-label="商品から選ぶ"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-ink/40"
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-bold">商品から選ぶ</h2>
          <Button variant="secondary" onClick={onClose}>
            閉じる
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Field id="product_q" label="商品名・商品コード">
            <TextInput
              id="product_q"
              value={q}
              onChange={(e) => setQ(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              maxLength={100}
            />
          </Field>
          <Button variant="secondary" onClick={() => void search()} disabled={loading}>
            {loading ? "検索中…" : "検索する"}
          </Button>
        </div>
        {error && <Alert tone="error">{error}</Alert>}
        {items && items.length === 0 && <p className="text-sm text-ink-muted">条件に合う商品はありません。</p>}
        {items && items.length > 0 && (
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {items.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-bold break-words">{productDescription(p)}</p>
                  <p className="text-xs text-ink-muted tabular-nums">
                    {p.productCode}　{p.sellPrice === null ? "売価なし" : formatYen(p.sellPrice, p.sellPriceTaxIncluded ? "included" : "excluded")}　税率{" "}
                    {p.taxRate}％
                  </p>
                </div>
                <Button variant="secondary" onClick={() => onPick(p)}>
                  選ぶ
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </dialog>
  );
}

export function InvoiceForm({
  action,
  deleteAction,
  invoiceId,
  version,
  initialValues,
  initialLines,
  customers,
  company,
  rounding,
  today,
  extraBlockers,
}: {
  action: (prev: InvoiceFormState, formData: FormData) => Promise<InvoiceFormState>;
  deleteAction: ((formData: FormData) => Promise<void>) | null;
  invoiceId: string | null;
  version: string;
  initialValues: Record<string, string>;
  initialLines: FormLine[];
  customers: FormCustomer[];
  company: CompanySettings | null;
  rounding: Rounding;
  today: string;
  // 画面の外で決まる発行の条件(訂正の元の請求書に入金の消込がある など。CH-11)
  extraBlockers: string[];
}) {
  const router = useRouter();
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const [lines, setLines] = useState<FormLine[]>(initialLines.length > 0 ? initialLines : [emptyLine(0)]);
  const [customerQuery, setCustomerQuery] = useState("");
  const [picking, setPicking] = useState(false);
  const printWindow = useRef<Window | null>(null);
  const e = state.errors;
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));
  const setLine = (key: string, field: keyof FormLine, value: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));
  const basis = (vals.price_basis === "inclusive" ? "inclusive" : "exclusive") as PriceBasis;
  const currentVersion = state.version ?? version;

  // EV-06: 保存できたら、先に開いておいたタブで印刷のページを開く(ポップアップが止められないよう、押したときにタブを開く)
  useEffect(() => {
    if (state.printUrl) {
      const w = printWindow.current;
      if (w && !w.closed) w.location.href = state.printUrl;
      else window.open(state.printUrl, "_blank");
      printWindow.current = null;
      if (!invoiceId && state.savedId) router.replace(`/admin/invoices/${state.savedId}?done=saved`);
    } else if (state.formError && printWindow.current) {
      printWindow.current.close();
      printWindow.current = null;
    }
  }, [state, invoiceId, router]);

  // 画面で使う値をフォームの値の形にそろえて、計算とチェックに渡す(サーバーと同じ関数)
  const formLike = useMemo(() => {
    const v: Record<string, string> = { ...vals, line_count: String(lines.length) };
    lines.forEach((l, i) => {
      v[`l${i}_date`] = l.date;
      v[`l${i}_desc`] = l.desc;
      v[`l${i}_qty`] = l.qty;
      v[`l${i}_unit`] = l.unit;
      v[`l${i}_price`] = l.price;
      v[`l${i}_rate`] = l.rate;
      v[`l${i}_product`] = l.product;
    });
    return v;
  }, [vals, lines]);
  const parsed = useMemo(() => parseInvoiceForm(formLike), [formLike]);
  const customer = customers.find((c) => c.id === vals.customer_id) ?? null;

  const totals = useMemo(() => {
    const calcLines = lines.map((l) => {
      const q = parseQuantityInput(l.qty);
      const p = parseUnitPriceInput(l.price);
      const rate = Number(l.rate);
      return {
        quantity100: typeof q === "number" ? q : null,
        unitPrice: typeof p === "number" ? p : null,
        taxRate: (TAX_RATES as readonly number[]).includes(rate) ? (rate as 10 | 8 | 0) : DEFAULT_TAX_RATE,
      };
    });
    return calcInvoiceTotals(calcLines, basis, rounding);
  }, [lines, basis, rounding]);

  const blockers = useMemo(() => {
    const base = parsed.ok
      ? issueBlockers(parsed.input, {
          company,
          customer: customer ? { name: customer.name, isActive: customer.isActive } : null,
          today,
          rounding,
        })
      : [...new Set(Object.values(parsed.errors))];
    return [...extraBlockers, ...base];
  }, [parsed, company, customer, today, rounding, extraBlockers]);
  const laterWarning = parsed.ok && hasLaterTransaction(parsed.input);

  // EV-03: 取引先を選んだら、お支払期限が空なら初期値を入れる
  const chooseCustomer = (id: string) => {
    const c = customers.find((x) => x.id === id);
    setVals((prev) => {
      const next: Record<string, string> = { ...prev, customer_id: id };
      if (c && !prev.due_on && prev.issued_on) {
        const due = defaultDueDate(c, prev.issued_on);
        if (due) next.due_on = due;
      }
      return next;
    });
  };

  // EV-04: 選んだ商品を1行足す(空の1行だけなら、その行に入れる)
  const pickProduct = (p: ProductHit) => {
    const price = productUnitPrice(p.sellPrice, p.sellPriceTaxIncluded, p.taxRate, basis);
    const line: FormLine = {
      ...emptyLine(lines.length),
      desc: productDescription(p).slice(0, INVOICE_LIMITS.description),
      qty: "1",
      price: price === null ? "" : String(price),
      rate: (TAX_RATES as readonly number[]).includes(p.taxRate) ? String(p.taxRate) : String(DEFAULT_TAX_RATE),
      product: p.id,
    };
    setLines((prev) => {
      const blank = (l: FormLine) => !l.desc && !l.qty && !l.price;
      if (prev.length === 1 && blank(prev[0])) return [line];
      return [...prev, line];
    });
    setPicking(false);
  };

  const shownCustomers = customers.filter(
    (c) => !customerQuery.trim() || c.name.includes(customerQuery.trim()) || c.id === vals.customer_id
  );
  const priceHeader = `単価（${PRICE_BASES[basis]}・円）`;
  const amountHeader = `金額（${PRICE_BASES[basis]}・円）`;
  const cell = "px-1 py-1 align-top";
  const lineErrors = Object.entries(e).filter(([k]) => /^l\d+_/.test(k) || /^amount_/.test(k) || k === "lines");

  const dateField = (name: string, label: string, required = false) => (
    <Field id={`iv_${name}`} label={label} required={required} error={e[name]}>
      <TextInput
        id={`iv_${name}`}
        name={name}
        type="date"
        value={vals[name] ?? ""}
        onChange={(ev) => set(name, ev.currentTarget.value)}
        invalid={!!e[name]}
        aria-describedby={fieldDescribedBy(`iv_${name}`, { error: e[name] })}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="version" value={currentVersion} />
        <input type="hidden" name="line_count" value={lines.length} />
        {state.formError && <Alert tone="error">{state.formError}</Alert>}

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 宛先 */}
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <h2 className="font-bold">宛先</h2>
            <Field id="iv_customer_q" label="取引先を名前で絞り込む">
              <TextInput
                id="iv_customer_q"
                value={customerQuery}
                onChange={(ev) => setCustomerQuery(ev.currentTarget.value)}
                placeholder="例: 町内会"
              />
            </Field>
            <Field id="iv_customer_id" label="取引先" required error={e.customer_id}>
              <Select
                id="iv_customer_id"
                name="customer_id"
                value={vals.customer_id ?? ""}
                onChange={(ev) => chooseCustomer(ev.currentTarget.value)}
                invalid={!!e.customer_id}
              >
                <option value="">（選んでください）</option>
                {shownCustomers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.isActive ? "" : "（取引停止）"}
                  </option>
                ))}
              </Select>
            </Field>
            {customer && (
              <div className="text-sm text-ink-muted">
                {customer.postalCode && <p>〒{customer.postalCode}</p>}
                {customer.address && <p className="break-words">{customer.address}</p>}
                <p>
                  {customer.contactName ? `ご担当 ${customer.contactName}様　` : ""}敬称 {customer.honorific}
                </p>
              </div>
            )}
            <Field id="iv_subject" label="件名" error={e.subject}>
              <TextInput
                id="iv_subject"
                name="subject"
                value={vals.subject ?? ""}
                onChange={(ev) => set("subject", ev.currentTarget.value)}
                maxLength={INVOICE_LIMITS.subject}
                invalid={!!e.subject}
                placeholder="例: 秋祭り 法被一式"
              />
            </Field>
          </section>

          {/* 日付 */}
          <section className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
            <h2 className="font-bold">日付</h2>
            {dateField("issued_on", "発行日", true)}
            <div className="grid gap-3 sm:grid-cols-2">
              {dateField("period_start", "取引期間（開始）")}
              {dateField("period_end", "取引期間（終わり）")}
            </div>
            {dateField("due_on", "お支払期限")}
            {customer && (
              <p className="text-xs text-ink-muted">
                （取引先の条件: {formatClosingAndPayment(customer.closingDay, customer.paymentMonthOffset, customer.paymentDay)}）
              </p>
            )}
          </section>
        </div>

        <RadioGroup
          name="price_basis"
          label="単価の入力"
          options={Object.entries(PRICE_BASES).map(([value, label]) => ({ value, label }))}
          value={basis}
          onChange={(v) => set("price_basis", v)}
          error={e.price_basis}
        />

        {/* 明細 */}
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
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-1 py-2">日付</th>
                  <th className="px-1 py-2">品名</th>
                  <th className="px-1 py-2 text-right">数量</th>
                  <th className="px-1 py-2">単位</th>
                  <th className="px-1 py-2 text-right">{priceHeader}</th>
                  <th className="px-1 py-2 text-right">{amountHeader}</th>
                  <th className="px-1 py-2">税率</th>
                  <th className="px-1 py-2">
                    <span className="sr-only">行を外す</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const q = parseQuantityInput(l.qty);
                  const p = parseUnitPriceInput(l.price);
                  const amount = calcLineAmount(typeof q === "number" ? q : null, typeof p === "number" ? p : null);
                  const input = (field: keyof FormLine, label: string, opts: { type?: string; numeric?: boolean; className?: string; maxLength?: number } = {}) => {
                    const name = `l${i}_${field}`;
                    return (
                      <TextInput
                        name={name}
                        aria-label={`${i + 1}行目の${label}`}
                        type={opts.type}
                        inputMode={opts.numeric ? "decimal" : undefined}
                        value={l[field]}
                        onChange={(ev) => setLine(l.key, field, ev.currentTarget.value)}
                        invalid={!!e[name]}
                        maxLength={opts.maxLength}
                        className={`min-h-9 px-2 text-sm ${opts.numeric ? "text-right tabular-nums" : ""} ${opts.className ?? ""}`}
                      />
                    );
                  };
                  return (
                    <tr key={l.key} className="border-b border-line last:border-b-0">
                      <td className={cell}>
                        <input type="hidden" name={`l${i}_product`} value={l.product} />
                        {input("date", "日付", { type: "date", className: "w-36" })}
                      </td>
                      <td className={cell}>{input("desc", "品名", { className: "w-56", maxLength: INVOICE_LIMITS.description })}</td>
                      <td className={cell}>{input("qty", "数量", { numeric: true, className: "w-20" })}</td>
                      <td className={cell}>{input("unit", "単位", { className: "w-16", maxLength: INVOICE_LIMITS.unit })}</td>
                      <td className={cell}>{input("price", "単価", { numeric: true, className: "w-28" })}</td>
                      <td className={`${cell} py-2 text-right tabular-nums whitespace-nowrap`}>{formatQuantity(amount)}</td>
                      <td className={cell}>
                        <Select
                          name={`l${i}_rate`}
                          aria-label={`${i + 1}行目の税率`}
                          value={l.rate}
                          onChange={(ev) => setLine(l.key, "rate", ev.currentTarget.value)}
                          className="min-h-9 w-28 px-2 text-sm"
                        >
                          {TAX_RATES.map((r) => (
                            <option key={r} value={r}>
                              {r === 8 ? "8%（軽減）" : r === 0 ? "0%（対象外）" : `${r}%`}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className={cell}>
                        <button
                          type="button"
                          aria-label={`${i + 1}行目を外す`}
                          onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                          className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-canvas"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lines.length < INVOICE_LIMITS.lines && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setLines((prev) => [...prev, emptyLine(prev.length)])}>
                行を足す
              </Button>
              <Button variant="secondary" onClick={() => setPicking(true)}>
                商品から選ぶ
              </Button>
            </div>
          )}
          {laterWarning && <Alert tone="warning">{LATER_TRANSACTION_WARNING}</Alert>}
        </section>

        {/* 合計(計算) */}
        <div aria-live="polite">
          <TotalsBox totals={totals} basis={basis} title="合計（計算）" />
        </div>

        <Field id="iv_note" label="備考" error={e.note}>
          <TextArea
            id="iv_note"
            name="note"
            value={vals.note ?? ""}
            onChange={(ev) => set("note", ev.currentTarget.value)}
            maxLength={INVOICE_LIMITS.note}
            invalid={!!e.note}
          />
        </Field>

        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            {deleteAction && (
              <ConfirmSubmitButton form="invoice-delete" confirmMessage="この下書きを削除してよいですか？削除すると元に戻せません。" pendingText="削除中…">
                削除する
              </ConfirmSubmitButton>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <IntentButton
                intent="print"
                variant="secondary"
                pendingText="保存中…"
                onClick={() => {
                  printWindow.current = window.open("", "_blank");
                }}
              >
                印刷して確認する
              </IntentButton>
              <IntentButton intent="save" variant="secondary" pendingText="保存中…">
                保存する
              </IntentButton>
              <ConfirmSubmitButton
                name="intent"
                value="issue"
                variant="primary"
                disabled={blockers.length > 0}
                confirmMessage="請求書を発行してよいですか？発行すると請求書番号が付き、内容を直せなくなります。"
                pendingText="発行中…"
              >
                発行する
              </ConfirmSubmitButton>
            </div>
            {blockers.length > 0 && (
              <div className="max-w-xl text-sm text-ink-muted">
                <p>発行するには、次を直してください（{blockers.length}件）:</p>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </form>

      {deleteAction && <form id="invoice-delete" action={deleteAction} className="hidden" />}
      {picking && <ProductPicker onPick={pickProduct} onClose={() => setPicking(false)} />}
    </div>
  );
}
