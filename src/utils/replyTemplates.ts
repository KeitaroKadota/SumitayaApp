// 返信のひな形(reply_templates。担当は D-02)の読み書き(D-02 03 EV-05〜EV-07)。
// 呼ぶ側のページ・操作で requireAccess("inquiries" か "inquiry_settings", …) を済ませておくこと。
// D-03(よくある質問)・D-04(特注)が使うひな形の読み込みは、それぞれ faq.ts・quoteData.ts にある。
import { query } from "@/utils/db";
import type { TemplateCategory, TemplateInput } from "@/utils/replyTemplateRules";

export type ReplyTemplate = {
  id: string;
  category: TemplateCategory;
  purpose: string;
  name: string;
  subject: string | null;
  body: string;
  sortOrder: number;
  isActive: boolean;
  updatedAt: Date;
  updatedByName: string | null;
};

type TemplateRow = {
  id: string;
  category: TemplateCategory;
  purpose: string;
  name: string;
  subject: string | null;
  body: string;
  sort_order: number;
  is_active: boolean;
  updated_at: Date;
  updated_by_name: string | null;
};

const toTemplate = (r: TemplateRow): ReplyTemplate => ({
  id: r.id,
  category: r.category,
  purpose: r.purpose,
  name: r.name,
  subject: r.subject,
  body: r.body,
  sortOrder: r.sort_order,
  isActive: r.is_active,
  updatedAt: r.updated_at,
  updatedByName: r.updated_by_name,
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// G02 の種類の並び(02 G02 の例の順)
const CATEGORY_ORDER = ["stock", "faq", "return", "custom", "common"];

// ---- G02 一覧(EV-06) ----

export const listReplyTemplates = async (filter: {
  category: TemplateCategory | null;
  includeInactive: boolean;
}): Promise<ReplyTemplate[]> => {
  const rows = await query(
    (sql) => sql<TemplateRow[]>`
      select t.id, t.category, t.purpose, t.name, t.subject, t.body, t.sort_order, t.is_active, t.updated_at,
             case when e.id is null then null else e.last_name || ' ' || e.first_name end as updated_by_name
      from reply_templates t left join employees e on e.id = t.updated_by
      where true
        ${filter.includeInactive ? sql`` : sql`and t.is_active`}
        ${filter.category ? sql`and t.category = ${filter.category}` : sql``}
      order by array_position(${CATEGORY_ORDER}::text[], t.category), t.sort_order, t.name`
  );
  return rows.map(toTemplate);
};

export const getReplyTemplate = async (id: string): Promise<ReplyTemplate | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const [r] = await query(
    (sql) => sql<TemplateRow[]>`
      select id, category, purpose, name, subject, body, sort_order, is_active, updated_at, null as updated_by_name
      from reply_templates where id = ${id}`
  );
  return r ? toTemplate(r) : null;
};

// ---- G03 保存(EV-07) ----

export const insertReplyTemplate = async (input: TemplateInput, by: string): Promise<string> => {
  const [row] = await query(
    (sql) => sql<{ id: string }[]>`
      insert into reply_templates (category, purpose, name, subject, body, sort_order, is_active, created_by, updated_by)
      values (${input.category}, ${input.purpose}, ${input.name}, ${input.subject}, ${input.body}, ${input.sortOrder},
              ${input.isActive}, ${by}, ${by})
      returning id`
  );
  return row.id;
};

export const updateReplyTemplate = async (id: string, input: TemplateInput, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`
      update reply_templates set
        category = ${input.category}, purpose = ${input.purpose}, name = ${input.name}, subject = ${input.subject},
        body = ${input.body}, sort_order = ${input.sortOrder}, is_active = ${input.isActive}, updated_by = ${by}
      where id = ${id}`
  );
  return rows.count > 0;
};

// CH-10 ほかに「使う」の署名があるか(自分は除く)
export const hasOtherActiveSignature = async (excludeId: string | null): Promise<boolean> => {
  const rows = await query(
    (sql) => sql<{ id: string }[]>`
      select id from reply_templates where category = 'common' and purpose = 'signature' and is_active`
  );
  return rows.some((r) => r.id !== excludeId);
};

// ---- D-02 G01 在庫のひな形 ----

export type StockTemplateOption = { id: string; purpose: string; name: string; subject: string | null; body: string };

// 種類 stock の使うもの(用途・並び順の順)
export const listStockTemplates = async (): Promise<StockTemplateOption[]> =>
  query(
    (sql) => sql<StockTemplateOption[]>`
      select id, purpose, name, subject, body from reply_templates
      where category = 'stock' and is_active
      order by purpose, sort_order, name`
  );
