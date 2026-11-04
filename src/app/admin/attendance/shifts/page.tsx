// G03 シフトの登録(月の表)と G04 シフトの入力(モーダル)。E-02 03 の EV-06〜EV-09。機能キー attendance_admin。
import Link from "next/link";
import { requireAccess } from "@/utils/auth";
import { listShifts } from "@/utils/attendanceServer";
import { formatDate, formatDateShort, formatDuration, formatYearMonth } from "@/utils/format";
import { addDays, getCalendar } from "@/utils/holidays";
import { todayJST, weekdayOfDateStr } from "@/utils/jst";
import { DEPARTMENTS } from "@/utils/masterRules";
import { isPayrollClosed, shiftPayrollPeriod, type PayrollPeriod } from "@/utils/payrollPeriod";
import { Alert } from "@/components/Alert";
import { EmptyState } from "@/components/EmptyState";
import { LinkButton } from "@/components/LinkButton";
import { Modal } from "@/components/Modal";
import { PeriodNav } from "@/components/PeriodNav";
import { bulkShiftAction, deleteShiftAction, saveShiftAction } from "../actions";
import { loadMonth } from "../attendanceData";
import { attendanceUrl, parseCellParam, parsePeriodParam, shiftCellText, shiftsUrl } from "../attendanceView";
import { BulkShiftForm, ShiftForm } from "./ShiftForms";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
// まとめて入力で件数を前もって数える範囲(期間の最初の日から。CH-11 の上限 62日に余裕を持たせた)
const BULK_PREVIEW_DAYS = 93;

const navLabel = (p: PayrollPeriod) => `${Number(p.month.slice(5))}月`;

const savedMessage = (saved: unknown, warn: unknown, bulkDone: unknown): { tone: "success" | "warning" | "error"; text: string } | null => {
  if (typeof bulkDone === "string" && /^\d+-\d+-\d+$/.test(bulkDone)) {
    const [n, over, skipped] = bulkDone.split("-");
    return { tone: "success", text: `${n}日分を入力しました（上書き ${over}件・飛ばした日 ${skipped}件）。` };
  }
  if (saved === "1") {
    return warn === "break"
      ? { tone: "warning", text: "保存しました。予定の休憩が足りません（6時間を超えるときは45分、8時間を超えるときは60分）。" }
      : { tone: "success", text: "保存しました。" };
  }
  if (saved === "deleted") return { tone: "success", text: "削除しました。" };
  if (saved === "closed") return { tone: "error", text: "この期間は締め済みです。" };
  if (saved === "failed") return { tone: "error", text: "保存できませんでした。" };
  return null;
};

