// ABC分析(A-02)のDBの読み書き(03 EV-01・EV-02・EV-06、04 CH-01・CH-02)。ランクの決め方は abc.ts(DBを読まない)。
// 計算すると同じトランザクションで商品マスタ(products.abc_rank・abc_ranked_at)へ反映する。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("sales", …) 済みの前提)。
import { query, transaction, type Sql } from "@/utils/db";
import { ABC_SETTINGS, calcAbc, isNewProductOn, type AbcInput, type AbcRank, type AbcSummary } from "@/utils/abc";
import { SALES_CHANNELS, type SalesChannel } from "@/utils/csvImport/kinds/salesColumns";
import { addDays, addMonths, monthsBetween, yearMonthLabel } from "@/utils/salesPeriod";
import { escapeLike, isValidDateStr } from "@/utils/textNormalize";

const CHUNK_SIZE = 1000;
export const ABC_RESULTS_PAGE_SIZE = 100;
const RUNS_SHOWN = 20;

// ---- CH-01 期間が正しい ----

export const checkAbcPeriod = (from: string, to: string, today: string): string | null => {
  const msg = "期間は1か月以上、3年以内で選んでください";
  if (!isValidDateStr(from) || !isValidDateStr(to) || from > to) return "期間を正しく入力してください";
  if (to >= today) return "期間の終わりは今日より前にしてください";
  // 1か月以上(始まりの1か月後の前日まで含む)、3年以内
  if (to < addDays(addMonths(from, 1), -1) || to > addDays(addMonths(from, 36), -1)) return msg;
  return null;
};

// ---- EV-01 画面の情報 ----

export type AbcRunSummary = {
  id: string;
  periodFrom: string;
  periodTo: string;
  summary: Partial<AbcSummary> & { warnings?: string[]; total?: number };
  status: string;
  createdAt: Date;
  createdByName: string | null;
};

type RunRow = {
  id: string;
  period_from: string;
  period_to: string;
  summary: AbcRunSummary["summary"];
  status: string;
  created_at: Date;
  created_by_name: string | null;
};
const toRun = (r: RunRow): AbcRunSummary => ({
  id: r.id,
  periodFrom: r.period_from,
  periodTo: r.period_to,
  summary: r.summary ?? {},
  status: r.status,
  createdAt: r.created_at,
  createdByName: r.created_by_name,
});
// 計算の回を読む SELECT(作った人の名前つき)
const runSelect = (sql: Sql) => sql`
  select r.id, r.period_from::text as period_from, r.period_to::text as period_to, r.summary, r.status, r.created_at,
         case when e.id is null then null else e.last_name || ' ' || e.first_name end as created_by_name
  from analysis_runs r left join employees e on e.id = r.created_by`;

export type AbcOverview = {
  // 商品マスタ(在籍中)のランクごとの数(none: ランク無し)
  rankCounts: Record<AbcRank | "none", number>;
  lastRankedAt: Date | null;
  // 最後に反映した回の、ランクごとの販売金額・出荷頻度の割合(0〜1)
  shares: Record<AbcRank, { amount: number; frequency: number }> | null;
  runs: AbcRunSummary[];
};

export const getAbcOverview = async (): Promise<AbcOverview> => {
  const counts = await query(
    (sql) => sql<{ rank: AbcRank | null; n: number; ranked_at: Date | null }[]>`
      select abc_rank as rank, count(*)::int as n, max(abc_ranked_at) as ranked_at from products where is_active group by abc_rank`
  );
  const runs = await query(
    (sql) => sql<RunRow[]>`
      ${runSelect(sql)}
      where r.kind = 'abc' order by r.created_at desc limit ${RUNS_SHOWN}`
  );
  const last = runs.find((r) => r.status === "applied");
  let shares: AbcOverview["shares"] = null;
  if (last) {
    const rows = await query(
      (sql) => sql<{ rank: AbcRank; amount: string; frequency: string }[]>`
        select rank, sum(sales_amount) as amount, sum(frequency) as frequency from abc_results where run_id = ${last.id} group by rank`
    );
    const totalAmount = rows.reduce((s, r) => s + Number(r.amount), 0);
    const totalFreq = rows.reduce((s, r) => s + Number(r.frequency), 0);
    shares = { A: { amount: 0, frequency: 0 }, B: { amount: 0, frequency: 0 }, C: { amount: 0, frequency: 0 } };
    for (const r of rows)
      shares[r.rank] = {
        amount: totalAmount > 0 ? Number(r.amount) / totalAmount : 0,
        frequency: totalFreq > 0 ? Number(r.frequency) / totalFreq : 0,
      };
  }
  const rankCounts: AbcOverview["rankCounts"] = { A: 0, B: 0, C: 0, none: 0 };
  let lastRankedAt: Date | null = null;
  for (const c of counts) {
    rankCounts[c.rank ?? "none"] = c.n;
    if (c.ranked_at && (!lastRankedAt || c.ranked_at > lastRankedAt)) lastRankedAt = c.ranked_at;
  }
  return { rankCounts, lastRankedAt, shares, runs: runs.map(toRun) };
};

// ---- EV-02 計算する ----

