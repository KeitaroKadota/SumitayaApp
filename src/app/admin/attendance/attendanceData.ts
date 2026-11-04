// 勤怠の一覧(G01)・シフト(G03)で使う、月の表の読み込み(E-02 03 の EV-01・EV-06)。サーバーだけで使う。
// 週の時間外を正しく出すため、期間の最初の日を含む週の始まりから読む(01 12章)。
import {
  buildAttendanceDay,
  plannedAttendanceDay,
  summarizePeriod,
  weekStartOf,
  type AttendanceDay,
  type PeriodSummary,
} from "@/utils/attendance";
import {
  listAlerts,
  listAttendanceEmployees,
  listPunchesOfEmployees,
  listShifts,
  type AttendanceAlert,
  type AttendanceEmployee,
  type ShiftRecord,
} from "@/utils/attendanceServer";
import { addDays, getCalendar, type CalendarDay } from "@/utils/holidays";
import type { PayrollPeriod } from "@/utils/payrollPeriod";
import type { WorkLocation } from "@/utils/punchLocation";
import { listActiveLocations, weeklyLegalMinutesFor } from "@/utils/timecardServer";

export type EmployeePunch = Awaited<ReturnType<typeof listPunchesOfEmployees>>[number];

export type EmployeeMonth = {
  employee: AttendanceEmployee;
  days: Map<string, AttendanceDay>;
  punchesByDate: Map<string, EmployeePunch[]>;
  shiftsByDate: Map<string, ShiftRecord>;
  summary: PeriodSummary;
  // 予定どおりに働いたとした合計(G03 の右端)
  planned: PeriodSummary;
};

export type MonthData = {
  dates: string[];
  calendar: Map<string, CalendarDay>;
  locations: WorkLocation[];
  rows: EmployeeMonth[];
  openAlerts: AttendanceAlert[];
};

// 期間の日付の並び
export const datesOf = (period: { from: string; to: string }): string[] => {
  const dates: string[] = [];
  for (let d = period.from; d <= period.to; d = addDays(d, 1)) dates.push(d);
  return dates;
};

export const loadMonth = async (period: PayrollPeriod, today: string, { withAlerts = true } = {}): Promise<MonthData> => {
  const readFrom = weekStartOf(period.from);
  // DBの接続1本の決まりのため順番に読む
  const employees = await listAttendanceEmployees(period.from, period.to);
  const ids = employees.map((e) => e.id);
  const punches = ids.length > 0 ? await listPunchesOfEmployees(readFrom, period.to, { employeeIds: ids }) : [];
  const shifts = ids.length > 0 ? await listShifts(readFrom, period.to, { employeeIds: ids }) : [];
  const calendar = await getCalendar(readFrom, period.to);
  const locations = await listActiveLocations();
  const openAlerts = withAlerts ? await listAlerts({ status: "open", from: period.from, to: period.to }) : [];

  const rows = employees.map((employee): EmployeeMonth => {
    const punchesByDate = new Map<string, EmployeePunch[]>();
    for (const p of punches) {
      if (p.employeeId === employee.id) punchesByDate.set(p.workDate, [...(punchesByDate.get(p.workDate) ?? []), p]);
    }
    const shiftsByDate = new Map(shifts.filter((s) => s.employeeId === employee.id).map((s) => [s.workDate, s]));
    const days = new Map<string, AttendanceDay>();
    const plannedDays: AttendanceDay[] = [];
    for (let d = readFrom; d <= period.to; d = addDays(d, 1)) {
      const shift = shiftsByDate.get(d) ?? null;
      const closed = calendar.get(d)?.isClosed ?? false;
      days.set(d, buildAttendanceDay(d, punchesByDate.get(d) ?? [], shift, closed));
      plannedDays.push(plannedAttendanceDay(d, shift, closed));
    }
    const weekly = weeklyLegalMinutesFor({ ...employee, usesTimecard: true }, locations);
    // 実績は今日まで(今日の勤務中の分は打刻漏れと同じく計算に入らない)
    const actualDays = [...days.values()].filter((d) => d.workDate <= today);
    const summary = summarizePeriod(actualDays, weekly, { from: period.from, to: period.to < today ? period.to : today });
    const planned = summarizePeriod(plannedDays, weekly, period);
    return { employee, days, punchesByDate, shiftsByDate, summary, planned };
  });

  return { dates: datesOf(period), calendar, locations, rows, openAlerts };
};
