// 選択(プルダウン)(00_画面共通ルール 4章)。選択肢が6つ以上のときに使う。Field の中に入れて使う。

export function Select({
  invalid = false,
  className = "",
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
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
