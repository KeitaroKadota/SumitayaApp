"use client";

// E-04 G03 請求書の確認・修正のフォーム(03 EV-07・EV-08・EV-09)。
// 欄の値は画面で持つ(エラーのときも入力を消さないため。D-04 の QuoteSpecForm と同じ)。
// お買上げ額(税込)は入力させず、税率ごとの金額の合計を表示する(保存のときもサーバーで計算し直す。CH-05)。
// 「差異を認める」は明細の行ごとの小さなフォーム。表の中に置くため、form 属性で外のフォームを送る(フォームの入れ子を避ける)。
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Alert } from "@/components/Alert";
import { Badge, type BadgeTone } from "@/components/Badge";
import { Button, buttonClassName } from "@/components/Button";
import { Field, fieldDescribedBy } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { formatYen } from "@/utils/format";
import type { FormState } from "@/utils/formState";
import { PAYABLE_KINDS, PAYABLE_LIMITS, PAYMENT_METHODS, TAX_RATES } from "@/utils/payables";

export type ReviewLine = {
  key: string;
  id: string | null;
  date: string;
  slip: string;
  desc: string;
  code: string;
  qty: string;
  price: string;
  amount: string;
  rate: string;
  // 突合の結果(保存した行だけ)
  match: { label: string; tone: BadgeTone; detail: string | null; canApprove: boolean } | null;
};

export type SlipOnlyRow = { id: string; detail: string };

const HEADER_FLAGS: Record<string, string> = {
  payee_name: "payeeName",
  registration_no: "registrationNo",
  invoice_no: "invoiceNo",
  invoice_date: "invoiceDate",
  period_start: "periodStart",
  period_end: "periodEnd",
  previous_balance: "previousBalance",
  payment_received: "paymentReceived",
  carried_over: "carriedOver",
  subtotal_10: "subtotal10",
  tax_10: "tax10",
  subtotal_8: "subtotal8",
  tax_8: "tax8",
  subtotal_exempt: "subtotalExempt",
  amount_due: "amountDue",
  due_on: "dueOn",
  transfer_to: "transferTo",
};
const LINE_FLAGS: Record<string, string> = { date: "lineDate", qty: "quantity", price: "unitPrice", amount: "amount", rate: "taxRate" };

const toNumber = (v: string) => Number((v ?? "").normalize("NFKC").replace(/[,，円¥￥\s]/g, "")) || 0;

function IntentButton({
  intent,
  variant,
  children,
  pendingText,
  disabled,
}: {
  intent: string;
  variant: "primary" | "secondary";
  children: React.ReactNode;
  pendingText: string;
  disabled?: boolean;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button type="submit" name="intent" value={intent} disabled={pending || disabled} className={buttonClassName(variant)}>
      {mine ? pendingText : children}
    </button>
  );
}

