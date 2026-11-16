// 需要予測・発注の提案(A-03)のDBの読み書き(03 EV-01〜EV-04、04 CH-01・CH-02・CH-07・CH-14)。
// 計算は forecast.ts・replenishment.ts(DBを読まない)。権限チェックはしない(呼ぶ側で requireAccess("sales", …) 済みの前提)。
import { query, queryOn, transaction, type SqlLike, type TransactionSql } from "@/utils/db";
import type { AbcRank } from "@/utils/abc";
import {
  FORECAST_DEFAULTS,
  calcBias,
  calcGrowth,
  forecastProduct,
  forecastStartOf,
  forecastWeeks,
  neededSalesDates,
  sumDays,
  type WeekForecast,
} from "@/utils/forecast";
import { listFestivals } from "@/utils/festivals";
import { getOpenQtyByProduct } from "@/utils/purchaseOrders";
import { calcPoTotals, formatPoNo } from "@/utils/purchaseOrderRules";
import { planReplenishment, type ReplenishmentPlan } from "@/utils/replenishment";
import { addDays, diffDays } from "@/utils/salesPeriod";
import { currentRounding, getCompanySettings } from "@/utils/invoicesServer";

const CHUNK_SIZE = 1000;
// CH-01 ほかの人が計算中かを見るアドバイザリーロックの番号(A-03 の予測の計算で使う決まった数)
const FORECAST_LOCK_KEY = 3_030_201;

// ---- CH-01 計算の前提 ----

export type ForecastPrereq = {
  errors: string[];
  warnings: string[];
  start: string;
  end: string;
  salesFirst: string | null;
  salesLast: string | null;
  inventoryAsOf: Date | null;
};

export const checkForecastPrereq = async (today: string, tx?: TransactionSql): Promise<ForecastPrereq> => {
  const start = forecastStartOf(today);
  const end = addDays(start, FORECAST_DEFAULTS.weeks * 7 - 1);
  const [row] = await queryOn(
    tx,
    (sql) => sql<
      {
        sales_first: string | null;
        sales_last: string | null;
        inventory_count: number;
        inventory_as_of: Date | null;
        ranked_count: number;
        festival_count: number;
      }[]
    >`
      select (select min(sales_date)::text from sales_daily) as sales_first,
             (select max(sales_date)::text from sales_daily) as sales_last,
             (select count(*)::int from inventory_levels) as inventory_count,
             (select max(synced_at) from inventory_levels) as inventory_as_of,
             (select count(*)::int from products where abc_ranked_at is not null) as ranked_count,
             (select count(*)::int from festival_events
               where start_date - influence_days_before <= ${end}::date and end_date + influence_days_after >= ${start}::date) as festival_count`
  );
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!row.sales_first) errors.push("売上がありません。先に売上を取り込んでください（A-01）");
  else {
    if (row.sales_last && row.sales_last < addDays(start, -FORECAST_DEFAULTS.recentWeeks * 7))
      warnings.push(`最近の売上が取り込まれていません（最後の日: ${row.sales_last.replace(/-/g, "/")}）`);
    if (row.sales_first > addDays(today, -365))
      warnings.push("売上が1年分より少ないため、去年の同じ時期を使えない商品は、直近の平均で予測します");
  }
  if (row.inventory_count === 0) errors.push("在庫数がありません。先に在庫を取り込んでください（B-01）");
  else if (row.inventory_as_of) {
    const days = diffDays(row.inventory_as_of.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }), today);
    if (days > FORECAST_DEFAULTS.stockStaleDays) warnings.push(`在庫数が ${days} 日前のものです（B-01 で取り込んでください）`);
  }
  if (row.ranked_count === 0) warnings.push("ABCランクがありません。すべての商品を B として計算します（A-02）");
  if (row.festival_count === 0) warnings.push("この期間の祭礼が登録されていません");
  return { errors, warnings, start, end, salesFirst: row.sales_first, salesLast: row.sales_last, inventoryAsOf: row.inventory_as_of };
};

// ---- EV-02 予測を計算する ----

type TargetProduct = {
  id: string;
  category_code: string | null;
  abc_rank: AbcRank | null;
  main_supplier_id: string | null;
  supplier_lead_time: number | null;
  is_in_house: boolean;
  order_lot: number | null;
  min_order_qty: number | null;
  lead_time_days: number | null;
  on_hand: number;
};

export type RunForecastResult =
  | { ok: true; products: number; needOrder: number; production: number; failed: number }
  | { ok: false; error: string };

