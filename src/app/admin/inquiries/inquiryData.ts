// 問い合わせ(D-01 G01・G02・G04)の読み書き。呼ぶ側のページ・操作で requireAccess("inquiries", …) を済ませておくこと。
import { query, transaction, type Sql, type SqlFragment } from "@/utils/db";
import type {
  AfterSentStatus,
  AiConfidence,
  InquiryCategory,
  InquiryChannel,
  InquiryExtracted,
  InquiryStatus,
  ReplyDraftSource,
  ReplyKind,
  ReplyStatus,
  SentVia,
} from "@/utils/inquiryRules";
import { escapeLike } from "@/utils/textNormalize";

export const PAGE_SIZE = 50;
// 【仮】続きのメッセージの候補は、同じメールアドレスの直近30日(00_仮決め一覧 D-01-仮-11)
const PARENT_CANDIDATE_DAYS = 30;
// 【仮】重複とみなす受信日時の幅(前後3日。00_仮決め一覧 D-01-仮-10)
const DUPLICATE_WINDOW_DAYS = 3;

// ---- EV-01 一覧 ----

export type InquiryFilter = {
  // "open"(未対応・対応中・返事待ち)・"all"・個別の状態
  status: "open" | "all" | InquiryStatus;
  // ""(すべて)・"none"(未分類)・個別の種類
  category: "" | "none" | InquiryCategory;
  channel: "" | InquiryChannel;
  assignedTo: string;
  q: string;
};

export type InquiryListItem = {
  id: string;
  receivedAt: Date;
  receivedOn: string;
  elapsedMinutes: number | null;
  category: InquiryCategory | null;
  categorySource: "ai" | "manual" | null;
  channel: InquiryChannel;
  customerName: string | null;
  customerEmail: string | null;
  subject: string | null;
  summary: string | null;
  status: InquiryStatus;
  assigneeName: string | null;
  childCount: number;
  hasUnsentDraft: boolean;
};

export const listInquiries = async (
  filter: InquiryFilter,
  page: number
): Promise<{ total: number; items: InquiryListItem[] }> => {
  const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const where = (sql: Sql): SqlFragment => sql`
    i.parent_inquiry_id is null
    ${
      filter.status === "open"
        ? sql`and i.status in ('new', 'in_progress', 'waiting')`
        : filter.status === "all"
          ? sql``
          : sql`and i.status = ${filter.status}`
    }
    ${filter.category === "none" ? sql`and i.category is null` : filter.category ? sql`and i.category = ${filter.category}` : sql``}
    ${filter.channel ? sql`and i.channel = ${filter.channel}` : sql``}
    ${filter.assignedTo ? sql`and i.assigned_to = ${filter.assignedTo}` : sql``}
    ${
      like
        ? sql`and (i.customer_name ilike ${like} or i.customer_email ilike ${like} or i.subject ilike ${like})`
        : sql``
    }`;

  const [{ total }] = await query((sql) => sql<{ total: number }[]>`select count(*)::int as total from inquiries i where ${where(sql)}`);
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        received_at: Date;
        received_on: string;
        elapsed_minutes: number | null;
        category: InquiryCategory | null;
        category_source: "ai" | "manual" | null;
        channel: InquiryChannel;
        customer_name: string | null;
        customer_email: string | null;
        subject: string | null;
        ai_summary: string | null;
        status: InquiryStatus;
        assignee_name: string | null;
        child_count: number;
        has_unsent_draft: boolean;
      }[]
    >`
      select i.id, i.received_at,
             to_char(i.received_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD') as received_on,
             -- EV-01 手順3: 返信していない行だけ、受信からの経過(分)
             case when i.first_replied_at is null and i.status in ('new', 'in_progress')
                  then floor(extract(epoch from now() - i.received_at) / 60)::int end as elapsed_minutes,
             i.category, i.category_source, i.channel, i.customer_name, i.customer_email, i.subject, i.ai_summary,
             i.status, e.last_name || ' ' || e.first_name as assignee_name,
             (select count(*)::int from inquiries c where c.parent_inquiry_id = i.id) as child_count,
             exists (
               select 1 from inquiry_replies r
               where r.status = 'draft'
                 and (r.inquiry_id = i.id or r.inquiry_id in (select c.id from inquiries c where c.parent_inquiry_id = i.id))
             ) as has_unsent_draft
      from inquiries i left join employees e on e.id = i.assigned_to
      where ${where(sql)}
      order by i.received_at desc, i.id
      limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`
  );
  return {
    total,
    items: rows.map((r) => ({
      id: r.id,
      receivedAt: r.received_at,
      receivedOn: r.received_on,
      elapsedMinutes: r.elapsed_minutes,
      category: r.category,
      categorySource: r.category_source,
      channel: r.channel,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      subject: r.subject,
      summary: r.ai_summary,
      status: r.status,
      assigneeName: r.assignee_name,
      childCount: r.child_count,
      hasUnsentDraft: r.has_unsent_draft,
    })),
  };
};

