// 勤怠の計算(E-02 03 の 0.1 buildAttendanceDay・0.2 summarizePeriod、01 の 5章)。DBを読まない純粋な関数。
// 担当は E-02。E-01(自分の勤怠)・E-03(集計)も同じ関数を使い、画面ごとに数字がずれないようにする。
// 時刻は勤務日の日本時間 0:00 からの分で扱う(夜12時を過ぎた退勤は 24:00 以降。例 25:30)。秒は切り捨てる。
// 後半は異常の判定(E-02 04 の CH-01〜CH-08)。異常の登録(attendance_alerts への書き込み)は src/utils/attendanceCron.ts。
import {
  BREAK_MODE,
  BREAK_REQUIRED1_MINUTES,
  BREAK_REQUIRED2_MINUTES,
  BREAK_THRESHOLD1_MINUTES,
  BREAK_THRESHOLD2_MINUTES,
  DAILY_LEGAL_MINUTES,
  DEVIATION_MINUTES,
  OVERTIME_MONTHLY_LIMIT_MINUTES,
  OVERTIME_WARNING_MINUTES,
  REWORK_GAP_MINUTES,
  WEEK_START_DOW,
} from "@/utils/attendanceRules";
import { addDays } from "@/utils/holidays";
import { weekdayOfDateStr } from "@/utils/jst";
import { sortValidPunches, type Punch } from "@/utils/timecard";

// シフト(E-02 の shifts の1行)
export type ShiftKind = "work" | "paid_leave" | "paid_leave_half" | "special_leave" | "absence";
export type Shift = {
  kind: ShiftKind;
  // "HH:mm"(work・paid_leave_half のとき)
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
};

export const SHIFT_KIND_LABELS: Record<ShiftKind, string> = {
  work: "出勤",
  paid_leave: "有給休暇",
  paid_leave_half: "有給休暇（半日）",
  special_leave: "特別休暇",
  absence: "欠勤",
};

// 組めない打刻(E-02 の CH-01 の種類と、同じ種類の連続など)
export type PunchGapKind = "missing_clock_out" | "missing_break_end" | "missing_clock_in" | "unmatched";

// 勤務のかたまり(出勤〜退勤)。分は勤務日の 0:00 から
export type WorkBlock = { start: number; end: number | null; breaks: { start: number; end: number | null }[] };

export type AttendanceDay = {
  workDate: string;
  blocks: WorkBlock[];
  gaps: PunchGapKind[];
  // 最初の出勤・最後の退勤(分。無ければ null)
  firstIn: number | null;
  lastOut: number | null;
  // 漏れがあれば null(計算できない)
  boundMinutes: number | null;
  breakMinutes: number | null;
  // 中抜け(かたまりとかたまりの間)
  awayMinutes: number | null;
  workedMinutes: number | null;
  nightMinutes: number | null;
  shift: Shift | null;
  lateMinutes: number;
  earlyMinutes: number;
  deviation: boolean;
  isClosedDay: boolean;
  outOfRangeCount: number;
  noLocationCount: number;
};

export type AttendanceOptions = { breakMode: "punch" | "fixed"; deviationMinutes: number };
const DEFAULT_OPTIONS: AttendanceOptions = { breakMode: BREAK_MODE, deviationMinutes: DEVIATION_MINUTES };

// 勤務日の日本時間 0:00 からの分(秒は切り捨て)
export const minutesFromWorkDate = (workDate: string, at: Date): number =>
  Math.floor((at.getTime() - Date.parse(`${workDate}T00:00:00+09:00`)) / 60000);

// "HH:mm" → 分
export const hhmmToMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 分 → "HH:mm"(24時を超えると "25:30" の形)
export const minutesToHHmm = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

// 深夜(22:00〜翌5:00)の時間帯。長い勤務も数えるよう、前の日の夜から翌々日の朝までを並べる
const NIGHT_WINDOWS = [-1, 0, 1, 2].map((k) => [k * 1440 + 1320, k * 1440 + 1740] as const);

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));

