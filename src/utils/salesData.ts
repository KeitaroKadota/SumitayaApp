// 売上の一覧(A-01 G01。03 EV-08、04 CH-13)の集計。sales_daily を SQL で集計してから読む(1行ずつ読まない)。
// 権限チェックはしない(呼ぶ側の画面で requireAccess("sales", …) 済みの前提)。
import { query, type Sql } from "@/utils/db";
import { SALES_CHANNELS, isSalesChannel, type SalesChannel } from "@/utils/csvImport/kinds/salesColumns";
import { diffDays, lastTwelveMonths, monthsBetween } from "@/utils/salesPeriod";
import { escapeLike, isValidDateStr } from "@/utils/textNormalize";

export type SalesUnit = "month" | "week" | "day";
export const SALES_UNITS: Record<SalesUnit, string> = { month: "月", week: "週", day: "日" };

export type SalesFilter = { from: string; to: string; unit: SalesUnit; channel: SalesChannel | ""; q: string };

// 商品別の上位の数(02 G01)
const TOP_PRODUCTS = 100;
// CH-13 期間の上限(3年)・日ごとのときの上限(92日)
const MAX_PERIOD_DAYS = 366 * 3;
const MAX_DAY_UNIT_DAYS = 92;

// CH-13 表示条件を確かめ、だめなら既定(直近12か月・月)に戻す。直したら adjusted = true
export const parseSalesFilter = (
  params: Record<string, string | string[] | undefined>,
  today: string
): { filter: SalesFilter; adjusted: boolean } => {
  const str = (k: string) => (typeof params[k] === "string" ? (params[k] as string).trim() : "");
  const def = lastTwelveMonths(today);
  const fallback: SalesFilter = { ...def, unit: "month", channel: "", q: str("q").slice(0, 100) };
  const hasAny = ["from", "to", "unit", "channel"].some((k) => str(k) !== "");
  if (!hasAny) return { filter: fallback, adjusted: false };

  const from = str("from") || def.from;
  const to = str("to") || def.to;
  const unit = (str("unit") || "month") as SalesUnit;
  const channel = str("channel");
  const ok =
    isValidDateStr(from) &&
    isValidDateStr(to) &&
    from <= to &&
    diffDays(from, to) <= MAX_PERIOD_DAYS &&
    Object.hasOwn(SALES_UNITS, unit) &&
    (unit !== "day" || diffDays(from, to) < MAX_DAY_UNIT_DAYS) &&
    (channel === "" || isSalesChannel(channel));
  if (!ok) return { filter: fallback, adjusted: true };
  return { filter: { from, to, unit, channel: channel as SalesChannel | "", q: fallback.q }, adjusted: false };
};

// 条件の where(sales_daily s と products p を結んだ形)
const whereOf = (sql: Sql, f: SalesFilter) => {
  const like = `%${escapeLike(f.q)}%`;
  return sql`
    s.sales_date between ${f.from}::date and ${f.to}::date
    ${f.channel ? sql`and s.channel = ${f.channel}` : sql``}
    ${f.q ? sql`and (s.product_code ilike ${like} or s.product_name ilike ${like} or p.name ilike ${like} or p.product_code ilike ${like})` : sql``}`;
};

export type SalesTotals = { quantity: number; amountInclTax: number; lineCount: number };
export type SalesPeriodRow = { bucket: string; byChannel: Partial<Record<SalesChannel, number>>; total: number };
export type SalesProductRow = {
  code: string;
  name: string | null;
  linked: boolean;
  quantity: number;
  amountInclTax: number;
  // 販路の内訳(税込金額の割合)
  shares: { channel: SalesChannel; ratio: number }[];
};
export type ChannelCoverage = { channel: SalesChannel; firstMonth: string; lastMonth: string; missing: string[] };

export type SalesOverview = {
  totals: SalesTotals;
  periods: SalesPeriodRow[];
  channels: SalesChannel[];
  products: SalesProductRow[];
  coverage: ChannelCoverage[];
};