export function ReviewForm({
  action,
  approveAction,
  initialValues,
  initialLines,
  slipOnly,
  suppliers,
  flags,
  version,
  readOnly,
  dueNote,
  canSchedule,
  blockers,
  showSchedule,
  totals,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  approveAction: (formData: FormData) => Promise<void>;
  initialValues: Record<string, string>;
  initialLines: ReviewLine[];
  slipOnly: SlipOnlyRow[];
  suppliers: { id: string; name: string }[];
  // ⚠ 要確認の項目(AIが読めなかった・直した。payables.ts の normalizeAiInvoice の flags)
  flags: string[];
  version: string;
  readOnly: boolean;
  // 支払予定日の横の文(「（請求書から）」など)
  dueNote: string;
  canSchedule: boolean;
  blockers: string[];
  showSchedule: boolean;
  // 突合の合計(保存した内容の値)
  totals: string | null;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const [lines, setLines] = useState<ReviewLine[]>(initialLines);
  const e = state.errors;
  const flagSet = new Set(flags);
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));
  const setLine = (key: string, field: keyof ReviewLine, value: string) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)));

  const flagMark = (name: string) =>
    flagSet.has(HEADER_FLAGS[name] ?? name) ? <span className="ml-1 text-xs font-bold text-warning">⚠ 要確認</span> : null;

  const text = (name: string, label: string, opts: { type?: string; numeric?: boolean; maxLength?: number; className?: string } = {}) => (
    <Field id={`p_${name}`} label={label} error={e[name]}>
      <div className="flex items-center">
        <TextInput
          id={`p_${name}`}
          name={name}
          type={opts.type}
          inputMode={opts.numeric ? "numeric" : undefined}
          value={vals[name] ?? ""}
          onChange={(ev) => set(name, ev.currentTarget.value)}
          invalid={!!e[name]}
          maxLength={opts.maxLength}
          disabled={readOnly}
          className={`${opts.numeric ? "text-right tabular-nums" : ""} ${opts.className ?? ""}`}
          aria-describedby={fieldDescribedBy(`p_${name}`, { error: e[name] })}
        />
        {flagMark(name)}
      </div>
    </Field>
  );

  const total =
    toNumber(vals.subtotal_10) + toNumber(vals.tax_10) + toNumber(vals.subtotal_8) + toNumber(vals.tax_8) + toNumber(vals.subtotal_exempt);

  const addLine = () =>
    setLines((prev) => [
      ...prev,
      {
        key: `new-${Date.now()}-${prev.length}`,
        id: null,
        date: "",
        slip: "",
        desc: "",
        code: "",
        qty: "",
        price: "",
        amount: "",
        rate: "10",
        match: null,
      },
    ]);
  const removeLine = (key: string) => setLines((prev) => prev.filter((l) => l.key !== key));

  const cell = "px-1 py-1 align-top";
  const lineInput = (l: ReviewLine, i: number, field: keyof ReviewLine, opts: { numeric?: boolean; type?: string; className?: string; label: string }) => {
    const name = `l${i}_${field}`;
    const flagged = flagSet.has(`lines.${i + 1}.${LINE_FLAGS[field as string] ?? field}`);
    return (
      <div className="flex flex-col">
        <TextInput
          name={name}
          aria-label={`${i + 1}行目の${opts.label}`}
          type={opts.type}
          inputMode={opts.numeric ? "decimal" : undefined}
          value={String(l[field] ?? "")}
          onChange={(ev) => setLine(l.key, field, ev.currentTarget.value)}
          invalid={!!e[name] || flagged}
          disabled={readOnly}
          className={`min-h-9 px-2 text-sm ${opts.numeric ? "text-right tabular-nums" : ""} ${opts.className ?? ""}`}
        />
        {flagged && <span className="text-xs font-bold text-warning">⚠ 要確認</span>}
      </div>
    );
  };

  const lineErrors = Object.entries(e).filter(([k]) => /^l\d+_/.test(k) || k === "lines");

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-4">
        <input type="hidden" name="version" value={version} />
        <input type="hidden" name="line_count" value={lines.length} />
        {state.formError && <Alert tone="error">{state.formError}</Alert>}

        <RadioGroup
          name="kind"
          label="種類"
          required
          options={Object.entries(PAYABLE_KINDS).map(([value, label]) => ({ value, label }))}
          value={vals.kind ?? "purchase"}
          onChange={(v) => set("kind", v)}
          disabled={readOnly}
          error={e.kind}
        />
        <Field id="p_supplier_id" label="仕入先" error={e.supplier_id}>
          <Select
            id="p_supplier_id"
            name="supplier_id"
            value={vals.supplier_id ?? ""}
            onChange={(ev) => set("supplier_id", ev.currentTarget.value)}
            invalid={!!e.supplier_id}
            disabled={readOnly}
          >
            <option value="">（仕入先マスタに無い相手）</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          {text("payee_name", "請求元の名前", { maxLength: PAYABLE_LIMITS.payeeName })}
          {text("registration_no", "登録番号", { maxLength: 30 })}
          {text("invoice_no", "請求書番号", { maxLength: PAYABLE_LIMITS.invoiceNo })}
          {text("invoice_date", "請求日", { type: "date" })}
          {text("period_start", "請求の期間（開始）", { type: "date" })}
          {text("period_end", "請求の期間（締め日）", { type: "date" })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {text("subtotal_10", "10％対象（税抜・円）", { numeric: true })}
          {text("tax_10", "10％の消費税（円）", { numeric: true })}
          {text("subtotal_8", "8％対象（税抜・円）", { numeric: true })}
          {text("tax_8", "8％の消費税（円）", { numeric: true })}
          {text("subtotal_exempt", "非課税など（円）", { numeric: true })}
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold">お買上げ額（税込）</p>
            <p className="flex min-h-11 items-center text-lg font-bold tabular-nums">{formatYen(total, "included")}</p>
            <p className="text-xs text-ink-muted">税率ごとの金額の合計（計算）</p>
          </div>
        </div>

        <details className="rounded-md border border-line p-3" open={Boolean(vals.previous_balance || vals.payment_received || vals.carried_over)}>
          <summary className="cursor-pointer text-sm font-bold">前回ご請求額・ご入金額・繰越額（読み取れたときだけ）</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {text("previous_balance", "前回ご請求額（円）", { numeric: true })}
            {text("payment_received", "ご入金額（円）", { numeric: true })}
            {text("carried_over", "繰越額（円）", { numeric: true })}
          </div>
        </details>

        <div className="grid gap-3 sm:grid-cols-2">
          {text("amount_due", "今回ご請求額（円）", { numeric: true })}
          <div className="flex flex-col gap-1">
            {text("due_on", "支払予定日", { type: "date" })}
            <p className="text-xs text-ink-muted">{dueNote}　空にすると、仕入先の締め日・支払日から計算します。</p>
          </div>
          <Field id="p_payment_method" label="支払方法" error={e.payment_method}>
            <Select
              id="p_payment_method"
              name="payment_method"
              value={vals.payment_method ?? ""}
              onChange={(ev) => set("payment_method", ev.currentTarget.value)}
              disabled={readOnly}
            >
              <option value="">（未入力）</option>
              {Object.entries(PAYMENT_METHODS).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          {text("transfer_to", "振込先", { maxLength: PAYABLE_LIMITS.transferTo })}
        </div>

        {/* 明細と突合 */}
        <section className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-3">
          <h2 className="font-bold">明細と突合</h2>
          {lineErrors.length > 0 && (
            <ul className="text-sm text-danger">
              {lineErrors.map(([k, msg]) => (
                <li key={k}>⚠ {msg}</li>
              ))}
            </ul>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-1 py-2">日付</th>
                  <th className="px-1 py-2">伝票番号</th>
                  <th className="px-1 py-2">品名</th>
                  <th className="px-1 py-2">品番</th>
                  <th className="px-1 py-2 text-right">数量</th>
                  <th className="px-1 py-2 text-right">単価（税抜・円）</th>
                  <th className="px-1 py-2 text-right">金額（税抜・円）</th>
                  <th className="px-1 py-2">税率</th>
                  <th className="px-1 py-2">突合</th>
                  <th className="px-1 py-2">
                    <span className="sr-only">行を外す</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={l.key} className="border-b border-line last:border-b-0">
                    <td className={cell}>
                      <input type="hidden" name={`l${i}_id`} value={l.id ?? ""} />
                      {lineInput(l, i, "date", { type: "date", label: "日付", className: "w-36" })}
                    </td>
                    <td className={cell}>{lineInput(l, i, "slip", { label: "伝票番号", className: "w-24" })}</td>
                    <td className={cell}>{lineInput(l, i, "desc", { label: "品名", className: "w-44" })}</td>
                    <td className={cell}>{lineInput(l, i, "code", { label: "品番", className: "w-24" })}</td>
                    <td className={cell}>{lineInput(l, i, "qty", { numeric: true, label: "数量", className: "w-20" })}</td>
                    <td className={cell}>{lineInput(l, i, "price", { numeric: true, label: "単価", className: "w-24" })}</td>
                    <td className={cell}>{lineInput(l, i, "amount", { numeric: true, label: "金額", className: "w-28" })}</td>
                    <td className={cell}>
                      <Select
                        name={`l${i}_rate`}
                        aria-label={`${i + 1}行目の税率`}
                        value={l.rate}
                        onChange={(ev) => setLine(l.key, "rate", ev.currentTarget.value)}
                        disabled={readOnly}
                        className="min-h-9 w-20 px-2 text-sm"
                      >
                        {TAX_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className={`${cell} min-w-40`}>
                      {l.match ? (
                        <div className="flex flex-col gap-1">
                          <span>
                            <Badge tone={l.match.tone}>{l.match.label}</Badge>
                          </span>
                          {l.match.detail && <span className="text-xs text-ink-muted">{l.match.detail}</span>}
                          {l.match.canApprove && l.id && !readOnly && (
                            <details>
                              <summary className="cursor-pointer text-xs font-bold text-primary">差異を認める</summary>
                              <div className="mt-1 flex flex-col gap-1">
                                <TextInput
                                  form={`approve-${l.id}`}
                                  name="note"
                                  aria-label="差異を認める理由"
                                  placeholder="例: 値上げの連絡あり"
                                  maxLength={PAYABLE_LIMITS.approveNote}
                                  className="min-h-9 px-2 text-sm"
                                />
                                <button type="submit" form={`approve-${l.id}`} className={buttonClassName("secondary", "md", "min-h-9")}>
                                  認める
                                </button>
                              </div>
                            </details>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-muted">保存すると照合します</span>
                      )}
                    </td>
                    <td className={cell}>
                      {!readOnly && (
                        <button
                          type="button"
                          aria-label={`${i + 1}行目を外す`}
                          onClick={() => removeLine(l.key)}
                          className="flex size-9 items-center justify-center rounded-md text-ink-muted hover:bg-canvas"
                        >
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {slipOnly.map((s) => (
                  <tr key={`slip-${s.id}`} className="border-b border-line bg-canvas last:border-b-0">
                    <td className={cell} colSpan={8}>
                      <span className="text-ink-muted">（請求に無い）</span> {s.detail}
                    </td>
                    <td className={cell} colSpan={2}>
                      <div className="flex flex-col gap-1">
                        <span>
                          <Badge tone="warning">検収のみ</Badge>
                        </span>
                        {!readOnly && (
                          <details>
                            <summary className="cursor-pointer text-xs font-bold text-primary">差異を認める</summary>
                            <div className="mt-1 flex flex-col gap-1">
                              <TextInput
                                form={`approve-slip-${s.id}`}
                                name="note"
                                aria-label="差異を認める理由"
                                placeholder="例: 来月の請求に入る"
                                maxLength={PAYABLE_LIMITS.approveNote}
                                className="min-h-9 px-2 text-sm"
                              />
                              <button type="submit" form={`approve-slip-${s.id}`} className={buttonClassName("secondary", "md", "min-h-9")}>
                                認める
                              </button>
                            </div>
                          </details>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!readOnly && lines.length < PAYABLE_LIMITS.lines && (
            <div>
              <Button variant="secondary" onClick={addLine}>
                行を足す
              </Button>
            </div>
          )}
          {totals && <p className="text-sm tabular-nums">{totals}</p>}
        </section>

        <Field id="p_review_note" label="確認のメモ" error={e.review_note}>
          <TextArea
            id="p_review_note"
            name="review_note"
            value={vals.review_note ?? ""}
            onChange={(ev) => set("review_note", ev.currentTarget.value)}
            maxLength={PAYABLE_LIMITS.note}
            disabled={readOnly}
            placeholder="例: 10/28分は来月請求と電話で確認"
          />
        </Field>

        {!readOnly && (
          <div className="flex flex-col items-end gap-2">
            <div className="flex flex-wrap justify-end gap-2">
              <IntentButton intent="save" variant="secondary" pendingText="保存中…">
                保存する
              </IntentButton>
              {showSchedule && (
                <IntentButton intent="schedule" variant="primary" pendingText="保存中…" disabled={!canSchedule}>
                  確認して支払予定にする
                </IntentButton>
              )}
            </div>
            {showSchedule && blockers.length > 0 && (
              <div className="max-w-xl text-sm text-ink-muted">
                <p>支払予定にするには、次を直して「保存する」を押してください:</p>
                <ul className="list-disc pl-5">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </form>

      {/* 差異を認める(EV-08)の小さなフォーム。中身の欄は表の中に form 属性で置いている */}
      {lines
        .filter((l) => l.id && l.match?.canApprove)
        .map((l) => (
          <form key={`approve-${l.id}`} id={`approve-${l.id}`} action={approveAction} className="hidden">
            <input type="hidden" name="version" value={version} />
            <input type="hidden" name="line_id" value={l.id ?? ""} />
          </form>
        ))}
      {slipOnly.map((s) => (
        <form key={`approve-slip-${s.id}`} id={`approve-slip-${s.id}`} action={approveAction} className="hidden">
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="slip_id" value={s.id} />
        </form>
      ))}
    </div>
  );
}