// ---- EV-02・EV-03 取り込み ----

export type ParentCandidate = { id: string; receivedAt: Date; subject: string | null; summary: string | null };

// EV-02 手順3: 同じメールアドレスの直近30日の問い合わせ(続きのメッセージの候補)
export const listParentCandidates = async (email: string): Promise<ParentCandidate[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; received_at: Date; subject: string | null; ai_summary: string | null }[]>`
      select id, received_at, subject, ai_summary from inquiries
      where customer_email = ${email.toLowerCase()}
        and received_at >= now() - make_interval(days => ${PARENT_CANDIDATE_DAYS})
      order by received_at desc
      limit 20`
  );
  return rows.map((r) => ({ id: r.id, receivedAt: r.received_at, subject: r.subject, summary: r.ai_summary }));
};

export type NewInquiryInput = {
  channel: InquiryChannel;
  receivedAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  subject: string | null;
  externalId: string | null;
  body: string;
  contentHash: string;
  parentInquiryId: string | null;
};

// CH-05 重複: 同じ経路に同じ番号、または同じ内容が受信日時の前後3日以内
export const findDuplicateInquiry = async (input: NewInquiryInput): Promise<{ id: string; receivedAt: Date } | null> => {
  const [row] = await query(
    (sql) => sql<{ id: string; received_at: Date }[]>`
      select id, received_at from inquiries
      where (${input.externalId}::text is not null and channel = ${input.channel} and external_id = ${input.externalId})
         or (content_hash = ${input.contentHash}
             and received_at between ${input.receivedAt}::timestamptz - make_interval(days => ${DUPLICATE_WINDOW_DAYS})
                                 and ${input.receivedAt}::timestamptz + make_interval(days => ${DUPLICATE_WINDOW_DAYS}))
      order by received_at desc
      limit 1`
  );
  return row ? { id: row.id, receivedAt: row.received_at } : null;
};

// EV-03 手順4: 保存する。続きなら最初の問い合わせにつなぎ、その状態が返事待ち・返信済みなら対応中に戻す
export const insertInquiry = async (input: NewInquiryInput, by: string): Promise<string | "parent_not_found"> =>
  transaction(async (tx) => {
    let parentId: string | null = null;
    if (input.parentInquiryId) {
      // 続きの続きを選んだときも、最初の問い合わせにつなぐ
      const [p] = await tx<{ root_id: string }[]>`
        select coalesce(parent_inquiry_id, id) as root_id from inquiries where id = ${input.parentInquiryId}`;
      if (!p) return "parent_not_found" as const;
      parentId = p.root_id;
    }
    const [row] = await tx<{ id: string }[]>`
      insert into inquiries (parent_inquiry_id, channel, source, external_id, content_hash, received_at,
                             customer_name, customer_email, subject, body, status, created_by, updated_by)
      values (${parentId}, ${input.channel}, 'paste', ${input.externalId}, ${input.contentHash}, ${input.receivedAt},
              ${input.customerName}, ${input.customerEmail}, ${input.subject}, ${input.body}, 'new', ${by}, ${by})
      returning id`;
    if (parentId) {
      await tx`
        update inquiries set status = 'in_progress', updated_by = ${by}
        where id = ${parentId} and status in ('waiting', 'replied')`;
    }
    return row.id;
  });

// ---- EV-05 詳細 ----

export type InquiryMessage = {
  id: string;
  parentInquiryId: string | null;
  channel: InquiryChannel;
  receivedAt: Date;
  customerName: string | null;
  customerEmail: string | null;
  subject: string | null;
  body: string;
};

export type InquiryDetail = InquiryMessage & {
  externalId: string | null;
  category: InquiryCategory | null;
  categorySource: "ai" | "manual" | null;
  aiCategory: InquiryCategory | null;
  aiConfidence: AiConfidence | null;
  aiSummary: string | null;
  aiExtracted: InquiryExtracted | null;
  aiClassifiedAt: Date | null;
  status: InquiryStatus;
  assignedTo: string | null;
  firstRepliedAt: Date | null;
  closedAt: Date | null;
  memo: string | null;
};

