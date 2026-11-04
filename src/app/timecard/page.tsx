// G02 自分の勤怠(月の一覧。スマホ。E-01 03 EV-04)。機能キー timecard(全員)。
import { fullName, requireAccess } from "@/utils/auth";
import { buildAttendanceDay, minutesToHHmm, summarizePeriod, weekStartOf, type AttendanceDay } from "@/utils/attendance";
import { getOpenAlertMessagesByDate, getShiftsByDate } from "@/utils/attendanceServer";
import { formatDateShort, formatDuration, formatYearMonth } from "@/utils/format";
import { addDays, getCalendar } from "@/utils/holidays";
import { toDateJST } from "@/utils/jst";
import type { WorkLocation } from "@/utils/punchLocation";
import type { Punch } from "@/utils/timecard";
import { getTimecardEmployee, isTimecardTarget, listActiveLocations, listPunches, weeklyLegalMinutesFor } from "@/utils/timecardServer";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { BackLink } from "@/components/LinkButton";
import { PeriodNav } from "@/components/PeriodNav";
import { StaffHeader } from "@/components/StaffHeader";
import { punchLine, shiftText } from "./timecardView";

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const shiftMonth = (key: string, diff: number) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + diff, 1));
  return monthKey(d.getUTCFullYear(), d.getUTCMonth() + 1);
};
const lastDayOf = (key: string) => addDays(`${shiftMonth(key, 1)}-01`, -1);

