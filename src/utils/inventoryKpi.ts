// 在庫の指標(A-05 01 5章・6.1・7章、03 の 0.1・EV-01〜EV-03、04 CH-01・CH-03・CH-04)。
// recordInventoryKpi は B-01 の在庫の取り込みの後(laterLinks.ts の入口を通す)と、A-05 の画面から呼ぶ。
// 権限チェックはしない(呼ぶ側で済ませている前提)。集計はなるべく SQL で行う。
import { query, transaction } from "@/utils/db";
import type { AbcRank } from "@/utils/abc";
import { todayJST } from "@/utils/jst";
import { addDays, diffDays } from "@/utils/salesPeriod";

// 仮の値は、設定画面を作らずここの1か所に置く(00_仮決め一覧 A-05-仮-01〜03)
export const INVENTORY_KPI_DEFAULTS = {
  // 滞留とみなす日数(A-05-仮-02)
  stagnantDays: 180,
  // 欠品率の対象: 直近この日数に1回以上売れた商品(A-05-仮-03)
  stockoutSalesDays: 90,
  // 在庫回転率の基準値(第36期)・目標値(効果測定 ⑧)
  turnoverBaseline: 2.15,
  turnoverTarget: 2.5,
  // 在庫回転率の期間(直近365日)
  turnoverDays: 365,
  // CH-01 同じ日の記録を、この分数以内にもう一度作ろうとしたら、計算せずに今の行を使う
  throttleMinutes: 5,
  // CH-01 在庫数の最後の更新がこの日数以上前なら古いと出す
  staleDays: 2,
} as const;

export type RecordKpiResult = { ok: true; skipped: boolean } | { ok: false; reason: string };

// 0.1 その日の指標を計算して記録する。force は「今日の数字を記録し直す」(5分の制限を受けない)
export const recordInventoryKpi = async (date: string, { force = false }: { force?: boolean } = {}): Promise<RecordKpiResult> => {
  const k = INVENTORY_KPI_DEFAULTS;
  // CH-01(2) 記録する日付が今日(過去の日はさかのぼって作らない)
  if (date !== todayJST()) return { ok: false, reason: "過去の日の指標は作れません" };
  return transaction(
    async (tx): Promise<RecordKpiResult> => {
      // CH-01(1) 在庫数がある
      const [inv] = await tx<{ n: number; as_of: Date | null }[]>`select count(*)::int as n, max(synced_at) as as_of from inventory_levels`;
      if (!inv || inv.n === 0) return { ok: false, reason: "在庫数がありません" };
      // CH-01(4) 5分以内の記録はそのまま使う
      if (!force) {
        const [recent] = await tx<{ fresh: boolean }[]>`
          select updated_at > now() - make_interval(mins => ${k.throttleMinutes}) as fresh from inventory_kpi_daily where kpi_date = ${date}`;
        if (recent?.fresh) return { ok: true, skipped: true };
      }

      // 手順3〜6 商品ごとに集めて、指標を出す(在庫数がマイナスなら0。原価が空・0は金額に入れない。CH-04)
      const turnoverFrom = addDays(date, -k.turnoverDays + 1);
      const stagnantBefore = addDays(date, -k.stagnantDays);
      const stockoutFrom = addDays(date, -k.stockoutSalesDays + 1);
      const [m] = await tx<
        {
          total_qty: number;
          total_value: string;
          missing_cost_count: number;
          cogs_365: string;
          stagnant_value: string;
          stagnant_count: number;
          target_count: number;
          stockout_count: number;
        }[]
      >`
        with inv as (
          select product_id, greatest(sum(quantity), 0)::int as qty from inventory_levels group by product_id
        ),
        sales as (
          select product_id,
                 max(sales_date) filter (where quantity > 0) as last_sold,
                 coalesce(sum(quantity) filter (where sales_date >= ${turnoverFrom}::date), 0) as qty_365,
                 bool_or(quantity > 0 and sales_date >= ${stockoutFrom}::date) as sold_recent
          from sales_daily where product_id is not null and sales_date <= ${date}::date group by product_id
        ),
        p as (
          select pr.id, pr.cost_price, pr.is_active, pr.is_in_house, (pr.created_at at time zone 'Asia/Tokyo')::date as created_on,
                 inv.qty, s.last_sold, coalesce(s.qty_365, 0) as qty_365, coalesce(s.sold_recent, false) as sold_recent,
                 inv.product_id is not null as has_inventory
          from products pr
          left join inv on inv.product_id = pr.id
          left join sales s on s.product_id = pr.id
        )
        select
          coalesce(sum(qty), 0)::int as total_qty,
          coalesce(sum(qty::bigint * cost_price) filter (where cost_price > 0), 0) as total_value,
          count(*) filter (where qty > 0 and coalesce(cost_price, 0) = 0)::int as missing_cost_count,
          coalesce(sum(qty_365::bigint * cost_price) filter (where cost_price > 0), 0) as cogs_365,
          coalesce(sum(qty::bigint * cost_price) filter (where cost_price > 0 and qty >= 1 and (
            last_sold <= ${stagnantBefore}::date or (last_sold is null and created_on <= ${stagnantBefore}::date))), 0) as stagnant_value,
          count(*) filter (where qty >= 1 and (last_sold <= ${stagnantBefore}::date or (last_sold is null and created_on <= ${stagnantBefore}::date)))::int
            as stagnant_count,
          count(*) filter (where is_active and not is_in_house and sold_recent and has_inventory)::int as target_count,
          count(*) filter (where is_active and not is_in_house and sold_recent and has_inventory and qty <= 0)::int as stockout_count
        from p`;
      const totalValue = Number(m.total_value);
      // 手順5 直近365日の平均在庫金額(その日の分を含める。記録のある日だけ)
      const [avg] = await tx<{ sum: string | null; n: number }[]>`
        select sum(total_value) as sum, count(*)::int as n from inventory_kpi_daily
        where kpi_date >= ${turnoverFrom}::date and kpi_date < ${date}::date`;
      const kpiDays = (avg?.n ?? 0) + 1;
      const avgValue = Math.round((Number(avg?.sum ?? 0) + totalValue) / kpiDays);
      const cogs = Number(m.cogs_365);
      const turnover = avgValue > 0 ? Math.round((cogs / avgValue) * 100) / 100 : null;
      const stockoutRate = m.target_count > 0 ? Math.round((m.stockout_count / m.target_count) * 10000) / 10000 : null;

      // 手順7 その日の行を INSERT(ある場合は UPDATE)
      await tx`
        insert into inventory_kpi_daily (
          kpi_date, inventory_as_of, total_qty, total_value, missing_cost_count, cogs_365, avg_value_365, kpi_days, turnover,
          stagnant_value, stagnant_count, target_count, stockout_count, stockout_rate, settings
        ) values (
          ${date}, ${inv.as_of}, ${m.total_qty}, ${totalValue}, ${m.missing_cost_count}, ${cogs}, ${avgValue}, ${kpiDays}, ${turnover},
          ${Number(m.stagnant_value)}, ${m.stagnant_count}, ${m.target_count}, ${m.stockout_count}, ${stockoutRate}, ${tx.json(k as never)}
        )
        on conflict (kpi_date) do update set
          inventory_as_of = excluded.inventory_as_of, total_qty = excluded.total_qty, total_value = excluded.total_value,
          missing_cost_count = excluded.missing_cost_count, cogs_365 = excluded.cogs_365, avg_value_365 = excluded.avg_value_365,
          kpi_days = excluded.kpi_days, turnover = excluded.turnover, stagnant_value = excluded.stagnant_value,
          stagnant_count = excluded.stagnant_count, target_count = excluded.target_count, stockout_count = excluded.stockout_count,
          stockout_rate = excluded.stockout_rate, settings = excluded.settings`;
      return { ok: true, skipped: false };
    },
    { timeoutMs: 60_000 }
  );
};

