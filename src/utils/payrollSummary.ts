// 給与CSVの集計(E-03 03 の 0.3 buildPayrollSummary・0.4、01 6章)。DBを読まない関数。担当は E-03。
// 日ごと・期間の計算は E-02 の buildAttendanceDay・summarizePeriod をそのまま使い(E-02 の画面と同じ数字にする)、
// ここでは 01 の 6.2 の列に並べ替えるだけにする。給与の金額は計算しない(社労士さんが行う)。
// CSVの列は PAYROLL_CSV_COLUMNS の1か所にまとめた。社労士さんの様式(ヒアリング No.32)が届いたら、ここを直す。
import { createHash } from "node:crypto";
import {
  ALERT_KIND_LABELS,
  ALERT_SEVERITY,
  buildAttendanceDay,
  stableDetail,
  summarizePeriod,
  weekStartOf,
  type AttendanceAlertKind,
  type AttendanceDay,
  type Shift,
} from "@/utils/attendance";
import {
  BREAK_MODE,
  DAILY_LEGAL_MINUTES,
  DEFAULT_WEEKLY_LEGAL_MINUTES,
  DEVIATION_MINUTES,
  WEEK_START_DOW,
} from "@/utils/attendanceRules";
import type { CsvCell } from "@/utils/csv";
import { addDays } from "@/utils/holidays";
import { DEPARTMENTS, EMPLOYMENT_TYPES, type Department, type EmploymentType } from "@/utils/masterRules";
import type { PayrollPeriod } from "@/utils/payrollPeriod";
import { PAYROLL_CLOSING_DAY, PAYROLL_ROUNDING, PAYROLL_TIME_FORMAT } from "@/utils/payrollRules";
import type { Punch } from "@/utils/timecard";

// 集計の対象の人(04 CH-09)
export type PayrollEmployee = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  department: Department;
  employmentType: EmploymentType;
  isActive: boolean;
  homeLocationId: string | null;
};

// 1人＝1行(01 の 6.2)。時間は分、日数は数(有給の半日は 0.5)
export type PayrollRow = {
  employeeId: string;
  employeeCode: string;
  name: string;
  // 締めたあとに従業員マスタや区分の名前を変えても同じ文字が出るよう、名前で持つ
  departmentLabel: string;
  employmentTypeLabel: string;
  workDays: number;
  holidayWorkDays: number;
  paidLeaveDays: number;
  specialLeaveDays: number;
  absenceDays: number;
  lateCount: number;
  lateMinutes: number;
  earlyCount: number;
  earlyMinutes: number;
  workedMinutes: number;
  legalWorkedMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  holidayWorkMinutes: number;
  breakMinutes: number;
  // 漏れがあり実働を計算できない日(未確定の日)
  undeterminedDays: number;
  note: string;
};

export type PayrollSource = {
  period: PayrollPeriod;
  // 今日(日本時間)。実績は今日までの日だけ数える(E-02 の勤怠の一覧と同じ)
  today: string;
  employees: PayrollEmployee[];
  // 期間の最初の日を含む週の始まり〜期間の最後の日の打刻(取り消しを含んでよい)・シフト
  punches: (Punch & { employeeId: string })[];
  shifts: (Shift & { employeeId: string; workDate: string })[];
  // 会社の休業日(holidays の is_closed)
  closedDates: ReadonlySet<string>;
  weeklyLegalMinutesOf: (employee: PayrollEmployee) => number;
  // 確認済み(dismissed)にした異常(備考に使う。法令のものだけを書く)
  dismissedAlerts: { employeeId: string; workDate: string; kind: AttendanceAlertKind }[];
};

// 03 の 0.3 手順4 月の合計の端数(基発第150号: 1時間未満の端数のうち30分未満は切り捨て、30分以上は1時間に切り上げ)
export const roundMonthlyMinutes = (minutes: number, rounding: "none" | "half_hour" = PAYROLL_ROUNDING): number => {
  if (rounding === "none") return minutes;
  const rest = minutes % 60;
  return rest >= 30 ? minutes - rest + 60 : minutes - rest;
};

// 03 の 0.3 手順3 確認済みの法令の異常を、人ごとに備考の文にまとめる(例「休憩不足 2日（確認済み）」)
const noteOf = (alerts: PayrollSource["dismissedAlerts"], undeterminedDays: number): string => {
  const parts: string[] = [];
  // 【仮】実働を計算できない日(同じ種類の打刻の連続だけの日など。E-02-仮-20)は要修正にならず締められるため、備考に出す(E-03-仮-10)
  if (undeterminedDays > 0) parts.push(`未確定 ${undeterminedDays}日（実働に含めていません）`);
  const days = new Map<AttendanceAlertKind, Set<string>>();
  for (const a of alerts) {
    if (ALERT_SEVERITY[a.kind] !== "legal") continue;
    days.set(a.kind, (days.get(a.kind) ?? new Set()).add(a.workDate));
  }
  for (const [kind, dates] of days) {
    // 月の時間外は期間に1件なので、日数を付けない
    parts.push(
      kind === "overtime_warning" || kind === "overtime_over"
        ? `${ALERT_KIND_LABELS[kind]}（確認済み）`
        : `${ALERT_KIND_LABELS[kind]} ${dates.size}日（確認済み）`
    );
  }
  return parts.join("、");
};

