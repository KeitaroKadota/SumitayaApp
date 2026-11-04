"use server";

// EV-03 打刻を登録する(E-01 03)。機能キー timecard(全員)。
// 想定内のエラーは throw せず、戻り値(useActionState)で画面に出す(Next.js の 10-error-handling.md)。
import { revalidatePath } from "next/cache";
import { requireAccess } from "@/utils/auth";
import { transaction } from "@/utils/db";
import { formatTime } from "@/utils/format";
import { addDays } from "@/utils/holidays";
import { toDateJST } from "@/utils/jst";
import {
  isPositionMissingButRequired,
  judgeLocation,
  locationNotice,
  parsePosition,
  POSITION_REQUIRED_MESSAGE,
} from "@/utils/punchLocation";
import { findDoubleTap, isPunchKind, punchOrderError, punchState, PUNCH_KIND_LABELS, workDateFor } from "@/utils/timecard";
import {
  getTimecardEmployee,
  insertAppPunch,
  isTimecardTarget,
  listActiveLocations,
  listPunches,
  lockEmployee,
  NOT_TIMECARD_TARGET,
} from "@/utils/timecardServer";

export type PunchResult = { tone: "success" | "warning" | "error"; message: string } | null;

const RELOAD_MESSAGE = "打刻できませんでした。画面を開き直してください。";
const DB_ERROR_MESSAGE = "打刻できませんでした。時間をおいてもう一度お試しください。";
const BREAK_END_MISSING = "休憩の終わりが打刻されていません。管理者にお伝えください。";
// 直近の打刻を読む日数(出勤から OPEN_SHIFT_MAX_HOURS(20時間)の勤務がまたぐ日を含める)
const RECENT_DAYS = 2;

const refresh = () => {
  revalidatePath("/");
  revalidatePath("/timecard");
};

export async function punch(_prev: PunchResult, formData: FormData): Promise<PunchResult> {
  // 手順1
  const me = await requireAccess("timecard", "/");

  // 手順2 CH-08
  const employee = await getTimecardEmployee(me.id);
  if (!isTimecardTarget(employee)) return { tone: "error", message: NOT_TIMECARD_TARGET };

  // 手順3 CH-01・CH-05(おかしな位置の値は「取れなかった」に直す)
  const kind = String(formData.get("kind") ?? "");
  if (!isPunchKind(kind)) return { tone: "error", message: RELOAD_MESSAGE };
  const text = (name: string) => {
    const v = formData.get(name);
    return typeof v === "string" ? v : null;
  };
  const position = parsePosition({
    available: text("positionAvailable"),
    latitude: text("latitude"),
    longitude: text("longitude"),
    accuracy: text("accuracy"),
  });

  // 手順4 CH-07
  if (isPositionMissingButRequired(position)) return { tone: "error", message: POSITION_REQUIRED_MESSAGE };

  let result: PunchResult;
  try {
    result = await transaction(async (tx) => {
      // 手順5
      await lockEmployee(tx, me.id);
      // CH-11 時刻はサーバーの時刻(スマホから送られた時刻は受け取らない)
      const now = new Date();
      const today = toDateJST(now);

      // 手順6
      const punches = await listPunches(me.id, addDays(today, -RECENT_DAYS), today, { tx });
      const state = punchState(punches, now);

      // 手順7 CH-03 二重押しは登録せずに成功として返す
      const doubleTap = findDoubleTap(kind, punches, now);
      if (doubleTap) {
        return { tone: "success", message: `${PUNCH_KIND_LABELS[kind]} ${formatTime(doubleTap.punchedAt)} は記録済みです。` } as const;
      }

      // 手順8 CH-02・CH-04
      const orderError = punchOrderError(kind, state);
      if (orderError) return { tone: "error", message: orderError } as const;

      // 手順9 勤務日と打刻場所の判定(CH-06)
      const workDate = workDateFor(kind, now, state);
      const locations = await listActiveLocations(tx);
      const judgement = judgeLocation(position, locations);

      // 手順10
      await insertAppPunch(tx, { employeeId: me.id, kind, punchedAt: now, workDate, position, judgement });

      // 手順11 返すメッセージ
      const notes: string[] = [];
      if (kind === "clock_out" && state.status === "on_break") notes.push(BREAK_END_MISSING);
      const locationKind = locations.find((l) => l.id === judgement.locationId)?.kind ?? null;
      const notice = locationNotice(judgement, locationKind);
      if (notice) notes.push(notice);
      return {
        tone: notes.length > 0 ? "warning" : "success",
        message: [`${PUNCH_KIND_LABELS[kind]} ${formatTime(now)} を記録しました。`, ...notes].join(""),
      } as const;
    });
  } catch (e) {
    console.error("打刻を登録できませんでした:", e instanceof Error ? e.message : e);
    return { tone: "error", message: DB_ERROR_MESSAGE };
  }

  // 順番の誤りのときも画面を新しくして正しいボタンを出す(CH-02)
  refresh();
  return result;
}
