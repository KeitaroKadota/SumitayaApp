// 勤怠のDBの読み書きのうち、E-02 のテーブル(shifts・attendance_alerts)と、全員分の打刻の読み込み(E-02 01 12章)。
// みるきーの workActualsServer.ts の役目(予定・実績を読んで従業員×日付の表にする)。サーバーだけで使う。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess を済ませている前提)。
// E-01 のホーム・自分の勤怠は getShiftsByDate・getOpenAlertMessagesByDate を使う(00_仮決め一覧 E-01-仮-11 の置き換え)。
import { query, queryOn, type SqlLike, type TransactionSql } from "@/utils/db";
import {
  isAlertKind,
  type AlertDetail,
  type AlertSeverity,
  type AttendanceAlertKind,
  type Shift,
  type ShiftKind,
} from "@/utils/attendance";
import type { Department } from "@/utils/masterRules";
import type { Punch, PunchKind } from "@/utils/timecard";
import { toPunch, type PunchRow } from "@/utils/timecardServer";

// ---- シフト(shifts) ----

export type ShiftRecord = Shift & {
  id: string;
  employeeId: string;
  workDate: string;
  locationId: string | null;
  note: string | null;
};

type ShiftRow = {
  id: string;
  employee_id: string;
  work_date: string;
  kind: ShiftKind;
  start_time: string | null;
  end_time: string | null;
  break_minutes: number;
  location_id: string | null;
  note: string | null;
};

const toShift = (r: ShiftRow): ShiftRecord => ({
  id: r.id,
  employeeId: r.employee_id,
  workDate: r.work_date,
  kind: r.kind,
  startTime: r.start_time,
  endTime: r.end_time,
  breakMinutes: r.break_minutes,
  locationId: r.location_id,
  note: r.note,
});

// 勤務日が from〜to のシフト。employeeIds を渡すとその人だけ
export const listShifts = async (
  from: string,
  to: string,
  { employeeIds, tx }: { employeeIds?: string[]; tx?: TransactionSql } = {}
): Promise<ShiftRecord[]> => {
  const rows = await queryOn(
    tx,
    (sql: SqlLike) => sql<ShiftRow[]>`
      select id, employee_id, to_char(work_date, 'YYYY-MM-DD') as work_date, kind,
             to_char(start_time, 'HH24:MI') as start_time, to_char(end_time, 'HH24:MI') as end_time,
             break_minutes, location_id, note
      from shifts
      where work_date between ${from} and ${to}
        ${employeeIds ? sql`and employee_id = any(${employeeIds}::uuid[])` : sql``}
      order by work_date`
  );
  return rows.map(toShift);
};

// 勤務日 "YYYY-MM-DD" → その日のシフト(E-01 のホーム・自分の勤怠)
export const getShiftsByDate = async (employeeId: string, from: string, to: string): Promise<Map<string, Shift>> => {
  const shifts = await listShifts(from, to, { employeeIds: [employeeId] });
  return new Map(shifts.map((s) => [s.workDate, s]));
};

export type ShiftInput = {
  kind: ShiftKind;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  locationId: string | null;
  note: string | null;
};

// EV-07 手順4 登録または上書き(同じ人・同じ日は上書き)
export const upsertShift = async (employeeId: string, workDate: string, input: ShiftInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      insert into shifts (employee_id, work_date, kind, start_time, end_time, break_minutes, location_id, note, created_by, updated_by)
      values (${employeeId}, ${workDate}, ${input.kind}, ${input.startTime}, ${input.endTime}, ${input.breakMinutes},
              ${input.locationId}, ${input.note}, ${by}, ${by})
      on conflict (employee_id, work_date) do update
      set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time,
          break_minutes = excluded.break_minutes, location_id = excluded.location_id, note = excluded.note,
          updated_by = excluded.updated_by`
  );
};

// EV-08 手順3 削除(シフトは予定なので記録を残さない)。消した件数
export const deleteShift = async (employeeId: string, workDate: string): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      delete from shifts where employee_id = ${employeeId} and work_date = ${workDate} returning id`
  );
  return rows.length;
};

