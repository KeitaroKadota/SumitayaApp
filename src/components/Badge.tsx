// バッジの共通部品(00_画面共通ルール 4章)。必ず文字を入れる。
// required: 必須の印(danger の枠線だけ・小さい文字。00_画面共通ルール 6.3)

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "ai" | "required";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-canvas text-ink-muted border border-line",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  ai: "bg-ai-soft text-ai",
  required: "border border-danger text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}
