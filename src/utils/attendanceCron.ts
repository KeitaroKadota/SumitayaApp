// 勤怠の異常のチェックと登録(E-02 03 の 0.3・EV-12、04 CH-13・CH-14)。サーバーだけで使う。
// 毎朝の定期実行(/api/cron/daily の1番目。src/utils/cron.ts の DAILY_JOBS)と、管理者が打刻・シフトを直したときに呼ぶ。
// 判定は src/utils/attendance.ts の純粋な関数(detectPeriodAlerts)で行い、ここでは読み込み・登録・タスクの発行だけを行う。
import {
  OVERTIME_ALERT_KINDS,
  ALERT_KIND_LABELS,
  hoursMinutes,
  stableDetail,
  weekStartOf,
  detectPeriodAlerts,
  type AttendanceAlertKind,
  type DetectedAlert,
  type Shift,
} from "@/utils/attendance";
import {
  OVERTIME_MONTHLY_LIMIT_MINUTES,
  TASK_ALERT_KINDS,
  TASK_DUE_DAYS,
  TASK_DUE_DAYS_DEFAULT,
} from "@/utils/attendanceRules";
import { listAttendanceEmployees, listPunchesOfEmployees, listShifts, type AttendanceEmployee } from "@/utils/attendanceServer";
import { query, transaction } from "@/utils/db";
import { formatDateShort } from "@/utils/format";
import { addDays, getCalendar } from "@/utils/holidays";
import { todayJST } from "@/utils/jst";
import { isPayrollClosed, payrollPeriodOf, shiftPayrollPeriod, type PayrollPeriod } from "@/utils/payrollPeriod";
import type { Punch } from "@/utils/timecard";
import { completeTasksBySource, createTask } from "@/utils/tasks";
import { listActiveLocations, weeklyLegalMinutesFor } from "@/utils/timecardServer";

// cron_runs.job_name(英小文字・数字・_。00_共通設計 7.1 の「E-02 勤怠のチェック」)
export const ATTENDANCE_CHECK_JOB = "attendance_check";

const SOURCE_FEATURE = "E-02";

export type CheckCounts = { created: number; resolved: number; open: number; taskErrors: number };
const emptyCounts = (): CheckCounts => ({ created: 0, resolved: 0, open: 0, taskErrors: 0 });
const addCounts = (a: CheckCounts, b: CheckCounts): CheckCounts => ({
  created: a.created + b.created,
  resolved: a.resolved + b.resolved,
  open: a.open + b.open,
  taskErrors: a.taskErrors + b.taskErrors,
});

type ExistingAlert = { id: string; work_date: string; kind: string; status: "open" | "resolved" | "dismissed"; detail: unknown };
type OpenAlert = { id: string; workDate: string; kind: AttendanceAlertKind; message: string; detail: DetectedAlert["detail"] };

// ---- タスクの内容(03「タスクの内容」) ----

const monthLabel = (period: PayrollPeriod) => `${Number(period.month.slice(5))}月分`;

type TaskContent = { title: string; body: string };

const selfTask = (alert: OpenAlert, period: PayrollPeriod): TaskContent | null => {
  const day = formatDateShort(alert.workDate);
  const actual = typeof alert.detail.actual === "number" ? alert.detail.actual : null;
  const planned = typeof alert.detail.planned === "number" ? alert.detail.planned : null;
  const limit = hoursMinutes(OVERTIME_MONTHLY_LIMIT_MINUTES);
  switch (alert.kind) {
    case "missing_clock_out":
      return { title: `${day}の退勤が打刻されていません。正しい時刻を管理者にお伝えください。`, body: alert.message };
    case "missing_break_end":
      return { title: `${day}の休憩の終わりが打刻されていません。正しい時刻を管理者にお伝えください。`, body: alert.message };
    case "no_punch":
      return { title: `${day}はシフトがありますが、打刻がありません。出勤していた場合は管理者にお伝えください。`, body: alert.message };
    case "break_short": {
      const rest = alert.detail.break;
      const required = alert.detail.required;
      return {
        title: `${day}の休憩が足りません（${rest}分／必要${required}分）。休憩を取れなかった場合は管理者にお伝えください。`,
        body: alert.message,
      };
    }
    case "overtime_warning":
    case "overtime_over": {
      const value = alert.detail.basis === "planned" && planned !== null ? planned : (actual ?? 0);
      const prefix = alert.detail.basis === "planned" ? "このまま予定どおり働くと、" : "";
      return {
        title: `${prefix}${monthLabel(period)}の時間外が ${hoursMinutes(value)} です（上限 ${limit}）。予定の見直しを管理者と相談してください。`,
        body: alert.message,
      };
    }
    default:
      return null;
  }
};