// EV-09 手順3 まとめて登録(1つのトランザクション)。overwrite が false なら、すでにある日は飛ばす
export const bulkUpsertShifts = async (
  tx: TransactionSql,
  items: { employeeId: string; workDate: string }[],
  input: ShiftInput,
  overwrite: boolean,
  by: string
): Promise<{ inserted: number; overwritten: number; skipped: number }> => {
  let inserted = 0;
  let overwritten = 0;
  let skipped = 0;
  for (const item of items) {
    const [existing] = await tx<{ id: string }[]>`
      select id from shifts where employee_id = ${item.employeeId} and work_date = ${item.workDate} for update`;
    if (existing && !overwrite) {
      skipped += 1;
      continue;
    }
    await tx`
      insert into shifts (employee_id, work_date, kind, start_time, end_time, break_minutes, location_id, note, created_by, updated_by)
      values (${item.employeeId}, ${item.workDate}, ${input.kind}, ${input.startTime}, ${input.endTime}, ${input.breakMinutes},
              ${input.locationId}, ${input.note}, ${by}, ${by})
      on conflict (employee_id, work_date) do update
      set kind = excluded.kind, start_time = excluded.start_time, end_time = excluded.end_time,
          break_minutes = excluded.break_minutes, location_id = excluded.location_id, note = excluded.note,
          updated_by = excluded.updated_by`;
    if (existing) overwritten += 1;
    else inserted += 1;
  }
  return { inserted, overwritten, skipped };
};

// ---- 打刻(全員分。time_punches は E-01 の担当) ----

// 勤務日が from〜to の打刻(取り消したものを含む。時刻の順)。employeeIds を渡すとその人だけ
export const listPunchesOfEmployees = async (
  from: string,
  to: string,
  { employeeIds, tx }: { employeeIds?: string[]; tx?: TransactionSql } = {}
): Promise<(Punch & { employeeId: string; createdByName: string | null; voidedByName: string | null })[]> => {
  const rows = await queryOn(
    tx,
    (sql: SqlLike) => sql<(PunchRow & { employee_id: string; created_by_name: string | null; voided_by_name: string | null })[]>`
      select p.id, p.employee_id, p.kind, p.punched_at, to_char(p.work_date, 'YYYY-MM-DD') as work_date, p.source,
             p.location_id, p.location_status, p.distance_m, p.accuracy_m, p.note, p.voided_at, p.void_reason,
             case when c.id is null then null else c.last_name || ' ' || c.first_name end as created_by_name,
             case when v.id is null then null else v.last_name || ' ' || v.first_name end as voided_by_name
      from time_punches p
      left join employees c on c.id = p.created_by
      left join employees v on v.id = p.voided_by
      where p.work_date between ${from} and ${to}
        ${employeeIds ? sql`and p.employee_id = any(${employeeIds}::uuid[])` : sql``}
      order by p.punched_at, p.created_at`
  );
  return rows.flatMap((r) => {
    const p = toPunch(r);
    return p ? [{ ...p, employeeId: r.employee_id, createdByName: r.created_by_name, voidedByName: r.voided_by_name }] : [];
  });
};

// ---- 勤怠の対象の従業員(CH-14) ----

export type AttendanceEmployee = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  department: Department;
  isActive: boolean;
  hiredOn: string | null;
  retiredOn: string | null;
  homeLocationId: string | null;
};

