import { Field } from "@/components/Field";
import { Select } from "@/components/Select";
import { MONTH_END_DAY, PAYMENT_MONTH_LABELS } from "@/utils/masterRules";

// 締め日・支払日の選択(CMN-02 02 G08・G10)。選択肢は 1〜30日と「末日」(31として保存。00_共通設計 7.5)。
// 締め日を空にすると「都度」。エラーは締め日の欄の下にまとめて出す(CH-18)。

const DAY_OPTIONS = [
  ...Array.from({ length: 30 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}日` })),
  { value: String(MONTH_END_DAY), label: "末日" },
];

export function ClosingPaymentFields({
  values,
  error,
  paymentLabel,
}: {
  values: Record<string, string>;
  error?: string;
  // 「支払」(仕入先)・「支払期限」(取引先)
  paymentLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="closing_day" label="締め日">
          <Select id="closing_day" name="closing_day" defaultValue={values.closing_day ?? ""} invalid={!!error} className="w-32">
            <option value="">都度</option>
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="payment_month_offset" label={`${paymentLabel}（月）`}>
          <Select
            id="payment_month_offset"
            name="payment_month_offset"
            defaultValue={values.payment_month_offset ?? ""}
            invalid={!!error}
            className="w-32"
          >
            <option value="">（なし）</option>
            {PAYMENT_MONTH_LABELS.map((label, i) => (
              <option key={label} value={String(i)}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="payment_day" label={`${paymentLabel}（日）`}>
          <Select id="payment_day" name="payment_day" defaultValue={values.payment_day ?? ""} invalid={!!error} className="w-32">
            <option value="">（なし）</option>
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <p className="text-xs text-ink-muted">その月に無い日（2月の30日など）は、その月の最後の日として扱います。</p>
      {error && <p className="text-sm text-danger">⚠ {error}</p>}
    </div>
  );
}