// 0.1 1日の勤怠を計算する。punches はその人・その勤務日の打刻(取り消したものが混ざっていてもよい)
export const buildAttendanceDay = (
  workDate: string,
  punches: Punch[],
  shift: Shift | null,
  isClosedDay: boolean,
  options: AttendanceOptions = DEFAULT_OPTIONS
): AttendanceDay => {
  // 手順1
  const valid = sortValidPunches(punches);
  // 手順2: 出勤〜退勤をかたまりに、休憩開始〜休憩終了を休憩に組む
  const blocks: WorkBlock[] = [];
  const gaps = new Set<PunchGapKind>();
  let current: WorkBlock | null = null;
  let lastKind: Punch["kind"] | null = null;
  for (const p of valid) {
    const t = minutesFromWorkDate(workDate, p.punchedAt);
    const openBreak = current?.breaks.find((b) => b.end === null) ?? null;
    if (lastKind === p.kind) gaps.add("unmatched");
    switch (p.kind) {
      case "clock_in":
        if (current) {
          gaps.add("missing_clock_out");
          if (openBreak) gaps.add("missing_break_end");
        }
        current = { start: t, end: null, breaks: [] };
        blocks.push(current);
        break;
      case "break_start":
        if (!current) gaps.add("missing_clock_in");
        else if (openBreak) gaps.add("missing_break_end");
        else current.breaks.push({ start: t, end: null });
        break;
      case "break_end":
        if (!current) gaps.add("missing_clock_in");
        else if (openBreak) openBreak.end = t;
        else gaps.add("unmatched");
        break;
      case "clock_out":
        if (!current) {
          gaps.add("missing_clock_in");
        } else {
          if (openBreak) gaps.add("missing_break_end");
          current.end = t;
          current = null;
        }
        break;
    }
    lastKind = p.kind;
  }
  if (current) {
    gaps.add("missing_clock_out");
    if (current.breaks.some((b) => b.end === null)) gaps.add("missing_break_end");
  }

  const firstIn = blocks.length > 0 ? blocks[0].start : null;
  const outs = valid.filter((p) => p.kind === "clock_out");
  const lastOut = outs.length > 0 ? minutesFromWorkDate(workDate, outs[outs.length - 1].punchedAt) : null;

  // 手順3〜5: 漏れが無いときだけ計算する
  let boundMinutes: number | null = null;
  let breakMinutes: number | null = null;
  let awayMinutes: number | null = null;
  let workedMinutes: number | null = null;
  let nightMinutes: number | null = null;
  if (gaps.size === 0) {
    boundMinutes = blocks.reduce((sum, b) => sum + (b.end! - b.start), 0);
    const punchedBreak = blocks.reduce((sum, b) => sum + b.breaks.reduce((s, br) => s + (br.end! - br.start), 0), 0);
    // 手順4: シフトの休憩で差し引く決まりなら、シフトの休憩の分(シフトが無ければ0)
    breakMinutes = options.breakMode === "fixed" ? (shift?.breakMinutes ?? 0) : punchedBreak;
    awayMinutes = blocks.slice(1).reduce((sum, b, i) => sum + (b.start - blocks[i].end!), 0);
    workedMinutes = Math.max(0, boundMinutes - breakMinutes);
    // 深夜: 勤務のかたまりから休憩を除いた時間と、22:00〜翌5:00 の重なり
    nightMinutes = 0;
    for (const b of blocks) {
      for (const [w0, w1] of NIGHT_WINDOWS) {
        nightMinutes += overlap(b.start, b.end!, w0, w1);
        if (options.breakMode === "punch") {
          for (const br of b.breaks) nightMinutes -= overlap(br.start, br.end!, w0, w1);
        }
      }
    }
  }

  // 手順6: シフトとのずれ
  let lateMinutes = 0;
  let earlyMinutes = 0;
  let deviation = false;
  if (shift && shift.startTime && shift.endTime && (shift.kind === "work" || shift.kind === "paid_leave_half")) {
    const start = hhmmToMinutes(shift.startTime);
    const end = hhmmToMinutes(shift.endTime);
    if (firstIn !== null) {
      lateMinutes = Math.max(0, firstIn - start);
      if (Math.abs(firstIn - start) >= options.deviationMinutes) deviation = true;
    }
    if (lastOut !== null) {
      earlyMinutes = Math.max(0, end - lastOut);
      if (Math.abs(lastOut - end) >= options.deviationMinutes) deviation = true;
    }
  }

  // 手順7
  return {
    workDate,
    blocks,
    gaps: [...gaps],
    firstIn,
    lastOut,
    boundMinutes,
    breakMinutes,
    awayMinutes,
    workedMinutes,
    nightMinutes,
    shift,
    lateMinutes,
    earlyMinutes,
    deviation,
    isClosedDay,
    outOfRangeCount: valid.filter((p) => p.locationStatus === "out_of_range").length,
    noLocationCount: valid.filter((p) => p.locationStatus === "unavailable").length,
  };
};

