// G11 の表示する年(EV-17 手順2: 2000〜2100 の整数でなければ今年)。DBを読まないファイル。
import { todayJST } from "@/utils/jst";

export const MIN_YEAR = 2000;
export const MAX_YEAR = 2100;

export const parseYear = (value: unknown): number => {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR ? n : Number(todayJST().slice(0, 4));
};

export const holidaysUrl = (year: number, extra = "") => `/admin/holidays?year=${year}${extra}`;
