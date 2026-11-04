"use client";

// 管理画面の左メニュー(CMN-01 G05、00_画面共通ルール 5.2)。みるきーの AdminSidebar.tsx の作りを流用。
// 出す項目は layout(サーバー)で権限に従って選んで渡す。ここでは選択中の印だけを付ける。
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminMenuGroup, AdminMenuItem } from "./adminMenu";

type MenuGroup = { group: AdminMenuGroup; items: AdminMenuItem[] };

function MenuLinks({ menu }: { menu: MenuGroup[] }) {
  const pathname = usePathname();

  if (menu.length === 0) {
    return <p className="px-3 py-2 text-xs text-ink-muted">使える画面はまだありません。</p>;
  }

  // 選択中は、今のURLに合う項目のうち一番長いもの(「問い合わせ」と「よくある質問」の両方に印が付かないように)
  const activeHref = menu
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <>
      {menu.map(({ group, items }) => (
        <div key={group} className="flex flex-col gap-1">
          <p className="px-3 pt-2 text-xs font-bold text-ink-muted">{group}</p>
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-11 items-center rounded-md border-l-4 px-3 text-sm ${
                  active ? "border-accent bg-primary-soft font-bold text-primary" : "border-transparent text-ink hover:bg-canvas"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function AdminSidebar({
  name,
  menu,
  logoutSlot,
}: {
  name: string;
  menu: MenuGroup[];
  logoutSlot: React.ReactNode;
}) {
  const pathname = usePathname();
  // 印刷用のページ(/print で終わるURL)では左メニューを出さない(みるきーと同じ)
  if (pathname.endsWith("/print")) return null;

  return (
    <>
      {/* PC: 左に常に出す */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex print:hidden">
        <div className="border-b border-line px-4 py-4">
          <Link href="/admin" className="block font-bold text-ink">
            祭すみたや
          </Link>
          <p className="mt-1 truncate text-sm text-ink-muted">{name}</p>
        </div>
        <nav aria-label="管理画面のメニュー" className="flex flex-1 flex-col gap-2 p-3">
          <MenuLinks menu={menu} />
        </nav>
        <div className="flex flex-col gap-2 border-t border-line p-3">
          <Link
            href="/"
            className="flex min-h-11 items-center rounded-md px-3 text-sm font-bold text-primary hover:bg-canvas"
          >
            ホームへ
          </Link>
          {logoutSlot}
        </div>
      </aside>

      {/* 幅が狭いとき(768px 未満): 左メニューを隠し、上に「≡ メニュー」と「ホームへ」を出す */}
      <div className="flex items-start gap-2 border-b-2 border-accent bg-surface px-4 md:hidden print:hidden">
        <details className="min-w-0 flex-1">
          <summary className="flex min-h-12 cursor-pointer list-none items-center font-bold text-ink">≡ メニュー</summary>
          <nav aria-label="管理画面のメニュー" className="flex flex-col gap-2 pb-3">
            <MenuLinks menu={menu} />
            {logoutSlot}
          </nav>
        </details>
        <Link href="/" className="flex min-h-12 items-center text-sm font-bold text-primary">
          ホームへ
        </Link>
      </div>
    </>
  );
}