// その日を含む週の始まりの日(定数 WEEK_START_DOW)
export const weekStartOf = (date: string, weekStartDow: number = WEEK_START_DOW): string =>
  addDays(date, -((weekdayOfDateStr(date) - weekStartDow + 7) % 7));

export type PeriodSummary = {
  workDays: number;
  workedMinutes: number;
  overtimeMinutes: number;
  nightMinutes: number;
  holidayWorkDays: number;
  holidayWorkMinutes: number;
  lateMinutes: number;
  earlyMinutes: number;
  leaveDays: Partial<Record<ShiftKind, number>>;
  // 漏れがあり実働を計算できない日(未確定の日)
  undeterminedDays: number;
  // 日ごとの時間外(1日の分＋週の分)
  overtimeByDate: Map<string, number>;
};

// 0.2 週・月の時間外を計算する。days には、週の時間外を正しく出すため、期間の最初の日を含む週の始まりからの日を渡す
export const summarizePeriod = (
  days: AttendanceDay[],
  weeklyLegalMinutes: number,
  period: { from: string; to: string },
  options: { dailyLegalMinutes: number; weekStartDow: number } = {
    dailyLegalMinutes: DAILY_LEGAL_MINUTES,
    weekStartDow: WEEK_START_DOW,
  }
): PeriodSummary => {
  const sorted = [...days].sort((a, b) => a.workDate.localeCompare(b.workDate));
  const overtimeByDate = new Map<string, number>();
  // 手順1・2: 1日の時間外と、週の法定労働時間を超えた分
  const weekTotals = new Map<string, number>();
  for (const day of sorted) {
    if (day.workedMinutes === null) continue;
    const daily = Math.max(0, day.workedMinutes - options.dailyLegalMinutes);
    const week = weekStartOf(day.workDate, options.weekStartDow);
    const before = weekTotals.get(week) ?? 0;
    const after = before + (day.workedMinutes - daily);
    weekTotals.set(week, after);
    const weekly = Math.max(0, after - weeklyLegalMinutes) - Math.max(0, before - weeklyLegalMinutes);
    overtimeByDate.set(day.workDate, daily + weekly);
  }

  // 手順3・4: 期間に入る日の分だけを数える
  const summary: PeriodSummary = {
    workDays: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    nightMinutes: 0,
    holidayWorkDays: 0,
    holidayWorkMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    leaveDays: {},
    undeterminedDays: 0,
    overtimeByDate,
  };
  for (const day of sorted) {
    if (day.workDate < period.from || day.workDate > period.to) continue;
    if (day.shift && day.shift.kind !== "work") {
      summary.leaveDays[day.shift.kind] = (summary.leaveDays[day.shift.kind] ?? 0) + 1;
    }
    if (day.blocks.length === 0) continue;
    summary.workDays += 1;
    summary.lateMinutes += day.lateMinutes;
    summary.earlyMinutes += day.earlyMinutes;
    if (day.workedMinutes === null) {
      summary.undeterminedDays += 1;
      continue;
    }
    summary.workedMinutes += day.workedMinutes;
    summary.overtimeMinutes += overtimeByDate.get(day.workDate) ?? 0;
    summary.nightMinutes += day.nightMinutes ?? 0;
    if (day.isClosedDay) {
      summary.holidayWorkDays += 1;
      summary.holidayWorkMinutes += day.workedMinutes;
    }
  }
  return summary;
};

