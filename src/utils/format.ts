// 画面の表示の形式(00_画面共通ルール 6.2)。画面では直接 toLocaleString を書かず、ここの関数を使う。
// 日時は日本時間で表示する。日付(date の列)は "YYYY-MM-DD" の文字列で受け取る。
import { weekdayOfDateStr } from "@/utils/jst";

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const MINUS = "−";

const pad2 = (n: number) => String(n).padStart(2, "0");

// Date・ISO文字列を日本時間の年月日・時分に分ける
const jstParts = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute") };
};

const toDateStr = (value: Date | string): string => {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const { y, m, d } = jstParts(value);
  return `${y}-${m}-${d}`;
};

// 2026/11/20（金）
export const formatDate = (value: Date | string): string => {
  const date = toDateStr(value);
  return `${date.replace(/-/g, "/")}（${WEEKDAYS[weekdayOfDateStr(date)]}）`;
};

// 11/20（金）(表の中・短く)
export const formatDateShort = (value: Date | string): string => {
  const date = toDateStr(value);
  return `${date.slice(5).replace("-", "/")}（${WEEKDAYS[weekdayOfDateStr(date)]}）`;
};

// 2026/11/20 08:31
export const formatDateTime = (value: Date | string): string => {
  const { y, m, d, hh, mm } = jstParts(value);
  return `${y}/${m}/${d} ${hh}:${mm}`;
};

// 08:31
export const formatTime = (value: Date | string): string => {
  const { hh, mm } = jstParts(value);
  return `${hh}:${mm}`;
};

// 時間の長さ。スマホは「7時間30分」、表とCSVは「7:30」
export const formatDuration = (minutes: number, style: "text" | "table" = "text"): string => {
  const sign = minutes < 0 ? MINUS : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (style === "table") return `${sign}${h}:${pad2(m)}`;
  if (h === 0) return `${sign}${m}分`;
  return m === 0 ? `${sign}${h}時間` : `${sign}${h}時間${m}分`;
};

// 2026年11月(month は 1〜12)
export const formatYearMonth = (year: number, month: number): string => `${year}年${month}月`;

const formatNumber = (n: number): string => {
  const abs = Math.abs(n).toLocaleString("ja-JP");
  return n < 0 ? `${MINUS}${abs}` : abs;
};

// 12,345円（税込）。tax を省くと「円」だけ(見出しに書いた場合など)
export const formatYen = (amount: number, tax?: "included" | "excluded"): string => {
  const suffix = tax === "included" ? "（税込）" : tax === "excluded" ? "（税抜）" : "";
  return `${formatNumber(amount)}円${suffix}`;
};

// 1,200枚(unit を省くと数字だけ)
export const formatQuantity = (n: number, unit = ""): string => `${formatNumber(n)}${unit}`;

// 12.5％(ratio は 0.125 のような割合)
export const formatPercent = (ratio: number): string => {
  const value = (ratio * 100).toFixed(1);
  return value.startsWith("-") ? `${MINUS}${value.slice(1)}％` : `${value}％`;
};

// 2026年11月20日(請求書の紙に書く日付。E-05 G03。みるきーの formatJaDate を流用)
export const formatJaDate = (date: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${Number(date.slice(0, 4))}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日` : date;

// URL の ?ids=a,b や ?ids=a&ids=b を、空・重複を除いた並びにする(印刷のページ。みるきーの parseIdList を流用)
export const parseIdList = (value: string | string[] | null | undefined): string[] => {
  const raw = Array.isArray(value) ? value.join(",") : (value ?? "");
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
};
