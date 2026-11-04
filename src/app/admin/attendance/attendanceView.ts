// 勤怠の管理画面(E-02 の G01〜G05)で共通の、URL・表示の文(DBを読まない)。
import {
  minutesToHHmm,
  type AlertSeverity,
  type AttendanceAlertKind,
  type AttendanceDay,
  type Shift,
} from "@/utils/attendance";
import type { BadgeTone } from "@/components/Badge";
import { payrollPeriodOf, payrollPeriodOfMonth, type PayrollPeriod } from "@/utils/payrollPeriod";

const MONTH_PATTERN = /^(20\d{2})-(0[1-9]|1[0-2])$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// EV-01 手順1 ?month= を確かめる(YYYY-MM、だめなら今日を含む期間)
export const parsePeriodParam = (value: string | string[] | undefined, today: string): PayrollPeriod =>
  typeof value === "string" && MONTH_PATTERN.test(value) ? payrollPeriodOfMonth(value) : payrollPeriodOf(today);

// EV-02 手順1 ?edit=<従業員ID>:<日付> の形(実在する人か・期間の中かは呼ぶ側で確かめる)
export const parseCellParam = (value: string | string[] | undefined): { employeeId: string; date: string } | null => {
  if (typeof value !== "string") return null;
  const [employeeId, date] = value.split(":");
  if (!employeeId || !date || !UUID_PATTERN.test(employeeId) || !DATE_PATTERN.test(date)) return null;
  return { employeeId, date };
};

export const isUuid = (value: string) => UUID_PATTERN.test(value);

export const attendanceUrl = (month: string, extra = "") => `/admin/attendance?month=${month}${extra}`;
export const shiftsUrl = (month: string, extra = "") => `/admin/attendance/shifts?month=${month}${extra}`;

export const SEVERITY_TONES: Record<AlertSeverity, BadgeTone> = { fix: "danger", legal: "warning", info: "neutral" };

// セルの印の文字(色だけにしない。02 の G01)
export const ALERT_MARKS: Record<AttendanceAlertKind, string> = {
  missing_clock_out: "漏れ",
  missing_break_end: "漏れ",
  missing_clock_in: "漏れ",
  no_punch: "打刻なし",
  duplicate_punch: "重複",
  break_short: "休",
  overtime_warning: "時間外",
  overtime_over: "時間外",
  shift_deviation: "ずれ",
  work_without_shift: "予定外",
  location_check: "範囲外",
};

// セル上段の予定: 「09:30-18:30」、休みは「有給」「半休」「特休」「欠勤」、無ければ「-」
export const shiftCellText = (shift: Shift | null | undefined): string => {
  if (!shift) return "-";
  switch (shift.kind) {
    case "work":
      return `${shift.startTime}-${shift.endTime}`;
    case "paid_leave":
      return "有給";
    case "paid_leave_half":
      return `半休 ${shift.startTime}-${shift.endTime}`;
    case "special_leave":
      return "特休";
    default:
      return "欠勤";
  }
};

// セル下段の実績: 最初の出勤〜最後の退勤。漏れは「（漏れ）」
export const actualCellText = (day: AttendanceDay): string => {
  if (day.blocks.length === 0 && day.lastOut === null) return "-";
  const first = day.firstIn !== null ? minutesToHHmm(day.firstIn) : "";
  const last = day.lastOut !== null && day.gaps.length === 0 ? minutesToHHmm(day.lastOut) : "（漏れ）";
  return `${first}-${last}`;
};
