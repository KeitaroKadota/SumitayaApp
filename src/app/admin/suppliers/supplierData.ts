// 仕入先マスタ(CMN-02 G07・G08)の読み書き。呼ぶ側のページ・操作で requireAccess("suppliers", …) を済ませておくこと。
import { query } from "@/utils/db";
import type { OrderMethod, PaymentMethod } from "@/utils/masterRules";
import type { PartnerCommon } from "@/utils/partnerRules";
import { escapeLike } from "@/utils/textNormalize";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SupplierListItem = {
  id: string;
  code: string | null;
  name: string;
  phone: string | null;
  orderMethod: OrderMethod | null;
  leadTimeDays: number | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  isActive: boolean;
};

// EV-14: 取引中だけ(?all=1 で全部)。コード・名前・ふりがな・別名の部分一致。コード → ふりがな → 名前 の順
export const listSuppliers = async (q: string, includeInactive: boolean): Promise<SupplierListItem[]> => {
  const like = q ? `%${escapeLike(q)}%` : null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        supplier_code: string | null;
        name: string;
        phone: string | null;
        order_method: OrderMethod | null;
        lead_time_days: number | null;
        closing_day: number | null;
        payment_month_offset: number | null;
        payment_day: number | null;
        is_active: boolean;
      }[]
    >`
      select id, supplier_code, name, phone, order_method, lead_time_days, closing_day, payment_month_offset, payment_day,
             is_active
      from suppliers
      where true
        ${includeInactive ? sql`` : sql`and is_active`}
        ${
          like
            ? sql`and (supplier_code ilike ${like} or name ilike ${like} or name_kana ilike ${like}
                   or exists (select 1 from unnest(aliases) as a(alias) where a.alias ilike ${like}))`
            : sql``
        }
      order by supplier_code nulls last, name_kana nulls last, name`
  );
  return rows.map((r) => ({
    id: r.id,
    code: r.supplier_code,
    name: r.name,
    phone: r.phone,
    orderMethod: r.order_method,
    leadTimeDays: r.lead_time_days,
    closingDay: r.closing_day,
    paymentMonthOffset: r.payment_month_offset,
    paymentDay: r.payment_day,
    isActive: r.is_active,
  }));
};

export type SupplierInput = PartnerCommon & {
  aliases: string[];
  fax: string | null;
  orderMethod: OrderMethod | null;
  leadTimeDays: number | null;
  registrationNo: string | null;
  paymentMethod: PaymentMethod | null;
  transferTo: string | null;
  ocrHint: string | null;
};

export type SupplierDetail = SupplierInput & { id: string; isActive: boolean };

export const getSupplier = async (id: string): Promise<SupplierDetail | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        supplier_code: string | null;
        name: string;
        name_kana: string | null;
        aliases: string[];
        contact_name: string | null;
        phone: string | null;
        fax: string | null;
        email: string | null;
        postal_code: string | null;
        address: string | null;
        order_method: OrderMethod | null;
        lead_time_days: number | null;
        registration_no: string | null;
        closing_day: number | null;
        payment_month_offset: number | null;
        payment_day: number | null;
        payment_method: PaymentMethod | null;
        transfer_to: string | null;
        ocr_hint: string | null;
        note: string | null;
        is_active: boolean;
      }[]
    >`
      select id, supplier_code, name, name_kana, aliases, contact_name, phone, fax, email, postal_code, address,
             order_method, lead_time_days, registration_no, closing_day, payment_month_offset, payment_day,
             payment_method, transfer_to, ocr_hint, note, is_active
      from suppliers where id = ${id}`
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    code: r.supplier_code,
    name: r.name,
    nameKana: r.name_kana,
    aliases: r.aliases,
    contactName: r.contact_name,
    phone: r.phone,
    fax: r.fax,
    email: r.email,
    postalCode: r.postal_code,
    address: r.address,
    orderMethod: r.order_method,
    leadTimeDays: r.lead_time_days,
    registrationNo: r.registration_no,
    closingDay: r.closing_day,
    paymentMonthOffset: r.payment_month_offset,
    paymentDay: r.payment_day,
    paymentMethod: r.payment_method,
    transferTo: r.transfer_to,
    ocrHint: r.ocr_hint,
    note: r.note,
    isActive: r.is_active,
  };
};

// CH-16 コードの重複(取引をやめたものを含む)
export const supplierCodeTaken = async (code: string, excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from suppliers where supplier_code = ${code} ${excludeId ? sql`and id <> ${excludeId}` : sql``} limit 1`
  );
  return rows.length > 0;
};

export const insertSupplier = async (s: SupplierInput, by: string): Promise<string> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      insert into suppliers (
        supplier_code, name, name_kana, aliases, contact_name, phone, fax, email, postal_code, address, order_method,
        lead_time_days, registration_no, closing_day, payment_month_offset, payment_day, payment_method, transfer_to,
        ocr_hint, note, created_by, updated_by
      ) values (
        ${s.code}, ${s.name}, ${s.nameKana}, ${s.aliases}::text[], ${s.contactName}, ${s.phone}, ${s.fax}, ${s.email},
        ${s.postalCode}, ${s.address}, ${s.orderMethod}, ${s.leadTimeDays}, ${s.registrationNo}, ${s.closingDay},
        ${s.paymentMonthOffset}, ${s.paymentDay}, ${s.paymentMethod}, ${s.transferTo}, ${s.ocrHint}, ${s.note},
        ${by}, ${by}
      ) returning id`
  );
  return rows[0].id;
};

export const updateSupplier = async (id: string, s: SupplierInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update suppliers set
        supplier_code = ${s.code}, name = ${s.name}, name_kana = ${s.nameKana}, aliases = ${s.aliases}::text[],
        contact_name = ${s.contactName}, phone = ${s.phone}, fax = ${s.fax}, email = ${s.email},
        postal_code = ${s.postalCode}, address = ${s.address}, order_method = ${s.orderMethod},
        lead_time_days = ${s.leadTimeDays}, registration_no = ${s.registrationNo}, closing_day = ${s.closingDay},
        payment_month_offset = ${s.paymentMonthOffset}, payment_day = ${s.paymentDay},
        payment_method = ${s.paymentMethod}, transfer_to = ${s.transferTo}, ocr_hint = ${s.ocrHint}, note = ${s.note},
        updated_by = ${by}
      where id = ${id}`
  );
};

// EV-16 取引をやめる・取引中に戻す
export const setSupplierActive = async (id: string, isActive: boolean, by: string): Promise<void> => {
  await query((sql) => sql`update suppliers set is_active = ${isActive}, updated_by = ${by} where id = ${id}`);
};

// CH-29 この仕入先を「主な仕入先」にしている使用中の商品の件数
export const countProductsUsingSupplier = async (id: string): Promise<number> => {
  const rows = await query(
    (sql) => sql<{ n: number }[]>`
      select count(*)::int as n from products where main_supplier_id = ${id} and is_active`
  );
  return rows[0]?.n ?? 0;
};
