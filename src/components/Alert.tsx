// メッセージの共通部品(00_画面共通ルール 4章・8章)。
// 完了は success、エラーは error、注意は warning。エラーは role="alert"、それ以外は role="status"。

export type AlertTone = "success" | "error" | "warning" | "info";

const TONE_CLASSES: Record<AlertTone, string> = {
  success: "border-success bg-success-soft text-success",
  error: "border-danger bg-danger-soft text-danger",
  warning: "border-warning-line bg-warning-soft text-warning",
  info: "border-line bg-surface text-ink",
};

// 色だけで意味を伝えないよう、印を付ける(00_画面共通ルール 10章)
const TONE_MARKS: Record<AlertTone, string> = {
  success: "✓",
  error: "⚠",
  warning: "⚠",
  info: "ⓘ",
};

export function Alert({
  tone,
  children,
  className = "",
}: {
  tone: AlertTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`flex gap-2 rounded-lg border px-4 py-3 text-sm break-words ${TONE_CLASSES[tone]} ${className}`}
    >
      <span aria-hidden="true">{TONE_MARKS[tone]}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
