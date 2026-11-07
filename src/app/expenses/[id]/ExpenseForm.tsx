"use client";

// E-07 G02 経費の登録のフォーム(02 G02 の①・②、03 EV-06〜EV-08)。
// 欄の値は画面で持つ(エラーのときも入力を消さないため。E-04 の ReviewForm と同じ)。
// 読み取りの結果は AiDraft で囲み、本人が「登録する」を押した時点で確認済みとする(02 G02)。
// 合計と内訳の検算(CH-05)は画面でも出すが、登録を止めるかはサーバーで計算し直して決める。登録すると確定し、あとから直せない。
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AiBadge, AiDraft } from "@/components/AiDraft";
import { Alert } from "@/components/Alert";
import { buttonClassName } from "@/components/Button";
import { Field } from "@/components/Field";
import { RadioGroup } from "@/components/RadioGroup";
import { Select } from "@/components/Select";
import { TextArea } from "@/components/TextArea";
import { TextInput } from "@/components/TextInput";
import { EXPENSE_LIMITS, EXPENSE_PAYMENT_METHODS, needsAttendees, registrationNotice, taxFromIncluded } from "@/utils/expenseClaims";
import type { FormState } from "@/utils/formState";
import { normalizeRegistrationNo } from "@/utils/payables";

export type TitleOption = { id: string; name: string };

const PAYMENT_OPTIONS = Object.entries(EXPENSE_PAYMENT_METHODS).map(([value, label]) => ({ value, label }));

// 金額の欄を数として読む(全角・カンマ・「円」を除く)。空・読めなければ null
const toAmount = (v: string | undefined): number | null => {
  const s = (v ?? "").normalize("NFKC").replace(/[,，円¥￥\s]/g, "");
  return /^\d+$/.test(s) ? Number(s) : null;
};

function IntentButton({
  intent,
  variant,
  children,
  pendingText,
}: {
  intent: string;
  variant: "primary" | "secondary";
  children: React.ReactNode;
  pendingText: string;
}) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("intent") === intent;
  return (
    <button
      type="submit"
      name="intent"
      value={intent}
      disabled={pending}
      className={buttonClassName(variant, "lg", "w-full")}
    >
      {mine ? pendingText : children}
    </button>
  );
}

