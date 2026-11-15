// 売上・分析・予測(A-01〜A-05)で使う日付の計算。日付は "YYYY-MM-DD" の文字列で扱う(日本時間の業務日付)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。
import { weekdayOfDateStr } from "@/utils/jst";

// 日付に日数を足す(holidays.ts の addDays と同じ。こちらはDBを読むファイルを読み込まないように別に持つ)
export const addDays = (date: string, days: number): string => {
  const t = new Date(`${date}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
};

const toUtc = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

// to − from の日数
export const diffDays = (from: string, to: string): number => Math.round((toUtc(to) - toUtc(from)) / 86_400_000);

// 月を足す(その月に無い日は月末にする)
export const addMonths = (date: string, months: number): string => {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
};

// その月の初日・末日
export const monthStart = (date: string): string => `${date.slice(0, 7)}-01`;
export const monthEnd = (date: string): string => addDays(addMonths(monthStart(date), 1), -1);

// 直近12か月(先月末まで)。A-01 G01・A-02 の期間の既定
export const lastTwelveMonths = (today: string): { from: string; to: string } => {
  const to = addDays(monthStart(today), -1);
  return { from: addMonths(monthStart(to), -11), to };
};

// その日を含む週の月曜日
export const mondayOf = (date: string): string => addDays(date, -((weekdayOfDateStr(date) + 6) % 7));

// from〜to の月の一覧("YYYY-MM")
export const monthsBetween = (from: string, to: string): string[] => {
  const result: string[] = [];
  for (let m = monthStart(from); m <= to; m = addMonths(m, 1)) result.push(m.slice(0, 7));
  return result;
};

// "YYYY-MM" → 2026年10月
export const yearMonthLabel = (ym: string): string => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
