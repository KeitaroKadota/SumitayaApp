// 給与CSVのDBの読み書き(E-03。payroll_exports と、集計のもとになる勤怠の読み込み)。サーバーだけで使う。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess を済ませている前提)。
// DBの接続1本の決まりのため、トランザクションの中では tx を渡せる関数だけを使う(query を使う関数は前に読んでおく)。
import { isAlertKind, type AlertSeverity, type AttendanceAlertKind, weekStartOf } from "@/utils/attendance";
import { listPunchesOfEmployees, listShifts } from "@/utils/attendanceServer";
import { query, queryOn, type SqlLike, type TransactionSql } from "@/utils/db";
import { getCalendar } from "@/utils/holidays";
import type { Department, EmploymentType } from "@/utils/masterRules";
import type { PayrollPeriod } from "@/utils/payrollPeriod";
import { buildPayrollSummary, type PayrollEmployee, type PayrollRow, type PayrollSnapshot, type SnapshotAlert } from "@/utils/payrollSummary";
import type { WorkLocation } from "@/utils/punchLocation";
import { listActiveLocations, weeklyLegalMinutesFor } from "@/utils/timecardServer";

// ---- payroll_exports ----

export type PayrollExportStatus = "closed" | "reopened";

export type PayrollExport = {
  id: string;
  yearMonth: string;
  periodStart: string;
  periodEnd: string;
  status: PayrollExportStatus;
  closedByName: string | null;
  closedAt: Date;
  closeNote: string | null;
  reopenedByName: string | null;
  reopenedAt: Date | null;
  reopenReason: string | null;
  closeCount: number;
  snapshot: unknown;
  snapshotHash: string;
  exportCount: number;
  lastExportedByName: string | null;
  lastExportedAt: Date | null;
};

type ExportRow = {
  id: string;
  year_month: string;
  period_start: string;
  period_end: string;
  status: PayrollExportStatus;
  closed_by_name: string | null;
  closed_at: Date;
  close_note: string | null;
  reopened_by_name: string | null;
  reopened_at: Date | null;
  reopen_reason: string | null;
  close_count: number;
  snapshot: unknown;
  snapshot_hash: string;
  export_count: number;
  last_exported_by_name: string | null;
  last_exported_at: Date | null;
};

const toExport = (r: ExportRow): PayrollExport => ({
  id: r.id,
  yearMonth: r.year_month,
  periodStart: r.period_start,
  periodEnd: r.period_end,
  status: r.status,
  closedByName: r.closed_by_name,
  closedAt: r.closed_at,
  closeNote: r.close_note,
  reopenedByName: r.reopened_by_name,
  reopenedAt: r.reopened_at,
  reopenReason: r.reopen_reason,
  closeCount: r.close_count,
  snapshot: r.snapshot,
  snapshotHash: r.snapshot_hash,
  exportCount: r.export_count,
  lastExportedByName: r.last_exported_by_name,
  lastExportedAt: r.last_exported_at,
});

// その期間(開始日)の行。forUpdate はトランザクションの中で行を押さえる(2人が同時に締め・解除をしないように)
export const getPayrollExport = async (
  periodStart: string,
  { tx, forUpdate = false }: { tx?: TransactionSql; forUpdate?: boolean } = {}
): Promise<PayrollExport | null> => {
  const rows = await queryOn(
    tx,
    (sql: SqlLike) => sql<ExportRow[]>`
      select x.id, x.year_month, to_char(x.period_start, 'YYYY-MM-DD') as period_start,
             to_char(x.period_end, 'YYYY-MM-DD') as period_end, x.status,
             case when c.id is null then null else c.last_name || ' ' || c.first_name end as closed_by_name, x.closed_at, x.close_note,
             case when r.id is null then null else r.last_name || ' ' || r.first_name end as reopened_by_name, x.reopened_at, x.reopen_reason, x.close_count,
             x.snapshot, x.snapshot_hash, x.export_count,
             case when l.id is null then null else l.last_name || ' ' || l.first_name end as last_exported_by_name, x.last_exported_at
      from payroll_exports x
      left join employees c on c.id = x.closed_by
      left join employees r on r.id = x.reopened_by
      left join employees l on l.id = x.last_exported_by
      where x.period_start = ${periodStart}
      ${forUpdate ? sql`for update of x` : sql``}`
  );
  return rows[0] ? toExport(rows[0]) : null;
};

