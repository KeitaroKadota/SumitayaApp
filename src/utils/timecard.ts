// 打刻の共通処理(E-01 03 の 0章)。DBを読まない純粋な関数。E-02 からも使う。
// 状態の判定(0.1)・勤務日(0.2)・順番の確認(CH-02・CH-04)・二重押し(CH-03)をここにまとめる。
// 打刻場所の判定(0.3)は、位置の扱いを1か所にまとめるため src/utils/punchLocation.ts に置き、ここから使えるようにしている。
import {
  BREAK_MODE,
  DOUBLE_TAP_SECONDS,
  OPEN_SHIFT_MAX_HOURS,
} from "@/utils/attendanceRules";
import { formatDateShort } from "@/utils/format";
import { toDateJST } from "@/utils/jst";
import type { LocationStatus } from "@/utils/punchLocation";

export { judgeLocation } from "@/utils/punchLocation";

export const PUNCH_KINDS = ["clock_in", "break_start", "break_end", "clock_out"] as const;
export type PunchKind = (typeof PUNCH_KINDS)[number];

export const PUNCH_KIND_LABELS: Record<PunchKind, string> = {
  clock_in: "出勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
  clock_out: "退勤",
};

// CH-01 打刻の種類が決まった値
export const isPunchKind = (value: string): value is PunchKind => (PUNCH_KINDS as readonly string[]).includes(value);

// 打刻1件(time_punches の1行)
export type Punch = {
  id: string;
  kind: PunchKind;
  punchedAt: Date;
  // 勤務日 "YYYY-MM-DD"
  workDate: string;
  source: "app" | "manual";
  locationId: string | null;
  locationStatus: LocationStatus;
  distanceM: number | null;
  accuracyM: number | null;
  note: string | null;
  voidedAt: Date | null;
  voidReason: string | null;
};

export type PunchStatus = "not_started" | "working" | "on_break" | "clocked_out";

export const PUNCH_STATUS_LABELS: Record<PunchStatus, string> = {
  not_started: "未出勤",
  working: "勤務中",
  on_break: "休憩中",
  clocked_out: "退勤済み",
};

export type PunchState = {
  status: PunchStatus;
  // 今開いている勤務の勤務日(勤務中・休憩中のとき)。それ以外は null
  workDate: string | null;
  // いちばん新しい勤務日の最後の打刻
  lastPunch: Punch | null;
  // CH-04 出勤から上限の時間を過ぎて閉じていない勤務の勤務日(あれば「未出勤」として扱っている)
  staleWorkDate: string | null;
  // 前の日から退勤していない勤務の勤務日(ホームの注意。staleWorkDate も含む)
  unclosedWorkDate: string | null;
  // 今押せる打刻の種類(02 の G01 のボタン)
  allowedKinds: PunchKind[];
};

export type PunchRuleOptions = { openShiftMaxHours: number; breakMode: "punch" | "fixed" };
const DEFAULT_OPTIONS: PunchRuleOptions = { openShiftMaxHours: OPEN_SHIFT_MAX_HOURS, breakMode: BREAK_MODE };

// 有効な打刻(取り消していないもの)を時刻の順に並べる
export const sortValidPunches = (punches: Punch[]): Punch[] =>
  punches.filter((p) => !p.voidedAt).sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime());

const allowedKindsOf = (status: PunchStatus, breakMode: "punch" | "fixed"): PunchKind[] => {
  switch (status) {
    case "working":
      return breakMode === "fixed" ? ["clock_out"] : ["break_start", "clock_out"];
    case "on_break":
      return ["break_end", "clock_out"];
    default:
      return ["clock_in"];
  }
};

const statusAfter = (kind: PunchKind): PunchStatus => {
  switch (kind) {
    case "clock_in":
    case "break_end":
      return "working";
    case "break_start":
      return "on_break";
    default:
      return "clocked_out";
  }
};