const loadAndCalc = async (tx: TransactionSql, today: string, by: string): Promise<RunForecastResult> => {
  const d = FORECAST_DEFAULTS;
  // 手順2 CH-01
  const prereq = await checkForecastPrereq(today, tx);
  if (prereq.errors.length > 0) return { ok: false, error: prereq.errors.join("。") };
  const start = prereq.start;
  const weeks = forecastWeeks(start);
  const salesRange = prereq.salesFirst && prereq.salesLast ? { first: prereq.salesFirst, last: prereq.salesLast } : null;

  // 手順5(先に) 発注残・祭礼
  const openQty = await getOpenQtyByProduct(undefined, tx);
  const festivals = await listFestivals(addDays(start, -800), prereq.end, tx);

  // 手順3 CH-02 対象の商品: 在籍中で、直近2年に売上がある・在庫が1以上・発注残がある
  const openIds = [...openQty.keys()];
  const products = await tx<TargetProduct[]>`
    with inv as (select product_id, sum(quantity)::int as qty from inventory_levels group by product_id)
    select p.id, p.category_code, p.abc_rank, p.main_supplier_id, s.lead_time_days as supplier_lead_time, p.is_in_house,
           p.order_lot, p.min_order_qty, p.lead_time_days, coalesce(inv.qty, 0) as on_hand
    from products p
    left join suppliers s on s.id = p.main_supplier_id
    left join inv on inv.product_id = p.id
    where p.is_active and (
      coalesce(inv.qty, 0) >= 1
      or p.id = any(${openIds}::uuid[])
      or exists (select 1 from sales_daily sd where sd.product_id = p.id and sd.sales_date >= ${addDays(today, -d.targetSalesDays)}::date)
    )`;
  const ids = products.map((p) => p.id);

  // 手順4 sales_daily を必要な日だけ、商品・日ごとに合計して読む
  const dates = neededSalesDates(start, weeks, festivals);
  const salesRows = await tx<{ product_id: string; sales_date: string; qty: number }[]>`
    select product_id, sales_date::text as sales_date, sum(quantity)::int as qty
    from sales_daily where product_id = any(${ids}::uuid[]) and sales_date = any(${dates}::date[])
    group by 1, 2`;
  const dailyByProduct = new Map<string, Map<string, number>>();
  for (const r of salesRows) {
    const m = dailyByProduct.get(r.product_id) ?? new Map<string, number>();
    m.set(r.sales_date, r.qty);
    dailyByProduct.set(r.product_id, m);
  }
  // 0.1 手順1 去年の記録(365日より前に1つでも売上がある)
  const oldRows = await tx<{ product_id: string }[]>`
    select distinct product_id from sales_daily where product_id = any(${ids}::uuid[]) and sales_date < ${addDays(today, -365)}::date`;
  const hasOld = new Set(oldRows.map((r) => r.product_id));

  // 手順3 伸び率の分母・分子(分類・店全体)
  const recentFrom = addDays(start, -d.growthWeeks * 7);
  const lyFrom = addDays(recentFrom, -d.lastYearShiftDays);
  const lyTo = addDays(start, -d.lastYearShiftDays);
  const totals = await tx<{ category_code: string | null; recent: number; ly: number }[]>`
    select p.category_code,
           coalesce(sum(s.quantity) filter (where s.sales_date >= ${recentFrom}::date and s.sales_date < ${start}::date), 0)::int as recent,
           coalesce(sum(s.quantity) filter (where s.sales_date >= ${lyFrom}::date and s.sales_date < ${lyTo}::date), 0)::int as ly
    from sales_daily s left join products p on p.id = s.product_id
    where (s.sales_date >= ${recentFrom}::date and s.sales_date < ${start}::date) or (s.sales_date >= ${lyFrom}::date and s.sales_date < ${lyTo}::date)
    group by p.category_code`;
  const store = totals.reduce((acc, t) => ({ recent: acc.recent + t.recent, lastYear: acc.lastYear + t.ly }), { recent: 0, lastYear: 0 });
  const byCategory = new Map(totals.filter((t) => t.category_code).map((t) => [t.category_code as string, { recent: t.recent, lastYear: t.ly }]));

  // 手順5 補正: 直近8週の、その週が始まる前の最後の計算の予測
  const biasFrom = addDays(start, -d.biasWeeks * 7);
  const pastRows = await tx<{ product_id: string; week_start: string; forecast_qty: number }[]>`
    select distinct on (f.product_id, f.week_start) f.product_id, f.week_start::text as week_start, f.forecast_qty
    from demand_forecasts f join analysis_runs r on r.id = f.run_id
    where f.week_start >= ${biasFrom}::date and f.week_start < ${start}::date
      and r.created_at < (f.week_start::timestamp at time zone 'Asia/Tokyo')
    order by f.product_id, f.week_start, r.created_at desc`;
  const pastByProduct = new Map<string, Map<string, number>>();
  for (const r of pastRows) {
    const m = pastByProduct.get(r.product_id) ?? new Map<string, number>();
    m.set(r.week_start, r.forecast_qty);
    pastByProduct.set(r.product_id, m);
  }

  // 手順6 商品ごとに 0.1 → 0.3(1つの商品で失敗したら飛ばして数える)
  const forecasts: { productId: string; weeks: WeekForecast[] }[] = [];
  const plans: { product: TargetProduct; plan: ReplenishmentPlan }[] = [];
  let failed = 0;
  for (const p of products) {
    try {
      const daily = dailyByProduct.get(p.id) ?? new Map<string, number>();
      const growth = calcGrowth(
        { recent: sumDays(daily, recentFrom, d.growthWeeks * 7), lastYear: sumDays(daily, lyFrom, d.growthWeeks * 7) },
        p.category_code ? (byCategory.get(p.category_code) ?? null) : null,
        store
      );
      const past = pastByProduct.get(p.id);
      const bias = calcBias(
        Array.from({ length: d.biasWeeks }, (_, i) => {
          const w = addDays(biasFrom, i * 7);
          return { actual: sumDays(daily, w, 7), forecast: past?.get(w) ?? null };
        })
      );
      const weekRows = forecastProduct({
        categoryCode: p.category_code,
        daily,
        hasLastYear: hasOld.has(p.id),
        growth,
        bias,
        start,
        weeks,
        festivals,
        salesRange,
      });
      const plan = planReplenishment({
        abcRank: p.abc_rank,
        weeklyForecast: weekRows.map((w) => w.forecastQty),
        onHandQty: p.on_hand,
        onOrderQty: openQty.get(p.id) ?? 0,
        productLeadTimeDays: p.lead_time_days,
        supplierId: p.main_supplier_id,
        supplierLeadTimeDays: p.supplier_lead_time,
        isInHouse: p.is_in_house,
        orderLot: p.order_lot,
        minOrderQty: p.min_order_qty,
      });
      forecasts.push({ productId: p.id, weeks: weekRows });
      plans.push({ product: p, plan });
    } catch (e) {
      console.error("予測を計算できなかった商品があります:", e instanceof Error ? e.message : e);
      failed++;
    }
  }

  // CH-02 マスタに無い商品コードの売上(予測しない)
  const [unlinked] = await tx<{ n: number }[]>`
    select count(distinct product_code)::int as n from sales_daily
    where product_id is null and sales_date >= ${addDays(today, -d.targetSalesDays)}::date`;
  const needOrder = plans.filter((x) => x.plan.destination === "purchase" && x.plan.suggestedQty > 0).length;
  const production = plans.filter((x) => x.plan.destination === "production" && x.plan.suggestedQty > 0).length;
  const noSupplier = plans.filter((x) => x.plan.destination === "no_supplier" && x.plan.suggestedQty > 0).length;

  // 手順7 保存(計算の回・予測・提案。1000行ずつ)
  const [run] = await tx<{ id: string }[]>`
    insert into analysis_runs (kind, period_from, period_to, settings, summary, status, created_by, updated_by)
    values ('forecast', ${dates[0] ?? addDays(start, -1)}, ${addDays(start, -1)},
            ${tx.json({ ...d, forecastFrom: start, forecastTo: prereq.end } as never)},
            ${tx.json({ products: plans.length, needOrder, production, noSupplier, failed, unlinkedSalesCodes: unlinked?.n ?? 0 } as never)},
            'calculated', ${by}, ${by})
    returning id`;
  const fRecords = forecasts.flatMap((f) =>
    f.weeks.map((w) => ({
      product_id: f.productId,
      week_start: w.weekStart,
      method: w.method,
      base_qty: w.baseQty,
      festival_event_id: w.festivalEventId,
      shift_days: w.shiftDays,
      growth_rate: w.growthRate,
      growth_basis: w.growthBasis,
      festival_factor: w.festivalFactor,
      bias_factor: w.biasFactor,
      forecast_value: w.forecastValue,
      forecast_qty: w.forecastQty,
    }))
  );
  for (let i = 0; i < fRecords.length; i += CHUNK_SIZE) {
    await tx`
      insert into demand_forecasts (
        run_id, product_id, week_start, method, base_qty, festival_event_id, shift_days, growth_rate, growth_basis,
        festival_factor, bias_factor, forecast_value, forecast_qty
      )
      select ${run.id}, d.product_id, d.week_start, d.method, d.base_qty, d.festival_event_id, d.shift_days, d.growth_rate,
             d.growth_basis, d.festival_factor, d.bias_factor, d.forecast_value, d.forecast_qty
      from jsonb_to_recordset(${JSON.stringify(fRecords.slice(i, i + CHUNK_SIZE))}::text::jsonb) as d (
        product_id uuid, week_start date, method text, base_qty numeric, festival_event_id uuid, shift_days integer,
        growth_rate numeric, growth_basis text, festival_factor numeric, bias_factor numeric, forecast_value numeric, forecast_qty integer
      )`;
  }
  const sRecords = plans.map(({ product, plan }) => ({
    product_id: product.id,
    destination: plan.destination,
    supplier_id: product.main_supplier_id,
    abc_rank: product.abc_rank,
    lead_time_days: plan.leadTimeDays,
    review_weeks: plan.reviewWeeks,
    on_hand_qty: plan.onHandQty,
    on_order_qty: plan.onOrderQty,
    lead_time_demand: plan.leadTimeDemand,
    safety_stock: plan.safetyStock,
    reorder_point: plan.reorderPoint,
    suggested_qty: plan.suggestedQty,
    reason: plan.reason,
  }));
  for (let i = 0; i < sRecords.length; i += CHUNK_SIZE) {
    await tx`
      insert into replenishment_suggestions (
        run_id, product_id, destination, supplier_id, abc_rank, lead_time_days, review_weeks, on_hand_qty, on_order_qty,
        lead_time_demand, safety_stock, reorder_point, suggested_qty, reason
      )
      select ${run.id}, d.product_id, d.destination, d.supplier_id, d.abc_rank, d.lead_time_days, d.review_weeks, d.on_hand_qty,
             d.on_order_qty, d.lead_time_demand, d.safety_stock, d.reorder_point, d.suggested_qty, d.reason
      from jsonb_to_recordset(${JSON.stringify(sRecords.slice(i, i + CHUNK_SIZE))}::text::jsonb) as d (
        product_id uuid, destination text, supplier_id uuid, abc_rank text, lead_time_days integer, review_weeks numeric,
        on_hand_qty integer, on_order_qty integer, lead_time_demand integer, safety_stock integer, reorder_point integer,
        suggested_qty integer, reason text
      )`;
  }
  return { ok: true, products: plans.length, needOrder, production, failed };
};

