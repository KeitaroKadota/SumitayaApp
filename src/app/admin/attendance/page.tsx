// G01 勤怠の一覧(月の表)と G02 日の詳細・打刻の修正(モーダル)。E-02 03 の EV-01・EV-02。機能キー attendance_admin。
// みるきーの PerformanceSection.tsx の作り(縦＝従業員・横＝日付、上段＝予定・下段＝実績、上の集計の帯)を流用した。
import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { SEVERITY_LABELS, SHIFT_KIND_LABELS, minutesToHHmm } from "@/utils/attendance";
import { OVERTIME_MONTHLY_LIMIT_MINUTES, OVERTIME_WARNING_MINUTES } from "@/utils/attendanceRules";
import { ATTENDANCE_CHECK_JOB } from "@/utils/attendanceCron";
import { lastAttendanceCheckAt, type AttendanceAlert } from "@/utils/attendanceServer";
import { formatDate, formatDateShort, formatDateTime, formatDuration, formatQuantity, formatYearMonth } from "@/utils/format";
import { addDays } from "@/utils/holidays";
import { todayJST, weekdayOfDateStr } from "@/utils/jst";
import { DEPARTMENTS } from "@/utils/masterRules";
import { isPayrollClosed, shiftPayrollPeriod, payrollPeriodOf, type PayrollPeriod } from "@/utils/payrollPeriod";
import { LOCATION_KIND_LABELS, locationLabel } from "@/utils/punchLocation";
import { PUNCH_KIND_LABELS } from "@/utils/timecard";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { addPunchAction, dismissAlertAction, voidPunchAction } from "./actions";
import { loadMonth, type EmployeeMonth } from "./attendanceData";
import { ALERT_MARKS, SEVERITY_TONES, actualCellText, attendanceUrl, parseCellParam, parsePeriodParam, shiftCellText, shiftsUrl } from "./attendanceView";
import { AddPunchForm, DismissAlertForm, VoidPunchForm } from "./PunchForms";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const DONE_MESSAGES: Record<string, { tone: "success" | "warning"; text: string }> = {
  added: { tone: "success", text: "打刻を追加しました。" },
  voided: { tone: "success", text: "取り消しました。" },
  dismissed: { tone: "success", text: "確認済みにしました。" },
  added_nocheck: { tone: "warning", text: "保存しました。チェックは次の定期チェックで行います。" },
  voided_nocheck: { tone: "warning", text: "保存しました。チェックは次の定期チェックで行います。" },
};

const navLabel = (p: PayrollPeriod) => `${Number(p.month.slice(5))}月`;
const yearMonthLabel = (p: PayrollPeriod) => formatYearMonth(Number(p.month.slice(0, 4)), Number(p.month.slice(5)));

// 時間外の合計の文字の色(注意の線・上限。CH-04)
const overtimeTone = (minutes: number) =>
  minutes > OVERTIME_MONTHLY_LIMIT_MINUTES ? "text-danger font-bold" : minutes > OVERTIME_WARNING_MINUTES ? "text-warning font-bold" : "";

function DayCell({
  row,
  date,
  alerts,
  month,
}: {
  row: EmployeeMonth;
  date: string;
  alerts: AttendanceAlert[];
  month: string;
}) {
  const day = row.days.get(date)!;
  const punches = row.punchesByDate.get(date) ?? [];
  const edited = punches.some((p) => p.source === "manual" || p.voidedAt);
  const marks = [...new Set(alerts.map((a) => ALERT_MARKS[a.kind]))];
  const worst = alerts.some((a) => a.severity === "fix") ? "fix" : alerts.some((a) => a.severity === "legal") ? "legal" : alerts.length ? "info" : null;
  const bg = worst === "fix" ? "bg-danger-soft" : worst === "legal" ? "bg-warning-soft" : worst === "info" ? "bg-canvas" : "";
  const name = `${row.employee.lastName} ${row.employee.firstName}`;
  return (
    <td className={`border-b border-l border-line p-0 align-top ${bg}`}>
      <Link
        href={attendanceUrl(month, `&edit=${row.employee.id}:${date}`)}
        scroll={false}
        aria-label={`${name}さん ${formatDateShort(date)}の詳細`}
        className="flex min-h-14 min-w-24 flex-col gap-0.5 px-1.5 py-1 text-xs tabular-nums hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span className="text-ink-muted">{shiftCellText(row.shiftsByDate.get(date))}</span>
        <span>
          {actualCellText(day)}
          {day.blocks.length >= 2 && <span className="ml-1 font-bold">{day.blocks.length}回</span>}
        </span>
        {(marks.length > 0 || edited) && (
          <span className="flex flex-wrap gap-0.5">
            {marks.map((m) => (
              <span key={m} className={`font-bold ${worst === "fix" ? "text-danger" : "text-warning"}`}>
                {m}
              </span>
            ))}
            {edited && <Badge tone="neutral">修正</Badge>}
          </span>
        )}
      </Link>
    </td>
  );
}

