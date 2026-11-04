// 勤怠の決まり(E-02 01 11.2。担当は E-02、E-01・E-03 が読む)。設定画面は作らず、値を変えるときはここを直してデプロイする。
// 【仮】の値は 00_仮決め一覧(E-01・E-02)で確認する。就業規則・36協定(ヒアリング No.30)が届いたら直す。
// DBを読まないファイルなので、画面の部品(クライアント)からも使える。
import type { AttendanceAlertKind } from "@/utils/attendance";

// 休憩を打刻する(punch)／シフトの休憩で差し引く(fixed)。fixed のときは休憩のボタンを出さない(E-01 CH-02)
export const BREAK_MODE: "punch" | "fixed" = "punch";

// 休憩の決まり(労働基準法 第34条第1項。E-02 01 5.2)
export const BREAK_THRESHOLD1_MINUTES = 360;
export const BREAK_REQUIRED1_MINUTES = 45;
export const BREAK_THRESHOLD2_MINUTES = 480;
export const BREAK_REQUIRED2_MINUTES = 60;

// 1日の法定労働時間(労働基準法 第32条第2項。E-02 01 5.3)
export const DAILY_LEGAL_MINUTES = 480;
// 週の法定労働時間(場所の値 work_locations.weekly_legal_minutes が無いとき。E-02 03 0.2)
export const DEFAULT_WEEKLY_LEGAL_MINUTES = 2400;
// 週の始まりの曜日(0=日〜6=土)
export const WEEK_START_DOW = 0;

// 月の時間外の上限と注意の線(労働基準法 第36条第4項。E-02 CH-04)
export const OVERTIME_MONTHLY_LIMIT_MINUTES = 2700;
export const OVERTIME_WARNING_MINUTES = 2160;

// シフトとのずれの印(分。E-02 01 5.5)
export const DEVIATION_MINUTES = 15;
// 退勤からこの分以内の再出勤は重複打刻の疑い(E-02 CH-02)
export const REWORK_GAP_MINUTES = 10;

// 二重押しとみなす秒数(E-01 CH-03。00_仮決め一覧 E-01-仮-07)
export const DOUBLE_TAP_SECONDS = 60;
// 開いたままの勤務の上限(時間。E-01 CH-04。00_仮決め一覧 E-01-仮-08)
export const OPEN_SHIFT_MAX_HOURS = 20;
// 位置が取れないときに打刻させないか(E-01 CH-07。false＝記録して印を付ける。00_仮決め一覧 E-01-仮-02)
export const LOCATION_REQUIRED = false;

// タスクを出す異常の種類と宛先(E-02 01 6章の「タスク」の列。00_仮決め一覧 E-02-仮-13)。
// self: 本人あて(attendance_alert_self)、admin: 管理者あて(attendance_alert。機能キー attendance_admin)。
// 表に無い種類(shift_deviation)はタスクを出さず、画面に印だけを出す。
export const TASK_ALERT_KINDS: Readonly<Partial<Record<AttendanceAlertKind, readonly ("self" | "admin")[]>>> = {
  missing_clock_out: ["self", "admin"],
  missing_break_end: ["self", "admin"],
  missing_clock_in: ["admin"],
  no_punch: ["self", "admin"],
  break_short: ["self", "admin"],
  overtime_warning: ["self", "admin"],
  overtime_over: ["self", "admin"],
  duplicate_punch: ["admin"],
  work_without_shift: ["admin"],
  location_check: ["admin"],
};

// 是正のタスクの期限(発行の何日後か。E-02 03「タスクの内容」。00_仮決め一覧 E-02-仮-14)。表に無い種類は3日後
export const TASK_DUE_DAYS: Readonly<Partial<Record<AttendanceAlertKind, number>>> = {
  missing_clock_out: 2,
  missing_break_end: 2,
  missing_clock_in: 2,
  no_punch: 2,
};
export const TASK_DUE_DAYS_DEFAULT = 3;