export type InquiryReply = {
  id: string;
  kind: ReplyKind;
  draftSource: ReplyDraftSource;
  aiDraft: string | null;
  body: string;
  facts: Record<string, unknown> | null;
  status: ReplyStatus;
  sentAt: Date | null;
  sentByName: string | null;
  sentVia: SentVia | null;
  createdAt: Date;
};

export const getInquiry = async (id: string): Promise<InquiryDetail | null> => {
  const [r] = await query(
    (sql) => sql<
      {
        id: string;
        parent_inquiry_id: string | null;
        channel: InquiryChannel;
        received_at: Date;
        customer_name: string | null;
        customer_email: string | null;
        subject: string | null;
        body: string;
        external_id: string | null;
        category: InquiryCategory | null;
        category_source: "ai" | "manual" | null;
        ai_category: InquiryCategory | null;
        ai_confidence: AiConfidence | null;
        ai_summary: string | null;
        ai_extracted: InquiryExtracted | null;
        ai_classified_at: Date | null;
        status: InquiryStatus;
        assigned_to: string | null;
        first_replied_at: Date | null;
        closed_at: Date | null;
        memo: string | null;
      }[]
    >`
      select id, parent_inquiry_id, channel, received_at, customer_name, customer_email, subject, body, external_id,
             category, category_source, ai_category, ai_confidence, ai_summary, ai_extracted, ai_classified_at,
             status, assigned_to, first_replied_at, closed_at, memo
      from inquiries where id = ${id}`
  );
  if (!r) return null;
  return {
    id: r.id,
    parentInquiryId: r.parent_inquiry_id,
    channel: r.channel,
    receivedAt: r.received_at,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    subject: r.subject,
    body: r.body,
    externalId: r.external_id,
    category: r.category,
    categorySource: r.category_source,
    aiCategory: r.ai_category,
    aiConfidence: r.ai_confidence,
    aiSummary: r.ai_summary,
    aiExtracted: r.ai_extracted,
    aiClassifiedAt: r.ai_classified_at,
    status: r.status,
    assignedTo: r.assigned_to,
    firstRepliedAt: r.first_replied_at,
    closedAt: r.closed_at,
    memo: r.memo,
  };
};

// EV-05 手順2: 同じやり取りのメッセージ(最初の問い合わせとその続き)を受信順に。自分は除く
export const listThreadMessages = async (inquiry: InquiryDetail): Promise<InquiryMessage[]> => {
  const rootId = inquiry.parentInquiryId ?? inquiry.id;
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        parent_inquiry_id: string | null;
        channel: InquiryChannel;
        received_at: Date;
        customer_name: string | null;
        customer_email: string | null;
        subject: string | null;
        body: string;
      }[]
    >`
      select id, parent_inquiry_id, channel, received_at, customer_name, customer_email, subject, body
      from inquiries
      where (id = ${rootId} or parent_inquiry_id = ${rootId}) and id <> ${inquiry.id}
      order by received_at, id`
  );
  return rows.map((r) => ({
    id: r.id,
    parentInquiryId: r.parent_inquiry_id,
    channel: r.channel,
    receivedAt: r.received_at,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    subject: r.subject,
    body: r.body,
  }));
};

// EV-05 手順3: 返信の案を新しい順に
export const listReplies = async (inquiryId: string): Promise<InquiryReply[]> => {
  const rows = await query(
    (sql) => sql<
      {
        id: string;
        kind: ReplyKind;
        draft_source: ReplyDraftSource;
        ai_draft: string | null;
        body: string;
        facts: Record<string, unknown> | null;
        status: ReplyStatus;
        sent_at: Date | null;
        sent_by_name: string | null;
        sent_via: SentVia | null;
        created_at: Date;
      }[]
    >`
      select r.id, r.kind, r.draft_source, r.ai_draft, r.body, r.facts, r.status, r.sent_at,
             e.last_name || ' ' || e.first_name as sent_by_name, r.sent_via, r.created_at
      from inquiry_replies r left join employees e on e.id = r.sent_by
      where r.inquiry_id = ${inquiryId}
      order by r.created_at desc, r.id`
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    draftSource: r.draft_source,
    aiDraft: r.ai_draft,
    body: r.body,
    facts: r.facts,
    status: r.status,
    sentAt: r.sent_at,
    sentByName: r.sent_by_name,
    sentVia: r.sent_via,
    createdAt: r.created_at,
  }));
};

