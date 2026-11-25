"use client";

// 管理画面の左メニュー(CMN-01 G05、00_画面共通ルール 5.2)。みるきーの AdminSidebar.tsx の作りを流用。
// 出す項目は layout(サーバー)で権限に従って選んで渡す。ここでは選択中の印と、区切りの開き閉じだけを扱う。
// 2026-11-25: 一番上に「ホーム」、区切り(A〜E)はたためる形にした(CMN01-仮-19)。
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/Badge";
import {
  ADMIN_MENU_GROUP_MARKS,
  FLAT_MENU_GROUPS,
  type AdminMenuBadge,
  type AdminMenuGroup,
  type AdminMenuItem,
} from "./adminMenu";

type MenuGroup = { group: AdminMenuGroup; items: AdminMenuItem[] };

export type MenuBadges = Partial<Record<AdminMenuBadge, number>>;

const ADMIN_HOME = "/admin";

const itemClass = (active: boolean) =>
  `flex min-h-11 items-center gap-2 rounded-md border-l-4 px-3 text-sm ${
    active ? "border-accent bg-primary-soft font-bold text-primary" : "border-transparent text-ink hover:bg-canvas"
  }`;

const badgeCount = (item: AdminMenuItem, badges: MenuBadges): number => (item.badge ? (badges[item.badge] ?? 0) : 0);

function MenuItemLink({ item, active, badges }: { item: AdminMenuItem; active: boolean; badges: MenuBadges }) {
  const count = badgeCount(item, badges);
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={itemClass(active)}>
      <span className="flex-1">{item.label}</span>
      {count > 0 && <Badge tone="warning">{count}</Badge>}
    </Link>
  );
}

function MenuLinks({ menu, badges }: { menu: MenuGroup[]; badges: MenuBadges }) {
  const pathname = usePathname();

  // 選択中は、今のURLに合う項目のうち一番長いもの(「問い合わせ」と「よくある質問」の両方に印が付かないように)
  const activeHref = menu
    .flatMap((g) => g.items.map((i) => i.href))
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
  const homeActive = pathname === ADMIN_HOME;

  return (
    <>
      <Link href={ADMIN_HOME} aria-current={homeActive ? "page" : undefined} className={itemClass(homeActive)}>
        ホーム
      </Link>
      {menu.length === 0 && <p className="px-3 py-2 text-xs text-ink-muted">使える画面はまだありません。</p>}
      {menu.map(({ group, items }) => {
        // 「全員のタスク」は見出しを付けずにそのまま並べる
        if (FLAT_MENU_GROUPS.includes(group)) {
          return (
            <div key={group} className="flex flex-col gap-1 border-b border-line pb-2">
              {items.map((item) => (
                <MenuItemLink key={item.href} item={item} active={item.href === activeHref} badges={badges} />
              ))}
            </div>
          );
        }
        const mark = ADMIN_MENU_GROUP_MARKS[group];
        const total = items.reduce((sum, item) => sum + badgeCount(item, badges), 0);
        const hasActive = items.some((item) => item.href === activeHref);
        return (
          // 今の画面を含む区切りだけ開いて出す。開き閉じは押した人が自由に変えられる
          <details key={group} open={hasActive} className="group">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md px-3 text-sm font-bold text-ink hover:bg-canvas [&::-webkit-details-marker]:hidden">
              {mark ? (
                <span
                  aria-hidden="true"
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded bg-primary text-xs font-bold text-white"
                >
                  {mark}
                </span>
              ) : (
                <span aria-hidden="true" className="inline-block size-6 shrink-0" />
              )}
              <span className="flex-1">{group}</span>
              {total > 0 && <Badge tone="warning">{total}</Badge>}
              <span aria-hidden="true" className="text-ink-muted transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="flex flex-col gap-1 pt-1 pl-6">
              {items.map((item) => (
                <MenuItemLink key={item.href} item={item} active={item.href === activeHref} badges={badges} />
              ))}
            </div>
          </details>
        );
      })}
    </>
  );
}

export function AdminSidebar({
  name,
  roleLabel,
  menu,
  badges = {},
  logoutSlot,
}: {
  name: string;
  roleLabel: string;
  menu: MenuGroup[];
  badges?: MenuBadges;
  logoutSlot: React.ReactNode;
}) {
  const pathname = usePathname();
  // 印刷用のページ(/print で終わるURL)では左メニューを出さない(みるきーと同じ)
  if (pathname.endsWith("/print")) return null;

  return (
    <>
      {/* PC: 左に常に出す */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-line bg-surface md:flex print:hidden">
        <div className="border-b-[3px] border-accent px-4 py-4">
          <Link href={ADMIN_HOME} className="block text-lg font-bold text-primary">
            祭すみたや
          </Link>
          <p className="mt-1 truncate text-xs text-ink-muted">
            {name}
            {roleLabel && `・${roleLabel}`}
          </p>
        </div>
        <nav aria-label="管理画面のメニュー" className="flex flex-1 flex-col gap-1 p-3">
          <MenuLinks menu={menu} badges={badges} />
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
          <nav aria-label="管理画面のメニュー" className="flex flex-col gap-1 pb-3">
            <MenuLinks menu={menu} badges={badges} />
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