function DayCard({
  date,
  day,
  punches,
  alerts,
  mark,
  locations,
  future,
}: {
  date: string;
  day: AttendanceDay;
  punches: Punch[];
  alerts: string[];
  mark: "休" | "祝" | null;
  locations: WorkLocation[];
  future: boolean;
}) {
  const actual =
    day.firstIn === null && day.lastOut === null
      ? "実績なし"
      : `実績 ${day.firstIn !== null ? minutesToHHmm(day.firstIn) : "—"}〜${day.lastOut !== null ? minutesToHHmm(day.lastOut) : ""}`;
  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line bg-surface p-4">
      <h2 className="flex items-center gap-2 font-bold tabular-nums">
        {formatDateShort(date)}
        {mark && <Badge tone="neutral">{mark}</Badge>}
      </h2>
      <div className="flex flex-col gap-1 text-sm tabular-nums">
        <p>予定 {shiftText(day.shift)}</p>
        {!future && (
          <>
            <p>{actual}</p>
            {day.blocks.length > 0 && (
              <p>
                休憩 {day.breakMinutes === null ? "—" : formatDuration(day.breakMinutes)}　実働{" "}
                {day.workedMinutes === null ? "—" : formatDuration(day.workedMinutes)}
              </p>
            )}
          </>
        )}
      </div>
      {alerts.map((message) => (
        <p key={message} className="text-sm font-bold text-warning">
          ⚠ {message}
        </p>
      ))}
      {punches.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer content-center font-bold text-primary">打刻の明細</summary>
          <ul className="flex flex-col gap-1 pt-1">
            {punches.map((p) => {
              const line = punchLine(p, locations);
              return (
                <li key={p.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums ${p.voidedAt ? "text-ink-muted line-through" : ""}`}>
                  <span className="w-16">{line.kind}</span>
                  <span>{line.time}</span>
                  {line.place && <span className="break-words">{line.place}</span>}
                  {p.source === "manual" && <Badge tone="neutral">修正</Badge>}
                  {p.voidedAt && <Badge tone="neutral">取消</Badge>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </li>
  );
}

export default async function MyTimecardPage({ searchParams }: PageProps<"/timecard">) {
  // 手順1
  const me = await requireAccess("timecard", "/timecard");
  const employee = await getTimecardEmployee(me.id);
  const header = <StaffHeader name={fullName(me)} />;
  if (!isTimecardTarget(employee)) {
    // CH-08
    return (
      <>
        {header}
        <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <BackLink href="/" label="ホームへ" />
          <h1 className="text-xl font-bold">自分の勤怠</h1>
          <Alert tone="info">打刻の対象になっていません。</Alert>
        </main>
      </>
    );
  }

  // 手順2: ?month= を確かめる(YYYY-MM の形、今の月より後でない)。だめなら今の月
  const today = toDateJST(new Date());
  const currentMonth = today.slice(0, 7);
  const { month: monthParam } = await searchParams;
  const requested = typeof monthParam === "string" ? monthParam : "";
  const month = MONTH_PATTERN.test(requested) && requested <= currentMonth ? requested : currentMonth;
  const monthStart = `${month}-01`;
  const monthEnd = lastDayOf(month);
  const periodEnd = monthEnd < today ? monthEnd : today;
  // 週の時間外を正しく出すため、月の最初の日を含む週の始まりから読む(E-02 03 の 0.2)
  const readFrom = weekStartOf(monthStart);

  // 手順3(DBの接続1本の決まりのため順番に読む)
  const punches = await listPunches(me.id, readFrom, monthEnd, { includeVoided: true });
  const shifts = await getShiftsByDate(me.id, readFrom, monthEnd);
  const alerts = await getOpenAlertMessagesByDate(me.id, monthStart, monthEnd);
  const calendar = await getCalendar(readFrom, monthEnd);
  const locations = await listActiveLocations();

  // 手順4: 日ごとの勤怠と月の合計(E-02 の計算をそのまま使う)
  const punchesByDate = new Map<string, Punch[]>();
  for (const p of punches) punchesByDate.set(p.workDate, [...(punchesByDate.get(p.workDate) ?? []), p]);
  const days = new Map<string, AttendanceDay>();
  for (let d = readFrom; d <= monthEnd; d = addDays(d, 1)) {
    days.set(d, buildAttendanceDay(d, punchesByDate.get(d) ?? [], shifts.get(d) ?? null, calendar.get(d)?.isClosed ?? false));
  }
  const summary = summarizePeriod(
    [...days.values()].filter((d) => d.workDate <= periodEnd),
    weeklyLegalMinutesFor(employee, locations),
    { from: monthStart, to: periodEnd }
  );

  // 月の切り替え: 今の月より先は出さない。古い月は入社の月まで(入社日が無ければ制限しない)
  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);
  const hiredMonth = employee.hiredOn?.slice(0, 7) ?? null;
  const [y, m] = month.split("-").map(Number);
  const navLabel = (key: string) => `${Number(key.slice(5))}月`;

  // 手順5: 新しい日を上に。今日より先の日は、予定があるときだけ予定を出す
  const cardDates: string[] = [];
  for (let d = monthEnd; d >= monthStart; d = addDays(d, -1)) {
    if (d > today && !shifts.has(d)) continue;
    cardDates.push(d);
  }

  return (
    <>
      {header}
      <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
        <BackLink href="/" label="ホームへ" />
        <h1 className="text-xl font-bold">自分の勤怠</h1>
        <PeriodNav
          label={formatYearMonth(y, m)}
          prev={!hiredMonth || prevMonth >= hiredMonth ? { href: `/timecard?month=${prevMonth}`, label: navLabel(prevMonth) } : null}
          next={nextMonth <= currentMonth ? { href: `/timecard?month=${nextMonth}`, label: navLabel(nextMonth) } : null}
        />

        <section aria-labelledby="summary-heading" className="flex flex-col gap-1 rounded-lg border border-line bg-surface p-4 text-sm">
          <h2 id="summary-heading" className="font-bold">
            {month === currentMonth ? "今月の合計" : "この月の合計"}（{formatDateShort(monthStart)}〜{formatDateShort(periodEnd)}）
          </h2>
          <p className="tabular-nums">
            出勤 {summary.workDays}日　実働 {formatDuration(summary.workedMinutes)}
          </p>
          <p className="tabular-nums">時間外 {formatDuration(summary.overtimeMinutes)} ※目安</p>
          <p className="text-ink-muted">時間外は目安です。確定は月の締めのあとです。</p>
          {summary.undeterminedDays > 0 && (
            <p className="text-ink-muted">打刻が足りない日（{summary.undeterminedDays}日）は、実働・時間外に含めていません。</p>
          )}
        </section>

        <ul className="flex flex-col gap-3">
          {cardDates.map((date) => {
            const cal = calendar.get(date);
            const mark = cal?.kind === "national" ? "祝" : cal?.isClosed ? "休" : null;
            return (
              <DayCard
                key={date}
                date={date}
                day={days.get(date)!}
                punches={punchesByDate.get(date) ?? []}
                alerts={alerts.get(date) ?? []}
                mark={mark}
                locations={locations}
                future={date > today}
              />
            );
          })}
        </ul>
        <p className="text-sm text-ink-muted">打刻の誤り・押し忘れは、管理者にお伝えください。</p>
      </main>
    </>
  );
}