// 勤怠の対象(uses_timecard)で、在籍中の人と、期間の中に打刻・シフトがある退職者。並びは所属・社員番号。employeeIds でその人だけ
export const listAttendanceEmployees = async (from: string, to: string, employeeIds?: string[]): Promise<AttendanceEmployee[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        employee_code: string;
        last_name: string;
        first_name: string;
        department: Department;
        is_active: boolean;
        hired_on: string | null;
        retired_on: string | null;
        home_location_id: string | null;
      }[]
    >`
      select e.id, e.employee_code, e.last_name, e.first_name, e.department, e.is_active,
             to_char(e.hired_on, 'YYYY-MM-DD') as hired_on, to_char(e.retired_on, 'YYYY-MM-DD') as retired_on, e.home_location_id
      from employees e
      where e.uses_timecard
        ${employeeIds ? sql`and e.id = any(${employeeIds}::uuid[])` : sql``}
        and (e.is_active
             or exists (select 1 from time_punches p where p.employee_id = e.id and p.work_date between ${from} and ${to})
             or exists (select 1 from shifts s where s.employee_id = e.id and s.work_date between ${from} and ${to}))
      order by case e.department when 'store' then 1 when 'factory' then 2 else 3 end, e.employee_code`
  );
  return rows.map((r) => ({
    id: r.id,
    employeeCode: r.employee_code,
    lastName: r.last_name,
    firstName: r.first_name,
    department: r.department,
    isActive: r.is_active,
    hiredOn: r.hired_on,
    retiredOn: r.retired_on,
    homeLocationId: r.home_location_id,
  }));
};

// ---- 勤怠の異常(attendance_alerts) ----

export type AlertStatus = "open" | "resolved" | "dismissed";
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = { open: "未対応", resolved: "解決", dismissed: "確認済み" };
export const isAlertStatus = (value: string): value is AlertStatus => value === "open" || value === "resolved" || value === "dismissed";

export type AttendanceAlert = {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  kind: AttendanceAlertKind;
  severity: AlertSeverity;
  message: string;
  detail: AlertDetail;
  status: AlertStatus;
  resolutionNote: string | null;
  resolvedByName: string | null;
  resolvedAt: Date | null;
  lastDetectedAt: Date;
};

type AlertRow = {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  kind: string;
  severity: AlertSeverity;
  message: string;
  detail: AlertDetail | null;
  status: AlertStatus;
  resolution_note: string | null;
  resolved_by_name: string | null;
  resolved_at: Date | null;
  last_detected_at: Date;
};

const toAlert = (r: AlertRow): AttendanceAlert | null =>
  isAlertKind(r.kind)
    ? {
        id: r.id,
        employeeId: r.employee_id,
        employeeName: r.employee_name,
        workDate: r.work_date,
        kind: r.kind,
        severity: r.severity,
        message: r.message,
        detail: r.detail ?? {},
        status: r.status,
        resolutionNote: r.resolution_note,
        resolvedByName: r.resolved_by_name,
        resolvedAt: r.resolved_at,
        lastDetectedAt: r.last_detected_at,
      }
    : null;

export type AlertFilter = {
  status?: AlertStatus | null;
  severity?: AlertSeverity | null;
  employeeId?: string | null;
  from?: string;
  to?: string;
  kinds?: readonly AttendanceAlertKind[];
};

const alertWhere = (sql: SqlLike, f: AlertFilter) => sql`
  true
  ${f.status ? sql`and a.status = ${f.status}` : sql``}
  ${f.severity ? sql`and a.severity = ${f.severity}` : sql``}
  ${f.employeeId ? sql`and a.employee_id = ${f.employeeId}` : sql``}
  ${f.from ? sql`and a.work_date >= ${f.from}` : sql``}
  ${f.to ? sql`and a.work_date <= ${f.to}` : sql``}
  ${f.kinds ? sql`and a.kind = any(${[...f.kinds]}::text[])` : sql``}`;

const selectAlerts = (sql: SqlLike, f: AlertFilter, tail = sql``) => sql<AlertRow[]>`
  select a.id, a.employee_id, e.last_name || ' ' || e.first_name as employee_name,
         to_char(a.work_date, 'YYYY-MM-DD') as work_date, a.kind, a.severity, a.message, a.detail, a.status,
         a.resolution_note, case when r.id is null then null else r.last_name || ' ' || r.first_name end as resolved_by_name,
         a.resolved_at, a.last_detected_at
  from attendance_alerts a
  join employees e on e.id = a.employee_id
  left join employees r on r.id = a.resolved_by
  where ${alertWhere(sql, f)}
  ${tail}`;