// G02 日の詳細・打刻の修正
async function DayDetail({
  row,
  date,
  month,
  alerts,
  overtimeMinutes,
  locationsById,
  closed,
  done,
}: {
  row: EmployeeMonth;
  date: string;
  month: string;
  alerts: AttendanceAlert[];
  overtimeMinutes: number;
  locationsById: Map<string, { name: string; kind: "store" | "factory" }>;
  closed: boolean;
  done: string | null;
}) {
  const day = row.days.get(date)!;
  const shift = row.shiftsByDate.get(date) ?? null;
  const punches = row.punchesByDate.get(date) ?? [];
  const id = row.employee.id;
  const dash = (v: number | null) => (v === null ? "—" : formatDuration(v, "table"));
  const shiftText = !shift
    ? "予定なし"
    : shift.startTime && shift.endTime
      ? `${shift.startTime}〜${shift.endTime}（${shift.kind === "paid_leave_half" ? "半休・" : ""}休憩${shift.breakMinutes}分${shift.locationId && locationsById.get(shift.locationId) ? `・${LOCATION_KIND_LABELS[locationsById.get(shift.locationId)!.kind]}` : ""}）`
      : SHIFT_KIND_LABELS[shift.kind];
  const message = done ? DONE_MESSAGES[done] : null;

  return (
    <div className="flex flex-col gap-4 text-sm">
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {closed && <Alert tone="warning">この期間は締め済みです。直すときは給与CSVの画面で締めを解除してください。</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <p>
          <span className="font-bold">予定</span>　{shiftText}
        </p>
        {!closed && (
          <Link href={shiftsUrl(month, `&cell=${id}:${date}`)} className="font-bold text-primary hover:underline">
            予定を直す ›
          </Link>
        )}
      </div>
      <p className="tabular-nums">
        <span className="font-bold">計算</span>　拘束 {dash(day.boundMinutes)}　休憩 {dash(day.breakMinutes)}　実働 {dash(day.workedMinutes)}
        　時間外 {day.workedMinutes === null ? "—" : formatDuration(overtimeMinutes, "table")}　深夜 {dash(day.nightMinutes)}
      </p>

      <section aria-label="異常" className="flex flex-col gap-2 rounded-lg border border-line p-3">
        <h3 className="font-bold">異常</h3>
        {alerts.length === 0 ? (
          <p className="text-ink-muted">未対応の異常はありません。</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-col gap-2">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEVERITY_TONES[a.severity]}>{SEVERITY_LABELS[a.severity]}</Badge>
                  <span className="break-words">{a.message}</span>
                </p>
                {!closed && a.severity !== "fix" && <DismissAlertForm id={a.id} action={dismissAlertAction.bind(null, a.id)} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="打刻" className="flex flex-col gap-2">
        <h3 className="font-bold">打刻</h3>
        {punches.length === 0 ? (
          <p className="text-ink-muted">打刻はありません。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead className="border-b border-line bg-canvas text-left">
                <tr>
                  <th className="px-3 py-2">時刻</th>
                  <th className="px-3 py-2">種類</th>
                  <th className="px-3 py-2">場所</th>
                  <th className="px-3 py-2">登録</th>
                  <th className="px-3 py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {punches.map((p) => {
                  const loc = p.locationId ? locationsById.get(p.locationId) : undefined;
                  const place = locationLabel({ locationStatus: p.locationStatus, locationKind: loc?.kind ?? null, distanceM: p.distanceM });
                  const minutes = Math.floor((p.punchedAt.getTime() - Date.parse(`${date}T00:00:00+09:00`)) / 60000);
                  return (
                    <tr key={p.id} className="border-b border-line last:border-b-0 align-top">
                      <td className={`px-3 py-2 tabular-nums ${p.voidedAt ? "text-ink-muted line-through" : ""}`}>{minutesToHHmm(minutes)}</td>
                      <td className={`px-3 py-2 ${p.voidedAt ? "text-ink-muted line-through" : ""}`}>{PUNCH_KIND_LABELS[p.kind]}</td>
                      <td className="px-3 py-2">
                        {place ?? (p.source === "manual" ? "—" : "判定なし")}
                        {p.locationStatus === "in_range" && p.distanceM !== null && ` ${formatQuantity(p.distanceM, "m")}`}
                        {p.accuracyM !== null && p.accuracyM > 50 && <span className="ml-1 text-ink-muted">誤差{formatQuantity(p.accuracyM, "m")}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {p.source === "manual" ? `修正（${p.createdByName ?? "—"}）` : "本人"}
                        {p.source === "manual" && p.note && <span className="block text-xs text-ink-muted break-words">{p.note}</span>}
                      </td>
                      <td className="px-3 py-2">
                        {p.voidedAt ? (
                          <span className="text-xs text-ink-muted break-words">
                            取消（{p.voidedByName ?? "—"} {formatDateTime(p.voidedAt)} {p.voidReason}）
                          </span>
                        ) : (
                          !closed && <VoidPunchForm label={p.id} action={voidPunchAction.bind(null, id, date, p.id)} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {!closed && <AddPunchForm action={addPunchAction.bind(null, id, date)} workDate={date} nextDate={addDays(date, 1)} />}
    </div>
  );
}

export default async function AttendancePage({ searchParams }: PageProps<"/admin/attendance">) {
  const params = await searchParams;
  const today = todayJST();
  const period = parsePeriodParam(params.month, today);
  await requireAccess("attendance_admin", attendanceUrl(period.month));

  // 手順2・3
  const data = await loadMonth(period, today);
  const closed = await isPayrollClosed(period.from);
  const lastCheck = await lastAttendanceCheckAt(ATTENDANCE_CHECK_JOB);
  const alertsByCell = new Map<string, AttendanceAlert[]>();
  for (const a of data.openAlerts) {
    const key = `${a.employeeId}|${a.workDate}`;
    alertsByCell.set(key, [...(alertsByCell.get(key) ?? []), a]);
  }
  const locationsById = new Map(data.locations.map((l) => [l.id, { name: l.name, kind: l.kind }]));

  // 手順4 集計の帯
  const countOf = (s: "fix" | "legal" | "info") => data.openAlerts.filter((a) => a.severity === s).length;
  const deviationCount = data.openAlerts.filter((a) => a.kind === "shift_deviation").length;

  // EV-02 ?edit=<従業員ID>:<日付>(表の人・表の期間の中だけ)
  const cell = parseCellParam(params.edit);
  const editRow = cell && cell.date >= period.from && cell.date <= period.to ? data.rows.find((r) => r.employee.id === cell.employeeId) : undefined;
  const done = typeof params.done === "string" ? params.done : null;

  const prev = shiftPayrollPeriod(period, -1);
  const next = shiftPayrollPeriod(period, 1);
  const current = payrollPeriodOf(today);
  const groups = (Object.keys(DEPARTMENTS) as (keyof typeof DEPARTMENTS)[])
    .map((dept) => ({ dept, rows: data.rows.filter((r) => r.employee.department === dept) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">勤怠の一覧</h1>
        <div className="flex gap-2">
          <LinkButton href={shiftsUrl(period.month)}>シフトへ</LinkButton>
          <LinkButton href="/admin/attendance/alerts">異常へ</LinkButton>
        </div>
      </div>
      <PeriodNav
        label={`${yearMonthLabel(period)}（対象期間 ${formatDateShort(period.from)}〜${formatDateShort(period.to)}・${closed ? "締め済み" : "締め前"}）`}
        prev={{ href: attendanceUrl(prev.month), label: navLabel(prev) }}
        next={next.from <= current.from ? { href: attendanceUrl(next.month), label: navLabel(next) } : null}
      />
      {closed && (
        <div>
          <Badge tone="neutral">締め済み</Badge>
        </div>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-sm tabular-nums">
        <span>
          <span className="font-bold text-danger">要修正</span> {countOf("fix")}件
        </span>
        <span>
          <span className="font-bold text-warning">法令</span> {countOf("legal")}件
        </span>
        <span>
          <span className="font-bold">確認</span> {countOf("info")}件
        </span>
        <span>予定とずれ {deviationCount}件</span>
        <span className="text-ink-muted">最終チェック {lastCheck ? formatDateTime(lastCheck) : "まだありません"}</span>
      </div>
      <p className="text-sm text-ink-muted">
        上段＝予定、下段＝実績。印: 漏れ＝打刻漏れ、休＝休憩不足、ずれ＝15分以上のずれ、範囲外＝店舗・工場から離れた打刻
      </p>

      {data.rows.length === 0 ? (
        <EmptyState message="勤怠の対象の従業員はまだいません。" />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className="sticky left-0 z-10 min-w-32 border-b border-line bg-canvas px-3 py-2 text-left">従業員</th>
                {data.dates.map((d) => {
                  const cal = data.calendar.get(d);
                  const mark = cal?.kind === "national" ? "祝" : cal?.isClosed ? "休" : null;
                  return (
                    <th key={d} className="border-b border-l border-line px-1.5 py-2 text-xs whitespace-nowrap">
                      {Number(d.slice(8))}日（{WEEKDAYS[weekdayOfDateStr(d)]}）{mark && <span className="ml-0.5 font-bold">{mark}</span>}
                    </th>
                  );
                })}
                <th className="border-b border-l border-line px-3 py-2 text-xs whitespace-nowrap">日数・実働・時間外</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <GroupRows key={g.dept} label={`${DEPARTMENTS[g.dept]}（${g.rows.length}人）`} span={data.dates.length + 2}>
                  {g.rows.map((row) => (
                    <tr key={row.employee.id} id={`emp-${row.employee.id}`}>
                      <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left font-normal whitespace-nowrap">
                        {row.employee.lastName} {row.employee.firstName}
                        {!row.employee.isActive && <span className="ml-1 text-xs text-ink-muted">退職</span>}
                      </th>
                      {data.dates.map((d) => (
                        <DayCell key={d} row={row} date={d} month={period.month} alerts={alertsByCell.get(`${row.employee.id}|${d}`) ?? []} />
                      ))}
                      <td className="border-b border-l border-line px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                        <span className="block">{row.summary.workDays}日</span>
                        <span className="block">
                          {formatDuration(row.summary.workedMinutes, "table")} /{" "}
                          <span className={overtimeTone(row.summary.overtimeMinutes)}>{formatDuration(row.summary.overtimeMinutes, "table")}</span>
                        </span>
                        {row.summary.undeterminedDays > 0 && <span className="block text-danger">未確定 {row.summary.undeterminedDays}日</span>}
                      </td>
                    </tr>
                  ))}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editRow && cell && (
        <Modal
          title={`${editRow.employee.lastName} ${editRow.employee.firstName}さん ${formatDate(cell.date)}`}
          closeHref={attendanceUrl(period.month)}
        >
          <DayDetail
            row={editRow}
            date={cell.date}
            month={period.month}
            alerts={alertsByCell.get(`${editRow.employee.id}|${cell.date}`) ?? []}
            overtimeMinutes={editRow.summary.overtimeByDate.get(cell.date) ?? 0}
            locationsById={locationsById}
            closed={await isPayrollClosed(cell.date)}
            done={done}
          />
        </Modal>
      )}
    </div>
  );
}

function GroupRows({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
  return (
    <>
      <tr>
        <th colSpan={span} className="border-b border-line bg-canvas px-3 py-1 text-left text-xs font-bold">
          {label}
        </th>
      </tr>
      {children}
    </>
  );
}
