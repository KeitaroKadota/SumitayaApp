import Link from "next/link";

// ホームのタイル(00_画面共通ルール 4章・5.1)。2列、1つ 88px 以上の高さ、アイコン＋名前、件数はバッジ。
// 色は全部同じ(primary-soft 地に primary のアイコン)。どのタイルを出すかは呼ぶ側で canAccess を使って決める。

export function HomeTiles({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

export function HomeTile({
  href,
  label,
  icon,
  badges,
}: {
  href: string;
  label: string;
  // 飾りのアイコン(SVG)。読み上げには使わない
  icon: React.ReactNode;
  // 件数などのバッジ(Badge)
  badges?: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-22 flex-col items-start justify-between gap-2 rounded-lg bg-primary-soft p-3 font-bold text-ink transition-transform duration-75 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    >
      <span className="text-primary" aria-hidden="true">
        {icon}
      </span>
      <span className="break-words">{label}</span>
      {badges && <span className="flex flex-wrap gap-1">{badges}</span>}
    </Link>
  );
}

// タスクのアイコン(チェックの付いた紙)
export function TaskIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

// 経費のアイコン(レシート)
export function ReceiptIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  );
}
