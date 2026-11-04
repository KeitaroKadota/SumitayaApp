// マスタを引く関数(CMN-02 03 の 0.2)。ほかの機能(CMN-03・A-01・B-01・D-02・E-05 など)が使う読み取り専用の関数。
// 権限チェックはしない(呼ぶ側の画面・操作で requireAccess を済ませている前提)。password_hash は返さない。
import { query } from "@/utils/db";
import { canAccess, isRole, type FeatureKey, type Role } from "@/utils/permissions";
import type { AliasSource, Department } from "@/utils/masterRules";
import { escapeLike } from "@/utils/textNormalize";

export type ActiveEmployee = {
  id: string;
  employeeCode: string;
  lastName: string;
  firstName: string;
  department: Department;
  email: string | null;
  roles: Role[];
  lineUserId: string | null;
};

// 在籍中の従業員を、区分・所属で絞って返す。featureKey を渡すと、その機能を使える人(社長を含む)だけにする
export const listActiveEmployees = async ({
  roles,
  department,
  featureKey,
}: { roles?: Role[]; department?: Department; featureKey?: FeatureKey } = {}): Promise<ActiveEmployee[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        employee_code: string;
        last_name: string;
        first_name: string;
        department: Department;
        email: string | null;
        roles: string[];
        line_user_id: string | null;
      }[]
    >`
      select id, employee_code, last_name, first_name, department, email, roles, line_user_id
      from employees
      where is_active
        ${department ? sql`and department = ${department}` : sql``}
        ${roles && roles.length > 0 ? sql`and roles && ${roles}::text[]` : sql``}
      order by employee_code, last_name_kana, first_name_kana`
  );
  return rows
    .map((r) => ({
      id: r.id,
      employeeCode: r.employee_code,
      lastName: r.last_name,
      firstName: r.first_name,
      department: r.department,
      email: r.email,
      roles: r.roles.filter(isRole),
      lineUserId: r.line_user_id,
    }))
    .filter((e) => !featureKey || canAccess(e.roles, featureKey));
};

export type ProductSummary = {
  id: string;
  productCode: string;
  name: string;
  size: string | null;
  color: string | null;
  sellPrice: number | null;
  sellPriceTaxIncluded: boolean;
  taxRate: number;
  isInHouse: boolean;
  isActive: boolean;
};

type ProductSummaryRow = {
  id: string;
  product_code: string;
  name: string;
  size: string | null;
  color: string | null;
  sell_price: number | null;
  sell_price_tax_included: boolean;
  tax_rate: number;
  is_in_house: boolean;
  is_active: boolean;
};

const toProductSummary = (r: ProductSummaryRow): ProductSummary => ({
  id: r.id,
  productCode: r.product_code,
  name: r.name,
  size: r.size,
  color: r.color,
  sellPrice: r.sell_price,
  sellPriceTaxIncluded: r.sell_price_tax_included,
  taxRate: r.tax_rate,
  isInHouse: r.is_in_house,
  isActive: r.is_active,
});

// 商品コードで1件探す(使用中止も返す。使用中止かは呼ぶ側で判断)
export const findProductByCode = async (code: string): Promise<ProductSummary | null> => {
  const rows = await findProductsByCodes([code]);
  return rows.get(code) ?? null;
};

// 商品コードでまとめて探す(1回のSQL)。商品コード → 商品
export const findProductsByCodes = async (codes: string[]): Promise<Map<string, ProductSummary>> => {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<ProductSummaryRow[]>`
      select id, product_code, name, size, color, sell_price, sell_price_tax_included, tax_rate, is_in_house, is_active
      from products where product_code = any(${unique}::text[])`
  );
  return new Map(rows.map((r) => [r.product_code, toProductSummary(r)]));
};

// 取り込み元のコードを商品に読み替える。先に product_code_aliases を引き、無ければ product_code で引く。
// 見つからないコードは結果に入れない(A-01・B-01)
export const resolveProductCodes = async (source: AliasSource, codes: string[]): Promise<Map<string, ProductSummary>> => {
  const unique = [...new Set(codes)];
  if (unique.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<(ProductSummaryRow & { external_code: string })[]>`
      select a.external_code, p.id, p.product_code, p.name, p.size, p.color, p.sell_price,
             p.sell_price_tax_included, p.tax_rate, p.is_in_house, p.is_active
      from product_code_aliases a join products p on p.id = a.product_id
      where a.source = ${source} and a.external_code = any(${unique}::text[])`
  );
  const result = new Map(rows.map((r) => [r.external_code, toProductSummary(r)]));
  const rest = unique.filter((c) => !result.has(c));
  const byCode = await findProductsByCodes(rest);
  for (const [code, product] of byCode) result.set(code, product);
  return result;
};

// 商品名の部分一致(pg_trgm の索引が効く)。使用中の商品だけ(D-02)
export const searchProductsByName = async (q: string, limit: number): Promise<ProductSummary[]> => {
  const word = q.trim();
  if (!word) return [];
  const rows = await query(
    (sql) => sql<ProductSummaryRow[]>`
      select id, product_code, name, size, color, sell_price, sell_price_tax_included, tax_rate, is_in_house, is_active
      from products where is_active and name ilike ${`%${escapeLike(word)}%`}
      order by product_code limit ${limit}`
  );
  return rows.map(toProductSummary);
};

export type PartnerOption = { id: string; code: string | null; name: string };

// 取引中の仕入先を名前(ふりがな)順で返す
export const listActiveSuppliers = async (): Promise<(PartnerOption & { leadTimeDays: number | null })[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; supplier_code: string | null; name: string; lead_time_days: number | null }[]>`
      select id, supplier_code, name, lead_time_days from suppliers where is_active
      order by name_kana nulls last, name`
  );
  return rows.map((r) => ({ id: r.id, code: r.supplier_code, name: r.name, leadTimeDays: r.lead_time_days }));
};

// 取引中の取引先を名前(ふりがな)順で返す
export const listActiveCustomers = async (): Promise<(PartnerOption & { honorific: string })[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; customer_code: string | null; name: string; honorific: string }[]>`
      select id, customer_code, name, honorific from customers where is_active
      order by name_kana nulls last, name`
  );
  return rows.map((r) => ({ id: r.id, code: r.customer_code, name: r.name, honorific: r.honorific }));
};