const adminTask = (alert: OpenAlert, employee: AttendanceEmployee, period: PayrollPeriod): TaskContent => {
  const name = `${employee.lastName} ${employee.firstName}さん`;
  if (alert.kind === "overtime_warning" || alert.kind === "overtime_over") {
    const value = alert.detail.basis === "planned" ? alert.detail.planned : alert.detail.actual;
    return {
      title: `時間外の注意：${name} ${monthLabel(period)} ${hoursMinutes(typeof value === "number" ? value : 0)}（上限 ${hoursMinutes(OVERTIME_MONTHLY_LIMIT_MINUTES)}）`,
      body: alert.message,
    };
  }
  return {
    title: `勤怠の確認：${name} ${formatDateShort(alert.workDate)} ${ALERT_KIND_LABELS[alert.kind]}`,
    body: alert.message,
  };
};

const isOvertime = (kind: AttendanceAlertKind) => OVERTIME_ALERT_KINDS.includes(kind);

// 03 の 0.3 手順6 タスクを発行する。失敗しても例外にせず、失敗の数を返す(次のチェックで発行し直す)
const issueTasks = async (
  alert: OpenAlert,
  employee: AttendanceEmployee,
  period: PayrollPeriod,
  today: string,
  only?: Set<string>
): Promise<number> => {
  const targets = TASK_ALERT_KINDS[alert.kind] ?? [];
  const dueDate = addDays(today, TASK_DUE_DAYS[alert.kind] ?? TASK_DUE_DAYS_DEFAULT);
  let errors = 0;
  for (const target of targets) {
    const type = target === "self" ? "attendance_alert_self" : "attendance_alert";
    if (only && !only.has(type)) continue;
    try {
      if (target === "self") {
        const content = selfTask(alert, period);
        if (!content) continue;
        await createTask({
          type,
          ...content,
          assigneeEmployeeId: employee.id,
          dueDate,
          sourceFeature: SOURCE_FEATURE,
          sourceId: alert.id,
          // 本人あては E-01 の自分の勤怠(その月)
          linkUrl: `/timecard?month=${(isOvertime(alert.kind) ? period.to : alert.workDate).slice(0, 7)}`,
        });
      } else {
        await createTask({
          type,
          ...adminTask(alert, employee, period),
          assigneeFeatureKey: "attendance_admin",
          dueDate,
          sourceFeature: SOURCE_FEATURE,
          sourceId: alert.id,
          // 管理者あては G02(その人・その日)。月の時間外は G01
          linkUrl: isOvertime(alert.kind)
            ? `/admin/attendance?month=${period.month}`
            : `/admin/attendance?month=${period.month}&edit=${employee.id}:${alert.workDate}`,
        });
      }
    } catch (e) {
      errors += 1;
      console.error("勤怠の異常のタスクを発行できませんでした:", e instanceof Error ? e.message : e);
    }
  }
  return errors;
};

// ---- 03 の 0.3 手順4・5 異常の登録(CH-13) ----

