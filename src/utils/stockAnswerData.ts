// D-02 在庫照会の、DBを読む部分(03 EV-01〜EV-03、0.1 に渡す値をそろえる)。計算は stockAnswer.ts。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess("inquiries", …) を済ませている前提)。
// 在庫数は B-01 の getStock、入荷予定は A-03 の getIncomingByProduct、休業日は CMN-02 の getCalendar で読む。
import { query } from "@/utils/db";
import { addDays, getCalendar } from "@/utils/holidays";
import { getStock } from "@/utils/inventoryLevels";
import { SHIPPING_SEARCH_DAYS, STOCK_LIMITS } from "@/utils/inquirySettings";
import { todayJST } from "@/utils/jst";
import { getIncomingByProduct } from "@/utils/purchaseOrders";
import {
  calcStockAnswer,
  displayNameOf,
  parseFactsItems,
  shippingDayRule,
  type StockAnswer,
  type StockProductInput,
} from "@/utils/stockAnswer";
import { escapeLike } from "@/utils/textNormalize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 届くまでの日数の上限(products・suppliers の CHECK と同じ)。休業日はこの先まで読む
const LEAD_TIME_MAX_DAYS = 365;

export type StockProductOption = { id: string; productCode: string; displayName: string; isActive: boolean };

type ProductRow = {
  id: string;
  product_code: string;
  name: string;
  size: string | null;
  color: string | null;
  is_active: boolean;
  is_in_house: boolean;
  lead_time_days: number | null;
};

const toOption = (r: Pick<ProductRow, "id" | "product_code" | "name" | "size" | "color" | "is_active">): StockProductOption => ({
  id: r.id,
  productCode: r.product_code,
  displayName: displayNameOf(r),
  isActive: r.is_active,
});

// ---- EV-02 「探す」 ----

// 手順2: 商品コード・JANコードの完全一致。手順3: 無ければ、商品名・サイズ・色に、空白で区切った言葉がすべて含まれるもの。
// 使わない商品(取り扱い終了)も出す。コード順に最大20件
export const searchStockProducts = async (q: string): Promise<StockProductOption[]> => {
  const text = q.normalize("NFKC").trim();
  const exact = await query(
    (sql) => sql<ProductRow[]>`
      select id, product_code, name, size, color, is_active from products
      where product_code = ${text} or jan_code = ${text}
      order by product_code limit ${STOCK_LIMITS.searchResults}`
  );
  if (exact.length > 0) return exact.map(toOption);

  const words = [...new Set(text.split(/\s+/).filter(Boolean))].slice(0, 10);
  if (words.length === 0) return [];
  const rows = await query(
    (sql) => sql<ProductRow[]>`
      select id, product_code, name, size, color, is_active from products
      where ${words.reduce(
        (acc, w) => {
          const like = `%${escapeLike(w)}%`;
          return sql`${acc} and (name ilike ${like} or coalesce(size, '') ilike ${like} or coalesce(color, '') ilike ${like})`;
        },
        sql`true`
      )}
      order by product_code limit ${STOCK_LIMITS.searchResults}`
  );
  return rows.map(toOption);
};

export const getStockProductOptions = async (ids: string[]): Promise<StockProductOption[]> => {
  const valid = ids.filter((id) => UUID_PATTERN.test(id));
  if (valid.length === 0) return [];
  const rows = await query(
    (sql) => sql<ProductRow[]>`
      select id, product_code, name, size, color, is_active from products where id = any(${valid}::uuid[])`
  );
  const byId = new Map(rows.map((r) => [r.id, toOption(r)]));
  return valid.map((id) => byId.get(id)).filter((p): p is StockProductOption => !!p);
};

// ---- EV-03 手順2 表を作る(保存はしない) ----

export type StockSelection = { productId: string; quantity: number };

// 選んだ商品の在庫数・仕入先・入荷予定・休業日を読み、calcStockAnswer で表を作る。見つからない商品は除く
export const loadStockAnswer = async (selection: StockSelection[], now: Date = new Date()): Promise<StockAnswer> => {
  const ids = [...new Set(selection.map((s) => s.productId).filter((id) => UUID_PATTERN.test(id)))];
  if (ids.length === 0) return { rows: [], stockAsOf: null, stockAgeHours: null, stockStale: false, warnings: [] };

  // 届くまでの日数は商品の値、空なら主な仕入先の値(CMN-02 の products.lead_time_days)
  const rows = await query(
    (sql) => sql<ProductRow[]>`
      select p.id, p.product_code, p.name, p.size, p.color, p.is_active, p.is_in_house,
             coalesce(p.lead_time_days, s.lead_time_days) as lead_time_days
      from products p left join suppliers s on s.id = p.main_supplier_id
      where p.id = any(${ids}::uuid[])`
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const incoming = await getIncomingByProduct(ids);

  const today = todayJST();
  const calendar = await getCalendar(today, addDays(today, LEAD_TIME_MAX_DAYS + SHIPPING_SEARCH_DAYS + 1));

  const inputs: StockProductInput[] = [];
  for (const s of selection) {
    const p = byId.get(s.productId);
    if (!p || inputs.some((i) => i.productId === p.id)) continue;
    // B-01 の getStock(在庫の時点も読む)。DBの接続は1本ずつ流すため、順に読む
    const stock = await getStock(p.id);
    inputs.push({
      productId: p.id,
      productCode: p.product_code,
      name: p.name,
      size: p.size,
      color: p.color,
      isActive: p.is_active,
      isInHouse: p.is_in_house,
      leadTimeDays: p.lead_time_days,
      quantityWanted: s.quantity,
      stock,
      incoming: incoming.get(p.id) ?? [],
    });
  }
  return calcStockAnswer(inputs, now, shippingDayRule(calendar));
};

// ---- EV-01 手順3 過去に作った在庫の案の、選んだ商品 ----

export const lastStockSelection = async (inquiryId: string): Promise<StockSelection[]> => {
  const [row] = await query(
    (sql) => sql<{ facts: Record<string, unknown> | null }[]>`
      select facts from inquiry_replies where inquiry_id = ${inquiryId} and kind = 'stock'
      order by created_at desc limit 1`
  );
  return parseFactsItems(row?.facts?.items).map((i) => ({ productId: i.product_id, quantity: i.quantity_wanted }));
};
