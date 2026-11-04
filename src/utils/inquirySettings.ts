// 問い合わせ(D-02 在庫照会)の設定値。設定画面は作らず、初回はここの定数で持つ(D-02 01 7章、00_共通設計 1章「設定値」)。
// 値はすみたや様の回答を受けて直す。DBを読まない定数だけのファイルなので、画面の部品からも使える。

// 【仮】出荷の締め時刻(日本時間の HH:mm)。この時刻より前なら、その日に出荷できるとする(00_仮決め一覧 D-02-仮-10、D-02-未-02)
export const SHIPPING_CUTOFF_TIME = "12:00";

// 【仮】出荷しない日の決まり(00_仮決め一覧 D-02-仮-11、D-02-未-02)。
// 初回は祝日・臨時休業を出荷しない日とする(D-02 01 4.1)。定休日(水・木)に出荷するかは未決のため、出荷しない側にしておく
export const SHIP_ON_NATIONAL_HOLIDAY = false;
export const SHIP_ON_REGULAR_CLOSED_DAY = false;

// 0.2 次の出荷する日を探す日数の上限(これを超えたら「確認が必要」)
export const SHIPPING_SEARCH_DAYS = 30;

// 【仮】在庫の時点が古いとみなす時間(04 CH-04。00_仮決め一覧 D-02-仮-02)。B-01 の STOCK_STALE_HOURS と同じ値にしておく
export const STOCK_REPLY_STALE_HOURS = 24;

// 【仮】返信に在庫の数を書くか。初回は有無だけ(00_仮決め一覧 D-02-仮-03)。false のときはAIに在庫数を渡さない
export const STOCK_REPLY_SHOW_QUANTITY = false;

// 04 CH-01・CH-02・CH-06、02 G01 の上限
export const STOCK_LIMITS = {
  searchMin: 2,
  searchMax: 100,
  searchResults: 20,
  quantityMax: 999,
  selectedMax: 20,
} as const;
