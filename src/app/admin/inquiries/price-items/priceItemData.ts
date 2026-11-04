// 特注の概算の単価表(D-04 G04、custom_price_items)の読み書き。
// 呼ぶ側のページ・操作で requireAccess("inquiry_settings" か "inquiries", …) を済ませておくこと。
import { query } from "@/utils/db";
import { sortPriceItems, type PriceItem, type PriceKind, type PriceUnit } from "@/utils/customQuote";
import type { PriceItemInput } from "@/utils/customQuoteInput";

type PriceItemRow = {
  id: string;
  kind: PriceKind;
  item_type: string | null;
  name: string;
  unit: PriceUnit;
  unit_price: number;
  qty_from: number;
  qty_to: number | null;
  sort_order: number;
  is_active: boolean;
  note: string | null;
};

const toItem = (r: PriceItemRow): PriceItem => ({
  id: r.id,
  kind: r.kind,
  itemType: r.item_type,
  name: r.name,
  unit: r.unit,
  unitPrice: r.unit_price,
  qtyFrom: r.qty_from,
  qtyTo: r.qty_to,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  note: r.note,
});

// すべての行(使わないものも)。概算の計算・入力のチェック・表示で使う(数十〜数百行の想定)
export const listAllPriceItems = async (): Promise<PriceItem[]> => {
  const rows = await query(
    (sql) => sql<PriceItemRow[]>`
      select id, kind, item_type, name, unit, unit_price, qty_from, qty_to, sort_order, is_active, note
      from custom_price_items`
  );
  return sortPriceItems(rows.map(toItem));
};

// G04 EV-13 手順1: 区分・品目・並び順・枚数の下限の順
export const listPriceItems = async (filter: { kind: PriceKind | null; includeInactive: boolean }): Promise<PriceItem[]> =>
  (await listAllPriceItems()).filter((i) => (!filter.kind || i.kind === filter.kind) && (filter.includeInactive || i.isActive));

// EV-13 手順3: 新規なら入れ、既存なら更新する(消さない)
export const insertPriceItem = async (input: PriceItemInput, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      insert into custom_price_items (kind, item_type, name, unit, unit_price, qty_from, qty_to, sort_order, is_active, note,
                                      created_by, updated_by)
      values (${input.kind}, ${input.itemType}, ${input.name}, ${input.unit}, ${input.unitPrice}, ${input.qtyFrom}, ${input.qtyTo},
              ${input.sortOrder}, ${input.isActive}, ${input.note}, ${by}, ${by})`
  );
};

export const updatePriceItem = async (id: string, input: PriceItemInput, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`
      update custom_price_items set
        kind = ${input.kind}, item_type = ${input.itemType}, name = ${input.name}, unit = ${input.unit},
        unit_price = ${input.unitPrice}, qty_from = ${input.qtyFrom}, qty_to = ${input.qtyTo}, sort_order = ${input.sortOrder},
        is_active = ${input.isActive}, note = ${input.note}, updated_by = ${by}
      where id = ${id}`
  );
  return rows.count > 0;
};
