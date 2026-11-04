// 打刻(time_punches)・打刻場所(work_locations)の読み書き(E-01 01 7章・8章)。サーバーだけで使う。
import { query, queryOn, type SqlLike, type TransactionSql } from "@/utils/db";
import { DEFAULT_WEEKLY_LEGAL_MINUTES } from "@/utils/attendanceRules";
import type { LocationJudgement, LocationStatus, PunchPosition, WorkLocation, WorkLocationKind } from "@/utils/punchLocation";
import { isPunchKind, type Punch, type PunchKind } from "@/utils/timecard";

// 打刻に関係する本人の情報(employees)
export type TimecardEmployee = {
  id: string;
  isActive: boolean;
  usesTimecard: boolean;
  hiredOn: string | null;
  homeLocationId: string | null;
};

// CH-08 勤怠の対象・在籍中
export const isTimecardTarget = (employee: TimecardEmployee | null): employee is TimecardEmployee =>
  !!employee && employee.isActive && employee.usesTimecard;

export const NOT_TIMECARD_TARGET = "打刻の対象になっていません。管理者にお伝えください。";

export const getTimecardEmployee = async (id: string): Promise<TimecardEmployee | null> => {
  const rows = await query(
    (sql) => sql<{ id: string; is_active: boolean; uses_timecard: boolean; hired_on: string | null; home_location_id: string | null }[]>`
      select id, is_active, uses_timecard, to_char(hired_on, 'YYYY-MM-DD') as hired_on, home_location_id
      from employees where id = ${id}`
  );
  const r = rows[0];
  return r
    ? { id: r.id, isActive: r.is_active, usesTimecard: r.uses_timecard, hiredOn: r.hired_on, homeLocationId: r.home_location_id }
    : null;
};

type LocationRow = {
  id: string;
  name: string;
  kind: WorkLocationKind;
  latitude: string | null;
  longitude: string | null;
  radius_m: number;
  weekly_legal_minutes: number;
};

// 有効な打刻場所(並び順)
export const listActiveLocations = async (tx?: TransactionSql): Promise<WorkLocation[]> => {
  const rows = await queryOn(
    tx,
    (sql) => sql<LocationRow[]>`
      select id, name, kind, latitude::text as latitude, longitude::text as longitude, radius_m, weekly_legal_minutes
      from work_locations where is_active order by sort_order, name`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    latitude: r.latitude === null ? null : Number(r.latitude),
    longitude: r.longitude === null ? null : Number(r.longitude),
    radiusM: r.radius_m,
    weeklyLegalMinutes: r.weekly_legal_minutes,
  }));
};

// 週の法定労働時間(その人の主な勤務場所の値。無ければ定数。E-02 03 の 0.2)
export const weeklyLegalMinutesFor = (employee: TimecardEmployee, locations: WorkLocation[]): number =>
  locations.find((l) => l.id === employee.homeLocationId)?.weeklyLegalMinutes ?? DEFAULT_WEEKLY_LEGAL_MINUTES;

export type PunchRow = {
  id: string;
  kind: string;
  punched_at: Date;
  work_date: string;
  source: "app" | "manual";
  location_id: string | null;
  location_status: LocationStatus;
  distance_m: number | null;
  accuracy_m: number | null;
  note: string | null;
  voided_at: Date | null;
  void_reason: string | null;
};

export const toPunch = (r: PunchRow): Punch | null =>
  isPunchKind(r.kind)
    ? {
        id: r.id,
        kind: r.kind,
        punchedAt: r.punched_at,
        workDate: r.work_date,
        source: r.source,
        locationId: r.location_id,
        locationStatus: r.location_status,
        distanceM: r.distance_m,
        accuracyM: r.accuracy_m,
        note: r.note,
        voidedAt: r.voided_at,
        voidReason: r.void_reason,
      }
    : null;

// 本人の、勤務日が from〜to の打刻(時刻の順)。includeVoided で取り消した行も含める(自分の勤怠の明細)
export const listPunches = async (
  employeeId: string,
  from: string,
  to: string,
  options: { includeVoided?: boolean; tx?: TransactionSql } = {}
): Promise<Punch[]> => {
  const includeVoided = options.includeVoided ?? false;
  const rows = await queryOn(
    options.tx,
    (sql: SqlLike) => sql<PunchRow[]>`
      select id, kind, punched_at, to_char(work_date, 'YYYY-MM-DD') as work_date, source, location_id, location_status,
             distance_m, accuracy_m, note, voided_at, void_reason
      from time_punches
      where employee_id = ${employeeId} and work_date between ${from} and ${to}
        and (${includeVoided} or voided_at is null)
      order by punched_at, created_at`
  );
  return rows.map(toPunch).filter((p): p is Punch => p !== null);
};

// EV-03 手順5: 本人の従業員の行を押さえる(同時に2回届いても順番に処理するため)
export const lockEmployee = async (tx: TransactionSql, employeeId: string): Promise<void> => {
  await tx`select id from employees where id = ${employeeId} for update`;
};

// EV-03 手順10: 打刻を1行登録する(本人がスマホで打刻)
export const insertAppPunch = async (
  tx: TransactionSql,
  input: {
    employeeId: string;
    kind: PunchKind;
    punchedAt: Date;
    workDate: string;
    position: PunchPosition | null;
    judgement: LocationJudgement;
  }
): Promise<void> => {
  const { position, judgement } = input;
  await tx`
    insert into time_punches (
      employee_id, kind, punched_at, work_date, source, location_id, location_status,
      latitude, longitude, accuracy_m, distance_m, created_by, updated_by
    ) values (
      ${input.employeeId}, ${input.kind}, ${input.punchedAt}, ${input.workDate}, 'app', ${judgement.locationId},
      ${judgement.status}, ${position ? position.latitude : null}, ${position ? position.longitude : null},
      ${position?.accuracyM ?? null}, ${judgement.distanceM}, ${input.employeeId}, ${input.employeeId}
    )`;
};
