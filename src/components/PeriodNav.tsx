import Link from "next/link";

// 期間の切り替え(00_画面共通ルール 4章。みるきーの PeriodNav.tsx の役割)。‹ 前　2026年11月　次 ›
// 前・次へ行けないときは href を null で渡す(リンクを出さない)。
export function PeriodNav({
  label,
  prev,
  next,
}: {
  label: string;
  prev: { href: string; label: string } | null;
  next: { href: string; label: string } | null;
}) {
  const linkClass =
    "inline-flex min-h-11 min-w-11 items-center text-sm font-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";
  return (
    <nav aria-label="期間の切り替え" className="flex items-center justify-between gap-2">
      <span className="min-w-20">
        {prev && (
          <Link href={prev.href} className={linkClass}>
            ‹ {prev.label}
          </Link>
        )}
      </span>
      <span className="font-bold tabular-nums">{label}</span>
      <span className="flex min-w-20 justify-end">
        {next && (
          <Link href={next.href} className={linkClass}>
            {next.label} ›
          </Link>
        )}
      </span>
    </nav>
  );
}