// ---- 異常の判定(E-02 04 の CH-01〜CH-08。DBを読まない) ----

export const ALERT_KINDS = [
  "missing_clock_out",
  "missing_break_end",
  "missing_clock_in",
  "no_punch",
  "duplicate_punch",
  "break_short",
  "overtime_warning",
  "overtime_over",
  "shift_deviation",
  "work_without_shift",
  "location_check",
] as const;
export type AttendanceAlertKind = (typeof ALERT_KINDS)[number];
export const isAlertKind = (value: string): value is AttendanceAlertKind => (ALERT_KINDS as readonly string[]).includes(value);

// 月の時間外の異常(work_date は給与の対象期間の最初の日)
export const OVERTIME_ALERT_KINDS: readonly AttendanceAlertKind[] = ["overtime_warning", "overtime_over"];

// 重さ(E-02 01 6章)。fix: 要修正 / legal: 法令 / info: 確認
export type AlertSeverity = "fix" | "legal" | "info";
export const SEVERITY_LABELS: Record<AlertSeverity, string> = { fix: "要修正", legal: "法令", info: "確認" };
export const ALERT_SEVERITY: Record<AttendanceAlertKind, AlertSeverity> = {
  missing_clock_out: "fix",
  missing_break_end: "fix",
  missing_clock_in: "fix",
  no_punch: "fix",
  duplicate_punch: "info",
  break_short: "legal",
  overtime_warning: "legal",
  overtime_over: "legal",
  shift_deviation: "info",
  work_without_shift: "info",
  location_check: "info",
};

// 短い名前(管理者あてのタスクの件名・G05 の絞り込み)
export const ALERT_KIND_LABELS: Record<AttendanceAlertKind, string> = {
  missing_clock_out: "退勤の打刻漏れ",
  missing_break_end: "休憩の終わりの打刻漏れ",
  missing_clock_in: "出勤の打刻漏れ",
  no_punch: "打刻なし（欠勤か打刻忘れ）",
  duplicate_punch: "重複打刻の疑い",
  break_short: "休憩不足",
  overtime_warning: "時間外の注意",
  overtime_over: "時間外の上限超過",
  shift_deviation: "シフトとのずれ",
  work_without_shift: "予定のない日の勤務",
  location_check: "店舗・工場から離れた打刻",
};

export type AlertDetail = Record<string, string | number | boolean | null | string[]>;

export type DetectedAlert = {
  workDate: string;
  kind: AttendanceAlertKind;
  severity: AlertSeverity;
  message: string;
  detail: AlertDetail;
};

const alertOf = (workDate: string, kind: AttendanceAlertKind, message: string, detail: AlertDetail): DetectedAlert => ({
  workDate,
  kind,
  severity: ALERT_SEVERITY[kind],
  message,
  detail,
});

// 「同じ内容か」の比較用(キーの順に左右されない文字列にする。CH-13)
export const stableDetail = (detail: unknown): string => {
  if (Array.isArray(detail)) return `[${detail.map(stableDetail).join(",")}]`;
  if (detail && typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableDetail(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(detail ?? null);
};

// 分 → 表の形 "38:15"
export const hoursMinutes = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  return `${h}:${String(minutes - h * 60).padStart(2, "0")}`;
};
// 分 → "8時間38分"
const hoursMinutesText = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
};

