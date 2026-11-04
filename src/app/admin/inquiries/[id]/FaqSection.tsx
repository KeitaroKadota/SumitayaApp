// D-03 のパネル(G01)と、よくある質問の案に付ける注意。D-01 の詳細画面(page.tsx)から使うサーバーの部品。
// 呼ぶ側のページで requireAccess("inquiries", …) を済ませておくこと。
import { Alert } from "@/components/Alert";
import {
  findFaqCandidates,
  getActiveFaqsByIds,
  getFaqQuestionsByIds,
  lastUsedFaqIds,
  listFaqAnswerTemplates,
  type FaqPanelItem,
} from "@/utils/faq";
import { FAQ_LIMITS, FAQ_TOPICS } from "@/utils/faqRules";
import type { InquiryDetail, InquiryReply } from "../inquiryData";
import { createFaqReply } from "../faqReplyActions";
import { FaqAnswerPanel } from "./FaqAnswerPanel";

// パネルの操作のエラー(?faq_error=)
const FAQ_ERRORS: Record<string, string> = {
  none: "根拠にするよくある質問を1件以上選んでください。",
  too_many: `根拠にするよくある質問は${FAQ_LIMITS.selectedMax}件までにしてください。`,
  reselect: "FAQを選び直してください（選んだよくある質問は「使わない」になっています）。",
  template: "ひな形を選び直してください。",
};
// AIで作れずにひな形で作ったときの文(?faq_ai=。EV-03 手順3)
const FAQ_AI_FALLBACK: Record<string, string> = {
  no_key: "AIの設定（APIキー）がありません。",
  limit: "本日のAIの利用回数に達しました。",
  bad_key: "AIのAPIキーが正しくありません。（管理者の方: 環境変数 GEMINI_API_KEY を確かめてください）",
  bad_model: "AIのモデル名が見つかりません。（管理者の方: 環境変数 GEMINI_MODEL を確かめてください）",
  failed: "",
};

export const faqErrorMessage = (code: string): string | undefined => FAQ_ERRORS[code];
export const faqFallbackMessage = (code: string): string | undefined =>
  code in FAQ_AI_FALLBACK ? `AIで作れませんでした。ひな形で案を作ります。${FAQ_AI_FALLBACK[code]}` : undefined;

// G01 EV-01 パネルを開く
export async function FaqPanelSection({ inquiry, aiStopped }: { inquiry: InquiryDetail; aiStopped: boolean }) {
  const topics = inquiry.aiExtracted?.faq_topics ?? [];
  let items: FaqPanelItem[];
  let checked: string[];
  let templates: { id: string; name: string }[];
  try {
    // 手順1・2: 抜き出した話題と、件名＋本文で候補を出し、上位5件に印を付ける
    const candidates = await findFaqCandidates(topics, `${inquiry.subject ?? ""}\n${inquiry.body}`);
    items = candidates.map(({ id, topic, question, sourceName }) => ({ id, topic, question, sourceName }));
    checked = candidates.slice(0, FAQ_LIMITS.preselected).map((c) => c.id);
    // 手順3: 前に作ったFAQの案があれば、その使ったFAQに印を付ける(候補に無ければ足す)【仮】D-03-仮-06
    const lastUsed = await lastUsedFaqIds(inquiry.id);
    if (lastUsed.length > 0) {
      const missing = lastUsed.filter((id) => !items.some((i) => i.id === id));
      const extra = await getActiveFaqsByIds(missing);
      items = [...items, ...extra.map((f) => ({ id: f.id, topic: f.topic, question: f.question, sourceName: f.sourceName }))];
      checked = lastUsed.filter((id) => items.some((i) => i.id === id));
    }
    templates = (await listFaqAnswerTemplates()).map((t) => ({ id: t.id, name: t.name }));
  } catch (e) {
    console.error("よくある質問を読めませんでした:", e instanceof Error ? e.message : e);
    return <Alert tone="error">よくある質問を読めませんでした。時間をおいてもう一度お試しください。</Alert>;
  }
  return (
    <FaqAnswerPanel
      action={createFaqReply.bind(null, inquiry.id)}
      topics={topics.map((t) => FAQ_TOPICS[t] ?? t)}
      initialItems={items}
      initialChecked={checked}
      templates={templates}
      aiStopped={aiStopped}
    />
  );
}

const stringList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

// よくある質問の案(kind = faq)の facts から、使ったFAQのIDをまとめて集める(表示で1回だけ読む)
export const collectFaqIds = (replies: InquiryReply[]): string[] => [
  ...new Set(replies.filter((r) => r.kind === "faq").flatMap((r) => stringList(r.facts?.used_faq_ids))),
];

export async function loadFaqQuestions(replies: InquiryReply[]): Promise<Map<string, string>> {
  const ids = collectFaqIds(replies);
  if (ids.length === 0) return new Map();
  try {
    return await getFaqQuestionsByIds(ids);
  } catch (e) {
    console.error("よくある質問を読めませんでした:", e instanceof Error ? e.message : e);
    return new Map();
  }
}

// 案の上に出す根拠・注意(EV-03 手順8・EV-04 の注)。FAQに無かった質問は黄色で出す
export function FaqDraftNotes({ reply, questions }: { reply: InquiryReply; questions: Map<string, string> }) {
  const facts = reply.facts ?? {};
  const used = stringList(facts.used_faq_ids);
  const notCovered = stringList(facts.not_covered);
  const warnings = stringList(facts.warnings);
  const subject = typeof facts.subject === "string" ? facts.subject : null;
  return (
    <div className="mb-2 flex flex-col gap-2 text-sm">
      {notCovered.length > 0 && (
        <Alert tone="warning">FAQに無い質問: {notCovered.join("／")} → 担当者が書き足してください。</Alert>
      )}
      {reply.draftSource === "template" && (
        <Alert tone="warning">お問い合わせのすべての質問に答えているか確かめてください。</Alert>
      )}
      {warnings.map((w) => (
        <Alert key={w} tone="warning">
          {w}
        </Alert>
      ))}
      {used.length > 0 && (
        <p>
          根拠のFAQ: {used.map((id) => questions.get(id) ?? "（見つからないFAQ）").join("／")}
        </p>
      )}
      {subject && <p>件名の案: {subject}</p>}
    </div>
  );
}