export type RunAbcResult = { ok: true; runId: string; changed: number } | { ok: false; error: string };

// CH-02 期間に売上がある(0行はエラー。売上の無い月・12か月より短い期間は警告)
const checkSalesInPeriod = async (from: string, to: string): Promise<{ error: string | null; warnings: string[] }> => {
  const rows = await query(
    (sql) => sql<{ channel: SalesChannel; month: string; first_month: string }[]>`
      with f as (select channel, to_char(min(sales_date), 'YYYY-MM') as first_month from sales_daily group by channel)
      select f.channel, f.first_month, coalesce(m.month, '') as month
      from f left join (
        select distinct channel, to_char(sales_date, 'YYYY-MM') as month from sales_daily
        where sales_date between ${from}::date and ${to}::date
      ) m on m.channel = f.channel`
  );
  if (!rows.some((r) => r.month)) return { error: "この期間の売上がありません。先に売上を取り込んでください（A-01）", warnings: [] };
  const warnings: string[] = [];
  const months = monthsBetween(from, to);
  for (const channel of Object.keys(SALES_CHANNELS) as SalesChannel[]) {
    const chRows = rows.filter((r) => r.channel === channel);
    if (chRows.length === 0) continue;
    const have = new Set(chRows.map((r) => r.month));
    const missing = months.filter((m) => m >= chRows[0].first_month && !have.has(m));
    if (missing.length > 0)
      warnings.push(`${SALES_CHANNELS[channel]}: ${missing.map(yearMonthLabel).join("・")} の売上がありません。取り込み漏れではありませんか`);
  }
  if (to < addDays(addMonths(from, ABC_SETTINGS.periodMonths), -1))
    warnings.push("季節の差が大きいので、12か月以上の期間をおすすめします");
  return { error: null, warnings };
};

export const runAbc = async (from: string, to: string, today: string, by: string): Promise<RunAbcResult> => {
  // 手順3 CH-02
  const check = await checkSalesInPeriod(from, to);
  if (check.error) return { ok: false, error: check.error };

  // 手順4 商品ごとに SQL で合計する(マスタに結び付いていない行でも、コードがマスタにあればその商品として数える)
  const sales = await query(
    (sql) => sql<{ product_id: string | null; code: string; amount: string; quantity: string; frequency: string }[]>`
      select coalesce(p.id, p2.id) as product_id, coalesce(p.product_code, p2.product_code, s.product_code) as code,
             sum(s.amount_excl_tax) as amount, sum(s.quantity) as quantity, sum(s.line_count) as frequency
      from sales_daily s
      left join products p on p.id = s.product_id
      left join products p2 on s.product_id is null and p2.product_code = s.product_code
      where s.sales_date between ${from}::date and ${to}::date
      group by 1, 2`,
    { timeoutMs: 60_000 }
  );
  // 手順5・6 商品マスタ(在籍中と、売上のある商品)。新商品は登録から定数の日数以内(移行日までに登録した商品は除く)
  const productIds = sales.map((s) => s.product_id).filter((id): id is string => !!id);
  const products = await query(
    (sql) => sql<{ id: string; product_code: string; abc_rank: AbcRank | null; created_on: string }[]>`
      select id, product_code, abc_rank, (created_at at time zone 'Asia/Tokyo')::date::text as created_on
      from products where is_active or id = any(${productIds}::uuid[])`,
    { timeoutMs: 30_000 }
  );
  const newSince = addDays(today, -ABC_SETTINGS.newProductDays);
  const byId = new Map(products.map((p) => [p.id, p]));
  const inputs: AbcInput[] = sales.map((s) => {
    const p = s.product_id ? byId.get(s.product_id) : undefined;
    return {
      productId: s.product_id,
      productCode: s.code,
      amount: Number(s.amount),
      quantity: Number(s.quantity),
      frequency: Number(s.frequency),
      currentRank: p?.abc_rank ?? null,
      isNewProduct: p ? isNewProductOn(p.created_on, newSince) : false,
    };
  });
  const sold = new Set(productIds);
  for (const p of products)
    if (!sold.has(p.id))
      inputs.push({
        productId: p.id,
        productCode: p.product_code,
        amount: 0,
        quantity: 0,
        frequency: 0,
        currentRank: p.abc_rank,
        isNewProduct: isNewProductOn(p.created_on, newSince),
      });

  // 手順7
  const { results, summary } = calcAbc(inputs);
  const round4 = (n: number) => Math.round(n * 10000) / 10000;

  // 手順8〜10 1つのトランザクションで保存し、商品マスタへ反映する
  try {
    const runId = await transaction(
      async (tx) => {
        const [run] = await tx<{ id: string }[]>`
          insert into analysis_runs (kind, period_from, period_to, settings, summary, status, created_by, updated_by, applied_by, applied_at)
          values ('abc', ${from}, ${to}, ${tx.json(ABC_SETTINGS as never)},
                  ${tx.json({ ...summary, total: results.length, warnings: check.warnings } as never)}, 'applied', ${by}, ${by}, ${by}, now())
          returning id`;
        for (let i = 0; i < results.length; i += CHUNK_SIZE) {
          const records = results.slice(i, i + CHUNK_SIZE).map((r) => ({
            product_id: r.productId,
            product_code: r.productCode,
            sales_amount: r.amount,
            sales_quantity: r.quantity,
            frequency: r.frequency,
            amount_share: round4(r.amountShare),
            amount_cum_share: round4(r.amountCumShare),
            frequency_cum_share: round4(r.frequencyCumShare),
            amount_rank: r.amountRank,
            frequency_rank: r.frequencyRank,
            rank: r.rank,
            previous_rank: r.currentRank,
            is_new_product: r.isNewProduct,
          }));
          await tx`
            insert into abc_results (
              run_id, product_id, product_code, sales_amount, sales_quantity, frequency, amount_share, amount_cum_share,
              frequency_cum_share, amount_rank, frequency_rank, rank, previous_rank, is_new_product
            )
            select ${run.id}, d.product_id, d.product_code, d.sales_amount, d.sales_quantity, d.frequency, d.amount_share,
                   d.amount_cum_share, d.frequency_cum_share, d.amount_rank, d.frequency_rank, d.rank, d.previous_rank, d.is_new_product
            from jsonb_to_recordset(${JSON.stringify(records)}::text::jsonb) as d (
              product_id uuid, product_code text, sales_amount bigint, sales_quantity integer, frequency integer,
              amount_share numeric, amount_cum_share numeric, frequency_cum_share numeric, amount_rank text,
              frequency_rank text, rank text, previous_rank text, is_new_product boolean
            )`;
        }
        // 手順9 product_id のある結果を商品マスタへ(この回に結果の無い商品は変えない)
        await tx`
          update products p set abc_rank = r.rank, abc_ranked_at = now()
          from abc_results r where r.run_id = ${run.id} and r.product_id = p.id`;
        return run.id;
      },
      { timeoutMs: 110_000 }
    );
    return { ok: true, runId, changed: summary.changed };
  } catch (e) {
    console.error("ABC分析を保存できませんでした:", e instanceof Error ? e.message : e);
    return { ok: false, error: "保存に失敗しました。商品マスタのランクは変えていません" };
  }
};

