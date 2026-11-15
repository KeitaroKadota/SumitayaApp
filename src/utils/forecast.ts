// 需要予測の計算(A-03 01 4.2 の手順1〜6、03 の 0.1・0.2、04 CH-03・CH-04・CH-14)。DBを読まない計算だけのファイル。
// 仮の値は、設定画面を作らずここの定数 FORECAST_DEFAULTS の1か所に置く(00_仮決め一覧 A-03-仮-01〜05・07)。
import { addDays, diffDays } from "@/utils/salesPeriod";
import { weekdayOfDateStr } from "@/utils/jst";
import type { AbcRank } from "@/utils/abc";

export const FORECAST_DEFAULTS = {
  // 予測する週数(週は月曜はじまり)
  weeks: 12,
  // 既定のリードタイム(日。商品にも仕入先にも無いとき。A-03-仮-05)
  defaultLeadTimeDays: 14,
  // 安全の週数・発注の間隔(週)。ランクが無い商品は B として扱う(A-03-仮-03)
  safetyWeeks: { A: 2.0, B: 1.0, C: 0.5 } as Record<AbcRank, number>,
  reviewWeeks: { A: 2, B: 2, C: 1 } as Record<AbcRank, number>,
  // 手順1 去年の同じ曜日(364日前)
  lastYearShiftDays: 364,
  // 手順3 伸び率: 直近12週、分母が商品で10未満なら分類、分類で30未満なら店全体。0.5〜2.0 に収める(CH-03)
  growthWeeks: 12,
  growthMinProduct: 10,
  growthMinCategory: 30,
  growthRange: { min: 0.5, max: 2.0 },
  // 手順5 補正: 直近8週、予測の合計が10未満なら 1.0。0.7〜1.3 に収める(CH-04)
  biasWeeks: 8,
  biasMinForecast: 10,
  biasRange: { min: 0.7, max: 1.3 },
  // 去年の記録が無い商品は、直近8週の平均
  recentWeeks: 8,
  // 在庫が古いとみなす日数(CH-01)
  stockStaleDays: 1,
  // CH-02 直近何日に売上がある商品を対象にするか(2年)
  targetSalesDays: 730,
  // CH-14 1週の予測が、去年の同じ時期の最大の週の何倍を超えたら印を出すか
  tooLargeFactor: 3,
  // 予測の回を残す日数(A-03-仮-07)
  keepDays: 365,
} as const;

export type FestivalEvent = {
  id: string;
  seriesKey: string;
  name: string;
  startDate: string;
  endDate: string;
  categoryCodes: string[];
  influenceDaysBefore: number;
  influenceDaysAfter: number;
  adjustFactor: number;
  isHeld: boolean;
};

// 予測を始める週の月曜日。【仮】今日が月曜なら今日、それ以外は次の月曜(03 EV-01 手順2「次の月曜日から」)
export const forecastStartOf = (today: string): string => {
  const wd = weekdayOfDateStr(today);
  return wd === 1 ? today : addDays(today, (8 - wd) % 7);
};

export const forecastWeeks = (start: string, weeks: number = FORECAST_DEFAULTS.weeks): string[] =>
  Array.from({ length: weeks }, (_, i) => addDays(start, i * 7));

// 日別の販売数の、start から days 日分の合計
export const sumDays = (daily: Map<string, number>, start: string, days: number): number => {
  let total = 0;
  for (let i = 0; i < days; i++) total += daily.get(addDays(start, i)) ?? 0;
  return total;
};

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

// ---- 手順3 伸び率(CH-03) ----

export type Growth = { rate: number; basis: "product" | "category" | "store"; clamped: "upper" | "lower" | null };

