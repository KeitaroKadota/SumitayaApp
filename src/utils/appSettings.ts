// 小さな設定(app_settings。A-01 01 6.4)の読み書き。キーは機能ごとに1行で、値(jsonb)の中に項目を持つ(00_共通設計 7.5)。
// 行が無ければ既定値を返す(初回は行が無くても動く)。値の中身のチェックは、設定を持つ機能が行う。
// 設定を変える画面は作らない(値は開発者が SQL で入れる)。
import { queryOn, type TransactionSql } from "@/utils/db";
import { isValidDateStr } from "@/utils/textNormalize";

export const getSetting = async <T>(key: string, fallback: T, tx?: TransactionSql): Promise<T> => {
  const rows = await queryOn(tx, (sql) => sql<{ value: T }[]>`select value from app_settings where key = ${key}`);
  return rows[0] ? rows[0].value : fallback;
};

export const setSetting = async (key: string, value: unknown, employeeId: string | null): Promise<void> => {
  await queryOn(
    undefined,
    (sql) => sql`
      insert into app_settings (key, value, updated_by) values (${key}, ${sql.json(value as never)}, ${employeeId})
      on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by`
  );
};

// ---- A-01 のキー sales ----

export type SalesSettings = {
  // B-01 への切替日("YYYY-MM-DD")。未設定なら null(CH-11・B-01 CH-14)
  crossmallCutoverDate: string | null;
  // 税率(%)。【仮】10%(00_仮決め一覧 A-01-仮-03)
  taxRate: number;
};

const DEFAULT_TAX_RATE = 10;

export const getSalesSettings = async (tx?: TransactionSql): Promise<SalesSettings> => {
  const raw = await getSetting<Record<string, unknown>>("sales", {}, tx);
  const cutover = typeof raw.crossmall_cutover_date === "string" && isValidDateStr(raw.crossmall_cutover_date) ? raw.crossmall_cutover_date : null;
  const rate = typeof raw.tax_rate === "number" && [10, 8].includes(raw.tax_rate) ? raw.tax_rate : DEFAULT_TAX_RATE;
  return { crossmallCutoverDate: cutover, taxRate: rate };
};
