// よくある質問(D-03)と返信のひな形(reply_templates。担当は D-02)の読み書き。
// 呼ぶ側のページ・操作で requireAccess("inquiries" か "inquiry_settings", …) を済ませておくこと。
import { query, queryOn, type TransactionSql } from "@/utils/db";
import { escapeLike } from "@/utils/textNormalize";
import {
  FAQ_LIMITS,
  normalizeQuestion,
  scoreFaqCandidates,
  type FaqInput,
  type FaqSource,
  type FaqTopic,
} from "@/utils/faqRules";

export type FaqEntry = {
  id: string;
  topic: FaqTopic;
  question: string;
  answer: string;
  keywords: string | null;
  sourceName: FaqSource;
  sourceUrl: string | null;
  checkedOn: string | null;
  sortOrder: number;
  isActive: boolean;
};

type FaqRow = {
  id: string;
  topic: FaqTopic;
  question: string;
  answer: string;
  keywords: string | null;
  source_name: FaqSource;
  source_url: string | null;
  checked_on: string | null;
  sort_order: number;
  is_active: boolean;
};

const toFaq = (r: FaqRow): FaqEntry => ({
  id: r.id,
  topic: r.topic,
  question: r.question,
  answer: r.answer,
  keywords: r.keywords,
  sourceName: r.source_name,
  sourceUrl: r.source_url,
  checkedOn: r.checked_on,
  sortOrder: r.sort_order,
  isActive: r.is_active,
});

// checked_on は文字(年-月-日)で受け取る
const FAQ_COLUMNS = `id, topic, question, answer, keywords, source_name, source_url, to_char(checked_on, 'YYYY-MM-DD') as checked_on,
  sort_order, is_active`;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- G02 一覧(EV-05) ----

export const listFaqEntries = async (filter: {
  topic: FaqTopic | null;
  q: string;
  includeInactive: boolean;
}): Promise<FaqEntry[]> => {
  const like = filter.q ? `%${escapeLike(filter.q)}%` : null;
  const rows = await query(
    (sql) => sql<FaqRow[]>`
      select ${sql.unsafe(FAQ_COLUMNS)} from faq_entries
      where true
        ${filter.includeInactive ? sql`` : sql`and is_active`}
        ${filter.topic ? sql`and topic = ${filter.topic}` : sql``}
        ${like ? sql`and (question ilike ${like} or answer ilike ${like} or keywords ilike ${like})` : sql``}
      order by topic, sort_order, question`
  );
  return rows.map(toFaq);
};

export const getFaqEntry = async (id: string): Promise<FaqEntry | null> => {
  if (!UUID_PATTERN.test(id)) return null;
  const [r] = await query((sql) => sql<FaqRow[]>`select ${sql.unsafe(FAQ_COLUMNS)} from faq_entries where id = ${id}`);
  return r ? toFaq(r) : null;
};

// ---- G03 保存(EV-06) ----

export const insertFaqEntry = async (input: FaqInput, by: string, tx?: TransactionSql): Promise<string> => {
  const [row] = await queryOn(
    tx,
    (sql) => sql<{ id: string }[]>`
      insert into faq_entries (topic, question, answer, keywords, source_name, source_url, checked_on, sort_order, is_active,
                               created_by, updated_by)
      values (${input.topic}, ${input.question}, ${input.answer}, ${input.keywords}, ${input.sourceName}, ${input.sourceUrl},
              ${input.checkedOn}::date, ${input.sortOrder}, ${input.isActive}, ${by}, ${by})
      returning id`
  );
  return row.id;
};

export const updateFaqEntry = async (id: string, input: FaqInput, by: string, tx?: TransactionSql): Promise<boolean> => {
  const rows = await queryOn(
    tx,
    (sql) => sql`
      update faq_entries set
        topic = ${input.topic}, question = ${input.question}, answer = ${input.answer}, keywords = ${input.keywords},
        source_name = ${input.sourceName}, source_url = ${input.sourceUrl}, checked_on = ${input.checkedOn}::date,
        sort_order = ${input.sortOrder}, is_active = ${input.isActive}, updated_by = ${by}
      where id = ${id}`
  );
  return rows.count > 0;
};

// CH-07 使うFAQの中に、空白と記号を除いて同じ質問があるか(自分は除く)。あれば、その質問を返す
export const findSameQuestion = async (question: string, excludeId: string | null): Promise<string | null> => {
  const rows = await query(
    (sql) => sql<{ id: string; question: string }[]>`select id, question from faq_entries where is_active`
  );
  const key = normalizeQuestion(question);
  return rows.find((r) => r.id !== excludeId && normalizeQuestion(r.question) === key)?.question ?? null;
};

