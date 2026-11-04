// 商品マスタ(CMN-02 G04・G05)の読み書き。呼ぶ側のページ・操作で requireAccess("products", …) を済ませておくこと。
import { query, type Sql } from "@/utils/db";
import { PRODUCT_PAGE_SIZE, type AliasSource } from "@/utils/masterRules";
import { escapeLike } from "@/utils/textNormalize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);

export type ProductListItem = {
  id: string;
  productCode: string;
  name: string;
  size: string | null;
  color: string | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  isInHouse: boolean;
  supplierName: string | null;
  supplierActive: boolean | null;
  abcRank: string | null;
  isActive: boolean;
};

// EV-07: 検索・分類・使用中止も表示・ページ。並び順は商品コード順、1ページ50件
export const listProducts = async ({
  q,
  category,
  includeInactive,
  page,
}: {
  q: string;
  category: string;
  includeInactive: boolean;
  page: number;
}): Promise<{ total: number; items: ProductListItem[] }> => {
  const like = q ? `%${escapeLike(q)}%` : null;
  const offset = (page - 1) * PRODUCT_PAGE_SIZE;
  const where = (sql: Sql) => sql`
    where true
      ${includeInactive ? sql`` : sql`and p.is_active`}
      ${category ? sql`and p.category_code = ${category}` : sql``}
      ${
        like
          ? sql`and (p.product_code ilike ${like} or p.item_code ilike ${like} or p.name ilike ${like}
                 or p.jan_code ilike ${like}
                 or exists (select 1 from product_code_aliases a where a.product_id = p.id and a.external_code ilike ${like}))`
          : sql``
      }`;

  const countRows = await query((sql) => sql<{ n: number }[]>`select count(*)::int as n from products p ${where(sql)}`);
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        product_code: string;
        name: string;
        size: string | null;
        color: string | null;
        sell_price: number | null;
        sell_price_tax_included: boolean;
        is_in_house: boolean;
        supplier_name: string | null;
        supplier_active: boolean | null;
        abc_rank: string | null;
        is_active: boolean;
      }[]
    >`
      select p.id, p.product_code, p.name, p.size, p.color, p.sell_price, p.sell_price_tax_included, p.is_in_house,
             s.name as supplier_name, s.is_active as supplier_active, p.abc_rank, p.is_active
      from products p left join suppliers s on s.id = p.main_supplier_id
      ${where(sql)}
      order by p.product_code limit ${PRODUCT_PAGE_SIZE} offset ${offset}`
  );
  return {
    total: countRows[0]?.n ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      productCode: r.product_code,
      name: r.name,
      size: r.size,
      color: r.color,
      sellPrice: r.sell_price,
      sellPriceTaxIncluded: r.sell_price_tax_included,
      isInHouse: r.is_in_house,
      supplierName: r.supplier_name,
      supplierActive: r.supplier_active,
      abcRank: r.abc_rank,
      isActive: r.is_active,
    })),
  };
};

export type ProductDetail = {
  id: string;
  productCode: string;
  itemCode: string | null;
  name: string;
  size: string | null;
  color: string | null;
  janCode: string | null;
  categoryCode: string | null;
  mainSupplierId: string | null;
  costPrice: number | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  taxRate: number;
  isInHouse: boolean;
  orderLot: number | null;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  abcRank: string | null;
  abcRankedAt: Date | null;
  note: string | null;
  isActive: boolean;
};

export const getProduct = async (id: string): Promise<ProductDetail | null> => {
  if (!isUuid(id)) return null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        product_code: string;
        item_code: string | null;
        name: string;
        size: string | null;
        color: string | null;
        jan_code: string | null;
        category_code: string | null;
        main_supplier_id: string | null;
        cost_price: number | null;
        sell_price: number | null;
        sell_price_tax_included: boolean;
        tax_rate: number;
        is_in_house: boolean;
        order_lot: number | null;
        min_order_qty: number | null;
        lead_time_days: number | null;
        abc_rank: string | null;
        abc_ranked_at: Date | null;
        note: string | null;
        is_active: boolean;
      }[]
    >`
      select id, product_code, item_code, name, size, color, jan_code, category_code, main_supplier_id, cost_price,
             sell_price, sell_price_tax_included, tax_rate, is_in_house, order_lot, min_order_qty, lead_time_days,
             abc_rank, abc_ranked_at, note, is_active
      from products where id = ${id}`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    productCode: r.product_code,
    itemCode: r.item_code,
    name: r.name,
    size: r.size,
    color: r.color,
    janCode: r.jan_code,
    categoryCode: r.category_code,
    mainSupplierId: r.main_supplier_id,
    costPrice: r.cost_price,
    sellPrice: r.sell_price,
    sellPriceTaxIncluded: r.sell_price_tax_included,
    taxRate: r.tax_rate,
    isInHouse: r.is_in_house,
    orderLot: r.order_lot,
    minOrderQty: r.min_order_qty,
    leadTimeDays: r.lead_time_days,
    abcRank: r.abc_rank,
    abcRankedAt: r.abc_ranked_at,
    note: r.note,
    isActive: r.is_active,
  };
};

