import { canAccess, type FeatureKey, type Role } from "@/utils/permissions";

// 管理画面の左メニュー(CMN-01 G05、00_画面共通ルール 5.2)。権限のある項目だけを出す。
// 各機能のページを作ったら、ここに1行足す(ページが無いうちは足さない。リンク切れを出さないため)。
// 例: { group: "マスタ", href: "/admin/employees", label: "従業員", feature: "employees" }

// feature を並びで書いたときは、どれか1つでも使えれば出す(B-01 の在庫の一覧は orders か inventory)
export type AdminMenuItem = { group: AdminMenuGroup; href: string; label: string; feature: FeatureKey | FeatureKey[] };

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
  // D-02 在庫照会への回答(02 の G02。返信のひな形は D-03・D-04・D-06 の分もここで管理する)
  { group: "問い合わせ", href: "/admin/inquiries/templates", label: "返信のひな形", feature: "inquiry_settings" },
  // D-03 よくある質問への回答(02 の G02)
  { group: "問い合わせ", href: "/admin/inquiries/faq", label: "よくある質問", feature: "inquiry_settings" },
  // D-04 特注の仕様確認・概算見積(02 の G02・G04)
  { group: "問い合わせ", href: "/admin/inquiries/custom", label: "特注", feature: "inquiries" },
  { group: "問い合わせ", href: "/admin/inquiries/price-items", label: "単価表", feature: "inquiry_settings" },
  // D-06 返品依頼への回答(02 の G02。「問い合わせ ＞ 返品」)
  { group: "問い合わせ", href: "/admin/inquiries/returns", label: "返品", feature: "inquiries" },
  // B-01 CROSS MALL からの受注・在庫の取り込み(02 の G01・G05)。「例外注文(B-02)」は B-02 の画面を作るときに足す
  { group: "受注・在庫", href: "/admin/orders", label: "受注", feature: "orders" },
  { group: "受注・在庫", href: "/admin/inventory", label: "在庫", feature: ["orders", "inventory"] },
  // E-02 勤怠チェック・シフトとの突合(02 の画面一覧)
  { group: "勤怠・給与", href: "/admin/attendance", label: "勤怠の一覧", feature: "attendance_admin" },
  { group: "勤怠・給与", href: "/admin/attendance/shifts", label: "シフト", feature: "attendance_admin" },
  { group: "勤怠・給与", href: "/admin/attendance/alerts", label: "勤怠の異常", feature: "attendance_admin" },
  // E-03 給与CSVの出力(02 の G01)
  { group: "勤怠・給与", href: "/admin/payroll", label: "給与CSV", feature: "payroll" },
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
    items: ADMIN_MENU_ITEMS.filter(
      (item) =>
        item.group === group &&
        (Array.isArray(item.feature) ? item.feature : [item.feature]).some((f) => canAccess(roles, f))
    ),
  })).filter((g) => g.items.length > 0);