// 03 の 0.3 集計を作る。並びは社員番号の順(01 の 6.1)
export const buildPayrollSummary = (src: PayrollSource): PayrollRow[] => {
  const { period, today } = src;
  const readFrom = weekStartOf(period.from);
  const lastDay = period.to < today ? period.to : today;
  return [...src.employees]
    .sort((a, b) => a.employeeCode.localeCompare(b.employeeCode, "ja", { numeric: true }))
    .map((employee): PayrollRow => {
      const punchesByDate = new Map<string, Punch[]>();
      for (const p of src.punches) {
        if (p.employeeId === employee.id) punchesByDate.set(p.workDate, [...(punchesByDate.get(p.workDate) ?? []), p]);
      }
      const shiftsByDate = new Map(src.shifts.filter((s) => s.employeeId === employee.id).map((s) => [s.workDate, s]));
      // 手順2 週の時間外を正しく出すため、期間の最初の日を含む週の始まりから計算する
      const days: AttendanceDay[] = [];
      for (let d = readFrom; d <= lastDay; d = addDays(d, 1)) {
        days.push(buildAttendanceDay(d, punchesByDate.get(d) ?? [], shiftsByDate.get(d) ?? null, src.closedDates.has(d)));
      }
      const summary = summarizePeriod(days, src.weeklyLegalMinutesOf(employee), { from: period.from, to: lastDay });
      const inPeriod = days.filter((d) => d.workDate >= period.from && d.blocks.length > 0);
      const leave = summary.leaveDays;
      const alerts = src.dismissedAlerts.filter((a) => a.employeeId === employee.id);
      return {
        employeeId: employee.id,
        employeeCode: employee.employeeCode,
        name: `${employee.lastName}　${employee.firstName}`,
        departmentLabel: DEPARTMENTS[employee.department],
        employmentTypeLabel: EMPLOYMENT_TYPES[employee.employmentType],
        workDays: summary.workDays,
        holidayWorkDays: summary.holidayWorkDays,
        paidLeaveDays: (leave.paid_leave ?? 0) + (leave.paid_leave_half ?? 0) * 0.5,
        specialLeaveDays: leave.special_leave ?? 0,
        absenceDays: leave.absence ?? 0,
        lateCount: inPeriod.filter((d) => d.lateMinutes > 0).length,
        lateMinutes: summary.lateMinutes,
        earlyCount: inPeriod.filter((d) => d.earlyMinutes > 0).length,
        earlyMinutes: summary.earlyMinutes,
        workedMinutes: summary.workedMinutes,
        // 総労働時間 − 時間外(丸める前の時間外で計算する。総労働時間などは丸めない)
        legalWorkedMinutes: summary.workedMinutes - summary.overtimeMinutes,
        // 手順4
        overtimeMinutes: roundMonthlyMinutes(summary.overtimeMinutes),
        nightMinutes: roundMonthlyMinutes(summary.nightMinutes),
        holidayWorkMinutes: roundMonthlyMinutes(summary.holidayWorkMinutes),
        breakMinutes: inPeriod.reduce((sum, d) => sum + (d.workedMinutes === null ? 0 : (d.breakMinutes ?? 0)), 0),
        undeterminedDays: summary.undeterminedDays,
        note: noteOf(alerts, summary.undeterminedDays),
      };
    });
};

// ---- 締めたときの集計(snapshot。01 8.1) ----

export type SnapshotAlert = { employeeName: string; workDate: string; kind: AttendanceAlertKind; severity: string; message: string };

export type PayrollSnapshot = {
  version: 1;
  period: { month: string; from: string; to: string };
  // 使った定数の値(時間の表し方は出力のときの定数を使うので、ここには入れない。01 5.2)
  rules: {
    payrollClosingDay: number;
    payrollRounding: string;
    dailyLegalMinutes: number;
    defaultWeeklyLegalMinutes: number;
    weekStartDow: number;
    breakMode: string;
    deviationMinutes: number;
  };
  rows: PayrollRow[];
  // 締めたときの未対応の異常(法令・確認。CH-04「何を確認して締めたか」)
  openAlertsAtClose: SnapshotAlert[];
};

export const buildSnapshot = (period: PayrollPeriod, rows: PayrollRow[], openAlerts: SnapshotAlert[]): PayrollSnapshot => ({
  version: 1,
  period: { month: period.month, from: period.from, to: period.to },
  rules: {
    payrollClosingDay: PAYROLL_CLOSING_DAY,
    payrollRounding: PAYROLL_ROUNDING,
    dailyLegalMinutes: DAILY_LEGAL_MINUTES,
    defaultWeeklyLegalMinutes: DEFAULT_WEEKLY_LEGAL_MINUTES,
    weekStartDow: WEEK_START_DOW,
    breakMode: BREAK_MODE,
    deviationMinutes: DEVIATION_MINUTES,
  },
  rows,
  openAlertsAtClose: openAlerts,
});