const PUNCH_LABELS: Record<Punch["kind"], string> = {
  clock_in: "出勤",
  break_start: "休憩開始",
  break_end: "休憩終了",
  clock_out: "退勤",
};
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
const PLACE_LABELS = { store: "店舗", factory: "工場" } as const;

export type BreakRule = { threshold: number; required: number };
// CH-03 の決まり(しきい値の大きい順に見る)
export const DEFAULT_BREAK_RULES: readonly BreakRule[] = [
  { threshold: BREAK_THRESHOLD2_MINUTES, required: BREAK_REQUIRED2_MINUTES },
  { threshold: BREAK_THRESHOLD1_MINUTES, required: BREAK_REQUIRED1_MINUTES },
];

// CH-03 実働に対して必要な休憩(分)。要らなければ 0
export const requiredBreakMinutes = (workedMinutes: number, rules: readonly BreakRule[] = DEFAULT_BREAK_RULES): number =>
  rules.find((r) => workedMinutes > r.threshold)?.required ?? 0;

export type DayCheckContext = {
  // 休業日の名前(休業日でなければ null)
  closedDayName: string | null;
  // 打刻場所の種類(範囲外の文に「店舗から850m」と出すため)
  locationKindOf: (locationId: string | null) => "store" | "factory" | null;
};

export type DayCheckOptions = { reworkGapMinutes: number; deviationMinutes: number; breakRules: readonly BreakRule[] };
const DEFAULT_DAY_CHECK: DayCheckOptions = {
  reworkGapMinutes: REWORK_GAP_MINUTES,
  deviationMinutes: DEVIATION_MINUTES,
  breakRules: DEFAULT_BREAK_RULES,
};

