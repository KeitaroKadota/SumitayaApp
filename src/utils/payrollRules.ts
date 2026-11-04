// 給与CSVの出力の決まり(E-03 01 8.2。担当は E-03)。設定画面は作らず、値を変えるときはここを直してデプロイする。
// 【仮】の値は 00_仮決め一覧(E-03)で確認する。社労士さんの様式(ヒアリング No.32)が届いたら直す。
// DBを読まない定数だけのファイルなので、画面の部品(クライアント)からも使える。

// 給与の締め日(1〜31。31＝月末。その月に無い日は、その月の最後の日。00_共通設計 7.5)。【仮】末日締め(E-03-仮-01)
export const PAYROLL_CLOSING_DAY = 31;

// 時間の表し方。hmm: 168:30 / decimal: 168.50(分 ÷ 60 を小数2けたに四捨五入)。【仮】hmm(E-03-仮-02)
export const PAYROLL_TIME_FORMAT: "hmm" | "decimal" = "hmm";

// 月の合計の端数。none: 丸めない / half_hour: 月の時間外・休日出勤・深夜の合計の1時間未満の端数を、
// 30分未満は切り捨て・30分以上は1時間に切り上げ(昭和63年3月14日 基発第150号)。【仮】none(E-03-仮-03・E-03-仮-11)
export const PAYROLL_ROUNDING: "none" | "half_hour" = "none";

// 給与CSVの画面で選べる最初の月(システムを使い始めた月。04 CH-01)。【仮】E-03-仮-12
export const PAYROLL_FIRST_MONTH = "2026-11";

// 締めのメモ・解除の理由の長さ(04 CH-07)。メモは【仮】E-03-仮-12
export const CLOSE_NOTE_MAX = 200;
export const REOPEN_REASON_MAX = 200;