// 重さ(要修正 → 法令 → 確認)、日付の新しい順(EV-10 手順2)
const ALERT_ORDER = (sql: SqlLike) =>
  sql`order by case a.severity when 'fix' then 1 when 'legal' then 2 else 3 end, a.work_date desc, e.employee_code, a.kind`;

export const listAlerts = async (f: AlertFilter, page?: { limit: number; offset: number }): Promise<AttendanceAlert[]> => {
  const rows = await query((sql) =>
    selectAlerts(sql, f, page ? sql`${ALERT_ORDER(sql)} limit ${page.limit} offset ${page.offset}` : ALERT_ORDER(sql))
  );
  return rows.map(toAlert).filter((a): a is AttendanceAlert => a !== null);
};

export const countAlerts = async (f: AlertFilter): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ count: number }[]>`select count(*)::int as count from attendance_alerts a where ${alertWhere(sql, f)}`
  );
  return rows[0]?.count ?? 0;
};

export const getAlert = async (id: string): Promise<AttendanceAlert | null> => {
  const rows = await query((sql) => selectAlerts(sql, {}, sql`and a.id = ${id}`));
  return rows.map(toAlert)[0] ?? null;
};

// 勤務日 "YYYY-MM-DD" → 未対応の異常の文(E-01 の自分の勤怠)。月の時間外は期間の最初の日に付く
export const getOpenAlertMessagesByDate = async (
  employeeId: string,
  from: string,
  to: string
): Promise<Map<string, string[]>> => {
  const alerts = await listAlerts({ status: "open", employeeId, from, to });
  const map = new Map<string, string[]>();
  for (const a of alerts) map.set(a.workDate, [...(map.get(a.workDate) ?? []), a.message]);
  return map;
};

// EV-05 手順3 確認済みにする。未対応で、重さが法令・確認のものだけ(CH-13)。できたら true
export const dismissAlert = async (id: string, note: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      update attendance_alerts
      set status = 'dismissed', resolution_note = ${note}, resolved_by = ${by}, resolved_at = now()
      where id = ${id} and status = 'open' and severity in ('legal', 'info')
      returning id`
  );
  return rows.length > 0;
};

// 最後にチェックした時刻(毎朝のチェックが成功した時刻。G01 の集計の帯)
export const lastAttendanceCheckAt = async (jobName: string): Promise<Date | null> => {
  const rows = await query(
    (sql) => sql<{ finished_at: Date }[]>`
      select finished_at from cron_runs
      where job_name = ${jobName} and status = 'succeeded' and finished_at is not null
      order by finished_at desc limit 1`
  );
  return rows[0]?.finished_at ?? null;
};

// ---- 打刻の修正(E-02 01 8章。取り消し＋追加で記録を残す。打刻の行は書き換えない) ----

// EV-04 手順3・5 有効な打刻を取り消す。その人・その勤務日の有効な打刻でなければ false
export const voidPunch = async (
  tx: TransactionSql,
  input: { punchId: string; employeeId: string; workDate: string; reason: string; by: string }
): Promise<boolean> => {
  const rows = await tx<{ id: string }[]>`
    update time_punches
    set voided_at = now(), voided_by = ${input.by}, void_reason = ${input.reason}, updated_by = ${input.by}
    where id = ${input.punchId} and employee_id = ${input.employeeId} and work_date = ${input.workDate} and voided_at is null
    returning id`;
  return rows.length > 0;
};

// EV-03 手順5 管理者が打刻を追加する(source = manual、位置は判定なし、理由はメモ)
export const insertManualPunch = async (
  tx: TransactionSql,
  input: { employeeId: string; kind: PunchKind; punchedAt: Date; workDate: string; reason: string; by: string }
): Promise<void> => {
  await tx`
    insert into time_punches (employee_id, kind, punched_at, work_date, source, location_status, note, created_by, updated_by)
    values (${input.employeeId}, ${input.kind}, ${input.punchedAt}, ${input.workDate}, 'manual', 'not_checked',
            ${input.reason}, ${input.by}, ${input.by})`;
};