// ---- G01 の表示 ----

export type KpiRow = {
  kpiDate: string;
  inventoryAsOf: Date | null;
  totalQty: number;
  totalValue: number;
  missingCostCount: number;
  kpiDays: number;
  turnover: number | null;
  stagnantValue: number;
  stagnantCount: number;
  targetCount: number;
  stockoutCount: number;
  stockoutRate: number | null;
};

type DbKpiRow = {
  kpi_date: string;
  inventory_as_of: Date | null;
  total_qty: number;
  total_value: string;
  missing_cost_count: number;
  kpi_days: number;
  turnover: string | null;
  stagnant_value: string;
  stagnant_count: number;
  target_count: number;
  stockout_count: number;
  stockout_rate: string | null;
};
const toKpi = (r: DbKpiRow): KpiRow => ({
  kpiDate: r.kpi_date,
  inventoryAsOf: r.inventory_as_of,
  totalQty: r.total_qty,
  totalValue: Number(r.total_value),
  missingCostCount: r.missing_cost_count,
  kpiDays: r.kpi_days,
  turnover: r.turnover === null ? null : Number(r.turnover),
  stagnantValue: Number(r.stagnant_value),
  stagnantCount: r.stagnant_count,
  targetCount: r.target_count,
  stockoutCount: r.stockout_count,
  stockoutRate: r.stockout_rate === null ? null : Number(r.stockout_rate),
});

