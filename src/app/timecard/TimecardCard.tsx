// G01 ホームの打刻カード(E-01 03 EV-01)。CMN-01 の G04(ホーム)の「打刻」の枠に入れる。
// 呼ぶ側(ホーム)で requireLogin と canAccess(区分, "timecard") を済ませてから置く。勤怠の対象でない人には何も出さない(CH-08)。
import Link from "next/link";
import { Alert } from "@/components/Alert";
import { getShiftsByDate } from "@/utils/attendanceServer";
import { formatDateShort, formatTime } from "@/utils/format";
import { addDays } from "@/utils/holidays";
import { toDateJST } from "@/utils/jst";
import { PUNCH_KIND_LABELS, PUNCH_STATUS_LABELS, punchState, sortValidPunches } from "@/utils/timecard";
import { getTimecardEmployee, isTimecardTarget, listActiveLocations, listPunches } from "@/utils/timecardServer";
import { PunchButtons } from "./PunchButtons";
import { punchLine, shiftText } from "./timecardView";

export async function TimecardCard({ employeeId }: { employeeId: string }) {
  // 手順2 CH-08
  const employee = await getTimecardEmployee(employeeId);
  if (!isTimecardTarget(employee)) return null;

  // 手順3: 直近の有効な打刻・今日のシフト・打刻場所(DBの接続1本の決まりのため順番に読む)
  const now = new Date();
  const today = toDateJST(now);
  const punches = await listPunches(employeeId, addDays(today, -2), today);
  const shifts = await getShiftsByDate(employeeId, today, today);
  const locations = await listActiveLocations();

  // 手順4
  const state = punchState(punches, now);
  // 一覧に出す勤務日: 勤務中・休憩中なら、その勤務の日(夜12時を過ぎても出勤からの打刻を出す)。それ以外は今日
  const shownDate = state.workDate ?? today;
  const shown = sortValidPunches(punches).filter((p) => p.workDate === shownDate);
  const statusDetail = state.status !== "not_started" && state.lastPunch
    ? `（${PUNCH_KIND_LABELS[state.lastPunch.kind]} ${formatTime(state.lastPunch.punchedAt)}）`
    : "";
  const warnDate = state.unclosedWorkDate && state.unclosedWorkDate !== state.workDate ? state.unclosedWorkDate : null;

  return (
    <section aria-labelledby="timecard-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-4">
      <h2 id="timecard-heading" className="text-lg font-bold">
        打刻
      </h2>
      <div className="flex flex-col gap-1 text-sm">
        <p className="tabular-nums">
          {formatDateShort(today)} 今日の予定 {shiftText(shifts.get(today))}
        </p>
        <p className="font-bold">
          状態: {PUNCH_STATUS_LABELS[state.status]}
          {statusDetail}
        </p>
      </div>

      {warnDate && (
        <Alert tone="warning">{formatDateShort(warnDate)}の退勤が打刻されていません。管理者にお伝えください。</Alert>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="text-sm font-bold">
          {shownDate === today ? "今日の打刻" : `${formatDateShort(shownDate)}の勤務の打刻`}
        </h3>
        {shown.length === 0 ? (
          <p className="text-sm text-ink-muted">まだ打刻はありません。</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {shown.map((p) => {
              const line = punchLine(p, locations);
              return (
                <li key={p.id} className="flex flex-wrap gap-x-3 tabular-nums">
                  <span className="w-16">{line.kind}</span>
                  <span>{line.time}</span>
                  {line.place && <span className="break-words">{line.place}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <PunchButtons kinds={state.allowedKinds} reclockIn={state.status === "clocked_out"} />

      <p className="text-sm text-ink-muted">
        打刻のときだけ位置情報を使います。勤務中に位置を記録し続けることはありません。
      </p>
      <Link href="/timecard" className="inline-flex min-h-11 items-center text-sm font-bold text-primary hover:underline">
        自分の勤怠を見る ›
      </Link>
    </section>
  );
}
