// 祝日・休業日(CMN-02 G11)の読み書き。呼ぶ側のページ・操作で requireAccess("holidays", …) を済ませておくこと。
// 日付は "YYYY-MM-DD" の文字列で受け渡す。
import { query } from "@/utils/db";
import type { HolidayKind } from "@/utils/masterRules";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type HolidayRow = { id: string; date: string; name: string; kind: HolidayKind; isClosed: boolean; note: string | null };

type Row = { id: string; day: string; name: string; kind: HolidayKind; is_closed: boolean; note: string | null };
const toHoliday = (r: Row): HolidayRow => ({
  id: r.id,
  date: r.day,
  name: r.name,
  kind: r.kind,
  isClosed: r.is_closed,
  note: r.note,
});

// EV-17 手順3: その年(month を渡すとその月だけ)の行を日付順に
export const listHolidays = async (year: number, month: number | null): Promise<HolidayRow[]> => {
  const from = month ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-01-01`;
  const rows = await query(
    (sql) => sql<Row[]>`
      select id, to_char(holiday_on, 'YYYY-MM-DD') as day, name, kind, is_closed, note from holidays
      where holiday_on >= ${from}::date
        and holiday_on < ${from}::date + ${month ? sql`interval '1 month'` : sql`interval '1 year'`}
      order by holiday_on`
  );
  return rows.map(toHoliday);
};

// その年にすでに行がある日付(「この年の休日を作る」の件数の計算に使う)
export const existingDatesOfYear = async (year: number): Promise<Set<string>> => {
  const rows = await query(
    (sql) => sql<{ day: string }[]>`
      select to_char(holiday_on, 'YYYY-MM-DD') as day from holidays
      where holiday_on between ${`${year}-01-01`} and ${`${year}-12-31`}`
  );
  return new Set(rows.map((r) => r.day));
};

// EV-18 手順4: すでに行がある日付は作らない(CH-28)。作った件数を返す
export const insertYearHolidays = async (
  rows: { date: string; name: string; kind: HolidayKind; isClosed: boolean }[]
): Promise<number> => {
  if (rows.length === 0) return 0;
  const data = rows.map((r) => [r.date, r.name, r.kind, String(r.isClosed)]);
  const inserted = await query(
    (sql) => sql<{ id: string }[]>`
      insert into holidays (holiday_on, name, kind, is_closed)
      select d.day::date, d.name, d.kind, d.is_closed::boolean
      from (values ${sql(data)}) as d (day, name, kind, is_closed)
      on conflict (holiday_on) do nothing
      returning id`
  );
  return inserted.length;
};

export const getHolidayByDate = async (date: string): Promise<HolidayRow | null> => {
  const rows = await query(
    (sql) => sql<Row[]>`
      select id, to_char(holiday_on, 'YYYY-MM-DD') as day, name, kind, is_closed, note from holidays
      where holiday_on = ${date}::date`
  );
  return rows[0] ? toHoliday(rows[0]) : null;
};

export const getHolidayById = async (id: string): Promise<HolidayRow | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await query(
    (sql) => sql<Row[]>`
      select id, to_char(holiday_on, 'YYYY-MM-DD') as day, name, kind, is_closed, note from holidays where id = ${id}`
  );
  return rows[0] ? toHoliday(rows[0]) : null;
};

// EV-19 手順3: 臨時休業の行を作る
export const insertTemporaryClosed = async (date: string, name: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      insert into holidays (holiday_on, name, kind, is_closed, created_by, updated_by)
      values (${date}::date, ${name}, 'temporary', true, ${by}, ${by})`
  );
};

// EV-19 手順3・4: ある行の休み/営業と名前を変える(種別は変えない)
export const setHolidayClosed = async (id: string, isClosed: boolean, name: string, by: string): Promise<void> => {
  await query(
    (sql) => sql`update holidays set is_closed = ${isClosed}, name = ${name}, updated_by = ${by} where id = ${id}`
  );
};

// EV-20: 名前・休み/営業・メモ(日付・種別は変えない)
export const updateHoliday = async (
  id: string,
  input: { name: string; isClosed: boolean; note: string | null },
  by: string
): Promise<void> => {
  await query(
    (sql) => sql`
      update holidays set name = ${input.name}, is_closed = ${input.isClosed}, note = ${input.note}, updated_by = ${by}
      where id = ${id}`
  );
};

// EV-21: 誤って登録した行を消す(00_共通設計 1章の例外)
export const deleteHoliday = async (id: string): Promise<void> => {
  await query((sql) => sql`delete from holidays where id = ${id}`);
};
