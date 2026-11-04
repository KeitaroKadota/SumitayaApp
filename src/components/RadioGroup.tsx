import { Badge } from "@/components/Badge";

// ラジオの選択(選択肢が5つ以下のとき。00_画面共通ルール 4章)。見出し・必須の印・エラーもまとめて出す。
// 入力を残したまま表示し直せるよう、defaultValue で選ぶ(制御するときは value と onChange を渡す)。

export function RadioGroup({
  name,
  label,
  options,
  defaultValue,
  value,
  onChange,
  required = false,
  disabled = false,
  error,
}: {
  name: string;
  label: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  error?: string;
}) {
  const errorId = `${name}-error`;
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={error ? errorId : undefined} disabled={disabled}>
      <legend className="flex items-center gap-2 text-sm font-bold">
        {label}
        {required && <Badge tone="required">必須</Badge>}
      </legend>
      <div className="flex flex-wrap gap-x-4">
        {options.map((o) => (
          <label key={o.value} className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={name}
              value={o.value}
              className="size-5 accent-primary"
              {...(value !== undefined
                ? { checked: value === o.value, onChange: () => onChange?.(o.value) }
                : { defaultChecked: defaultValue === o.value })}
            />
            {o.label}
          </label>
        ))}
      </div>
      {error && (
        <p id={errorId} className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </fieldset>
  );
}