// CH-06 の SHA-256。DB(jsonb)はキーの順を並べ替えるので、キーの順に左右されない文字列から作る
export const snapshotHash = (snapshot: unknown): string => createHash("sha256").update(stableDetail(snapshot)).digest("hex");

// ---- CSV(01 の 6章、03 の 0.4) ----

// 分 → "168:30"(hmm)・"168.50"(decimal)
export const formatPayrollMinutes = (minutes: number, format: "hmm" | "decimal" = PAYROLL_TIME_FORMAT): string => {
  if (format === "decimal") return (Math.round((minutes * 100) / 60) / 100).toFixed(2);
  const h = Math.floor(minutes / 60);
  return `${h}:${String(minutes - h * 60).padStart(2, "0")}`;
};

// CH-08 値の中の改行は空白にする(Excel で行がずれないように)。数式の頭文字の対策は csv.ts で行う。
// 先頭のタブは csv.ts の対象に無いので、ここで「'」を付ける
const csvText = (value: string): string => {
  const s = value.replace(/\r\n|\r|\n/g, " ");
  return s.startsWith("\t") ? `'${s}` : s;
};

type CsvContext = { period: PayrollPeriod; timeFormat: "hmm" | "decimal" };
const slashDate = (date: string) => date.replace(/-/g, "/");
const time = (minutes: number, ctx: CsvContext) => formatPayrollMinutes(minutes, ctx.timeFormat);

// 列の定義(01 の 6.2)。並び・名前・表し方を変えるときは、ここだけを直す
export const PAYROLL_CSV_COLUMNS: { header: string; value: (row: PayrollRow, ctx: CsvContext) => CsvCell }[] = [
  { header: "対象月", value: (_r, c) => c.period.month },
  { header: "期間開始", value: (_r, c) => slashDate(c.period.from) },
  { header: "期間終了", value: (_r, c) => slashDate(c.period.to) },
  { header: "社員番号", value: (r) => csvText(r.employeeCode) },
  { header: "氏名", value: (r) => csvText(r.name) },
  { header: "所属", value: (r) => csvText(r.departmentLabel) },
  { header: "雇用形態", value: (r) => csvText(r.employmentTypeLabel) },
  { header: "出勤日数", value: (r) => r.workDays },
  { header: "休日出勤日数", value: (r) => r.holidayWorkDays },
  { header: "有給休暇日数", value: (r) => r.paidLeaveDays },
  { header: "特別休暇日数", value: (r) => r.specialLeaveDays },
  { header: "欠勤日数", value: (r) => r.absenceDays },
  { header: "遅刻回数", value: (r) => r.lateCount },
  { header: "遅刻時間", value: (r, c) => time(r.lateMinutes, c) },
  { header: "早退回数", value: (r) => r.earlyCount },
  { header: "早退時間", value: (r, c) => time(r.earlyMinutes, c) },
  { header: "総労働時間", value: (r, c) => time(r.workedMinutes, c) },
  { header: "法定内労働時間", value: (r, c) => time(r.legalWorkedMinutes, c) },
  { header: "時間外労働時間", value: (r, c) => time(r.overtimeMinutes, c) },
  { header: "深夜労働時間", value: (r, c) => time(r.nightMinutes, c) },
  { header: "休日出勤時間", value: (r, c) => time(r.holidayWorkMinutes, c) },
  { header: "休憩時間", value: (r, c) => time(r.breakMinutes, c) },
  { header: "備考", value: (r) => csvText(r.note) },
];

// 見出しの行＋1人1行(csv.ts の toCsv・csvResponse に渡す形)
export const payrollCsvRows = (snapshot: PayrollSnapshot, timeFormat: "hmm" | "decimal" = PAYROLL_TIME_FORMAT): CsvCell[][] => {
  const ctx: CsvContext = { period: { ...snapshot.period }, timeFormat };
  return [PAYROLL_CSV_COLUMNS.map((c) => c.header), ...snapshot.rows.map((r) => PAYROLL_CSV_COLUMNS.map((c) => c.value(r, ctx)))];
};

// ファイル名 勤怠集計_2026年11月分_20261201-0930.csv(作った日時は日本時間)
export const payrollCsvFileName = (month: string, now: Date = new Date()): string => {
  const stamp = now.toLocaleString("sv-SE", { timeZone: "Asia/Tokyo", hour12: false }).replace(/[-:]/g, "").replace(" ", "-").slice(0, 13);
  return `勤怠集計_${month.slice(0, 4)}年${Number(month.slice(5))}月分_${stamp}.csv`;
};
