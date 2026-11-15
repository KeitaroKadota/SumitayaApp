// 祭礼カレンダー(festival_events。A-03 01 6.1、03 EV-05、04 CH-05)の読み書き。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("sales", …) 済みの前提)。
import { query, queryOn, type TransactionSql } from "@/utils/db";
import type { FestivalEvent } from "@/utils/forecast";
import { PRODUCT_CATEGORIES } from "@/utils/masterRules";
import { diffDays } from "@/utils/salesPeriod";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

export type FestivalRow = FestivalEvent & { region: string | null; note: string | null };

type DbRow = {
  id: string;
  series_key: string;
  name: string;
  start_date: string;
  end_date: string;
  region: string | null;
  category_codes: string[];
  influence_days_before: number;
  influence_days_after: number;
  adjust_factor: string;
  is_held: boolean;
  note: string | null;
};
const toRow = (r: DbRow): FestivalRow => ({
  id: r.id,
  seriesKey: r.series_key,
  name: r.name,
  startDate: r.start_date,
  endDate: r.end_date,
  region: r.region,
  categoryCodes: r.category_codes,
  influenceDaysBefore: r.influence_days_before,
  influenceDaysAfter: r.influence_days_after,
  adjustFactor: Number(r.adjust_factor),
  isHeld: r.is_held,
  note: r.note,
});

// 期間に初日がある祭礼(from・to を省くとすべて)
export const listFestivals = async (from?: string, to?: string, tx?: TransactionSql): Promise<FestivalRow[]> => {
  const rows = await queryOn(
    tx,
    (sql) => sql<DbRow[]>`
      select id, series_key, name, start_date::text as start_date, end_date::text as end_date, region, category_codes,
             influence_days_before, influence_days_after, adjust_factor, is_held, note
      from festival_events
      where true ${from ? sql`and start_date >= ${from}::date` : sql``} ${to ? sql`and start_date <= ${to}::date` : sql``}
      order by start_date, series_key`
  );
  return rows.map(toRow);
};

export const getFestival = async (id: string): Promise<FestivalRow | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const rows = await query(
    (sql) => sql<DbRow[]>`
      select id, series_key, name, start_date::text as start_date, end_date::text as end_date, region, category_codes,
             influence_days_before, influence_days_after, adjust_factor, is_held, note
      from festival_events where id = ${id}`
  );
  return rows[0] ? toRow(rows[0]) : null;
};

export type FestivalInput = {
  seriesKey: string;
  name: string;
  startDate: string;
  endDate: string;
  region: string | null;
  categoryCodes: string[];
  influenceDaysBefore: number;
  influenceDaysAfter: number;
  adjustFactor: number;
  isHeld: boolean;
  note: string | null;
};

// CH-05 祭礼の入力。だめな項目 → 文。重複(同じつなぐ名前・同じ初日)は保存のときに DB の制約で見る
export const checkFestivalInput = (
  raw: Record<string, string>,
  categories: string[]
): { input: FestivalInput | null; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const seriesKey = raw.series_key.trim();
  const name = raw.name.trim();
  if (!seriesKey || seriesKey.length > 50) errors.series_key = "つなぐ名前を50文字以内で入力してください。";
  if (!name || name.length > 100) errors.name = "名前を100文字以内で入力してください。";
  const start = raw.start_date;
  const end = raw.end_date;
  if (!isValidDateStr(start) || !isValidDateStr(end) || start > end || diffDays(start, end) > 30)
    errors.start_date = "日程は初日〜最終日を、31日以内で入力してください。";
  const intIn = (v: string, min: number, max: number) => {
    const s = toHalfWidth(v).trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= min && n <= max ? n : null;
  };
  const before = intIn(raw.influence_days_before, 0, 120);
  const after = intIn(raw.influence_days_after, 0, 120);
  if (before === null || after === null) errors.influence_days_before = "売れ始め・後の日数は0〜120の整数で入力してください。";
  const factorText = toHalfWidth(raw.adjust_factor).trim();
  const factor = /^\d+(\.\d{1,2})?$/.test(factorText) ? Number(factorText) : NaN;
  if (!(factor >= 0 && factor <= 5)) errors.adjust_factor = "補正の倍率は0.00〜5.00で入力してください。";
  const categoryCodes = raw.category_codes ? raw.category_codes.split(",").filter(Boolean) : [];
  if (categoryCodes.some((c) => !categories.includes(c))) errors.category_codes = "対象の分類を選び直してください。";
  const region = raw.region.trim();
  if (region.length > 100) errors.region = "地域は100文字以内で入力してください。";
  const note = raw.note.trim();
  if (note.length > 500) errors.note = "メモは500文字以内で入力してください。";
  if (Object.keys(errors).length > 0) return { input: null, errors };
  return {
    input: {
      seriesKey,
      name,
      startDate: start,
      endDate: end,
      region: region || null,
      categoryCodes,
      influenceDaysBefore: before as number,
      influenceDaysAfter: after as number,
      adjustFactor: factor,
      isHeld: raw.is_held === "1",
      note: note || null,
    },
    errors,
  };
};

// 対象の分類の選択肢(商品マスタの分類。CMN-02 の定数)
export const festivalCategoryOptions = (): { value: string; label: string }[] =>
  Object.entries(PRODUCT_CATEGORIES).map(([value, label]) => ({ value, label }));

// CH-05 の警告: 同じつなぐ名前で、同じ年に別の祭礼があるか
export const hasSameYearFestival = async (seriesKey: string, startDate: string, exceptId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from festival_events
      where series_key = ${seriesKey} and extract(year from start_date) = ${Number(startDate.slice(0, 4))}
        ${exceptId ? sql`and id <> ${exceptId}` : sql``}`
  );
  return (rows[0]?.n ?? 0) > 0;
};

export const saveFestival = async (id: string | null, input: FestivalInput, by: string): Promise<void> => {
  const v = input;
  if (id) {
    await query(
      (sql) => sql`
        update festival_events set
          series_key = ${v.seriesKey}, name = ${v.name}, start_date = ${v.startDate}, end_date = ${v.endDate}, region = ${v.region},
          category_codes = ${v.categoryCodes}::text[], influence_days_before = ${v.influenceDaysBefore},
          influence_days_after = ${v.influenceDaysAfter}, adjust_factor = ${v.adjustFactor}, is_held = ${v.isHeld},
          note = ${v.note}, updated_by = ${by}
        where id = ${id}`
    );
  } else {
    await query(
      (sql) => sql`
        insert into festival_events (
          series_key, name, start_date, end_date, region, category_codes, influence_days_before, influence_days_after,
          adjust_factor, is_held, note, created_by, updated_by
        ) values (
          ${v.seriesKey}, ${v.name}, ${v.startDate}, ${v.endDate}, ${v.region}, ${v.categoryCodes}::text[], ${v.influenceDaysBefore},
          ${v.influenceDaysAfter}, ${v.adjustFactor}, ${v.isHeld}, ${v.note}, ${by}, ${by}
        )`
    );
  }
};

// 祭礼は消せる(マスタではなく予定のため。消すと次の計算から使われない。EV-05 手順3)
export const deleteFestival = async (id: string): Promise<void> => {
  await query((sql) => sql`delete from festival_events where id = ${id}`);
};