// ---- EV-06〜EV-09・EV-15 ----

// EV-06 手順2: 種類を手で選ぶ。未対応なら対応中、担当者が空なら押した人
export const updateCategory = async (id: string, category: InquiryCategory, by: string): Promise<void> => {
  await query(
    (sql) => sql`
      update inquiries set
        category = ${category}, category_source = 'manual',
        status = case when status = 'new' then 'in_progress' else status end,
        assigned_to = coalesce(assigned_to, ${by}),
        updated_by = ${by}
      where id = ${id}`
  );
};

// EV-08 手順3: 抜き出した情報を上書き(category_source は変えない)
export const updateExtracted = async (id: string, extracted: InquiryExtracted, by: string): Promise<void> => {
  await query(
    (sql) => sql`update inquiries set ai_extracted = ${sql.json(extracted as never)}, updated_by = ${by} where id = ${id}`
  );
};

// EV-09 手順2・3: 状態・担当者。完了・対応不要で closed_at = 今、完了から戻したら空。完了にしたら残った案を破棄
export const updateStatusAndAssignee = async (
  id: string,
  status: InquiryStatus,
  assignedTo: string | null,
  by: string
): Promise<void> => {
  await transaction(async (tx) => {
    await tx`
      update inquiries set
        status = ${status},
        assigned_to = ${assignedTo},
        closed_at = case when ${status} in ('closed', 'ignored') then coalesce(closed_at, now()) else null end,
        updated_by = ${by}
      where id = ${id}`;
    if (status === "closed") {
      await tx`update inquiry_replies set status = 'discarded', updated_by = ${by} where inquiry_id = ${id} and status = 'draft'`;
    }
  });
};

// EV-15
export const updateMemo = async (id: string, memo: string | null, by: string): Promise<void> => {
  await query((sql) => sql`update inquiries set memo = ${memo}, updated_by = ${by} where id = ${id}`);
};

// ---- EV-10・EV-12・EV-13 返信欄 ----

export const getReply = async (
  replyId: string
): Promise<{ id: string; inquiryId: string; status: ReplyStatus } | null> => {
  const [r] = await query(
    (sql) => sql<{ id: string; inquiry_id: string; status: ReplyStatus }[]>`
      select id, inquiry_id, status from inquiry_replies where id = ${replyId}`
  );
  return r ? { id: r.id, inquiryId: r.inquiry_id, status: r.status } : null;
};

// EV-10 手順2(ai_draft は変えない)。案のままのときだけ直す(CH-11)
export const updateReplyBody = async (replyId: string, body: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) => sql`update inquiry_replies set body = ${body}, updated_by = ${by} where id = ${replyId} and status = 'draft' returning id`
  );
  return rows.length > 0;
};

// EV-13 手順2(消さない)
export const discardReply = async (replyId: string, by: string): Promise<boolean> => {
  const rows = await query(
    (sql) =>
      sql`update inquiry_replies set status = 'discarded', updated_by = ${by} where id = ${replyId} and status = 'draft' returning id`
  );
  return rows.length > 0;
};

// EV-12 手順3: 1つのトランザクションで、案を送信済みに・初めての返信の時刻・状態を記録する
export const markReplySent = async (
  replyId: string,
  sentVia: SentVia,
  afterStatus: AfterSentStatus,
  by: string
): Promise<boolean> =>
  transaction(async (tx) => {
    const [reply] = await tx<{ inquiry_id: string }[]>`
      update inquiry_replies set status = 'sent', sent_at = now(), sent_by = ${by}, sent_via = ${sentVia}, updated_by = ${by}
      where id = ${replyId} and status = 'draft'
      returning inquiry_id`;
    if (!reply) return false;
    const [inq] = await tx<{ parent_inquiry_id: string | null }[]>`
      update inquiries set
        first_replied_at = coalesce(first_replied_at, now()),
        status = ${afterStatus},
        closed_at = case when ${afterStatus} = 'closed' then coalesce(closed_at, now()) else null end,
        updated_by = ${by}
      where id = ${reply.inquiry_id}
      returning parent_inquiry_id`;
    // 続きのメッセージなら、最初の問い合わせにも初めての返信の時刻を入れる
    if (inq?.parent_inquiry_id) {
      await tx`
        update inquiries set first_replied_at = coalesce(first_replied_at, now()), updated_by = ${by}
        where id = ${inq.parent_inquiry_id}`;
    }
    return true;
  });