// EV-04 手順6 締め済みにする(行が無ければ作る。同時に作られたときは一意の制約で失敗する)
export const savePayrollClose = async (
  tx: TransactionSql,
  input: { period: PayrollPeriod; existing: boolean; note: string | null; snapshot: PayrollSnapshot; hash: string; by: string }
): Promise<void> => {
  const snapshotJson = JSON.stringify(input.snapshot);
  if (input.existing) {
    await tx`
      update payroll_exports
      set status = 'closed', closed_by = ${input.by}, closed_at = now(), close_note = ${input.note},
          close_count = close_count + 1, snapshot = ${snapshotJson}::jsonb, snapshot_hash = ${input.hash}, updated_by = ${input.by}
      where period_start = ${input.period.from}`;
    return;
  }
  await tx`
    insert into payroll_exports (year_month, period_start, period_end, status, closed_by, closed_at, close_note,
                                 close_count, snapshot, snapshot_hash, created_by, updated_by)
    values (${input.period.month}, ${input.period.from}, ${input.period.to}, 'closed', ${input.by}, now(), ${input.note},
            1, ${snapshotJson}::jsonb, ${input.hash}, ${input.by}, ${input.by})`;
};

// EV-06 手順3 締めを解除する(snapshot は消さない)
export const savePayrollReopen = async (tx: TransactionSql, periodStart: string, reason: string, by: string): Promise<void> => {
  await tx`
    update payroll_exports
    set status = 'reopened', reopened_by = ${by}, reopened_at = now(), reopen_reason = ${reason}, updated_by = ${by}
    where period_start = ${periodStart}`;
};

