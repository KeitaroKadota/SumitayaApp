import Link from "next/link";
import { formatQuantity } from "@/utils/format";

// ページ送り(00_画面共通ルール 4章)。「1,234件中 1〜50件」と「‹ 前へ 1 / 25 次へ ›」を出す。
// hrefOf はページ番号から URL を作る(検索の条件を残すため、呼ぶ側で作る)。

const linkClass =
  "inline-flex min-h-11 items-center px-2 text-sm font-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-primary";

export function Pagination({
  total,
  page,
  pageSize,
  hrefOf,
}: {
  total: number;
  page: number;
  pageSize: number;
  hrefOf: (page: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="ページ送り" className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="tabular-nums text-ink-muted">
        {formatQuantity(total)}件中 {formatQuantity(from)}〜{formatQuantity(to)}件
      </p>
      <div className="flex items-center gap-2 tabular-nums">
        {page > 1 ? (
          <Link href={hrefOf(page - 1)} className={linkClass}>
            ‹ 前へ
          </Link>
        ) : (
          <span className="px-2 text-ink-muted">‹ 前へ</span>
        )}
        <span>
          {page} / {pages}
        </span>
        {page < pages ? (
          <Link href={hrefOf(page + 1)} className={linkClass}>
            次へ ›
          </Link>
        ) : (
          <span className="px-2 text-ink-muted">次へ ›</span>
        )}
      </div>
    </nav>
  );
}