// CSV の ID があるかの確認(EV-07 手順1)
export const existingFaqIds = async (ids: string[]): Promise<Set<string>> => {
  const valid = ids.filter((id) => UUID_PATTERN.test(id));
  if (valid.length === 0) return new Set();
  const rows = await query((sql) => sql<{ id: string }[]>`select id from faq_entries where id = any(${valid}::uuid[])`);
  return new Set(rows.map((r) => r.id));
};

// ---- G01 パネル ----

export type FaqPanelItem = { id: string; topic: FaqTopic; question: string; sourceName: FaqSource };

// 0.1 findFaqCandidates: 使うFAQを読み、話題とことばで点数をつける(AIは使わない)
export const findFaqCandidates = async (
  topics: readonly string[],
  text: string,
  limit: number = FAQ_LIMITS.candidates
): Promise<(FaqPanelItem & { score: number })[]> => {
  const rows = await query(
    (sql) => sql<{ id: string; topic: FaqTopic; question: string; keywords: string | null; source_name: FaqSource; sort_order: number }[]>`
      select id, topic, question, keywords, source_name, sort_order from faq_entries where is_active`
  );
  return scoreFaqCandidates(
    rows.map((r) => ({
      id: r.id,
      topic: r.topic,
      question: r.question,
      keywords: r.keywords,
      sourceName: r.source_name,
      sortOrder: r.sort_order,
    })),
    topics,
    text.slice(0, FAQ_LIMITS.matchText),
    limit
  ).map((r) => ({ id: r.id, topic: r.topic, question: r.question, sourceName: r.sourceName, score: r.score }));
};

// EV-02 手順2: 質問・回答・ことばに言葉を含む、使うFAQを20件まで
export const searchActiveFaq = async (q: string): Promise<FaqPanelItem[]> => {
  const like = `%${escapeLike(q.trim())}%`;
  const rows = await query(
    (sql) => sql<{ id: string; topic: FaqTopic; question: string; source_name: FaqSource }[]>`
      select id, topic, question, source_name from faq_entries
      where is_active and (question ilike ${like} or answer ilike ${like} or keywords ilike ${like})
      order by topic, sort_order, question
      limit ${FAQ_LIMITS.searchResults}`
  );
  return rows.map((r) => ({ id: r.id, topic: r.topic, question: r.question, sourceName: r.source_name }));
};

// ID で読む(使うものだけ。並びは渡した順)。EV-03 手順2・パネルの印の復元
export const getActiveFaqsByIds = async (ids: string[]): Promise<FaqEntry[]> => {
  const valid = ids.filter((id) => UUID_PATTERN.test(id));
  if (valid.length === 0) return [];
  const rows = await query(
    (sql) => sql<FaqRow[]>`select ${sql.unsafe(FAQ_COLUMNS)} from faq_entries where is_active and id = any(${valid}::uuid[])`
  );
  const byId = new Map(rows.map((r) => [r.id, toFaq(r)]));
  return valid.map((id) => byId.get(id)).filter((f): f is FaqEntry => !!f);
};

// 案の根拠の表示用(使わないにしたものも出す)
export const getFaqQuestionsByIds = async (ids: string[]): Promise<Map<string, string>> => {
  const valid = ids.filter((id) => UUID_PATTERN.test(id));
  if (valid.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<{ id: string; question: string }[]>`select id, question from faq_entries where id = any(${valid}::uuid[])`
  );
  return new Map(rows.map((r) => [r.id, r.question]));
};

// EV-01 手順3: この問い合わせで最後に作ったFAQの案の、使ったFAQのID
export const lastUsedFaqIds = async (inquiryId: string): Promise<string[]> => {
  const [row] = await query(
    (sql) => sql<{ facts: Record<string, unknown> | null }[]>`
      select facts from inquiry_replies where inquiry_id = ${inquiryId} and kind = 'faq'
      order by created_at desc limit 1`
  );
  const ids = row?.facts?.used_faq_ids;
  return Array.isArray(ids) ? ids.filter((v): v is string => typeof v === "string") : [];
};

// ---- 返信のひな形(reply_templates。D-02 の担当) ----

export type ReplyTemplateOption = { id: string; name: string; subject: string | null; body: string };

// D-03 01 6.2 よくある質問の回答のひな形(種類 faq・用途 faq_answer)の、使うもの
export const listFaqAnswerTemplates = async (): Promise<ReplyTemplateOption[]> =>
  query(
    (sql) => sql<ReplyTemplateOption[]>`
      select id, name, subject, body from reply_templates
      where category = 'faq' and purpose = 'faq_answer' and is_active
      order by sort_order, name`
  );

// {署名}: 共通の署名のひな形(使うものは1件だけ。D-02 04 CH-10)
export const getSignatureText = async (): Promise<string | null> => {
  const [row] = await query(
    (sql) => sql<{ body: string }[]>`
      select body from reply_templates where category = 'common' and purpose = 'signature' and is_active limit 1`
  );
  return row?.body ?? null;
};