// 03 の 0.1 今の状態を決める。punches は本人の直近の打刻(取り消したものが混ざっていてもよい)
export const punchState = (punches: Punch[], now: Date, options: PunchRuleOptions = DEFAULT_OPTIONS): PunchState => {
  const valid = sortValidPunches(punches);
  const empty: PunchState = {
    status: "not_started",
    workDate: null,
    lastPunch: null,
    staleWorkDate: null,
    unclosedWorkDate: null,
    allowedKinds: allowedKindsOf("not_started", options.breakMode),
  };
  if (valid.length === 0) return empty;

  // 手順1: いちばん新しい勤務日の打刻
  const latestDate = valid.reduce((max, p) => (p.workDate > max ? p.workDate : max), valid[0].workDate);
  const dayPunches = valid.filter((p) => p.workDate === latestDate);
  const lastPunch = dayPunches[dayPunches.length - 1];

  // 手順2
  let status = statusAfter(lastPunch.kind);
  let workDate: string | null = status === "working" || status === "on_break" ? latestDate : null;
  let staleWorkDate: string | null = null;

  // 手順3(CH-04): 勤務中・休憩中のまま、その勤務の出勤から上限の時間を過ぎていれば「未出勤」として扱う
  if (workDate) {
    const clockIns = dayPunches.filter((p) => p.kind === "clock_in");
    const openedAt = (clockIns[clockIns.length - 1] ?? dayPunches[0]).punchedAt;
    if (now.getTime() - openedAt.getTime() > options.openShiftMaxHours * 3600 * 1000) {
      staleWorkDate = latestDate;
      status = "not_started";
      workDate = null;
    }
  }

  // 退勤済みでも、それが今日より前の勤務日なら、今日はまだ出勤していない(ホームの表示を「未出勤」にする。押せる種類は同じ)
  if (status === "clocked_out" && latestDate < toDateJST(now)) status = "not_started";

  // 前の日から退勤していない勤務(新しい勤務日より前の日で、最後の打刻が退勤でない日)
  let unclosedWorkDate = staleWorkDate;
  if (!unclosedWorkDate) {
    const earlierDates = [...new Set(valid.filter((p) => p.workDate < latestDate).map((p) => p.workDate))].sort();
    for (const date of earlierDates.reverse()) {
      const ps = valid.filter((p) => p.workDate === date);
      if (ps[ps.length - 1].kind !== "clock_out") {
        unclosedWorkDate = date;
        break;
      }
    }
  }

  // 手順4
  return { status, workDate, lastPunch, staleWorkDate, unclosedWorkDate, allowedKinds: allowedKindsOf(status, options.breakMode) };
};

// 03 の 0.2 勤務日を決める。出勤で「未出勤」「退勤済み」なら今の日本時間の日付、それ以外は開いている勤務の勤務日
export const workDateFor = (kind: PunchKind, now: Date, state: PunchState): string => {
  if (kind === "clock_in" && (state.status === "not_started" || state.status === "clocked_out")) return toDateJST(now);
  return state.workDate ?? toDateJST(now);
};

// CH-03 二重押し: 最後の有効な打刻が同じ種類で、上限の秒数以内なら、その打刻を返す
export const findDoubleTap = (
  kind: PunchKind,
  punches: Punch[],
  now: Date,
  seconds: number = DOUBLE_TAP_SECONDS
): Punch | null => {
  const valid = sortValidPunches(punches);
  const last = valid[valid.length - 1];
  if (!last || last.kind !== kind) return null;
  const elapsed = now.getTime() - last.punchedAt.getTime();
  return elapsed >= 0 && elapsed <= seconds * 1000 ? last : null;
};

// CH-02・CH-04 打刻の順番。押せない種類なら理由の文を返す(押せるなら null)
export const punchOrderError = (
  kind: PunchKind,
  state: PunchState,
  breakMode: "punch" | "fixed" = BREAK_MODE
): string | null => {
  const isBreak = kind === "break_start" || kind === "break_end";
  if (breakMode === "fixed" && isBreak) return "休憩の打刻は使っていません。";
  if (state.allowedKinds.includes(kind)) return null;
  // CH-04: 閉じていない古い勤務への退勤・休憩は受け付けない
  if (state.staleWorkDate && kind !== "clock_in") {
    return `前回の勤務（${formatDateShort(state.staleWorkDate)}）の退勤が打刻されていません。出勤を押してから、管理者にお伝えください。`;
  }
  switch (state.status) {
    case "not_started":
      return "まだ出勤していません。先に出勤を押してください。";
    case "working":
      return kind === "clock_in" ? "すでに出勤しています。" : "休憩中ではありません。";
    case "on_break":
      return kind === "clock_in" ? "すでに出勤しています。" : "すでに休憩中です。";
    default:
      return "すでに退勤しています。もう一度働くときは出勤を押してください。";
  }
};