export function ExpenseForm({
  action,
  initialValues,
  version,
  titles,
  estimated,
  aiRead,
  aiFlags,
  hasReceipt,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  initialValues: Record<string, string>;
  version: string;
  titles: TitleOption[];
  // 推定した科目と理由(EV-06: 違う科目を選んだら理由を消す)
  estimated: { titleId: string; reason: string; ai: boolean } | null;
  // AIが読み取った下書きか(AiDraft で囲む)と、その日時
  aiRead: { createdAt: string } | null;
  // ⚠ 要確認の項目(AIが読めなかった・形を直した。CH-19)
  aiFlags: string[];
  hasReceipt: boolean;
}) {
  const [state, formAction] = useActionState(action, { errors: {}, formError: null, values: initialValues });
  const [vals, setVals] = useState<Record<string, string>>(initialValues);
  const e = state.errors;
  const flagSet = new Set(aiFlags);
  const set = (name: string, value: string) => setVals((prev) => ({ ...prev, [name]: value }));

  // 合計を入れたとき、1つの税率だけなら内訳と税額を自動で入れる(税込から計算。02 G02 の「内訳」)
  const onTotal = (value: string) => {
    setVals((prev) => {
      const next = { ...prev, total: value };
      const total = toAmount(value);
      if (total === null) return next;
      const has10 = (toAmount(prev.total_10) ?? 0) > 0;
      const has8 = (toAmount(prev.total_8) ?? 0) > 0;
      const hasExempt = (toAmount(prev.total_exempt) ?? 0) > 0;
      if (has8 && !has10 && !hasExempt) return { ...next, total_8: String(total), tax_8: String(taxFromIncluded(total, 8)) };
      if (hasExempt && !has10 && !has8) return { ...next, total_exempt: String(total) };
      if (!has8 && !hasExempt) return { ...next, total_10: String(total), tax_10: String(taxFromIncluded(total, 10)) };
      return next;
    });
  };

  const total = toAmount(vals.total);
  const t10 = toAmount(vals.total_10);
  const t8 = toAmount(vals.total_8);
  const tEx = toAmount(vals.total_exempt);
  const breakdownEmpty = !t10 && !t8 && !tEx;
  // CH-05 の検算(画面の表示だけ)
  const mismatch = total !== null && total > 0 && !breakdownEmpty && (t10 ?? 0) + (t8 ?? 0) + (tEx ?? 0) !== total;
  const titleName = titles.find((t) => t.id === vals.account_title_id)?.name ?? null;
  const showReason = estimated && vals.account_title_id === estimated.titleId;
  const regNotice = registrationNotice(vals.registration_no ? normalizeRegistrationNo(vals.registration_no) : null);

  const flagMark = (name: string) =>
    flagSet.has(name) ? <span className="text-sm font-bold text-warning">⚠ 要確認（読み取りの確かさが低い）</span> : null;

  const text = (
    name: string,
    label: string,
    opts: { required?: boolean; type?: string; numeric?: boolean; maxLength?: number; placeholder?: string } = {}
  ) => (
    <Field id={`x_${name}`} label={label} required={opts.required} error={e[name]}>
      <TextInput
        id={`x_${name}`}
        name={name}
        type={opts.type}
        inputMode={opts.numeric ? "numeric" : undefined}
        value={vals[name] ?? ""}
        onChange={(ev) => (name === "total" ? onTotal(ev.currentTarget.value) : set(name, ev.currentTarget.value))}
        invalid={!!e[name]}
        maxLength={opts.maxLength}
        placeholder={opts.placeholder}
      />
      {flagMark(name)}
    </Field>
  );

  const amountPair = (label: string, totalName: string, taxName: string | null) => (
    <div className="grid grid-cols-2 gap-2">
      {text(totalName, label, { numeric: true })}
      {taxName && text(taxName, "うち消費税", { numeric: true })}
    </div>
  );

  const readFields = (
    <div className="flex flex-col gap-3">
      {text("spent_on", "支払った日", { required: true, type: "date" })}
      {text("payee_name", "支払先", { required: true, maxLength: EXPENSE_LIMITS.payeeName, placeholder: "例: ダイソー 浜松店" })}
      <div className="flex flex-col gap-1">
        {text("total", "合計（税込・円）", { required: true, numeric: true })}
      </div>
      <fieldset className="flex flex-col gap-2 rounded-md border border-line p-3">
        <legend className="px-1 text-sm font-bold">内訳（税込・円）</legend>
        {amountPair("10％対象", "total_10", "tax_10")}
        {amountPair("8％対象（軽減税率）", "total_8", "tax_8")}
        {amountPair("対象外（切手・印紙など）", "total_exempt", null)}
        {mismatch && <p className="text-sm font-bold text-warning">⚠ 要確認: 内訳の合計が合計と合いません</p>}
        {breakdownEmpty && (total ?? 0) > 0 && <p className="text-sm text-ink-muted">内訳を10％として登録します。</p>}
        {e.breakdown && <p className="text-sm text-danger">⚠ {e.breakdown}</p>}
        <p className="text-sm text-ink-muted">消費税が空のときは、金額から計算して入れます。</p>
      </fieldset>
      <div className="flex flex-col gap-1">
        {text("registration_no", "登録番号", { maxLength: 30, placeholder: "例: T1234567890123" })}
        {regNotice && <p className="text-sm text-warning">{regNotice}</p>}
      </div>
      {text("items_text", "品目", { maxLength: EXPENSE_LIMITS.itemsText, placeholder: "例: ガムテープ、軍手" })}
    </div>
  );

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="version" value={version} />
      {state.formError && <Alert tone="error">{state.formError}</Alert>}

      {aiRead ? (
        <AiDraft title="読み取り結果" createdAt={aiRead.createdAt}>
          {readFields}
        </AiDraft>
      ) : (
        <div className="rounded-lg border border-line bg-surface p-4">{readFields}</div>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4">
        {!hasReceipt && (
          <Field id="x_no_receipt_reason" label="領収書がない理由" required error={e.no_receipt_reason}>
            <TextInput
              id="x_no_receipt_reason"
              name="no_receipt_reason"
              value={vals.no_receipt_reason ?? ""}
              onChange={(ev) => set("no_receipt_reason", ev.currentTarget.value)}
              invalid={!!e.no_receipt_reason}
              maxLength={EXPENSE_LIMITS.noReceiptReason}
              placeholder="例: バス・電車の運賃"
            />
          </Field>
        )}
        <Field id="x_purpose" label="用途" required error={e.purpose}>
          <TextArea
            id="x_purpose"
            name="purpose"
            value={vals.purpose ?? ""}
            onChange={(ev) => set("purpose", ev.currentTarget.value)}
            invalid={!!e.purpose}
            maxLength={EXPENSE_LIMITS.purpose}
            placeholder="例: 店頭ののぼりの補修"
          />
        </Field>
        <RadioGroup
          name="payment_method"
          label="支払い方"
          options={PAYMENT_OPTIONS}
          value={vals.payment_method || "cash"}
          onChange={(v) => set("payment_method", v)}
          error={e.payment_method}
        />
        <Field id="x_account_title_id" label="勘定科目" required error={e.account_title_id}>
          <Select
            id="x_account_title_id"
            name="account_title_id"
            value={vals.account_title_id ?? ""}
            onChange={(ev) => set("account_title_id", ev.currentTarget.value)}
            invalid={!!e.account_title_id}
          >
            <option value="">選ぶ</option>
            {titles.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          {showReason && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              {estimated.ai && <AiBadge />}
              {estimated.reason}
            </p>
          )}
        </Field>
        {/* CH-11 交際費・会議費のときは相手先・人数が必須 */}
        {needsAttendees(titleName) && (
          <Field id="x_attendees" label="相手先・人数" required error={e.attendees}>
            <TextInput
              id="x_attendees"
              name="attendees"
              value={vals.attendees ?? ""}
              onChange={(ev) => set("attendees", ev.currentTarget.value)}
              invalid={!!e.attendees}
              maxLength={EXPENSE_LIMITS.attendees}
              placeholder="例: 〇〇町内会 山田様ほか2名、計4名"
            />
          </Field>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">登録すると確定し、あとから直せません。</p>
        <IntentButton intent="confirm" variant="primary" pendingText="登録中…">
          登録する
        </IntentButton>
        <IntentButton intent="save" variant="secondary" pendingText="保存中…">
          下書きを保存する
        </IntentButton>
      </div>
    </form>
  );
}