// EV-08 手順3〜4
export const getSalesOverview = async (f: SalesFilter): Promise<SalesOverview> => {
  const bucketExpr = (sql: Sql) =>
    f.unit === "month"
      ? sql`date_trunc('month', s.sales_date)::date`
      : f.unit === "week"
        ? sql`date_trunc('week', s.sales_date)::date`
        : sql`s.sales_date`;

  const [totalRows, periodRows, productRows, coverageRows] = [
    await query(
      (sql) => sql<{ quantity: string | null; amount: string | null; lines: string | null }[]>`
        select sum(s.quantity) as quantity, sum(s.amount_incl_tax) as amount, sum(s.line_count) as lines
        from sales_daily s left join products p on p.id = s.product_id
        where ${whereOf(sql, f)}`,
      { timeoutMs: 30_000 }
    ),
    await query(
      (sql) => sql<{ bucket: string; channel: SalesChannel; amount: string }[]>`
        select ${bucketExpr(sql)}::text as bucket, s.channel, sum(s.amount_incl_tax) as amount
        from sales_daily s left join products p on p.id = s.product_id
        where ${whereOf(sql, f)}
        group by 1, 2 order by 1 desc`,
      { timeoutMs: 30_000 }
    ),
    await query(
      (sql) => sql<{ code: string; name: string | null; linked: boolean; quantity: string; amount: string; by_channel: Record<string, string> }[]>`
        with g as (
          select coalesce(p.product_code, s.product_code) as code, max(coalesce(p.name, s.product_name)) as name,
                 bool_or(s.product_id is not null) as linked, s.channel,
                 sum(s.quantity) as quantity, sum(s.amount_incl_tax) as amount
          from sales_daily s left join products p on p.id = s.product_id
          where ${whereOf(sql, f)}
          group by 1, s.channel
        )
        select code, max(name) as name, bool_or(linked) as linked, sum(quantity) as quantity, sum(amount) as amount,
               jsonb_object_agg(channel, amount) as by_channel
        from g group by code
        order by sum(amount) desc, code
        limit ${TOP_PRODUCTS}`,
      { timeoutMs: 30_000 }
    ),
    await query(
      (sql) => sql<{ channel: SalesChannel; month: string }[]>`
        select distinct channel, to_char(sales_date, 'YYYY-MM') as month from sales_daily order by 1, 2`,
      { timeoutMs: 30_000 }
    ),
  ];

  const periodMap = new Map<string, SalesPeriodRow>();
  const channelSet = new Set<SalesChannel>();
  for (const r of periodRows) {
    const row = periodMap.get(r.bucket) ?? { bucket: r.bucket, byChannel: {}, total: 0 };
    row.byChannel[r.channel] = Number(r.amount);
    row.total += Number(r.amount);
    periodMap.set(r.bucket, row);
    channelSet.add(r.channel);
  }
  const channels = (Object.keys(SALES_CHANNELS) as SalesChannel[]).filter((c) => channelSet.has(c));

  // 手順4 販路ごとの取り込んである期間と、抜けている月
  const monthsByChannel = new Map<SalesChannel, string[]>();
  for (const r of coverageRows) monthsByChannel.set(r.channel, [...(monthsByChannel.get(r.channel) ?? []), r.month]);
  const coverage: ChannelCoverage[] = (Object.keys(SALES_CHANNELS) as SalesChannel[])
    .filter((c) => monthsByChannel.has(c))
    .map((c) => {
      const months = monthsByChannel.get(c) ?? [];
      const have = new Set(months);
      const first = months[0];
      const last = months[months.length - 1];
      const all = monthsBetween(`${first}-01`, `${last}-01`);
      return { channel: c, firstMonth: first, lastMonth: last, missing: all.filter((m) => !have.has(m)) };
    });

  const t = totalRows[0];
  return {
    totals: { quantity: Number(t?.quantity ?? 0), amountInclTax: Number(t?.amount ?? 0), lineCount: Number(t?.lines ?? 0) },
    periods: [...periodMap.values()],
    channels,
    products: productRows.map((r) => {
      const amount = Number(r.amount);
      const shares = (Object.keys(SALES_CHANNELS) as SalesChannel[])
        .filter((c) => r.by_channel[c] !== undefined)
        .map((c) => ({ channel: c, ratio: amount !== 0 ? Number(r.by_channel[c]) / amount : 0 }));
      return { code: r.code, name: r.name, linked: r.linked, quantity: Number(r.quantity), amountInclTax: amount, shares };
    }),
    coverage,
  };
};

// 売上の最初と最後の日(A-02・A-03 の画面にも出す)
export const getSalesDateRange = async (): Promise<{ first: string | null; last: string | null }> => {
  const rows = await query(
    (sql) => sql<{ first: string | null; last: string | null }[]>`
      select min(sales_date)::text as first, max(sales_date)::text as last from sales_daily`
  );
  return { first: rows[0]?.first ?? null, last: rows[0]?.last ?? null };
};