// CH-01〜CH-03・CH-05〜CH-08 1日の異常。day は buildAttendanceDay の結果、punches はその日の打刻(取り消しを含んでよい)
export const detectDayAlerts = (
  day: AttendanceDay,
  punches: Punch[],
  context: DayCheckContext,
  options: DayCheckOptions = DEFAULT_DAY_CHECK
): DetectedAlert[] => {
  const date = day.workDate;
  const valid = sortValidPunches(punches);
  const timeOf = (p: Punch) => minutesToHHmm(minutesFromWorkDate(date, p.punchedAt));
  const punchList = valid.map((p) => `${p.kind} ${timeOf(p)}`);
  const alerts: DetectedAlert[] = [];
  const shift = day.shift;
  const workShift = shift && (shift.kind === "work" || shift.kind === "paid_leave_half") ? shift : null;

  // CH-01 打刻漏れ
  if (day.gaps.includes("missing_clock_out")) {
    alerts.push(alertOf(date, "missing_clock_out", "退勤の打刻がありません", { punches: punchList }));
  }
  if (day.gaps.includes("missing_break_end")) {
    alerts.push(alertOf(date, "missing_break_end", "休憩の終わりの打刻がありません", { punches: punchList }));
  }
  if (day.gaps.includes("missing_clock_in")) {
    alerts.push(alertOf(date, "missing_clock_in", "出勤の打刻がありません", { punches: punchList }));
  }

  // CH-06 予定があるのに打刻なし
  if (workShift && valid.length === 0) {
    alerts.push(
      alertOf(date, "no_punch", `シフトがありますが、打刻がありません（予定 ${workShift.startTime}〜${workShift.endTime}）`, {
        kind: workShift.kind,
        start: workShift.startTime,
        end: workShift.endTime,
      })
    );
  }

  // CH-02 重複打刻の疑い(1: 同じ種類の連続、2: 退勤からすぐの再出勤、3: 勤務のかたまりが3つ以上)
  const reasons: string[] = [];
  for (let i = 1; i < valid.length; i++) {
    if (valid[i].kind === valid[i - 1].kind) {
      reasons.push(`${PUNCH_LABELS[valid[i].kind]}の打刻が2回続いています（${timeOf(valid[i - 1])}・${timeOf(valid[i])}）`);
    }
  }
  for (let i = 1; i < day.blocks.length; i++) {
    const prevEnd = day.blocks[i - 1].end;
    if (prevEnd === null) continue;
    const gap = day.blocks[i].start - prevEnd;
    if (gap >= 0 && gap <= options.reworkGapMinutes) reasons.push(`退勤の${gap}分後に再出勤しています`);
  }
  if (day.blocks.length >= 3) reasons.push(`1日の勤務が${day.blocks.length}回に分かれています`);
  if (reasons.length > 0) {
    alerts.push(alertOf(date, "duplicate_punch", reasons.join("／"), { reasons, punches: punchList }));
  }

  // CH-03 休憩の未取得・不足(打刻漏れのある日は判定しない)。休憩＋中抜けで数える
  if (day.gaps.length === 0 && day.workedMinutes !== null) {
    const worked = day.workedMinutes;
    const rest = (day.breakMinutes ?? 0) + (day.awayMinutes ?? 0);
    const required = requiredBreakMinutes(worked, options.breakRules);
    if (rest < required) {
      const message =
        rest === 0
          ? `休憩が取られていません（実働 ${hoursMinutesText(worked)}）`
          : `休憩が足りません（実働 ${hoursMinutesText(worked)}、休憩${rest}分／必要${required}分）`;
      alerts.push(alertOf(date, "break_short", message, { worked, break: rest, required }));
    }
  }

  // CH-05 シフトとのずれ(出勤のシフトがあり、打刻漏れが無い日)
  if (workShift && workShift.startTime && workShift.endTime && day.gaps.length === 0) {
    const parts: string[] = [];
    const start = hhmmToMinutes(workShift.startTime);
    const end = hhmmToMinutes(workShift.endTime);
    if (day.firstIn !== null && Math.abs(day.firstIn - start) >= options.deviationMinutes) {
      const diff = day.firstIn - start;
      parts.push(
        `予定より ${Math.abs(diff)}分${diff > 0 ? "遅い" : "早い"}出勤（予定 ${workShift.startTime}・実績 ${minutesToHHmm(day.firstIn)}）`
      );
    }
    if (day.lastOut !== null && Math.abs(day.lastOut - end) >= options.deviationMinutes) {
      const diff = day.lastOut - end;
      parts.push(
        `予定より ${Math.abs(diff)}分${diff > 0 ? "遅い" : "早い"}退勤（予定 ${workShift.endTime}・実績 ${minutesToHHmm(day.lastOut)}）`
      );
    }
    if (parts.length > 0) {
      alerts.push(
        alertOf(date, "shift_deviation", parts.join("／"), {
          start: workShift.startTime,
          end: workShift.endTime,
          firstIn: day.firstIn,
          lastOut: day.lastOut,
        })
      );
    }
  }

  // CH-07 予定のない日・休業日の勤務
  if (valid.length > 0) {
    const parts: string[] = [];
    if (!shift) parts.push("シフトの無い日の勤務です");
    else if (!workShift) parts.push(`休みの予定（${SHIFT_KIND_LABELS[shift.kind]}）の日の勤務です`);
    if (context.closedDayName) parts.push(`${context.closedDayName}（${WEEKDAY_LABELS[weekdayOfDateStr(date)]}）の勤務です`);
    if (parts.length > 0) {
      alerts.push(
        alertOf(date, "work_without_shift", parts.join("／"), {
          shift: shift?.kind ?? null,
          closedDay: context.closedDayName,
        })
      );
    }
  }

  // CH-08 範囲外・位置情報なしの打刻(1日に1件にまとめる)
  const offsite = valid.filter((p) => p.locationStatus === "out_of_range" || p.locationStatus === "unavailable");
  if (offsite.length > 0) {
    const allOut = offsite.every((p) => p.locationStatus === "out_of_range");
    const allNone = offsite.every((p) => p.locationStatus === "unavailable");
    const head = allOut ? "店舗・工場から離れた打刻" : allNone ? "位置情報の無い打刻" : "店舗・工場から離れた打刻・位置情報の無い打刻";
    const items = offsite.map((p) => {
      if (p.locationStatus === "unavailable") return `${PUNCH_LABELS[p.kind]} ${timeOf(p)}・位置情報なし`;
      const kind = context.locationKindOf(p.locationId);
      return `${PUNCH_LABELS[p.kind]} ${timeOf(p)}・${kind ? PLACE_LABELS[kind] : "打刻場所"}から${p.distanceM ?? 0}m`;
    });
    alerts.push(
      alertOf(date, "location_check", `${head}が${offsite.length}件あります（${items.join("、")}）`, {
        punches: offsite.map((p) => `${p.id} ${p.locationStatus}`),
      })
    );
  }

  return alerts;
};

