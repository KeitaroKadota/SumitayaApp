// 権限表(CMN-01 01 3.2、00_共通設計 2章)。権限の決まりはこのファイルの1か所にだけ書く。
// この表を直せば、メニュー・タイルの出し分けと権限チェック(requireAccess)の両方が変わる。
// 【仮】ヒアリング No.45・46 の回答で見直す(00_仮決め一覧 CMN01-仮-01)。設計書の表と一緒に直すこと。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。

export const ROLES = ["president", "store", "factory", "accounting"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  president: "社長",
  store: "店舗",
  factory: "工場",
  accounting: "経理",
};

export const isRole = (value: string): value is Role => (ROLES as readonly string[]).includes(value);

// 社長(president)は表に関係なく常に使える(canAccess の中で扱う)ので、表には店舗・工場・経理だけを書く。
// all: 区分に関係なく全員が使う機能。admin: 管理画面(/admin)の機能か(管理画面に入れるかの判定に使う)。
export const FEATURES = {
  accounts: { label: "アカウントの発行・再設定", roles: [], admin: true },
  employees: { label: "従業員マスタ", roles: [], admin: true },
  products: { label: "商品マスタ", roles: ["store"], admin: true },
  suppliers: { label: "仕入先マスタ", roles: ["store", "accounting"], admin: true },
  customers: { label: "取引先マスタ", roles: ["accounting"], admin: true },
  holidays: { label: "祝日・休業日の編集", roles: ["store"], admin: true },
  tasks: { label: "自分のタスク", roles: ["store", "factory", "accounting"], admin: false },
  tasks_admin: { label: "全員のタスク", roles: [], admin: true },
  inquiries: { label: "問い合わせ", roles: ["store"], admin: true },
  inquiry_settings: { label: "よくある質問・単価表・ひな形の管理", roles: ["store"], admin: true },
  timecard: { label: "打刻・自分の勤怠", roles: ["store", "factory", "accounting"], admin: false },
  attendance_admin: { label: "全員の勤怠チェック・シフト", roles: ["accounting"], admin: true },
  payroll: { label: "給与CSV", roles: ["accounting"], admin: true },
  payables: { label: "受け取った請求書・支払予定", roles: ["accounting"], admin: true },
  receivables: { label: "請求書の発行・入金消込", roles: ["accounting"], admin: true },
  expenses_apply: { label: "経費の申請", roles: ["store", "factory", "accounting"], admin: false },
  expenses_admin: { label: "全員の経費の一覧・CSV", roles: ["accounting"], admin: true },
  expenses_approve: { label: "経費の承認", roles: [], admin: true },
  sales: { label: "売上・分析・予測・発注の下書き", roles: ["store"], admin: true },
  production: { label: "製造指示", roles: ["store", "factory"], admin: true },
  orders: { label: "受注", roles: ["store"], admin: true },
  inventory: { label: "在庫の増減・棚卸", roles: ["store", "factory"], admin: true },
  purchasing: { label: "納品書・検収", roles: ["store", "accounting"], admin: true },
} as const satisfies Record<string, { label: string; roles: readonly Exclude<Role, "president">[]; admin: boolean }>;

export type FeatureKey = keyof typeof FEATURES;

// CH-12 権限がある: 区分のどれか1つでも、権限表でその機能キーが「○」なら使える。社長は常に使える。
export const canAccess = (roles: readonly Role[], feature: FeatureKey): boolean => {
  if (roles.includes("president")) return true;
  const allowed: readonly Role[] = FEATURES[feature].roles;
  return roles.some((r) => allowed.includes(r));
};

// 管理画面の機能が1つでも使えるか(EV-10 の「管理画面へ」、EV-11 の管理画面のトップ)。
// 【仮】メニューの項目がまだ無い機能も、権限表で使えるなら「使える」とする(00_仮決め一覧 CMN01-仮-14)。
export const canUseAdmin = (roles: readonly Role[]): boolean =>
  (Object.keys(FEATURES) as FeatureKey[]).some((key) => FEATURES[key].admin && canAccess(roles, key));

// 区分の表示(例: 「店舗・経理」)。並びは ROLES の順にそろえる。
export const formatRoles = (roles: readonly Role[]): string =>
  ROLES.filter((r) => roles.includes(r))
    .map((r) => ROLE_LABELS[r])
    .join("・");