const syncAlerts = async (
  employeeId: string,
  period: PayrollPeriod,
  checkedTo: string,
  detected: DetectedAlert[]
): Promise<{ reopened: OpenAlert[]; resolvedIds: string[]; open: OpenAlert[] }> =>
  await transaction(async (tx) => {
    const overtimeKinds = [...OVERTIME_ALERT_KINDS];
    const existing = await tx<ExistingAlert[]>`
      select id, to_char(work_date, 'YYYY-MM-DD') as work_date, kind, status, detail
      from attendance_alerts
      where employee_id = ${employeeId}
        and ((kind <> all(${overtimeKinds}::text[]) and work_date between ${period.from} and ${checkedTo})
             or (kind = any(${overtimeKinds}::text[]) and work_date = ${period.from}))
      for update`;
    const byKey = new Map(existing.map((r) => [`${r.work_date}|${r.kind}`, r]));
    const reopened: OpenAlert[] = [];
    const open: OpenAlert[] = [];
    const seen = new Set<string>();

    for (const a of detected) {
      const key = `${a.workDate}|${a.kind}`;
      seen.add(key);
      const detailJson = JSON.stringify(a.detail);
      const row = byKey.get(key);
      if (!row) {
        // 新規 → open で登録し、タスクを発行
        const [inserted] = await tx<{ id: string }[]>`
          insert into attendance_alerts (employee_id, work_date, kind, severity, message, detail, status)
          values (${employeeId}, ${a.workDate}, ${a.kind}, ${a.severity}, ${a.message}, ${detailJson}::jsonb, 'open')
          returning id`;
        const item = { id: inserted.id, workDate: a.workDate, kind: a.kind, message: a.message, detail: a.detail };
        reopened.push(item);
        open.push(item);
        continue;
      }
      const sameDetail = stableDetail(row.detail) === stableDetail(a.detail);
      if (row.status === "dismissed" && sameDetail) {
        // 確認済みは、同じ内容のあいだは戻さない
        await tx`update attendance_alerts set last_detected_at = now() where id = ${row.id}`;
        continue;
      }
      if (row.status === "open") {
        // 内容が変わった・変わらない → 文と内容を新しくする(タスクは新しく出さない)
        await tx`
          update attendance_alerts
          set severity = ${a.severity}, message = ${a.message}, detail = ${detailJson}::jsonb, last_detected_at = now()
          where id = ${row.id}`;
        open.push({ id: row.id, workDate: a.workDate, kind: a.kind, message: a.message, detail: a.detail });
        continue;
      }
      // 再発(resolved)・確認済みで内容が変わった(dismissed) → open に戻し、タスクを発行し直す
      await tx`
        update attendance_alerts
        set status = 'open', severity = ${a.severity}, message = ${a.message}, detail = ${detailJson}::jsonb,
            resolution_note = null, resolved_by = null, resolved_at = null, last_detected_at = now()
        where id = ${row.id}`;
      const item = { id: row.id, workDate: a.workDate, kind: a.kind, message: a.message, detail: a.detail };
      reopened.push(item);
      open.push(item);
    }

    // 直った → resolved
    const resolvedIds = existing.filter((r) => r.status === "open" && !seen.has(`${r.work_date}|${r.kind}`)).map((r) => r.id);
    if (resolvedIds.length > 0) {
      await tx`
        update attendance_alerts set status = 'resolved', resolved_at = now(), resolved_by = null
        where id = any(${resolvedIds}::uuid[])`;
    }
    return { reopened, resolvedIds, open };
  });

