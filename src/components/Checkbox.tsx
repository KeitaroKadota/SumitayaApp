// チェック(はい/いいえ。00_画面共通ルール 4章)。押せる範囲は 44px 以上にする。

export function Checkbox({
  label,
  className = "",
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: React.ReactNode }) {
  return (
    <label className={`inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm ${className}`}>
      <input type="checkbox" className="size-5 accent-primary" {...props} />
      <span>{label}</span>
    </label>
  );
}