export const runForecast = async (today: string, by: string): Promise<RunForecastResult> => {
  let result: RunForecastResult;
  try {
    // 計算の全体を1つのトランザクションにし、その間はアドバイザリーロックで、ほかの人の計算を止める(CH-01)
    result = await transaction(
      async (tx) => {
        const [lock] = await tx<{ ok: boolean }[]>`select pg_try_advisory_xact_lock(${FORECAST_LOCK_KEY}) as ok`;
        if (!lock?.ok) return { ok: false, error: "ほかの人が計算中です。しばらくしてからもう一度押してください" } as const;
        return loadAndCalc(tx, today, by);
      },
      { timeoutMs: 280_000 }
    );
  } catch (e) {
    console.error("予測を保存できませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, error: "保存に失敗しました。何も保存していません" };
  }
  if (result.ok) {
    // 手順8 1年より古い予測の回の行を消す(発注に結び付いた提案は残す)。失敗しても計算の結果は残す
    try {
      const before = addDays(today, -FORECAST_DEFAULTS.keepDays);
      await query(
        (sql) => sql`
          delete from demand_forecasts where run_id in (
            select id from analysis_runs where kind = 'forecast' and created_at < (${before}::date)::timestamp at time zone 'Asia/Tokyo')`,
        { timeoutMs: 60_000 }
      );
      await query(
        (sql) => sql`
          delete from replenishment_suggestions where purchase_order_line_id is null and run_id in (
            select id from analysis_runs where kind = 'forecast' and created_at < (${before}::date)::timestamp at time zone 'Asia/Tokyo')`,
        { timeoutMs: 60_000 }
      );
    } catch (e) {
      console.error("古い予測を消せませんでした:", e instanceof Error ? e.message : e);
    }
  }
  return result;
};

// ---- EV-01 画面の情報 ----

export type ForecastRunInfo = {
  id: string;
  createdAt: Date;
  createdByName: string | null;
  forecastFrom: string | null;
  forecastTo: string | null;
  summary: { products?: number; needOrder?: number; production?: number; noSupplier?: number; failed?: number; unlinkedSalesCodes?: number };
};

export const getLatestForecastRun = async (tx?: SqlLike): Promise<ForecastRunInfo | null> => {
  const run = async (sql: SqlLike) =>
    sql<{ id: string; created_at: Date; created_by_name: string | null; settings: Record<string, unknown>; summary: ForecastRunInfo["summary"] }[]>`
      select r.id, r.created_at, r.settings, r.summary,
             case when e.id is null then null else e.last_name || ' ' || e.first_name end as created_by_name
      from analysis_runs r left join employees e on e.id = r.created_by
      where r.kind = 'forecast' order by r.created_at desc limit 1`;
  const rows = tx ? await run(tx) : await query((sql) => run(sql));
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    createdAt: r.created_at,
    createdByName: r.created_by_name,
    forecastFrom: typeof r.settings.forecastFrom === "string" ? r.settings.forecastFrom : null,
    forecastTo: typeof r.settings.forecastTo === "string" ? r.settings.forecastTo : null,
    summary: r.summary ?? {},
  };
};