export const calcGrowth = (
  product: { recent: number; lastYear: number },
  category: { recent: number; lastYear: number } | null,
  store: { recent: number; lastYear: number },
  d = FORECAST_DEFAULTS
): Growth => {
  let raw: number;
  let basis: Growth["basis"];
  if (product.lastYear >= d.growthMinProduct) [raw, basis] = [product.recent / product.lastYear, "product"];
  else if (category && category.lastYear >= d.growthMinCategory) [raw, basis] = [category.recent / category.lastYear, "category"];
  else [raw, basis] = [store.lastYear > 0 ? store.recent / store.lastYear : 1, "store"];
  const rate = clamp(raw, d.growthRange.min, d.growthRange.max);
  return { rate, basis, clamped: raw > d.growthRange.max ? "upper" : raw < d.growthRange.min ? "lower" : null };
};

// ---- 手順5 補正(CH-04) ----

// weeks: 直近の週ごとの実績と、その週が始まる前の最後の計算の予測(無い週は比べない)
export const calcBias = (weeks: { actual: number; forecast: number | null }[], d = FORECAST_DEFAULTS): number => {
  const compared = weeks.filter((w) => w.forecast !== null);
  const forecastTotal = compared.reduce((s, w) => s + (w.forecast as number), 0);
  if (forecastTotal < d.biasMinForecast) return 1;
  const actualTotal = compared.reduce((s, w) => s + w.actual, 0);
  return clamp(actualTotal / forecastTotal, d.biasRange.min, d.biasRange.max);
};

// ---- 0.2 祭りに合わせてずらす日数・手順4 祭りの倍率 ----

export type FestivalMatch = { shiftDays: number; event: FestivalEvent | null; factor: number };

const appliesTo = (e: FestivalEvent, categoryCode: string | null) =>
  e.categoryCodes.length === 0 || (categoryCode !== null && e.categoryCodes.includes(categoryCode));

export const matchFestival = (
  weekStart: string,
  categoryCode: string | null,
  festivals: FestivalEvent[],
  salesRange: { first: string; last: string } | null,
  d = FORECAST_DEFAULTS
): FestivalMatch => {
  // 手順1・2 影響の期間に入る、対象の分類の祭り。複数なら初日が一番近いもの
  const candidates = festivals
    .filter(
      (e) =>
        weekStart >= addDays(e.startDate, -e.influenceDaysBefore) &&
        weekStart <= addDays(e.endDate, e.influenceDaysAfter) &&
        appliesTo(e, categoryCode)
    )
    .sort((a, b) => Math.abs(diffDays(weekStart, a.startDate)) - Math.abs(diffDays(weekStart, b.startDate)));
  const e = candidates[0];
  if (!e) return { shiftDays: d.lastYearShiftDays, event: null, factor: 1 };
  // 手順4 倍率(中止なら0)
  const factor = e.isHeld ? e.adjustFactor : 0;
  // 手順3 同じつなぐ名前で、E より前に開催した一番新しい祭り
  const prev = festivals
    .filter((p) => p.seriesKey === e.seriesKey && p.startDate < e.startDate && p.isHeld)
    .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
  if (!prev) return { shiftDays: d.lastYearShiftDays, event: e, factor };
  // 手順4・5 ずらす日数。ずらした先が売上を取り込んである期間の外なら 364 日に戻す
  const shift = diffDays(prev.startDate, e.startDate);
  const from = addDays(weekStart, -shift - 7);
  const to = addDays(weekStart, -shift + 13);
  if (!salesRange || from < salesRange.first || to > salesRange.last) return { shiftDays: d.lastYearShiftDays, event: e, factor };
  return { shiftDays: shift, event: e, factor };
};

// ---- 0.1 forecastProduct ----

export type WeekForecast = {
  weekStart: string;
  method: "last_year" | "recent_average" | "no_data";
  baseQty: number;
  festivalEventId: string | null;
  shiftDays: number;
  growthRate: number;
  growthBasis: Growth["basis"];
  festivalFactor: number;
  biasFactor: number;
  forecastValue: number;
  forecastQty: number;
};

