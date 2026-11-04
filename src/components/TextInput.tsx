// 入力欄(00_画面共通ルール 4章・4.2)。Field の中に入れて使う。
// 文字は16px(text-base)以上にする(iPhone で入力時に画面が勝手に拡大されないように)。

export function TextInput({
  invalid = false,
  className = "",
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={[
        "min-h-11 w-full rounded-md border bg-surface px-3 text-base text-ink",
        "focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-primary",
        invalid ? "border-danger" : "border-line-strong",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
