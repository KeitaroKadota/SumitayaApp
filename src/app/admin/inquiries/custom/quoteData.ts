// 特注の案件(D-04 G01〜G03、custom_quotes)の読み書き。呼ぶ側のページ・操作で requireAccess("inquiries", …) を済ませておくこと。
import { query, transaction, type Sql, type SqlFragment } from "@/utils/db";
import type { CustomQuoteStatus, Estimate, EstimateLine, QuoteSpec, SizeQty } from "@/utils/customQuote";
import type { QuoteContact } from "@/utils/customQuoteInput";
import type { InquiryExtracted, InquiryStatus } from "@/utils/inquiryRules";
import { escapeLike } from "@/utils/textNormalize";

export const QUOTE_PAGE_SIZE = 50;

export type CustomQuote = QuoteContact & {
  id: string;
  quoteNumber: string;
  inquiryId: string;
  spec: QuoteSpec;
  missingItems: string[];
  status: CustomQuoteStatus;
  estimate: (Estimate & { estimatedAt: Date }) | null;
  factoryRequestedAt: Date | null;
  factoryRequestText: string | null;
  factoryRequestedByName: string | null;
  closedReason: string | null;
  wonAt: Date | null;
  closedAt: Date | null;
  assignedTo: string | null;
  assigneeName: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type QuoteRow = {
  id: string;
  quote_number: string;
  inquiry_id: string;
  organization_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  item_type: string | null;
  fabric_item_id: string | null;
  fabric_note: string | null;
  size_breakdown: SizeQty[] | null;
  quantity: number | null;
  print_item_id: string | null;
  print_none: boolean;
  print_text: string | null;
  desired_date: string | null;
  spec_note: string | null;
  missing_items: string[];
  status: CustomQuoteStatus;
  estimate_subtotal: number | null;
  estimate_tax: number | null;
  estimate_total: number | null;
  estimate_lines: EstimateLine[] | null;
  estimated_at: Date | null;
  factory_requested_at: Date | null;
  factory_request_text: string | null;
  factory_requested_by_name: string | null;
  closed_reason: string | null;
  won_at: Date | null;
  closed_at: Date | null;
  assigned_to: string | null;
  assignee_name: string | null;
  created_at: Date;
  updated_at: Date;
};

const QUOTE_COLUMNS = `q.id, q.quote_number, q.inquiry_id, q.organization_name, q.customer_name, q.customer_email, q.customer_phone,
  q.item_type, q.fabric_item_id, q.fabric_note, q.size_breakdown, q.quantity, q.print_item_id, q.print_none, q.print_text,
  to_char(q.desired_date, 'YYYY-MM-DD') as desired_date, q.spec_note, q.missing_items, q.status,
  q.estimate_subtotal, q.estimate_tax, q.estimate_total, q.estimate_lines, q.estimated_at,
  q.factory_requested_at, q.factory_request_text, fe.last_name || ' ' || fe.first_name as factory_requested_by_name,
  q.closed_reason, q.won_at, q.closed_at, q.assigned_to, ae.last_name || ' ' || ae.first_name as assignee_name,
  q.created_at, q.updated_at`;
const QUOTE_FROM = `custom_quotes q
  left join employees fe on fe.id = q.factory_requested_by
  left join employees ae on ae.id = q.assigned_to`;

const toQuote = (r: QuoteRow): CustomQuote => ({
  id: r.id,
  quoteNumber: r.quote_number,
  inquiryId: r.inquiry_id,
  organizationName: r.organization_name,
  customerName: r.customer_name,
  customerEmail: r.customer_email,
  customerPhone: r.customer_phone,
  spec: {
    itemType: r.item_type,
    fabricItemId: r.fabric_item_id,
    fabricNote: r.fabric_note,
    sizeBreakdown: r.size_breakdown,
    quantity: r.quantity,
    printItemId: r.print_item_id,
    printNone: r.print_none,
    printText: r.print_text,
    desiredDate: r.desired_date,
    specNote: r.spec_note,
  },
  missingItems: r.missing_items,
  status: r.status,
  estimate:
    r.estimate_total !== null && r.estimate_subtotal !== null && r.estimate_tax !== null && r.estimated_at
      ? {
          lines: r.estimate_lines ?? [],
          subtotal: r.estimate_subtotal,
          tax: r.estimate_tax,
          total: r.estimate_total,
          estimatedAt: r.estimated_at,
        }
      : null,
  factoryRequestedAt: r.factory_requested_at,
  factoryRequestText: r.factory_request_text,
  factoryRequestedByName: r.factory_requested_by_name,
  closedReason: r.closed_reason,
  wonAt: r.won_at,
  closedAt: r.closed_at,
  assignedTo: r.assigned_to,
  assigneeName: r.assignee_name,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

// ---- EV-01 パネル・EV-04 詳細 ----

export const getQuote = async (id: string): Promise<CustomQuote | null> => {
  const [r] = await query(
    (sql) => sql<QuoteRow[]>`select ${sql.unsafe(QUOTE_COLUMNS)} from ${sql.unsafe(QUOTE_FROM)} where q.id = ${id}`
  );
  return r ? toQuote(r) : null;
};

// EV-01 手順1: 最初の問い合わせにつながる、取消でない案件(CH-01)
export const findQuoteByInquiry = async (rootInquiryId: string): Promise<CustomQuote | null> => {
  const [r] = await query(
    (sql) => sql<QuoteRow[]>`
      select ${sql.unsafe(QUOTE_COLUMNS)} from ${sql.unsafe(QUOTE_FROM)}
      where q.inquiry_id = ${rootInquiryId} and q.status <> 'cancelled'
      order by q.created_at desc limit 1`
  );
  return r ? toQuote(r) : null;
};

// ---- EV-04 一覧(G02) ----

export type QuoteFilter = { status: "open" | "all" | CustomQuoteStatus; q: string };

export const listQuotes = async (filter: QuoteFilter, page: number): Promise<{ total: number; items: CustomQuote[] }> => {
  const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const where = (sql: Sql): SqlFragment => sql`
    true
    ${
      filter.status === "open"
        ? sql`and q.status in ('hearing', 'estimated', 'factory_requested')`
        : filter.status === "all"
          ? sql``
          : sql`and q.status = ${filter.status}`
    }
    ${like ? sql`and (q.organization_name ilike ${like} or q.quote_number ilike ${like})` : sql``}`;
  const [{ total }] = await query(
    (sql) => sql<{ total: number }[]>`select count(*)::int as total from custom_quotes q where ${where(sql)}`
  );
  const rows = await query(
    (sql) => sql<QuoteRow[]>`
      select ${sql.unsafe(QUOTE_COLUMNS)} from ${sql.unsafe(QUOTE_FROM)}
      where ${where(sql)}
      order by q.created_at desc, q.id
      limit ${QUOTE_PAGE_SIZE} offset ${(page - 1) * QUOTE_PAGE_SIZE}`
  );
  return { total, items: rows.map(toQuote) };
};

// ---- EV-02 案件を作る ----

export type NewQuoteInput = QuoteContact & { inquiryId: string; spec: QuoteSpec; missingItems: string[] };

// 番号は TK-年-通し番号(年ごとに1から。年は日本時間)。同時に作られても番号が重ならないよう、トランザクションの中で鍵をかけて振る
export const insertQuote = async (
  input: NewQuoteInput,
  year: number,
  by: string
): Promise<{ ok: true; id: string } | { ok: false; existingId: string }> =>
  transaction(async (tx) => {
    await tx`select pg_advisory_xact_lock(hashtext('custom_quotes.quote_number'))`;
    // CH-01 同じ問い合わせの案件がまだ無い
    const [existing] = await tx<{ id: string }[]>`
      select id from custom_quotes where inquiry_id = ${input.inquiryId} and status <> 'cancelled' limit 1`;
    if (existing) return { ok: false as const, existingId: existing.id };

    const prefix = `TK-${year}-`;
    const [{ next }] = await tx<{ next: number }[]>`
      select coalesce(max(substring(quote_number from ${prefix.length + 1})::int), 0) + 1 as next
      from custom_quotes where quote_number like ${`${prefix}%`}`;
    const number = `${prefix}${String(next).padStart(4, "0")}`;
    const s = input.spec;
    const [row] = await tx<{ id: string }[]>`
      insert into custom_quotes (quote_number, inquiry_id, organization_name, customer_name, customer_email, customer_phone,
                                 item_type, fabric_item_id, fabric_note, size_breakdown, quantity, print_item_id, print_none,
                                 print_text, desired_date, spec_note, missing_items, status, assigned_to, created_by, updated_by)
      values (${number}, ${input.inquiryId}, ${input.organizationName}, ${input.customerName}, ${input.customerEmail},
              ${input.customerPhone}, ${s.itemType}, ${s.fabricItemId}, ${s.fabricNote},
              ${s.sizeBreakdown ? tx.json(s.sizeBreakdown as never) : null}, ${s.quantity}, ${s.printItemId}, ${s.printNone},
              ${s.printText}, ${s.desiredDate}::date, ${s.specNote}, ${input.missingItems}::text[], 'hearing', ${by}, ${by}, ${by})
      returning id`;
    return { ok: true as const, id: row.id };
  });

// ---- EV-05 仕様を保存 ----

// clearEstimate: 仕様が変わったので概算を空にする。status: 状態を変えるとき(estimated → hearing)
export const updateQuoteSpec = async (
  id: string,
  contact: QuoteContact,
  spec: QuoteSpec,
  missingItems: string[],
  opts: { clearEstimate: boolean; status: CustomQuoteStatus | null },
  by: string
): Promise<void> => {
  await query(
    (sql) => sql`
      update custom_quotes set
        organization_name = ${contact.organizationName}, customer_name = ${contact.customerName},
        customer_email = ${contact.customerEmail}, customer_phone = ${contact.customerPhone},
        item_type = ${spec.itemType}, fabric_item_id = ${spec.fabricItemId}, fabric_note = ${spec.fabricNote},
        size_breakdown = ${spec.sizeBreakdown ? sql.json(spec.sizeBreakdown as never) : null}, quantity = ${spec.quantity},
        print_item_id = ${spec.printItemId}, print_none = ${spec.printNone}, print_text = ${spec.printText},
        desired_date = ${spec.desiredDate}::date, spec_note = ${spec.specNote}, missing_items = ${missingItems}::text[],
        ${
          opts.clearEstimate
            ? sql`estimate_subtotal = null, estimate_tax = null, estimate_total = null, estimate_lines = null, estimated_at = null,`
            : sql``
        }
        status = coalesce(${opts.status}, status),
        updated_by = ${by}
      where id = ${id}`
  );
};

// ---- EV-08 概算を計算 ----

// 小計・税・合計・内訳・計算した日時を保存し、聞き取り中なら概算済みにする
export const saveEstimate = async (id: string, e: Estimate, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update custom_quotes set
        estimate_subtotal = ${e.subtotal}, estimate_tax = ${e.tax}, estimate_total = ${e.total},
        estimate_lines = ${sql.json(e.lines as never)}, estimated_at = now(),
        status = case when status = 'hearing' then 'estimated' else status end,
        updated_by = ${by}
      where id = ${id}`
  );
};

// ---- 担当者 ----

export const updateQuoteAssignee = async (id: string, assignedTo: string | null, by: string): Promise<void> => {
  await query((sql) => sql`update custom_quotes set assigned_to = ${assignedTo}, updated_by = ${by} where id = ${id}`);
};

// ---- EV-14 工場に依頼したことを記録 ----

// 依頼できる状態のときだけ記録する(CH-11。記録できなければ false で、案件は変えない)
export const recordFactoryRequest = async (id: string, text: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`
      update custom_quotes set
        factory_request_text = ${text}, factory_requested_at = now(), factory_requested_by = ${by},
        status = 'factory_requested', updated_by = ${by}
      where id = ${id} and status in ('hearing', 'estimated', 'factory_requested')
      returning id`
  );
  return rows.length > 0;
};

// ---- EV-12 受注・失注・取消(と、間違えたときに工場に依頼済みへ戻す) ----

export const updateQuoteStatus = async (
  id: string,
  from: CustomQuoteStatus,
  to: "won" | "lost" | "cancelled" | "factory_requested",
  reason: string | null,
  by: string
): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`
      update custom_quotes set
        status = ${to},
        won_at = ${to === "won" ? sql`now()` : sql`null`},
        closed_at = ${to === "lost" || to === "cancelled" ? sql`now()` : sql`null`},
        closed_reason = ${to === "lost" || to === "cancelled" ? reason : null},
        updated_by = ${by}
      where id = ${id} and status = ${from}
      returning id`
  );
  return rows.length > 0;
};

// ---- 元の問い合わせと続き(EV-01 手順3・EV-03・EV-06 手順2) ----

export type ThreadMessage = {
  id: string;
  parentInquiryId: string | null;
  receivedAt: Date;
  customerName: string | null;
  subject: string | null;
  body: string;
  status: InquiryStatus;
  extracted: InquiryExtracted | null;
};

// 最初の問い合わせと続きを受信順に
export const listQuoteThread = async (rootInquiryId: string): Promise<ThreadMessage[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        parent_inquiry_id: string | null;
        received_at: Date;
        customer_name: string | null;
        subject: string | null;
        body: string;
        status: InquiryStatus;
        ai_extracted: InquiryExtracted | null;
      }[]
    >`
      select id, parent_inquiry_id, received_at, customer_name, subject, body, status, ai_extracted
      from inquiries
      where id = ${rootInquiryId} or parent_inquiry_id = ${rootInquiryId}
      order by received_at, id`
  );
  return rows.map((r) => ({
    id: r.id,
    parentInquiryId: r.parent_inquiry_id,
    receivedAt: r.received_at,
    customerName: r.customer_name,
    subject: r.subject,
    body: r.body,
    status: r.status,
    extracted: r.ai_extracted,
  }));
};

// ---- 返信のひな形(reply_templates。D-02 の担当。D-04 01 6.3 の種類 custom の用途) ----

export type CustomTemplatePurpose = "custom_ask" | "custom_estimate";

export const listCustomTemplates = async (
  purpose: CustomTemplatePurpose
): Promise<{ id: string; name: string; subject: string | null; body: string }[]> =>
  query(
    (sql) => sql<{ id: string; name: string; subject: string | null; body: string }[]>`
      select id, name, subject, body from reply_templates
      where category = 'custom' and purpose = ${purpose} and is_active
      order by sort_order, name`
  );