// EV-05 手順6 出力の記録。締め済みの行でなければ false
export const recordPayrollExport = async (periodStart: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update payroll_exports
      set export_count = export_count + 1, last_exported_by = ${by}, last_exported_at = now()
      where period_start = ${periodStart} and status = 'closed'
      returning id`
  );
  return rows.length > 0;
};

// CH-05 その期間に打刻(取り消していないもの)またはシフトがあるか
export const hasAttendanceIn = async (period: { from: string; to: string }): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ found: boolean }[]>`
      select exists (select 1 from time_punches where work_date between ${period.from} and ${period.to} and voided_at is null)
          or exists (select 1 from shifts where work_date between ${period.from} and ${period.to}) as found`
  );
  return rows[0]?.found ?? false;
};

// ---- 異常(attendance_alerts は E-02 の担当。読むだけ) ----

export type SeverityCounts = Record<AlertSeverity, number>;

// CH-03・CH-04 その期間の未対応の異常の件数(重さごと)
export const countOpenAlertsBySeverity = async (period: { from: string; to: string }, tx?: TransactionSql): Promise<SeverityCounts> => {
  const rows = await queryOn(
    tx,
    (sql: SqlLike) => sql<{ severity: AlertSeverity; count: number }[]>`
      select severity, count(*)::int as count from attendance_alerts
      where status = 'open' and work_date between ${period.from} and ${period.to}
      group by severity`
  );
  const counts: SeverityCounts = { fix: 0, legal: 0, info: 0 };
  for (const r of rows) counts[r.severity] = r.count;
  return counts;
};

type AlertListRow = {
  employee_id: string;
  employee_name: string;
  work_date: string;
  kind: string;
  severity: AlertSeverity;
  status: "open" | "dismissed";
  message: string;
};

// 期間の未対応(法令・確認)と、確認済みの異常(G02 の一覧・snapshot・備考)
const listPayrollAlerts = async (period: { from: string; to: string }, tx?: TransactionSql) => {
  const rows = await queryOn(
    tx,
    (sql: SqlLike) => sql<AlertListRow[]>`
      select a.employee_id, e.last_name || ' ' || e.first_name as employee_name, to_char(a.work_date, 'YYYY-MM-DD') as work_date,
             a.kind, a.severity, a.status, a.message
      from attendance_alerts a
      join employees e on e.id = a.employee_id
      where a.work_date between ${period.from} and ${period.to}
        and (a.status = 'dismissed' or (a.status = 'open' and a.severity in ('legal', 'info')))
      order by case a.severity when 'legal' then 1 else 2 end, a.work_date, e.employee_code, a.kind`
  );
  const valid = rows.flatMap((r) => (isAlertKind(r.kind) ? [{ ...r, kind: r.kind as AttendanceAlertKind }] : []));
  return {
    open: valid
      .filter((r) => r.status === "open")
      .map((r): SnapshotAlert => ({ employeeName: r.employee_name, workDate: r.work_date, kind: r.kind, severity: r.severity, message: r.message })),
    dismissed: valid.filter((r) => r.status === "dismissed").map((r) => ({ employeeId: r.employee_id, workDate: r.work_date, kind: r.kind })),
  };
};

// G02 に出す未対応(法令・確認)の一覧
export const listOpenReviewAlerts = async (period: { from: string; to: string }): Promise<SnapshotAlert[]> =>
  (await listPayrollAlerts(period)).open;

// ---- 集計のもと(03 の 0.3) ----

// CH-09 集計の対象の人。勤怠の対象で、在籍中の人と、期間の中に打刻・シフトがある人
const listPayrollEmployees = async (period: { from: string; to: string }): Promise<PayrollEmployee[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        employee_code: string;
        last_name: string;
        first_name: string;
        department: Department;
        employment_type: EmploymentType;
        is_active: boolean;
        home_location_id: string | null;
      }[]
    >`
      select e.id, e.employee_code, e.last_name, e.first_name, e.department, e.employment_type, e.is_active, e.home_location_id
      from employees e
      where e.uses_timecard
        and (e.is_active
             or exists (select 1 from time_punches p
                        where p.employee_id = e.id and p.work_date between ${period.from} and ${period.to} and p.voided_at is null)
             or exists (select 1 from shifts s where s.employee_id = e.id and s.work_date between ${period.from} and ${period.to}))
      order by e.employee_code`
  );
  return rows.map((r) => ({
    id: r.id,
    employeeCode: r.employee_code,
    lastName: r.last_name,
    firstName: r.first_name,
    department: r.department,
    employmentType: r.employment_type,
    isActive: r.is_active,
    homeLocationId: r.home_location_id,
  }));
};

// トランザクションの前に読んでおくもの(従業員・休業日・打刻の場所)
export type PayrollMasters = { employees: PayrollEmployee[]; closedDates: Set<string>; locations: WorkLocation[] };

export const loadPayrollMasters = async (period: PayrollPeriod): Promise<PayrollMasters> => {
  // DBの接続1本の決まりのため順番に読む
  const employees = await listPayrollEmployees(period);
  const calendar = await getCalendar(weekStartOf(period.from), period.to);
  const locations = await listActiveLocations();
  return {
    employees,
    closedDates: new Set([...calendar].filter(([, c]) => c.isClosed).map(([d]) => d)),
    locations,
  };
};

// 集計を作る(締めの確定のときは tx を渡し、トランザクションの中で打刻・シフト・異常を読む)
export const loadPayrollSummary = async (
  period: PayrollPeriod,
  today: string,
  masters: PayrollMasters,
  tx?: TransactionSql
): Promise<{ rows: PayrollRow[]; openAlerts: SnapshotAlert[] }> => {
  const ids = masters.employees.map((e) => e.id);
  const readFrom = weekStartOf(period.from);
  const punches = ids.length > 0 ? await listPunchesOfEmployees(readFrom, period.to, { employeeIds: ids, tx }) : [];
  const shifts = ids.length > 0 ? await listShifts(readFrom, period.to, { employeeIds: ids, tx }) : [];
  const alerts = await listPayrollAlerts(period, tx);
  const rows = buildPayrollSummary({
    period,
    today,
    employees: masters.employees,
    punches,
    shifts,
    closedDates: masters.closedDates,
    weeklyLegalMinutesOf: (e) => weeklyLegalMinutesFor({ ...e, usesTimecard: true, hiredOn: null }, masters.locations),
    dismissedAlerts: alerts.dismissed,
  });
  return { rows, openAlerts: alerts.open };
};
