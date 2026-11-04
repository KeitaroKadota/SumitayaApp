// 祝日・休業日と、日付の共通関数(CMN-02 03 の 0.1、01 7.1)。ほかの機能(E-02・D-02・A-03・E-04〜E-06・CMN-03)も使う。
// 日付は "YYYY-MM-DD" の文字列で受け渡す。画面に出すときは src/utils/format.ts を使う。
// 祝日の計算(japaneseHolidays)はみるきーの holidays.ts をそのまま流用した。シート用の部分は持ってこない。
// DBを読む関数は、読めなかったときに例外を投げる(休業日が分からないまま計算しない。呼ぶ側でエラーの扱いを決める)。
import { query } from "@/utils/db";
import type { HolidayKind } from "@/utils/masterRules";

// 定休日の曜日(0=日〜6=土)。水・木(CMN-02 01 6.6)
export const REGULAR_CLOSED_WEEKDAYS = [3, 4] as const;
export const REGULAR_CLOSED_NAME = "定休日";

// 祝日の行を作るときの「休業か」の初期値。【仮】祝日は営業日とする(00_仮決め一覧 CMN02-仮-04)
export const NATIONAL_HOLIDAY_IS_CLOSED = false;

// ---- 日付の計算(DBを読まない) ----

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const weekdayOf = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();

// 日付に日数を足す(サーバーのタイムゾーンに左右されない)
export const addDays = (date: string, days: number): string => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

// その月の第n月曜日
const nthMonday = (y: number, m: number, n: number) => {
  const first = weekdayOf(y, m, 1);
  return 1 + ((8 - first) % 7) + (n - 1) * 7;
};

// 春分・秋分の日(1980〜2099年の近似式)
const equinoxDay = (y: number, base: number) => Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));

// 対象年の国民の祝日(振替休日・国民の休日を含む)を日付昇順で返す。特例の年の移動は反映しない(違う年は画面で直す)
export const japaneseHolidays = (year: number): { date: string; name: string }[] => {
  const base: [string, string][] = [
    [ymd(year, 1, 1), "元日"],
    [ymd(year, 1, nthMonday(year, 1, 2)), "成人の日"],
    [ymd(year, 2, 11), "建国記念の日"],
    [ymd(year, 2, 23), "天皇誕生日"],
    [ymd(year, 3, equinoxDay(year, 20.8431)), "春分の日"],
    [ymd(year, 4, 29), "昭和の日"],
    [ymd(year, 5, 3), "憲法記念日"],
    [ymd(year, 5, 4), "みどりの日"],
    [ymd(year, 5, 5), "こどもの日"],
    [ymd(year, 7, nthMonday(year, 7, 3)), "海の日"],
    [ymd(year, 8, 11), "山の日"],
    [ymd(year, 9, nthMonday(year, 9, 3)), "敬老の日"],
    [ymd(year, 9, equinoxDay(year, 23.2488)), "秋分の日"],
    [ymd(year, 10, nthMonday(year, 10, 2)), "スポーツの日"],
    [ymd(year, 11, 3), "文化の日"],
    [ymd(year, 11, 23), "勤労感謝の日"],
  ];
  const map = new Map(base);
  const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

  // 国民の休日: 前日と翌日が祝日で、その日が日曜でも祝日でもない日
  for (const [date] of base) {
    const next = addDays(date, 1);
    const afterNext = addDays(date, 2);
    if (map.has(afterNext) && !map.has(next) && !isSunday(next) && next.startsWith(`${year}-`)) map.set(next, "国民の休日");
  }

  // 振替休日: 日曜の祝日の後の、最初の祝日でない日
  for (const date of [...map.keys()].sort()) {
    if (!isSunday(date)) continue;
    let d = addDays(date, 1);
    while (map.has(d)) d = addDays(d, 1);
    if (d.startsWith(`${year}-`)) map.set(d, "振替休日");
  }

  return [...map.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date));
};