// ---- EV-06 結果の詳細 ----

export const getAbcRun = async (runId: string): Promise<AbcRunSummary | null> => {
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return null;
  const rows = await query(
    (sql) => sql<RunRow[]>`
      ${runSelect(sql)}
      where r.id = ${runId} and r.kind = 'abc'`
  );
  return rows[0] ? toRun(rows[0]) : null;
};

export type AbcResultRow = {
  order: number;
  productId: string | null;
  productCode: string;
  name: string | null;
  salesAmount: number;
  amountCumShare: number;
  frequency: number;
  amountRank: AbcRank;
  frequencyRank: AbcRank;
  rank: AbcRank;
  previousRank: AbcRank | null;
  isNewProduct: boolean;
};

export type AbcResultFilter = { changedOnly: boolean; rank: AbcRank | ""; q: string; page: number };

export const listAbcResults = async (runId: string, f: AbcResultFilter): Promise<{ total: number; rows: AbcResultRow[] }> => {
  const like = `%${escapeLike(f.q)}%`;
  const offset = (f.page - 1) * ABC_RESULTS_PAGE_SIZE;
  const rows = await query(
    (sql) => sql<
      {
        ord: string;
        product_id: string | null;
        product_code: string;
        name: string | null;
        sales_amount: string;
        amount_cum_share: string;
        frequency: number;
        amount_rank: AbcRank;
        frequency_rank: AbcRank;
        rank: AbcRank;
        previous_rank: AbcRank | null;
        is_new_product: boolean;
        total: string;
      }[]
    >`
      with ranked as (
        select r.*, row_number() over (order by r.amount_cum_share, r.sales_amount desc, r.frequency desc, r.product_code) as ord,
               coalesce(p.name, (select max(s.product_name) from sales_daily s where s.product_code = r.product_code)) as name
        from abc_results r left join products p on p.id = r.product_id
        where r.run_id = ${runId}
      )
      select ord, product_id, product_code, name, sales_amount, amount_cum_share, frequency, amount_rank, frequency_rank,
             rank, previous_rank, is_new_product, count(*) over () as total
      from ranked
      where true
        ${f.changedOnly ? sql`and product_id is not null and previous_rank is distinct from rank` : sql``}
        ${f.rank ? sql`and rank = ${f.rank}` : sql``}
        ${f.q ? sql`and (product_code ilike ${like} or name ilike ${like})` : sql``}
      order by ord
      limit ${ABC_RESULTS_PAGE_SIZE} offset ${offset}`,
    { timeoutMs: 30_000 }
  );
  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((r) => ({
      order: Number(r.ord),
      productId: r.product_id,
      productCode: r.product_code,
      name: r.name,
      salesAmount: Number(r.sales_amount),
      amountCumShare: Number(r.amount_cum_share),
      frequency: r.frequency,
      amountRank: r.amount_rank,
      frequencyRank: r.frequency_rank,
      rank: r.rank,
      previousRank: r.previous_rank,
      isNewProduct: r.is_new_product,
    })),
  };
};

