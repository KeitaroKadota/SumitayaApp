// 複数行の入力欄(00_画面共通ルール 4章・4.2)。Field の中に入れて使う。

export function TextArea({
  invalid = false,
  className = "",
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={[
        "min-h-20 w-full rounded-md border bg-surface px-3 py-2 text-base text-ink",
        "focus:border-primary focus:outline-2 focus:outline-offset-0 focus:outline-primary",
        invalid ? "border-danger" : "border-line-strong",
        className,
      ].join(" ")}
      {...props}
    />
  );
}