export default async function ShiftsPage({ searchParams }: PageProps<"/admin/attendance/shifts">) {
  const params = await searchParams;
  const today = todayJST();
  const period = parsePeriodParam(params.month, today);
  await requireAccess("attendance_admin", shiftsUrl(period.month));

  // EV-06 手順2・3
  const data = await loadMonth(period, today, { withAlerts: false });
  const closed = await isPayrollClosed(period.from);
  const locations = data.locations.map((l) => ({ id: l.id, name: l.name }));
  const message = savedMessage(params.saved, params.warn, params.bulk_done);

  // G04 1日ずつ(?cell=)。締め済み・退職した人は開かない(見るだけ)
  const cell = parseCellParam(params.cell);
  const cellRow =
    !closed && cell && cell.date >= period.from && cell.date <= period.to
      ? data.rows.find((r) => r.employee.id === cell.employeeId && r.employee.isActive)
      : undefined;
  const bulk = params.bulk === "1" && !closed;

  // まとめて入力の件数の計算に使う、すでにあるシフトと休業日(期間の最初の日から BULK_PREVIEW_DAYS 日分)
  let bulkData: { existingKeys: string[]; closedDates: string[]; knownTo: string } | null = null;
  if (bulk) {
    const knownTo = addDays(period.from, BULK_PREVIEW_DAYS);
    const activeIds = data.rows.filter((r) => r.employee.isActive).map((r) => r.employee.id);
    const shifts = activeIds.length > 0 ? await listShifts(period.from, knownTo, { employeeIds: activeIds }) : [];
    const calendar = await getCalendar(period.from, knownTo);
    bulkData = {
      existingKeys: shifts.map((s) => `${s.employeeId}|${s.workDate}`),
      closedDates: [...calendar].filter(([, c]) => c.isClosed || c.kind === "national").map(([d]) => d),
      knownTo,
    };
  }

  const prev = shiftPayrollPeriod(period, -1);
  const next = shiftPayrollPeriod(period, 1);
  const groups = (Object.keys(DEPARTMENTS) as (keyof typeof DEPARTMENTS)[])
    .map((dept) => ({ dept, rows: data.rows.filter((r) => r.employee.department === dept) }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">シフト</h1>
        <div className="flex gap-2">
          <LinkButton href={attendanceUrl(period.month)}>勤怠の一覧へ</LinkButton>
          {!closed && (
            <LinkButton href={shiftsUrl(period.month, "&bulk=1")} variant="primary">
              まとめて入力する
            </LinkButton>
          )}
        </div>
      </div>
      <PeriodNav
        label={formatYearMonth(Number(period.month.slice(0, 4)), Number(period.month.slice(5)))}
        prev={{ href: shiftsUrl(prev.month), label: navLabel(prev) }}
        next={{ href: shiftsUrl(next.month), label: navLabel(next) }}
      />
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
      {closed && <Alert tone="info">この期間は締め済みのため、見るだけです。</Alert>}

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
                <th className="border-b border-l border-line px-3 py-2 text-xs whitespace-nowrap">予定の合計</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <ShiftGroup key={g.dept} label={DEPARTMENTS[g.dept]} span={data.dates.length + 2}>
                  {g.rows.map((row) => {
                    const editable = !closed && row.employee.isActive;
                    const name = `${row.employee.lastName} ${row.employee.firstName}`;
                    const plannedDays = [...row.shiftsByDate.values()].filter(
                      (s) => s.workDate >= period.from && s.workDate <= period.to && (s.kind === "work" || s.kind === "paid_leave_half")
                    ).length;
                    return (
                      <tr key={row.employee.id}>
                        <th className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-2 text-left font-normal whitespace-nowrap">
                          {name}
                          {!row.employee.isActive && <span className="ml-1 text-xs text-ink-muted">退職</span>}
                        </th>
                        {data.dates.map((d) => {
                          const text = shiftCellText(row.shiftsByDate.get(d));
                          const body = (
                            <span className="flex min-h-11 min-w-20 items-center px-1.5 py-1 text-xs tabular-nums">{text}</span>
                          );
                          return (
                            <td key={d} className="border-b border-l border-line p-0 align-top">
                              {editable ? (
                                <Link
                                  href={shiftsUrl(period.month, `&cell=${row.employee.id}:${d}`)}
                                  scroll={false}
                                  aria-label={`${name}さん ${formatDateShort(d)}のシフト`}
                                  className="block hover:bg-primary-soft focus-visible:outline-2 focus-visible:outline-primary"
                                >
                                  {body}
                                </Link>
                              ) : (
                                body
                              )}
                            </td>
                          );
                        })}
                        <td className="border-b border-l border-line px-3 py-2 text-xs whitespace-nowrap tabular-nums">
                          <span className="block">
                            {plannedDays}日 {formatDuration(row.planned.workedMinutes, "table")}
                          </span>
                          {row.planned.overtimeMinutes > 0 && (
                            <span className="block font-bold text-warning">予定で時間外 {formatDuration(row.planned.overtimeMinutes, "table")}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </ShiftGroup>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-ink-muted">※セルを押すと、その日のシフトを入力できます。</p>

      {cellRow && cell && (
        <Modal
          title={`${cellRow.employee.lastName} ${cellRow.employee.firstName}さん ${formatDate(cell.date)}のシフト`}
          closeHref={shiftsUrl(period.month)}
          size="md"
        >
          {(() => {
            const shift = cellRow.shiftsByDate.get(cell.date);
            const cal = data.calendar.get(cell.date);
            return (
              <ShiftForm
                key={`${cell.employeeId}:${cell.date}`}
                action={saveShiftAction.bind(null, cell.employeeId, cell.date)}
                deleteAction={deleteShiftAction.bind(null, cell.employeeId, cell.date)}
                hasShift={!!shift}
                closedDayName={cal?.isClosed ? cal.name : null}
                locations={locations}
                initial={{
                  kind: shift?.kind ?? "work",
                  start_time: shift?.startTime ?? "",
                  end_time: shift?.endTime ?? "",
                  break_minutes: String(shift?.breakMinutes ?? 0),
                  location_id: shift?.locationId ?? "",
                  note: shift?.note ?? "",
                }}
              />
            );
          })()}
        </Modal>
      )}

      {bulk && bulkData && (
        <Modal title="シフトをまとめて入力" closeHref={shiftsUrl(period.month)}>
          <BulkShiftForm
            action={bulkShiftAction.bind(null, period.month)}
            employees={data.rows
              .filter((r) => r.employee.isActive)
              .map((r) => ({ id: r.employee.id, name: `${r.employee.lastName} ${r.employee.firstName}` }))}
            locations={locations}
            defaultFrom={period.from}
            defaultTo={period.to}
            existingKeys={bulkData.existingKeys}
            closedDates={bulkData.closedDates}
            knownFrom={period.from}
            knownTo={bulkData.knownTo}
          />
        </Modal>
      )}
    </div>
  );
}

function ShiftGroup({ label, span, children }: { label: string; span: number; children: React.ReactNode }) {
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