export type OvertimeLimits = { limit: number; warning: number };
const DEFAULT_OVERTIME_LIMITS: OvertimeLimits = {
  limit: OVERTIME_MONTHLY_LIMIT_MINUTES,
  warning: OVERTIME_WARNING_MINUTES,
};

// CH-04 時間外の上限超過の予兆・超過(期間ごと。work_date は期間の最初の日)。
// actual は今日より前の日の時間外の合計、planned は actual に今日から期間の最後までの予定の時間外を足したもの。
// 超過のときは予兆を出さない(予兆の行は「直った」として解決になる)
export const detectOvertimeAlerts = (
  periodFrom: string,
  actual: number,
  planned: number,
  limits: OvertimeLimits = DEFAULT_OVERTIME_LIMITS
): DetectedAlert[] => {
  if (actual > limits.limit) {
    return [
      alertOf(
        periodFrom,
        "overtime_over",
        `今月の時間外が上限を超えました（${hoursMinutes(actual)}／上限 ${hoursMinutes(limits.limit)}）`,
        { actual, limit: limits.limit }
      ),
    ];
  }
  if (actual > limits.warning) {
    return [
      alertOf(
        periodFrom,
        "overtime_warning",
        `今月の時間外が ${hoursMinutes(actual)} です（注意の線 ${hoursMinutes(limits.warning)}・上限 ${hoursMinutes(limits.limit)}）`,
        { basis: "actual", actual, warning: limits.warning, limit: limits.limit }
      ),
    ];
  }
  if (planned > limits.limit) {
    return [
      alertOf(
        periodFrom,
        "overtime_warning",
        `このまま予定どおり働くと、今月の時間外が ${hoursMinutes(planned)} になります（上限 ${hoursMinutes(limits.limit)}）`,
        { basis: "planned", actual, planned, limit: limits.limit }
      ),
    ];
  }
  return [];
};

// 予定(シフト)どおりに働いたとした1日(CH-04 の予定・G03 の見込み)。休みの区分・予定なしは勤務なし
export const plannedAttendanceDay = (workDate: string, shift: Shift | null, isClosedDay: boolean): AttendanceDay => {
  const base = buildAttendanceDay(workDate, [], shift, isClosedDay);
  if (!shift || !shift.startTime || !shift.endTime || (shift.kind !== "work" && shift.kind !== "paid_leave_half")) return base;
  const start = hhmmToMinutes(shift.startTime);
  const end = hhmmToMinutes(shift.endTime);
  return {
    ...base,
    blocks: [{ start, end, breaks: [] }],
    firstIn: start,
    lastOut: end,
    boundMinutes: end - start,
    breakMinutes: shift.breakMinutes,
    awayMinutes: 0,
    workedMinutes: Math.max(0, end - start - shift.breakMinutes),
    nightMinutes: 0,
    lateMinutes: 0,
    earlyMinutes: 0,
    deviation: false,
  };
};

