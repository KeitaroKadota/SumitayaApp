// マスタ(CMN-02)の決まった値と仮の値。値を変えるときはこのファイルだけを直す。
// 【仮】と書いた値は 00_仮決め一覧 の CMN-02 の表に載せてある。確認できたらここを直す。
// DBを読まない定数だけのファイルなので、画面の部品(クライアント)からも使える。

// ---- 従業員(CMN-02 01 6.1・04 CH-05) ----

// 【仮】所属と雇用形態の種類(CMN02-仮-01。ヒアリング No.28)
export const DEPARTMENTS = { store: "店舗", factory: "工場", office: "事務" } as const;
export type Department = keyof typeof DEPARTMENTS;

export const EMPLOYMENT_TYPES = { full_time: "正社員", part_time: "パート", other: "その他" } as const;
export type EmploymentType = keyof typeof EMPLOYMENT_TYPES;

// 【仮】所属を選んだときの権限の初期値(CMN02-仮-02)。店舗→店舗、工場→工場、事務→経理
export const DEFAULT_ROLE_BY_DEPARTMENT = { store: "store", factory: "factory", office: "accounting" } as const;

// 所属を選んだときの「主な勤務場所」の初期値に使う、打刻の場所の種類(work_locations.kind)。事務は初期値なし
export const DEFAULT_LOCATION_KIND_BY_DEPARTMENT: Record<Department, "store" | "factory" | null> = {
  store: "store",
  factory: "factory",
  office: null,
};

// CH-03 社員番号: 半角の英数字と「-」、1〜20文字
export const EMPLOYEE_CODE_PATTERN = /^[A-Za-z0-9-]{1,20}$/;

// ---- 文字数の上限(04 冒頭。【仮】CMN02-仮-19) ----
export const MAX_TEXT = 100;
export const MAX_NOTE = 1000;
export const MAX_PERSON_NAME = 30; // CH-01 姓・名
export const MAX_PRODUCT_NAME = 200; // CH-09
export const MAX_HOLIDAY_NAME = 50; // CH-27

// ---- 商品(CMN-02 01 6.2・6.3、04 CH-08〜CH-14・CH-35〜CH-37) ----

// 【仮】商品の分類(CMN02-仮-07。ヒアリング No.35)。コード → 表示名
export const PRODUCT_CATEGORIES: Record<string, string> = {
  happi: "法被",
  koikuchi: "鯉口シャツ",
  tabi: "足袋",
};

// 【仮】商品コードの決まり(CMN02-仮-10)。半角の英数字と「-」「_」「.」「/」の1〜50文字。大文字・小文字は区別する
export const PRODUCT_CODE_PATTERN = /^[A-Za-z0-9._/-]{1,50}$/;

// 売価・原価の上限(CH-11)
export const MAX_PRICE = 9_999_999;
// 発注の単位・最低の発注数(CH-35)
export const MIN_ORDER_UNIT = 1;
export const MAX_ORDER_UNIT = 99_999;
// 届くまでの日数(CH-19・CH-36。【仮】暦の日数で数える。CMN02-仮-11)
export const MAX_LEAD_TIME_DAYS = 365;

export const TAX_RATES = [10, 8, 0] as const;
export type TaxRate = (typeof TAX_RATES)[number];

// 商品の一覧の1ページの件数(EV-07)
export const PRODUCT_PAGE_SIZE = 50;

// 読み替えのコードの取り込み元(CH-37)
export const ALIAS_SOURCES = { pos: "レジ", crossmall: "CROSS MALL" } as const;
export type AliasSource = keyof typeof ALIAS_SOURCES;

// 商品の詳細に「読み替えのコード」の欄を出すか(02 G05)。ヒアリング No.36 で「コードは同じ」と分かれば false にする
export const SHOW_PRODUCT_CODE_ALIASES = true;

// ---- 仕入先・取引先(CMN-02 01 6.4・6.5、04 CH-16〜CH-19・CH-31〜CH-34) ----

// CH-16 仕入先・取引先のコード: 半角の英数字と「-」「_」、1〜20文字
export const PARTNER_CODE_PATTERN = /^[A-Za-z0-9_-]{1,20}$/;

export const ORDER_METHODS = { fax: "FAX", email: "メール", web: "Web", phone: "電話", other: "その他" } as const;
export type OrderMethod = keyof typeof ORDER_METHODS;

export const PAYMENT_METHODS = { transfer: "振込", debit: "口座振替", cash: "現金", other: "その他" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

// 支払月(0=当月〜3=3か月後。CH-18)
export const PAYMENT_MONTH_LABELS = ["当月", "翌月", "翌々月", "3か月後"] as const;

// 締め日・支払日の「月末」(00_共通設計 7.5)
export const MONTH_END_DAY = 31;

// 【仮】取引先の敬称と種別(CMN02-仮-16)
export const HONORIFICS = ["御中", "様"] as const;
export type Honorific = (typeof HONORIFICS)[number];

export const CUSTOMER_TYPES = {
  neighborhood: "町内会",
  corporate: "法人",
  school: "学校",
  individual: "個人",
  other: "その他",
} as const;
export type CustomerType = keyof typeof CUSTOMER_TYPES;

// CH-33 仕入先の別名は10件まで・読み取りの注意は500文字まで
export const MAX_SUPPLIER_ALIASES = 10;
export const MAX_OCR_HINT = 500;
// CH-32・CH-34 振込先・振込名義は200文字まで
export const MAX_TRANSFER_TEXT = 200;

// ---- 祝日・休業日(CMN-02 01 6.6) ----

export const HOLIDAY_KINDS = { national: "祝日", regular: "定休日", temporary: "臨時" } as const;
export type HolidayKind = keyof typeof HOLIDAY_KINDS;

// 締め日・支払日の表示(31 は「末日」)
export const formatDayOfMonth = (day: number | null): string =>
  day === null ? "" : day === MONTH_END_DAY ? "末日" : `${day}日`;

// 一覧の「締め/支払」の表示(例: 末締め翌月末払)
export const formatClosingAndPayment = (
  closingDay: number | null,
  paymentMonthOffset: number | null,
  paymentDay: number | null,
  paymentWord = "払"
): string => {
  if (closingDay === null) return "都度";
  const closing = closingDay === MONTH_END_DAY ? "末締め" : `${closingDay}日締め`;
  if (paymentMonthOffset === null || paymentDay === null) return closing;
  const day = paymentDay === MONTH_END_DAY ? "末" : `${paymentDay}日`;
  return `${closing}${PAYMENT_MONTH_LABELS[paymentMonthOffset] ?? ""}${day}${paymentWord}`;
};