// EV-18 手順2・3: 「この年の休日を作る」で作る候補。祝日(営業)と、すべての水・木(定休日・休み)。
// 祝日と定休日が同じ日は、祝日の名前で休みの1行にする。
export const yearHolidayCandidates = (
  year: number
): { date: string; name: string; kind: HolidayKind; isClosed: boolean }[] => {
  const national = new Map(japaneseHolidays(year).map((h) => [h.date, h.name]));
  const rows: { date: string; name: string; kind: HolidayKind; isClosed: boolean }[] = [];
  for (let d = `${year}-01-01`; d.startsWith(`${year}-`); d = addDays(d, 1)) {
    const regular = (REGULAR_CLOSED_WEEKDAYS as readonly number[]).includes(new Date(`${d}T00:00:00Z`).getUTCDay());
    const holidayName = national.get(d);
    if (holidayName) rows.push({ date: d, name: holidayName, kind: "national", isClosed: regular || NATIONAL_HOLIDAY_IS_CLOSED });
    else if (regular) rows.push({ date: d, name: REGULAR_CLOSED_NAME, kind: "regular", isClosed: true });
  }
  return rows;
};

// ---- DBの暦(holidays)を使う関数 ----

export type CalendarDay = { name: string; kind: HolidayKind; isClosed: boolean };

// 期間内の holidays の行を、日付 → {名前・種別・休業か} の対応表で返す(DBを1回読む)
export const getCalendar = async (from: string, to: string): Promise<Map<string, CalendarDay>> => {
  const rows = await query(
    (sql) => sql<{ day: string; name: string; kind: HolidayKind; is_closed: boolean }[]>`
      select to_char(holiday_on, 'YYYY-MM-DD') as day, name, kind, is_closed
      from holidays where holiday_on between ${from} and ${to}`
  );
  return new Map(rows.map((r) => [r.day, { name: r.name, kind: r.kind, isClosed: r.is_closed }]));
};

// 店舗・工場の休業日か(holidays の is_closed)。行が無い日は営業日
export const isClosedDay = async (date: string): Promise<boolean> => {
  const calendar = await getCalendar(date, date);
  return calendar.get(date)?.isClosed ?? false;
};

// 休業日を飛ばして n 営業日後の日付(n は0以上。0ならその日から数えず、そのまま返す)。
// 先の90日分を読み、足りなければ続けて読む
const CALENDAR_CHUNK_DAYS = 90;
export const addBusinessDays = async (date: string, n: number): Promise<string> => {
  if (!Number.isInteger(n) || n < 0) throw new Error("addBusinessDays: 日数は0以上の整数で渡してください");
  let remaining = n;
  let current = date;
  while (remaining > 0) {
    const from = addDays(current, 1);
    const to = addDays(current, CALENDAR_CHUNK_DAYS);
    const calendar = await getCalendar(from, to);
    for (let d = from; d <= to; d = addDays(d, 1)) {
      current = d;
      if (!calendar.get(d)?.isClosed) remaining -= 1;
      if (remaining === 0) break;
    }
  }
  return current;
};

// ---- 銀行の休日(土日・国民の祝日・12/31〜1/3。店舗の定休日・臨時休業は見ない) ----

const isYearEndHoliday = (date: string) => {
  const md = date.slice(5);
  return md === "12-31" || md === "01-01" || md === "01-02" || md === "01-03";
};

// その年の祝日の日付。holidays の national の行(is_closed は問わない)を使い、1件も無い年は計算で決める
const nationalHolidayDates = async (year: number): Promise<Set<string>> => {
  const rows = await query(
    (sql) => sql<{ day: string }[]>`
      select to_char(holiday_on, 'YYYY-MM-DD') as day from holidays
      where kind = 'national' and holiday_on between ${`${year}-01-01`} and ${`${year}-12-31`}`
  );
  if (rows.length > 0) return new Set(rows.map((r) => r.day));
  return new Set(japaneseHolidays(year).map((h) => h.date));
};

export const isBankHoliday = async (date: string): Promise<boolean> => {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return true;
  if (isYearEndHoliday(date)) return true;
  const national = await nationalHolidayDates(Number(date.slice(0, 4)));
  return national.has(date);
};

// 銀行の休日なら、前(previous)または後(next)の銀行の営業日にずらす。休日でなければそのまま。最大10日
const MAX_BANK_SHIFT_DAYS = 10;
export const adjustToBankBusinessDay = async (date: string, direction: "previous" | "next"): Promise<string> => {
  let current = date;
  for (let i = 0; i <= MAX_BANK_SHIFT_DAYS; i += 1) {
    if (!(await isBankHoliday(current))) return current;
    current = addDays(current, direction === "previous" ? -1 : 1);
  }
  throw new Error(`adjustToBankBusinessDay: ${date} から${MAX_BANK_SHIFT_DAYS}日以内に銀行の営業日がありません`);
};
