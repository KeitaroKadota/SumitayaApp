// 取引先マスタ(CMN-02 G09・G10)の読み書き。呼ぶ側のページ・操作で requireAccess("customers", …) を済ませておくこと。
import { query } from "@/utils/db";
import type { CustomerType, Honorific } from "@/utils/masterRules";
import type { PartnerCommon } from "@/utils/partnerRules";
import { escapeLike } from "@/utils/textNormalize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerListItem = {
  id: string;
  code: string | null;
  name: string;
  honorific: Honorific;
  customerType: CustomerType;
  contactName: string | null;
  phone: string | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  isActive: boolean;
};

// EV-14: 取引中だけ(?all=1 で全部)。コード・名前・ふりがなの部分一致。コード → ふりがな → 名前 の順
export const listCustomers = async (q: string, includeInactive: boolean): Promise<CustomerListItem[]> => {
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        customer_code: string | null;
        name: string;
        honorific: Honorific;
        customer_type: CustomerType;
        contact_name: string | null;
        phone: string | null;
        closing_day: number | null;
        payment_month_offset: number | null;
        payment_day: number | null;
        is_active: boolean;
      }[]
    >`
      select id, customer_code, name, honorific, customer_type, contact_name, phone, closing_day, payment_month_offset,
             payment_day, is_active
      from customers
      where true
        ${includeInactive ? sql`` : sql`and is_active`}
        ${like ? sql`and (customer_code ilike ${like} or name ilike ${like} or name_kana ilike ${like})` : sql``}
      order by customer_code nulls last, name_kana nulls last, name`
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.customer_code,
    name: r.name,
    honorific: r.honorific,
    customerType: r.customer_type,
    contactName: r.contact_name,
    phone: r.phone,
    closingDay: r.closing_day,
    paymentMonthOffset: r.payment_month_offset,
    paymentDay: r.payment_day,
    isActive: r.is_active,
  }));
};

export type CustomerInput = PartnerCommon & {
  honorific: Honorific;
  customerType: CustomerType;
  payerNameKana: string | null;
};

export type CustomerDetail = CustomerInput & { id: string; isActive: boolean };

export const getCustomer = async (id: string): Promise<CustomerDetail | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        customer_code: string | null;
        name: string;
        name_kana: string | null;
        honorific: Honorific;
        customer_type: CustomerType;
        contact_name: string | null;
        phone: string | null;
        email: string | null;
        postal_code: string | null;
        address: string | null;
        closing_day: number | null;
        payment_month_offset: number | null;
        payment_day: number | null;
        payer_name_kana: string | null;
        note: string | null;
        is_active: boolean;
      }[]
    >`
      select id, customer_code, name, name_kana, honorific, customer_type, contact_name, phone, email, postal_code,
             address, closing_day, payment_month_offset, payment_day, payer_name_kana, note, is_active
      from customers where id = ${id}`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    code: r.customer_code,
    name: r.name,
    nameKana: r.name_kana,
    honorific: r.honorific,
    customerType: r.customer_type,
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    postalCode: r.postal_code,
    address: r.address,
    closingDay: r.closing_day,
    paymentMonthOffset: r.payment_month_offset,
    paymentDay: r.payment_day,
    payerNameKana: r.payer_name_kana,
    note: r.note,
    isActive: r.is_active,
  };
};

// CH-16 コードの重複(取引をやめたものを含む)
export const customerCodeTaken = async (code: string, excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from customers where customer_code = ${code} ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`
  );
  return rows.length > 0;
};

export const insertCustomer = async (c: CustomerInput, by: string): Promise<string> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into customers (
        customer_code, name, name_kana, honorific, customer_type, contact_name, phone, email, postal_code, address,
        closing_day, payment_month_offset, payment_day, payer_name_kana, note, created_by, updated_by
      ) values (
        ${c.code}, ${c.name}, ${c.nameKana}, ${c.honorific}, ${c.customerType}, ${c.contactName}, ${c.phone}, ${c.email},
        ${c.postalCode}, ${c.address}, ${c.closingDay}, ${c.paymentMonthOffset}, ${c.paymentDay}, ${c.payerNameKana},
        ${c.note}, ${by}, ${by}
      ) returning id`
  );
  return rows[0].id;
};

export const updateCustomer = async (id: string, c: CustomerInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update customers set
        customer_code = ${c.code}, name = ${c.name}, name_kana = ${c.nameKana}, honorific = ${c.honorific},
        customer_type = ${c.customerType}, contact_name = ${c.contactName}, phone = ${c.phone}, email = ${c.email},
        postal_code = ${c.postalCode}, address = ${c.address}, closing_day = ${c.closingDay},
        payment_month_offset = ${c.paymentMonthOffset}, payment_day = ${c.paymentDay},
        payer_name_kana = ${c.payerNameKana}, note = ${c.note}, updated_by = ${by}
      where id = ${id}`
  );
};

// EV-16 取引をやめる・取引中に戻す
export const setCustomerActive = async (id: string, isActive: boolean, by: string): Promise<void> => {
  await query((sql) => sql`update customers set is_active = ${isActive}, updated_by = ${by} where id = ${id}`);
};