export type PeriodCheckInput = {
  period: { from: string; to: string };
  // 今日(日本時間)。打刻のチェック(CH-01〜CH-03・CH-05〜CH-08)は今日より前の日だけ(CH-14)
  today: string;
  // 期間の最初の日を含む週の始まり〜期間の最後の日の打刻・シフト・休業日(日付 → 休業日の名前)
  punchesByDate: Map<string, Punch[]>;
  shiftsByDate: Map<string, Shift>;
  closedDays: Map<string, string>;
  weeklyLegalMinutes: number;
  // 入社日の前・退職日の後は対象外(CH-14)
  hiredOn: string | null;
  retiredOn: string | null;
  locationKindOf: DayCheckContext["locationKindOf"];
};

export type PeriodCheckResult = {
  alerts: DetectedAlert[];
  // 打刻のチェックをした最後の日(期間の最初の日より前なら、打刻のチェックはしていない)
  checkedTo: string;
  actualOvertimeMinutes: number;
  plannedOvertimeMinutes: number;
};

// 03 の 0.3 手順2・3 1人・1期間の異常の一覧を作る。
// 時間外の予定は「昨日までの実績＋今日から期間の最後までのシフト」で計算する(今日はまだ勤務中のことがあるため予定で数える)
export const detectPeriodAlerts = (input: PeriodCheckInput): PeriodCheckResult => {
  const { period, today } = input;
  const yesterday = addDays(today, -1);
  const checkedTo = period.to < yesterday ? period.to : yesterday;
  const inEmployment = (d: string) => (!input.hiredOn || d >= input.hiredOn) && (!input.retiredOn || d <= input.retiredOn);
  const alerts: DetectedAlert[] = [];
  const actualDays: AttendanceDay[] = [];
  const plannedDays: AttendanceDay[] = [];
  for (let d = weekStartOf(period.from); d <= period.to; d = addDays(d, 1)) {
    const shift = input.shiftsByDate.get(d) ?? null;
    const closedName = input.closedDays.get(d) ?? null;
    if (d <= yesterday) {
      const punches = input.punchesByDate.get(d) ?? [];
      const day = buildAttendanceDay(d, punches, shift, closedName !== null);
      actualDays.push(day);
      plannedDays.push(day);
      if (d >= period.from && inEmployment(d)) {
        alerts.push(...detectDayAlerts(day, punches, { closedDayName: closedName, locationKindOf: input.locationKindOf }));
      }
    } else {
      plannedDays.push(plannedAttendanceDay(d, inEmployment(d) ? shift : null, closedName !== null));
    }
  }
  const actual = summarizePeriod(actualDays, input.weeklyLegalMinutes, { from: period.from, to: checkedTo });
  const planned = summarizePeriod(plannedDays, input.weeklyLegalMinutes, period);
  alerts.push(...detectOvertimeAlerts(period.from, actual.overtimeMinutes, planned.overtimeMinutes));
  return {
    alerts,
    checkedTo,
    actualOvertimeMinutes: actual.overtimeMinutes,
    plannedOvertimeMinutes: planned.overtimeMinutes,
  };
};

// CH-09 並びの決まり。有効な打刻が「出勤 →（休憩開始 → 休憩終了）× n → 退勤」の繰り返しになれるか。
// 退勤がまだ無い(途中の)状態は許す。だめなら理由の文を返す(よければ null)
export const punchSequenceError = (punches: Punch[]): string | null => {
  let state: "off" | "working" | "on_break" = "off";
  for (const p of sortValidPunches(punches)) {
    const need =
      p.kind === "clock_in"
        ? state === "off" ? null : state === "on_break" ? "休憩終了と退勤" : "退勤"
        : p.kind === "break_start"
          ? state === "working" ? null : state === "on_break" ? "休憩終了" : "出勤"
          : p.kind === "break_end"
            ? state === "on_break" ? null : state === "working" ? "休憩開始" : "出勤と休憩開始"
            : state === "working" ? null : state === "on_break" ? "休憩終了" : "出勤";
    if (need) return `打刻の順番が合いません（${PUNCH_LABELS[p.kind]}の前に${need}が必要です）。`;
    state = p.kind === "clock_in" || p.kind === "break_end" ? "working" : p.kind === "break_start" ? "on_break" : "off";
  }
  return null;
};