export type SuggestionRow = {
  id: string;
  productId: string;
  productCode: string;
  productName: string;
  destination: "purchase" | "production" | "no_supplier";
  supplierId: string | null;
  supplierName: string | null;
  supplierLeadTime: number | null;
  supplierOrderMethod: string | null;
  abcRank: AbcRank | null;
  onHandQty: number;
  onOrderQty: number;
  reorderPoint: number;
  suggestedQty: number;
  reason: string;
  costPrice: number | null;
  // 下書き・発注にした発注番号
  orderNo: string | null;
  // CH-14 提案数が直近1年の販売数の合計を超える
  tooMany: boolean;
};

export type SuggestionTab = "purchase" | "production" | "no_supplier" | "all";

// EV-01 手順4・5 その回の提案(タブごと)。「すべての商品」以外は提案数1以上か、在庫が発注点以下のもの
export const listSuggestions = async (runId: string, tab: SuggestionTab, today: string): Promise<SuggestionRow[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        product_id: string;
        product_code: string;
        product_name: string;
        destination: SuggestionRow["destination"];
        supplier_id: string | null;
        supplier_name: string | null;
        supplier_lead_time: number | null;
        supplier_order_method: string | null;
        abc_rank: AbcRank | null;
        on_hand_qty: number;
        on_order_qty: number;
        reorder_point: number;
        suggested_qty: number;
        reason: string;
        cost_price: number | null;
        order_no: string | null;
        sold_365: number;
      }[]
    >`
      select rs.id, rs.product_id, p.product_code, p.name as product_name, rs.destination, rs.supplier_id, s.name as supplier_name,
             s.lead_time_days as supplier_lead_time, s.order_method as supplier_order_method, rs.abc_rank, rs.on_hand_qty,
             rs.on_order_qty, rs.reorder_point, rs.suggested_qty, rs.reason, p.cost_price, po.order_no,
             case when rs.suggested_qty > 0 then coalesce((select sum(sd.quantity) from sales_daily sd
               where sd.product_id = rs.product_id and sd.sales_date > ${addDays(today, -365)}::date), 0) else 0 end::int as sold_365
      from replenishment_suggestions rs
      join products p on p.id = rs.product_id
      left join suppliers s on s.id = rs.supplier_id
      left join purchase_order_lines l on l.id = rs.purchase_order_line_id
      left join purchase_orders po on po.id = l.purchase_order_id
      where rs.run_id = ${runId}
        ${tab === "all" ? sql`` : sql`and rs.destination = ${tab} and (rs.suggested_qty > 0 or rs.on_hand_qty + rs.on_order_qty <= rs.reorder_point)`}
      order by s.name_kana nulls last, s.name nulls last, rs.suggested_qty desc, p.product_code
      limit 2000`,
    { timeoutMs: 30_000 }
  );
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    productCode: r.product_code,
    productName: r.product_name,
    destination: r.destination,
    supplierId: r.supplier_id,
    supplierName: r.supplier_name,
    supplierLeadTime: r.supplier_lead_time,
    supplierOrderMethod: r.supplier_order_method,
    abcRank: r.abc_rank,
    onHandQty: r.on_hand_qty,
    onOrderQty: r.on_order_qty,
    reorderPoint: r.reorder_point,
    suggestedQty: r.suggested_qty,
    reason: r.reason,
    costPrice: r.cost_price,
    orderNo: r.order_no,
    tooMany: r.suggested_qty > 0 && r.suggested_qty > r.sold_365,
  }));
};

