import { canAccess, type FeatureKey, type Role } from "@/utils/permissions";

// 管理画面の左メニュー(CMN-01 G05、00_画面共通ルール 5.2)。権限のある項目だけを出す。
// 各機能のページを作ったら、ここに1行足す(ページが無いうちは足さない。リンク切れを出さないため)。
// 例: { group: "マスタ", href: "/admin/employees", label: "従業員", feature: "employees" }

export type AdminMenuItem = { group: AdminMenuGroup; href: string; label: string; feature: FeatureKey };

// 区切りの並び(G05 の左メニューの順)。
// 【仮】「タスク」の区切りは CMN-01 の G05 に無いので、先頭に置いた(00_仮決め一覧 CMN03-仮-15)
export const ADMIN_MENU_GROUPS = [
  "タスク",
  "問い合わせ",
  "受注・在庫",
  "売上・発注",
  "仕入・検収",
  "請求・支払",
  "勤怠・給与",
  "経費",
  "マスタ",
] as const;
export type AdminMenuGroup = (typeof ADMIN_MENU_GROUPS)[number];

const ADMIN_MENU_ITEMS: AdminMenuItem[] = [
  // CMN-03 タスク・通知(02 の G03)
  { group: "タスク", href: "/admin/tasks", label: "全員のタスク", feature: "tasks_admin" },
  // D-01 問い合わせの取り込み・分類(02 の G01)
  { group: "問い合わせ", href: "/admin/inquiries", label: "問い合わせ", feature: "inquiries" },
  // CMN-02 マスタ管理(02 の画面一覧)
  { group: "マスタ", href: "/admin/employees", label: "従業員", feature: "employees" },
  { group: "マスタ", href: "/admin/products", label: "商品", feature: "products" },
  { group: "マスタ", href: "/admin/suppliers", label: "仕入先", feature: "suppliers" },
  { group: "マスタ", href: "/admin/customers", label: "取引先", feature: "customers" },
  { group: "マスタ", href: "/admin/holidays", label: "祝日・休業日", feature: "holidays" },
];

// 本人が使える項目だけを、区切りの順に並べて返す(CH-12)
export const visibleAdminMenu = (roles: readonly Role[]): { group: AdminMenuGroup; items: AdminMenuItem[] }[] =>
  ADMIN_MENU_GROUPS.map((group) => ({
    group,
    items: ADMIN_MENU_ITEMS.filter((item) => item.group === group && canAccess(roles, item.feature)),
  })).filter((g) => g.items.length > 0);
