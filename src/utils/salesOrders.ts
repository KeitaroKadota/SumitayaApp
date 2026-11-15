// 受注(B-01)から売上(sales_daily)への積み上げ(B-01 01 7.5、04 CH-14。A-01 01 7.4)。
// B-01 の受注の登録の中から呼ぶ(src/utils/crossmall/laterLinks.ts の入口を通す)。
// 切替日以後(当日を含む)の注文日ごとに、その日の source = 'orders' の行を消して、その日の注文全部から集計し直して入れる。
// 同じ日・販路・商品コードに A-01 の取り込みの行(source が orders でない行)があれば、その組は積み上げずに警告を返す。
import type { SqlLike, TransactionSql } from "@/utils/db";
import { query } from "@/utils/db";
import { getSalesSettings } from "@/utils/appSettings";

type OrderSalesRow = {
  sales_date: string;
  channel: string;
  product_code: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
  amount_incl_tax: number;
  line_count: number;
  // A-01 の取り込みの行と重なるか
  conflict: boolean;
};

// その日々の注文(キャンセルを除く)の商品の明細を、日(日本時間)×販路×商品コードで集計する
const aggregateOrders = (sql: SqlLike, dates: string[]) => sql<OrderSalesRow[]>`
  with g as (
    select (o.ordered_at at time zone 'Asia/Tokyo')::date as sales_date, o.shop as channel, i.product_code,
           (array_agg(i.product_id) filter (where i.product_id is not null))[1] as product_id,
           (array_agg(i.product_name) filter (where i.product_name <> ''))[1] as product_name,
           sum(i.quantity)::int as quantity, sum(i.amount)::int as amount_incl_tax, count(*)::int as line_count
    from orders o join order_items i on i.order_id = o.id
    where not o.is_cancelled and (o.ordered_at at time zone 'Asia/Tokyo')::date = any(${dates}::date[])
    group by 1, 2, 3
  )
  select g.sales_date::text as sales_date, g.channel, left(g.product_code, 50) as product_code, g.product_id, g.product_name,
         g.quantity, g.amount_incl_tax, g.line_count,
         exists (select 1 from sales_daily s
                 where s.sales_date = g.sales_date and s.channel = g.channel
                   and s.product_code = left(g.product_code, 50) and s.source <> 'orders') as conflict
  from g`;

const warningOf = (r: OrderSalesRow) =>
  `${r.sales_date.replace(/-/g, "/")} ${r.product_code} は売上の取り込み（A-01）の行があるため積み上げませんでした`;

// tx が null(確認の段階)のときは書かずに警告の文だけを返す。tx があれば同じトランザクションの中で作り直す
export const rebuildSalesFromOrders = async (
  tx: TransactionSql | null,
  orderDates: string[],
  cutoverDate: string
): Promise<string[]> => {
  const dates = [...new Set(orderDates)].filter((d) => d >= cutoverDate);
  if (dates.length === 0) return [];
  if (!tx) {
    const rows = await query((sql) => aggregateOrders(sql, dates), { timeoutMs: 30_000 });
    return rows.filter((r) => r.conflict).map(warningOf);
  }

  const { taxRate } = await getSalesSettings(tx);
  await tx`delete from sales_daily where source = 'orders' and sales_date = any(${dates}::date[])`;
  const rows = await aggregateOrders(tx, dates);
  const targets = rows.filter((r) => !r.conflict);
  if (targets.length > 0) {
    // 【仮】明細の金額は税込として扱い、税抜は税率で計算する(1円未満は切り捨て。B-01 01 7.5)
    const records = targets.map((r) => ({
      ...r,
      amount_excl_tax: Math.trunc((r.amount_incl_tax * 100) / (100 + taxRate)),
    }));
    await tx`
      insert into sales_daily (
        sales_date, channel, product_code, product_id, product_name, quantity, amount_excl_tax, amount_incl_tax,
        line_count, source
      )
      select d.sales_date, d.channel, d.product_code, d.product_id, d.product_name, d.quantity, d.amount_excl_tax,
             d.amount_incl_tax, d.line_count, 'orders'
      from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as d (
        sales_date date, channel text, product_code text, product_id uuid, product_name text, quantity integer,
        amount_excl_tax integer, amount_incl_tax integer, line_count integer
      )`;
  }
  return rows.filter((r) => r.conflict).map(warningOf);
};
