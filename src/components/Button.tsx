// ボタンの共通部品(00_画面共通ルール 4章・4.1)。色はテーマ変数だけを使う。
// 使う側で色を上書きしない(幅・位置の調整だけ className で渡す)。

export type ButtonVariant = "primary" | "secondary" | "danger";
export type ButtonSize = "md" | "lg";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover active:bg-primary-hover",
  secondary: "border border-line-strong bg-surface text-primary hover:bg-primary-soft active:bg-primary-soft",
  danger: "bg-danger text-white hover:bg-danger-hover active:bg-danger-hover",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

// ボタン・リンクのボタンで共通の見た目
export const buttonClassName = (variant: ButtonVariant = "primary", size: ButtonSize = "md", className = "") =>
  [
    "inline-flex items-center justify-center gap-2 rounded-md font-bold",
    "transition-transform duration-75 active:scale-95",
    "disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ].join(" ");

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClassName(variant, size, className)} {...props} />;
}