// EV-01 手順3 今日の行(無ければ最新の行)と、推移の期間の行(古い順)
export const getKpiRows = async (today: string, days: number): Promise<{ latest: KpiRow | null; trend: KpiRow[] }> => {
  const rows = await query(
    (sql) => sql<DbKpiRow[]>`
      select kpi_date::text as kpi_date, inventory_as_of, total_qty, total_value, missing_cost_count, kpi_days, turnover,
             stagnant_value, stagnant_count, target_count, stockout_count, stockout_rate
      from inventory_kpi_daily where kpi_date > ${addDays(today, -days)}::date order by kpi_date`
  );
  let latest = rows.length > 0 ? toKpi(rows[rows.length - 1]) : null;
  if (!latest) {
    const [r] = await query(
      (sql) => sql<DbKpiRow[]>`
        select kpi_date::text as kpi_date, inventory_as_of, total_qty, total_value, missing_cost_count, kpi_days, turnover,
               stagnant_value, stagnant_count, target_count, stockout_count, stockout_rate
        from inventory_kpi_daily order by kpi_date desc limit 1`
    );
    latest = r ? toKpi(r) : null;
  }
  return { latest, trend: rows.map(toKpi) };
};

export const hasKpiForDate = async (date: string): Promise<boolean> => {
  const [r] = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from inventory_kpi_daily where kpi_date = ${date}`);
  return (r?.n ?? 0) > 0;
};

// CH-04 在庫がマイナスの商品の数(画面に出す)
export const countNegativeStock = async (): Promise<number> => {
  const [r] = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from (select product_id from inventory_levels group by product_id having sum(quantity) < 0) t`
  );
  return r?.n ?? 0;
};

export const KPI_PAGE_SIZE = 50;

export type StagnantRow = {
  productId: string;
  productCode: string;
  name: string;
  abcRank: AbcRank | null;
  qty: number;
  costPrice: number | null;
  value: number;
  lastSold: string | null;
};
export type StockoutRow = { productId: string; productCode: string; name: string; abcRank: AbcRank | null; qty: number; sold90: number };

// EV-01 手順4 滞留在庫の一覧(金額の大きい順・50件ずつ)
export const listStagnant = async (today: string, page: number): Promise<{ total: number; rows: StagnantRow[] }> => {
  const before = addDays(today, -INVENTORY_KPI_DEFAULTS.stagnantDays);
  const rows = await query(
    (sql) => sql<
      { product_id: string; product_code: string; name: string; abc_rank: AbcRank | null; qty: number; cost_price: number | null; value: string; last_sold: string | null; total: string }[]
    >`
      with inv as (select product_id, greatest(sum(quantity), 0)::int as qty from inventory_levels group by product_id),
      s as (select product_id, max(sales_date) filter (where quantity > 0) as last_sold from sales_daily where product_id is not null group by product_id)
      select p.id as product_id, p.product_code, p.name, p.abc_rank, inv.qty, p.cost_price,
             (inv.qty::bigint * coalesce(p.cost_price, 0)) as value, s.last_sold::text as last_sold, count(*) over () as total
      from products p join inv on inv.product_id = p.id left join s on s.product_id = p.id
      where inv.qty >= 1 and (s.last_sold <= ${before}::date or (s.last_sold is null and (p.created_at at time zone 'Asia/Tokyo')::date <= ${before}::date))
      order by value desc, p.product_code
      limit ${KPI_PAGE_SIZE} offset ${(page - 1) * KPI_PAGE_SIZE}`,
    { timeoutMs: 30_000 }
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      productId: r.product_id,
      productCode: r.product_code,
      name: r.name,
      abcRank: r.abc_rank,
      qty: r.qty,
      costPrice: r.cost_price,
      value: Number(r.value),
      lastSold: r.last_sold,
    })),
  };
};

// EV-01 手順4 欠品中の商品(直近90日の販売数の多い順・50件ずつ)
export const listStockout = async (today: string, page: number): Promise<{ total: number; rows: StockoutRow[] }> => {
  const from = addDays(today, -INVENTORY_KPI_DEFAULTS.stockoutSalesDays + 1);
  const rows = await query(
    (sql) => sql<{ product_id: string; product_code: string; name: string; abc_rank: AbcRank | null; qty: number; sold90: number; total: string }[]>`
      with inv as (select product_id, sum(quantity)::int as qty from inventory_levels group by product_id),
      s as (
        select product_id, sum(quantity) filter (where quantity > 0)::int as sold90
        from sales_daily where product_id is not null and sales_date >= ${from}::date and sales_date <= ${today}::date
        group by product_id having bool_or(quantity > 0)
      )
      select p.id as product_id, p.product_code, p.name, p.abc_rank, inv.qty, s.sold90, count(*) over () as total
      from products p join inv on inv.product_id = p.id join s on s.product_id = p.id
      where p.is_active and not p.is_in_house and inv.qty <= 0
      order by s.sold90 desc, p.product_code
      limit ${KPI_PAGE_SIZE} offset ${(page - 1) * KPI_PAGE_SIZE}`,
    { timeoutMs: 30_000 }
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      productId: r.product_id,
      productCode: r.product_code,
      name: r.name,
      abcRank: r.abc_rank,
      qty: r.qty,
      sold90: r.sold90,
    })),
  };
};

// 在庫数が何日前のものか(CH-01(3))
export const staleDaysOf = (asOf: Date | null, today: string): number | null =>
  asOf ? diffDays(asOf.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }), today) : null;