// 1期間・何人かのチェック(読み込みは期間ごとに1回ずつ)
const checkPeriod = async (employees: AttendanceEmployee[], period: PayrollPeriod, today: string): Promise<CheckCounts> => {
  const counts = emptyCounts();
  if (employees.length === 0) return counts;
  const readFrom = weekStartOf(period.from);
  const ids = employees.map((e) => e.id);
  // DBの接続1本の決まりのため順番に読む
  const punches = await listPunchesOfEmployees(readFrom, period.to, { employeeIds: ids });
  const shifts = await listShifts(readFrom, period.to, { employeeIds: ids });
  const calendar = await getCalendar(readFrom, period.to);
  const locations = await listActiveLocations();
  const closedDays = new Map([...calendar].filter(([, c]) => c.isClosed).map(([d, c]) => [d, c.name]));
  const locationKindOf = (id: string | null) => locations.find((l) => l.id === id)?.kind ?? null;

  for (const employee of employees) {
    const punchesByDate = new Map<string, Punch[]>();
    for (const p of punches) {
      if (p.employeeId !== employee.id) continue;
      punchesByDate.set(p.workDate, [...(punchesByDate.get(p.workDate) ?? []), p]);
    }
    const shiftsByDate = new Map<string, Shift>(shifts.filter((s) => s.employeeId === employee.id).map((s) => [s.workDate, s]));
    const result = detectPeriodAlerts({
      period,
      today,
      punchesByDate,
      shiftsByDate,
      closedDays,
      weeklyLegalMinutes: weeklyLegalMinutesFor({ ...employee, usesTimecard: true }, locations),
      hiredOn: employee.hiredOn,
      retiredOn: employee.retiredOn,
      locationKindOf,
    });

    // 手順4・5
    const { reopened, resolvedIds, open } = await syncAlerts(employee.id, period, result.checkedTo, result.alerts);
    counts.created += reopened.length;
    counts.resolved += resolvedIds.length;
    counts.open += open.length;

    // 手順6: 新規・再発はタスクを発行。それ以外の未対応で、タスクが1件も無いもの(前に発行に失敗したもの)も発行し直す
    for (const alert of reopened) counts.taskErrors += await issueTasks(alert, employee, period, today);
    const reopenedIds = new Set(reopened.map((a) => a.id));
    const others = open.filter((a) => !reopenedIds.has(a.id) && TASK_ALERT_KINDS[a.kind]);
    if (others.length > 0) {
      const issued = await query(
        (sql) => sql<{ source_id: string; task_type: string }[]>`
          select source_id, task_type from tasks
          where source_feature = ${SOURCE_FEATURE} and source_id = any(${others.map((a) => a.id)}::text[])`
      );
      const has = new Set(issued.map((t) => `${t.source_id}|${t.task_type}`));
      for (const alert of others) {
        const missing = new Set(
          ["attendance_alert_self", "attendance_alert"].filter((type) => !has.has(`${alert.id}|${type}`))
        );
        if (missing.size > 0) counts.taskErrors += await issueTasks(alert, employee, period, today, missing);
      }
    }
    // 直った異常のタスクを完了にする
    for (const id of resolvedIds) {
      try {
        await completeTasksBySource(SOURCE_FEATURE, id);
      } catch (e) {
        counts.taskErrors += 1;
        console.error("勤怠の異常のタスクを完了にできませんでした:", e instanceof Error ? e.message : e);
      }
    }
  }
  return counts;
};

// 締めていない期間だけを残す(CH-14・CH-13 の「締め済みの期間の行は変えない」)
const openPeriods = async (periods: PayrollPeriod[]): Promise<PayrollPeriod[]> => {
  const unique = [...new Map(periods.map((p) => [p.from, p])).values()].sort((a, b) => a.from.localeCompare(b.from));
  const result: PayrollPeriod[] = [];
  for (const p of unique) if (!(await isPayrollClosed(p.from))) result.push(p);
  return result;
};

// EV-12 毎朝の定期チェック。締めていない給与期間(前の期間と今の期間の最大2つ)の、前の日までの全員を対象にする
export const runAttendanceCheck = async (today: string = todayJST()): Promise<Record<string, unknown>> => {
  const current = payrollPeriodOf(today);
  const periods = await openPeriods([shiftPayrollPeriod(current, -1), current]);
  let counts = emptyCounts();
  for (const period of periods) {
    const employees = await listAttendanceEmployees(weekStartOf(period.from), period.to);
    counts = addCounts(counts, await checkPeriod(employees, period, today));
  }
  return { periods: periods.map((p) => p.month), ...counts };
};

// E-03 の EV-03 手順2 締める前に、その期間の全員をチェックし直す(締め済みの期間は何もしない)
export const checkAttendancePeriod = async (period: PayrollPeriod, today: string = todayJST()): Promise<CheckCounts> => {
  if ((await openPeriods([period])).length === 0) return emptyCounts();
  const employees = await listAttendanceEmployees(weekStartOf(period.from), period.to);
  return await checkPeriod(employees, period, today);
};

// EV-03・EV-04・EV-07〜EV-09 手順「チェックし直す」: その人の、その日を含む週と給与期間
export const recheckAttendance = async (employeeIds: string[], dates: string[], today: string = todayJST()): Promise<void> => {
  const periods: PayrollPeriod[] = [];
  for (const date of dates) {
    const weekStart = weekStartOf(date);
    periods.push(payrollPeriodOf(weekStart), payrollPeriodOf(date), payrollPeriodOf(addDays(weekStart, 6)));
  }
  for (const period of await openPeriods(periods)) {
    const employees = await listAttendanceEmployees(weekStartOf(period.from), period.to, employeeIds);
    await checkPeriod(employees, period, today);
  }
};