export const countSuggestionsByTab = async (runId: string): Promise<Record<"production" | "no_supplier", number>> => {
  const rows = await query(
    (sql) => sql<{ destination: string; n: number }[]>`
      select destination, count(*)::int as n from replenishment_suggestions
      where run_id = ${runId} and suggested_qty > 0 group by destination`
  );
  const get = (k: string) => rows.find((r) => r.destination === k)?.n ?? 0;
  return { production: get("production"), no_supplier: get("no_supplier") };
};

// ---- EV-03 選んだ商品で発注の下書きを作る ----

export type CreateDraftsResult =
  | { ok: true; purchaseOrderIds: string[]; skipped: string[] }
  | { ok: false; error: string; skipped: string[] };

export const createDraftsFromSuggestions = async (suggestionIds: string[], by: string): Promise<CreateDraftsResult> => {
  const ids = suggestionIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return { ok: false, error: "発注の下書きにする商品を選んでください。", skipped: [] };
  const company = await getCompanySettings();
  const rounding = currentRounding(company);

  return transaction(
    async (tx): Promise<CreateDraftsResult> => {
      const latest = await getLatestForecastRun(tx);
      // CH-07 下書きにできる提案(FOR UPDATE で読んで、二重に作らない)
      const rows = await tx<
        {
          id: string;
          run_id: string;
          product_id: string;
          product_code: string;
          product_name: string;
          destination: string;
          suggested_qty: number;
          purchase_order_line_id: string | null;
          supplier_id: string | null;
          supplier_active: boolean | null;
          cost_price: number | null;
          tax_rate: number;
        }[]
      >`
        select rs.id, rs.run_id, rs.product_id, p.product_code, p.name as product_name, rs.destination, rs.suggested_qty,
               rs.purchase_order_line_id, rs.supplier_id, s.is_active as supplier_active, p.cost_price, p.tax_rate
        from replenishment_suggestions rs
        join products p on p.id = rs.product_id
        left join suppliers s on s.id = rs.supplier_id
        where rs.id = any(${ids}::uuid[])
        for update of rs`;
      const skipped: string[] = [];
      const ok = rows.filter((r) => {
        const why =
          r.run_id !== latest?.id
            ? "新しい計算があります。開き直してください"
            : r.destination !== "purchase"
              ? "仕入先へ発注する商品ではありません"
              : r.suggested_qty < 1
                ? "提案数が0です"
                : r.purchase_order_line_id
                  ? "すでに下書き・発注にしています"
                  : !r.supplier_id || !r.supplier_active
                    ? "仕入先が取引中ではありません"
                    : null;
        if (why) skipped.push(`${r.product_code}: ${why}`);
        return !why;
      });
      if (ok.length === 0) return { ok: false, error: "下書きにできる商品がありませんでした。", skipped };

      // 仕入先の品番(C-01 の supplier_item_codes。テーブルがまだ無いときは使わない)
      const itemCodes = new Map<string, string>();
      const [exists] = await tx<{ ok: boolean }[]>`select to_regclass('public.supplier_item_codes') is not null as ok`;
      if (exists?.ok) {
        const codes = await tx<{ supplier_id: string; product_id: string; supplier_item_code: string }[]>`
          select distinct on (supplier_id, product_id) supplier_id, product_id, supplier_item_code
          from supplier_item_codes
          where is_active and product_id = any(${ok.map((r) => r.product_id)}::uuid[])
          order by supplier_id, product_id, updated_at desc`;
        for (const c of codes) itemCodes.set(`${c.supplier_id}|${c.product_id}`, c.supplier_item_code);
      }

      // 手順4〜7 仕入先ごとに発注を1つ作り、明細を作り、提案に明細を書き、金額を計算する
      const bySupplier = new Map<string, typeof ok>();
      for (const r of ok) bySupplier.set(r.supplier_id as string, [...(bySupplier.get(r.supplier_id as string) ?? []), r]);
      const purchaseOrderIds: string[] = [];
      for (const [supplierId, lines] of bySupplier) {
        const [seq] = await tx<{ n: string }[]>`select nextval('purchase_order_no_seq') as n`;
        const totals = calcPoTotals(
          lines.map((l) => ({ quantity: l.suggested_qty, unitPrice: l.cost_price ?? 0, taxRate: l.tax_rate })),
          rounding
        );
        const [po] = await tx<{ id: string }[]>`
          insert into purchase_orders (order_no, supplier_id, status, source, run_id, subtotal, tax, total, created_by, updated_by)
          values (${formatPoNo(Number(seq.n))}, ${supplierId}, 'draft', 'suggestion', ${latest?.id ?? null},
                  ${totals.subtotal}, ${totals.tax}, ${totals.total}, ${by}, ${by})
          returning id`;
        for (const [i, l] of lines.entries()) {
          const price = l.cost_price ?? 0;
          const [line] = await tx<{ id: string }[]>`
            insert into purchase_order_lines (
              purchase_order_id, line_no, product_id, supplier_item_code, product_name, suggested_qty, quantity, unit_price, tax_rate, amount
            ) values (
              ${po.id}, ${i + 1}, ${l.product_id}, ${itemCodes.get(`${supplierId}|${l.product_id}`) ?? null}, ${l.product_name},
              ${l.suggested_qty}, ${l.suggested_qty}, ${price}, ${l.tax_rate}, ${l.suggested_qty * price}
            ) returning id`;
          await tx`update replenishment_suggestions set purchase_order_line_id = ${line.id} where id = ${l.id}`;
        }
        purchaseOrderIds.push(po.id);
      }
      return { ok: true, purchaseOrderIds, skipped };
    },
    { timeoutMs: 60_000 }
  );
};

