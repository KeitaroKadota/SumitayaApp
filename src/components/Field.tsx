import { Badge } from "@/components/Badge";

// 入力欄の枠(00_画面共通ルール 4章・4.2・10章)。ラベル・必須の印・説明・エラーをまとめる。
// 中の入力欄には id と aria-describedby={fieldDescribedBy(...)} を付ける。

export const fieldDescriptionId = (id: string) => `${id}-description`;
export const fieldErrorId = (id: string) => `${id}-error`;

// 説明・エラーの文を入力欄と結び付ける aria-describedby の値
export const fieldDescribedBy = (id: string, { description, error }: { description?: string; error?: string }) =>
  [description ? fieldDescriptionId(id) : "", error ? fieldErrorId(id) : ""].filter(Boolean).join(" ") || undefined;

export function Field({
  id,
  label,
  required = false,
  description,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  description?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-bold">
        {label}
        {required && <Badge tone="required">必須</Badge>}
      </label>
      {description && (
        <p id={fieldDescriptionId(id)} className="text-sm text-ink-muted">
          {description}
        </p>
      )}
      {children}
      {error && (
        <p id={fieldErrorId(id)} className="text-sm text-danger">
          ⚠ {error}
        </p>
      )}
    </div>
  );
}