// 主な仕入先の選択肢(取引中のものと、今の値)
export type SupplierOption = { id: string; name: string; leadTimeDays: number | null; isActive: boolean };
export const listSupplierOptions = async (currentId: string | null): Promise<SupplierOption[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; name: string; lead_time_days: number | null; is_active: boolean }[]>`
      select id, name, lead_time_days, is_active from suppliers
      where is_active ${currentId ? sql`or id = ${currentId}` : sql``}
      order by name_kana nulls last, name`
  );
  return rows.map((r) => ({ id: r.id, name: r.name, leadTimeDays: r.lead_time_days, isActive: r.is_active }));
};

// CH-13 選んだ仕入先が取引中か(今の値なら取引終了でもよい)
export const supplierSelectable = async (id: string, currentId: string | null): Promise<boolean> => {
  if (!isUuid(id)) return false;
  const rows = await query((sql) => sql<{ is_active: boolean }[]>`select is_active from suppliers where id = ${id}`);
  return rows.length > 0 && (rows[0].is_active || id === currentId);
};

// CH-08 商品コードの重複(使用中止を含む)
export const productCodeTaken = async (code: string): Promise<boolean> => {
  const rows = await query((sql) => sql<{ id: string }[]>`select id from products where product_code = ${code} limit 1`);
  return rows.length > 0;
};

// 保存する列(EV-08 手順4。product_code・abc_rank・abc_ranked_at は編集では変えない。CH-14)
export type ProductInput = {
  itemCode: string | null;
  name: string;
  size: string | null;
  color: string | null;
  janCode: string | null;
  categoryCode: string | null;
  mainSupplierId: string | null;
  costPrice: number | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  taxRate: number;
  isInHouse: boolean;
  orderLot: number | null;
  minOrderQty: number | null;
  leadTimeDays: number | null;
  note: string | null;
};

export const insertProduct = async (productCode: string, p: ProductInput, by: string): Promise<string> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into products (
        product_code, item_code, name, size, color, jan_code, category_code, main_supplier_id, cost_price, sell_price,
        sell_price_tax_included, tax_rate, is_in_house, order_lot, min_order_qty, lead_time_days, note,
        created_by, updated_by
      ) values (
        ${productCode}, ${p.itemCode}, ${p.name}, ${p.size}, ${p.color}, ${p.janCode}, ${p.categoryCode},
        ${p.mainSupplierId}, ${p.costPrice}, ${p.sellPrice}, ${p.sellPriceTaxIncluded}, ${p.taxRate}, ${p.isInHouse},
        ${p.orderLot}, ${p.minOrderQty}, ${p.leadTimeDays}, ${p.note}, ${by}, ${by}
      ) returning id`
  );
  return rows[0].id;
};

export const updateProduct = async (id: string, p: ProductInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update products set
        item_code = ${p.itemCode}, name = ${p.name}, size = ${p.size}, color = ${p.color}, jan_code = ${p.janCode},
        category_code = ${p.categoryCode}, main_supplier_id = ${p.mainSupplierId}, cost_price = ${p.costPrice},
        sell_price = ${p.sellPrice}, sell_price_tax_included = ${p.sellPriceTaxIncluded}, tax_rate = ${p.taxRate},
        is_in_house = ${p.isInHouse}, order_lot = ${p.orderLot}, min_order_qty = ${p.minOrderQty},
        lead_time_days = ${p.leadTimeDays}, note = ${p.note}, updated_by = ${by}
      where id = ${id}`
  );
};

// EV-09 使用中止・使用中に戻す
export const setProductActive = async (id: string, isActive: boolean, by: string): Promise<void> => {
  await query((sql) => sql`update products set is_active = ${isActive}, updated_by = ${by} where id = ${id}`);
};

// ---- 読み替えのコード(EV-22・EV-23) ----

export type ProductAlias = { id: string; source: AliasSource; externalCode: string };

export const listAliases = async (productId: string): Promise<ProductAlias[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; source: AliasSource; external_code: string }[]>`
      select id, source, external_code from product_code_aliases where product_id = ${productId}
      order by source, external_code`
  );
  return rows.map((r) => ({ id: r.id, source: r.source, externalCode: r.external_code }));
};

// CH-37 同じ取り込み元・同じ元のコードの行があれば、その読み替え先の商品コード
export const aliasOwnerCode = async (source: AliasSource, externalCode: string): Promise<string | null> => {
  const rows = await query(
    (sql) => sql<{ product_code: string }[]>`
      select p.product_code from product_code_aliases a join products p on p.id = a.product_id
      where a.source = ${source} and a.external_code = ${externalCode}`
  );
  return rows[0]?.product_code ?? null;
};

export const insertAlias = async (
  productId: string,
  source: AliasSource,
  externalCode: string,
  by: string
): Promise<void> => {
  await query(
    (sql) => sql`
      insert into product_code_aliases (source, external_code, product_id, created_by, updated_by)
      values (${source}, ${externalCode}, ${productId}, ${by}, ${by})`
  );
};

export const deleteAlias = async (productId: string, aliasId: string): Promise<void> => {
  if (!isUuid(aliasId)) return;
  await query((sql) => sql`delete from product_code_aliases where id = ${aliasId} and product_id = ${productId}`);
};
