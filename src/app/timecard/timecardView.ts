// ホームの打刻カード(G01)と自分の勤怠(G02)で共通の表示の文(DBを読まない)。
import { SHIFT_KIND_LABELS, type Shift } from "@/utils/attendance";
import { formatTime } from "@/utils/format";
import { locationLabel, type WorkLocation } from "@/utils/punchLocation";
import { PUNCH_KIND_LABELS, type Punch } from "@/utils/timecard";

// 予定の文: 「09:30〜18:30」、休みの区分は「有給休暇」など、無ければ「予定なし」
export const shiftText = (shift: Shift | null | undefined): string => {
  if (!shift) return "予定なし";
  const times = shift.startTime && shift.endTime ? `${shift.startTime}〜${shift.endTime}` : "";
  if (shift.kind === "work") return times || SHIFT_KIND_LABELS.work;
  if (shift.kind === "paid_leave_half" && times) return `${SHIFT_KIND_LABELS.paid_leave_half} ${times}`;
  return SHIFT_KIND_LABELS[shift.kind];
};

// 打刻1件の表示(種類・時刻・場所)
export const punchLine = (punch: Punch, locations: WorkLocation[]) => ({
  kind: PUNCH_KIND_LABELS[punch.kind],
  time: formatTime(punch.punchedAt),
  place: locationLabel({
    locationStatus: punch.locationStatus,
    locationKind: locations.find((l) => l.id === punch.locationId)?.kind ?? null,
    distanceM: punch.distanceM,
  }),
});
