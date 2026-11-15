// A-01 の「売上の商品の結び付け直し」(A-01 EV-09 手順2)。
// sales_daily の product_id が空の行を、商品コード(読み替えの表 product_code_aliases があれば読み替えた後)で
// products に結び付ける(1つの UPDATE 文)。A-01 の G01 のボタンのほか、CMN-02 が商品の一括登録(EV-12 手順7)と
// 読み替えのコードの追加(EV-22 手順5)の後に呼ぶ。権限チェックはしない(呼ぶ側で済ませている前提)。
import { query } from "@/utils/db";

// 結び付けた行の数を返す
export const relinkSalesProducts = async (): Promise<number | null> => {
  const result = await query(
    (sql) => sql`
      with cand as (
        select s.id,
               coalesce(
                 (select a.product_id from product_code_aliases a
                   where a.source = case when s.source = 'pos_csv' then 'pos' else 'crossmall' end
                     and a.external_code = s.product_code),
                 (select p.id from products p where p.product_code = s.product_code)
               ) as product_id
        from sales_daily s
        where s.product_id is null
      )
      update sales_daily s set product_id = c.product_id
      from cand c
      where c.id = s.id and c.product_id is not null`,
    { timeoutMs: 60_000 }
  );
  return result.count;
};

// マスタに無い商品コード(product_id が空)の数
export const countUnlinkedSalesCodes = async (): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ n: number }[]>`select count(distinct product_code)::int as n from sales_daily where product_id is null`
  );
  return rows[0]?.n ?? 0;
};