// ---- EV-04 予測の詳細 ----

export type ForecastDetail = {
  runId: string;
  runCreatedAt: Date;
  product: { id: string; code: string; name: string; categoryCode: string | null };
  supplierName: string | null;
  suggestion: {
    destination: string;
    abcRank: AbcRank | null;
    leadTimeDays: number;
    reviewWeeks: number;
    onHandQty: number;
    onOrderQty: number;
    leadTimeDemand: number;
    safetyStock: number;
    reorderPoint: number;
    suggestedQty: number;
    reason: string;
    orderLot: number | null;
    minOrderQty: number | null;
  } | null;
  weeks: (WeekForecast & {
    festivalName: string | null;
    // 去年の実績(ずらした先の7日間)
    lastYearActual: number;
  })[];
  // 伸び率の元(直近12週・去年の同じ12週。商品で計算したときの数)
  growthRecent: number;
  growthLastYear: number;
  // 補正の元(直近8週の実績と予測)
  biasActual: number;
  biasForecast: number;
  // CH-14 予測が去年の同じ時期の最大の週の3倍を超える週
  tooLargeWeeks: string[];
};

export const getForecastDetail = async (runId: string, productId: string): Promise<ForecastDetail | null> => {
  const uuid = /^[0-9a-f-]{36}$/i;
  if (!uuid.test(runId) || !uuid.test(productId)) return null;
  const d = FORECAST_DEFAULTS;
  const [run] = await query(
    (sql) => sql<{ id: string; created_at: Date; settings: Record<string, unknown> }[]>`
      select id, created_at, settings from analysis_runs where id = ${runId} and kind = 'forecast'`
  );
  if (!run) return null;
  const [product] = await query(
    (sql) => sql<{ id: string; product_code: string; name: string; category_code: string | null; order_lot: number | null; min_order_qty: number | null; supplier_name: string | null }[]>`
      select p.id, p.product_code, p.name, p.category_code, p.order_lot, p.min_order_qty, s.name as supplier_name
      from products p left join suppliers s on s.id = p.main_supplier_id where p.id = ${productId}`
  );
  if (!product) return null;
  const weekRows = await query(
    (sql) => sql<
      {
        week_start: string;
        method: WeekForecast["method"];
        base_qty: string;
        festival_event_id: string | null;
        festival_name: string | null;
        shift_days: number;
        growth_rate: string;
        growth_basis: WeekForecast["growthBasis"];
        festival_factor: string;
        bias_factor: string;
        forecast_value: string;
        forecast_qty: number;
      }[]
    >`
      select f.week_start::text as week_start, f.method, f.base_qty, f.festival_event_id, fe.name as festival_name, f.shift_days,
             f.growth_rate, f.growth_basis, f.festival_factor, f.bias_factor, f.forecast_value, f.forecast_qty
      from demand_forecasts f left join festival_events fe on fe.id = f.festival_event_id
      where f.run_id = ${runId} and f.product_id = ${productId} order by f.week_start`
  );
  const [sg] = await query(
    (sql) => sql<
      {
        destination: string;
        abc_rank: AbcRank | null;
        lead_time_days: number;
        review_weeks: string;
        on_hand_qty: number;
        on_order_qty: number;
        lead_time_demand: number;
        safety_stock: number;
        reorder_point: number;
        suggested_qty: number;
        reason: string;
      }[]
    >`
      select destination, abc_rank, lead_time_days, review_weeks, on_hand_qty, on_order_qty, lead_time_demand, safety_stock,
             reorder_point, suggested_qty, reason
      from replenishment_suggestions where run_id = ${runId} and product_id = ${productId}`
  );

  // 手順3 去年の同じ時期の実績・直近12週の実績と、その週の予測
  const start = typeof run.settings.forecastFrom === "string" ? run.settings.forecastFrom : weekRows[0]?.week_start;
  const minShift = Math.max(d.lastYearShiftDays, ...weekRows.map((w) => w.shift_days));
  const from = start ? addDays(start, -minShift - d.growthWeeks * 7 - 7) : addDays(run.created_at.toISOString().slice(0, 10), -800);
  const daily = new Map<string, number>();
  const salesRows = await query(
    (sql) => sql<{ sales_date: string; qty: number }[]>`
      select sales_date::text as sales_date, sum(quantity)::int as qty from sales_daily
      where product_id = ${productId} and sales_date >= ${from}::date group by 1`
  );
  for (const r of salesRows) daily.set(r.sales_date, r.qty);
  const weeks = weekRows.map((w) => ({
    weekStart: w.week_start,
    method: w.method,
    baseQty: Number(w.base_qty),
    festivalEventId: w.festival_event_id,
    festivalName: w.festival_name,
    shiftDays: w.shift_days,
    growthRate: Number(w.growth_rate),
    growthBasis: w.growth_basis,
    festivalFactor: Number(w.festival_factor),
    biasFactor: Number(w.bias_factor),
    forecastValue: Number(w.forecast_value),
    forecastQty: w.forecast_qty,
    lastYearActual: sumDays(daily, addDays(w.week_start, -w.shift_days), 7),
  }));
  let growthRecent = 0;
  let growthLastYear = 0;
  let biasActual = 0;
  let biasForecast = 0;
  const tooLargeWeeks: string[] = [];
  if (start) {
    const recentFrom = addDays(start, -d.growthWeeks * 7);
    growthRecent = sumDays(daily, recentFrom, d.growthWeeks * 7);
    growthLastYear = sumDays(daily, addDays(recentFrom, -d.lastYearShiftDays), d.growthWeeks * 7);
    // 補正の元: その週が始まる前の最後の計算の予測がある週だけ
    const biasFrom = addDays(start, -d.biasWeeks * 7);
    const past = await query(
      (sql) => sql<{ week_start: string; forecast_qty: number }[]>`
        select distinct on (f.week_start) f.week_start::text as week_start, f.forecast_qty
        from demand_forecasts f join analysis_runs r on r.id = f.run_id
        where f.product_id = ${productId} and f.week_start >= ${biasFrom}::date and f.week_start < ${start}::date
          and r.created_at < (f.week_start::timestamp at time zone 'Asia/Tokyo')
        order by f.week_start, r.created_at desc`
    );
    for (const p of past) {
      biasForecast += p.forecast_qty;
      biasActual += sumDays(daily, p.week_start, 7);
    }
    // CH-14 去年の同じ時期の最大の週
    const lyMax = Math.max(0, ...weeks.map((w) => w.lastYearActual));
    for (const w of weeks) if (lyMax > 0 && w.forecastQty > lyMax * d.tooLargeFactor) tooLargeWeeks.push(w.weekStart);
  }

  return {
    runId: run.id,
    runCreatedAt: run.created_at,
    product: { id: product.id, code: product.product_code, name: product.name, categoryCode: product.category_code },
    supplierName: product.supplier_name,
    suggestion: sg
      ? {
          destination: sg.destination,
          abcRank: sg.abc_rank,
          leadTimeDays: sg.lead_time_days,
          reviewWeeks: Number(sg.review_weeks),
          onHandQty: sg.on_hand_qty,
          onOrderQty: sg.on_order_qty,
          leadTimeDemand: sg.lead_time_demand,
          safetyStock: sg.safety_stock,
          reorderPoint: sg.reorder_point,
          suggestedQty: sg.suggested_qty,
          reason: sg.reason,
          orderLot: product.order_lot,
          minOrderQty: product.min_order_qty,
        }
      : null,
    weeks,
    growthRecent,
    growthLastYear,
    biasActual,
    biasForecast,
    tooLargeWeeks,
  };
};