export type ForecastProductInput = {
  categoryCode: string | null;
  // 日別の販売数(必要な日だけ。無い日は0)
  daily: Map<string, number>;
  // 手順1 365日より前に1つでも売上があるか
  hasLastYear: boolean;
  growth: Growth;
  bias: number;
  // 予測を始める週の月曜日
  start: string;
  weeks: string[];
  festivals: FestivalEvent[];
  salesRange: { first: string; last: string } | null;
};

export const forecastProduct = (input: ForecastProductInput, d = FORECAST_DEFAULTS): WeekForecast[] => {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  if (!input.hasLastYear) {
    // 去年の記録が無い商品: 直近8週の1週あたりの平均(手順2〜4は使わない)。それも0なら予測0
    const avg = sumDays(input.daily, addDays(input.start, -d.recentWeeks * 7), d.recentWeeks * 7) / d.recentWeeks;
    const method = avg > 0 ? "recent_average" : "no_data";
    return input.weeks.map((w) => ({
      weekStart: w,
      method,
      baseQty: round2(avg),
      festivalEventId: null,
      shiftDays: d.lastYearShiftDays,
      growthRate: 1,
      growthBasis: "product",
      festivalFactor: 1,
      biasFactor: 1,
      forecastValue: round2(avg),
      forecastQty: Math.max(0, Math.round(avg)),
    }));
  }
  return input.weeks.map((w) => {
    const m = matchFestival(w, input.categoryCode, input.festivals, input.salesRange, d);
    const at = addDays(w, -m.shiftDays);
    // 手順1 基準 ＝(前の週 ＋ 2×その週 ＋ 次の週)÷ 4
    const base = (sumDays(input.daily, addDays(at, -7), 7) + 2 * sumDays(input.daily, at, 7) + sumDays(input.daily, addDays(at, 7), 7)) / 4;
    // 手順6 予測 ＝ 基準 × 伸び率 × 祭りの倍率 × 補正(マイナスにしない。CH-14)
    const value = Math.max(0, base * input.growth.rate * m.factor * input.bias);
    return {
      weekStart: w,
      method: "last_year" as const,
      baseQty: round2(base),
      festivalEventId: m.event?.id ?? null,
      shiftDays: m.shiftDays,
      growthRate: Math.round(input.growth.rate * 1000) / 1000,
      growthBasis: input.growth.basis,
      festivalFactor: m.factor,
      biasFactor: Math.round(input.bias * 1000) / 1000,
      forecastValue: round2(value),
      forecastQty: Math.round(value),
    };
  });
};

// 予測に使う日の一覧(03 EV-02 手順4: 去年の予測期間の前後と祭りでずらす分、直近12週、去年の同じ12週)
export const neededSalesDates = (start: string, weeks: string[], festivals: FestivalEvent[], d = FORECAST_DEFAULTS): string[] => {
  const dates = new Set<string>();
  const addRange = (from: string, days: number) => {
    for (let i = 0; i < days; i++) dates.add(addDays(from, i));
  };
  const recentDays = Math.max(d.growthWeeks, d.recentWeeks, d.biasWeeks) * 7;
  addRange(addDays(start, -recentDays), recentDays);
  addRange(addDays(start, -recentDays - d.lastYearShiftDays), recentDays);
  for (const w of weeks) {
    const shifts = new Set<number>([d.lastYearShiftDays]);
    // 分類を問わず、その週に当たりうる祭りのずらす日数(売上の期間の確かめは計算のときに行う)
    for (const e of festivals) {
      if (w < addDays(e.startDate, -e.influenceDaysBefore) || w > addDays(e.endDate, e.influenceDaysAfter)) continue;
      const prev = festivals
        .filter((p) => p.seriesKey === e.seriesKey && p.startDate < e.startDate && p.isHeld)
        .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0];
      if (prev) shifts.add(diffDays(prev.startDate, e.startDate));
    }
    for (const s of shifts) addRange(addDays(w, -s - 7), 21);
  }
  return [...dates].sort();
};
