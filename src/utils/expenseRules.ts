// 経費精算(E-07)の決まり(規程)の値(01 7.4、04 CH-07・CH-10〜CH-12)。
// 規程が分かるまで(ヒアリング No.33)の【仮】の値。規程が届いたら、このファイルだけを直す(00_仮決め一覧 E-07-仮-03〜仮-08)。
// DBを読まない定数だけのファイルなので、画面の部品(クライアント)からも使える。

// CH-10 登録の期限: 支払った日からこの日数を過ぎて登録したら印(E-07-仮-03)
export const APPLY_DEADLINE_DAYS = 90;

// CH-12 金額の上限: 1件の合計がこの額以上なら印(E-07-仮-04)
export const AMOUNT_CHECK_YEN = 30_000;

// CH-12 消耗品費でこの額以上なら「資産になる可能性」の印(法人税法施行令 第133条。E-07-仮-07)
export const SUPPLIES_ASSET_YEN = 100_000;
export const SUPPLIES_TITLE_NAME = "消耗品費";

// CH-07 支払った日がこの年数より前の領収書は登録できない(E-07-仮-05)
export const OLDEST_RECEIPT_YEARS = 1;

// CH-11 相手先・人数が要る勘定科目(名前で判定する)と、1人あたりの飲食費の上限(租税特別措置法 第61条の4。E-07-仮-08)
export const ATTENDEE_TITLE_NAMES = ["交際費", "会議費"] as const;
export const PER_PERSON_MEAL_YEN = 10_000;

// CH-04 用途のメモを必須にするか(E-07-仮-06。規程で不要なら false にする)
export const PURPOSE_REQUIRED = true;

// 03 の 0.2 勘定科目の推定に使う履歴の期間(年。E-07-仮-12)
export const HISTORY_YEARS = 2;

// CH-06 消費税額の検算で許す差(円。E-04 と同じ。00_仮決め一覧 E-04-仮-02)
export const EXPENSE_TAX_TOLERANCE_YEN = 1;

// 01 7.3 CSV の貸方の勘定科目(支払い方に関係なく「未払金」。税理士の確認待ち。E-07-仮-14)
export const CREDIT_TITLE_NAME = "未払金";
