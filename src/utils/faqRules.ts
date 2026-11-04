// よくある質問(D-03)の決まった値・チェック・計算。DBを読まない計算だけのファイルなので、画面の部品からも使える。
// 設計書: D-03 01 4.1・6.1・6.2・7章、03 0.1・EV-03・EV-04、04 CH-01〜CH-07
import { FAQ_TOPICS, type FaqTopic } from "@/utils/inquiryRules";
import { isValidDateStr, katakanaToHiragana, parseIntInRange } from "@/utils/textNormalize";

export { FAQ_TOPICS, type FaqTopic };
export const isFaqTopic = (v: string): v is FaqTopic => v in FAQ_TOPICS;

// 6.1 根拠
export const FAQ_SOURCES = { site: "自社サイト", matsurijuku: "祭塾", store: "お店の決まり" } as const;
export type FaqSource = keyof typeof FAQ_SOURCES;
export const isFaqSource = (v: string): v is FaqSource => v in FAQ_SOURCES;

// CSV で受け付ける日本語の名前(02 G04)。D-03 01 4.1 の名前と、画面の表示名(FAQ_TOPICS)の両方
const TOPIC_NAMES: Record<string, FaqTopic> = {
  サイズ: "size",
  送料: "shipping",
  "送料・配送": "shipping",
  配送: "shipping",
  納期: "delivery",
  支払方法: "payment",
  お手入れ: "care",
  手入れ: "care",
  "手入れ・使い方": "care",
  その他: "other",
};
const SOURCE_NAMES: Record<string, FaqSource> = { 自社サイト: "site", 祭塾: "matsurijuku", お店の決まり: "store" };
export const parseFaqTopic = (v: string): FaqTopic | null => {
  const s = v.normalize("NFKC").trim();
  return isFaqTopic(s) ? s : (TOPIC_NAMES[s] ?? null);
};
export const parseFaqSource = (v: string): FaqSource | null => {
  const s = v.normalize("NFKC").trim();
  return isFaqSource(s) ? s : (SOURCE_NAMES[s] ?? null);
};

// CH-05・CH-06 長さの上限と、仮の数(00_仮決め一覧 D-03-仮-01・D-03-仮-04〜)
export const FAQ_LIMITS = {
  question: 200,
  answer: 3000,
  keywords: 200,
  url: 500,
  sortOrderMax: 9999,
  // CH-01 検索の言葉
  searchText: 100,
  // EV-02 検索の結果の件数
  searchResults: 20,
  // 【仮】0.1 候補の件数(D-03-仮-01)
  candidates: 15,
  // 【仮】EV-01 初めから印を付ける件数(D-03-仮-01)
  preselected: 5,
  // 【仮】CH-02 AIに渡す・ひな形に並べるFAQの件数(D-03-仮-01)
  selectedMin: 1,
  selectedMax: 15,
  // 0.1 手順2 候補を探すときに見る文の長さ(件名＋本文の先頭)
  matchText: 2000,
  // 【仮】CSV の1回の行数(D-03-仮-05)
  csvMaxRows: 1000,
} as const;

// ---- 0.1 手順2 文のそろえ方(全角・半角、カタカナ・ひらがな、英字の大小) ----

export const normalizeForMatch = (value: string): string => katakanaToHiragana(value.normalize("NFKC")).toLowerCase();

// FAQの「ことば」(空白で区切る。全角の空白も区切りにする)
export const splitKeywords = (keywords: string | null): string[] =>
  [...new Set((keywords ?? "").normalize("NFKC").split(/\s+/).map(normalizeForMatch).filter(Boolean))];

export type FaqForScore = { id: string; topic: FaqTopic; keywords: string | null; sortOrder: number };

// 0.1 手順3・4: 話題が同じなら＋3、FAQのことばが文に含まれるごとに＋1。1点以上を高い順(同じなら並び順)に
export const scoreFaqCandidates = <T extends FaqForScore>(
  faqs: T[],
  topics: readonly string[],
  text: string,
  limit: number = FAQ_LIMITS.candidates
): (T & { score: number })[] => {
  const normalized = normalizeForMatch(text);
  return faqs
    .map((f) => ({
      ...f,
      score: (topics.includes(f.topic) ? 3 : 0) + splitKeywords(f.keywords).filter((k) => normalized.includes(k)).length,
    }))
    .filter((f) => f.score >= 1)
    .sort((a, b) => b.score - a.score || a.sortOrder - b.sortOrder)
    .slice(0, limit);
};

// ---- CH-01 検索の言葉 ----

export const checkFaqSearchText = (value: string): string | null => {
  const s = value.trim();
  if (!s) return "探す言葉を入力してください。";
  if (s.length > FAQ_LIMITS.searchText) return `探す言葉は${FAQ_LIMITS.searchText}文字以内で入力してください。`;
  return null;
};

// ---- CH-02 根拠のFAQの件数 ----

export const checkSelectedFaqCount = (count: number): string | null =>
  count < FAQ_LIMITS.selectedMin
    ? "根拠にするよくある質問を1件以上選んでください。"
    : count > FAQ_LIMITS.selectedMax
      ? `根拠にするよくある質問は${FAQ_LIMITS.selectedMax}件までにしてください。`
      : null;

// ---- CH-04 AIの文の金額がFAQにある ----

// 「◯円」「◯,◯◯◯円」の金額を数にして拾う(全角の数字も半角にしてから見る)
export const extractYenAmounts = (text: string): number[] =>
  [...text.normalize("NFKC").matchAll(/(\d[\d,]*)\s*円/g)]
    .map((m) => Number(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n));

// FAQの回答に無い金額(重なりは1つ)
export const amountsNotInFaq = (draft: string, faqAnswers: string[]): number[] => {
  const known = new Set(faqAnswers.flatMap(extractYenAmounts));
  return [...new Set(extractYenAmounts(draft))].filter((n) => !known.has(n));
};

// ---- EV-03 手順5・EV-04 手順3 差し込み欄 ----

// 返信の案で使う差し込み欄(D-02 01 6.3 の {お客様名}・{署名} と、D-03 01 6.2 の {FAQの回答})
export const FAQ_PLACEHOLDERS = ["お客様名", "署名", "FAQの回答"] as const;

// 値を入れる。値が無い欄・知らない欄は空にし、入らなかった欄の名前を返す(D-02 04 CH-08 と同じ扱い)
export const fillPlaceholders = (
  text: string,
  values: Partial<Record<string, string | null>>
): { text: string; missing: string[] } => {
  const missing = new Set<string>();
  const filled = text.replace(/\{([^{}\n]{1,30})\}/g, (_all, name: string) => {
    const v = values[name];
    if (v === undefined || v === null || v === "") {
      missing.add(name);
      return "";
    }
    return v;
  });
  return { text: filled, missing: [...missing] };
};

// {FAQの回答} に入れる文: 「■質問」「回答」を空の行で区切って並べる(EV-04 手順2・3)
export const formatFaqAnswers = (faqs: { question: string; answer: string }[]): string =>
  faqs.map((f) => `■${f.question}\n${f.answer}`).join("\n\n");

// ---- CH-05・CH-06 よくある質問の入力 ----

export type FaqInput = {
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

export type FaqRawInput = {
  topic: string;
  question: string;
  answer: string;
  keywords: string;
  sourceName: string;
  sourceUrl: string;
  checkedOn: string;
  sortOrder: string;
};

// 画面(EV-06)と CSV(EV-07)の両方で使う。errors の名前はフォームの name と同じ。today は日本時間の年-月-日
export const validateFaqInput = (
  raw: FaqRawInput,
  isActive: boolean,
  today: string
): { ok: true; input: FaqInput } | { ok: false; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const topic = parseFaqTopic(raw.topic);
  if (!topic) errors.topic = raw.topic.trim() ? "話題を選び直してください。" : "話題を選んでください。";

  const question = raw.question.trim();
  if (!question) errors.question = "質問を入力してください。";
  else if (question.length > FAQ_LIMITS.question) errors.question = `質問は${FAQ_LIMITS.question}文字以内で入力してください。`;

  const answer = raw.answer.trim();
  if (!answer) errors.answer = "回答を入力してください。";
  else if (answer.length > FAQ_LIMITS.answer)
    errors.answer = `回答は${FAQ_LIMITS.answer.toLocaleString("ja-JP")}文字以内で入力してください。`;

  // ことばは空白を1つにそろえる
  const keywords = raw.keywords.trim().replace(/\s+/g, " ");
  if (keywords.length > FAQ_LIMITS.keywords) errors.keywords = `ことばは${FAQ_LIMITS.keywords}文字以内で入力してください。`;

  const sourceName = parseFaqSource(raw.sourceName);
  if (!sourceName) errors.source_name = raw.sourceName.trim() ? "根拠を選び直してください。" : "根拠を選んでください。";

  // CH-06 URLの形
  const sourceUrl = raw.sourceUrl.trim();
  if (sourceUrl && (!/^https?:\/\/\S+$/.test(sourceUrl) || sourceUrl.length > FAQ_LIMITS.url))
    errors.source_url = `元のURLは https:// か http:// で始まる${FAQ_LIMITS.url}文字以内で入力してください。`;

  // 確かめた日: 空、または年-月-日(「/」の区切りも受け付ける)。未来の日はだめ
  const checkedOn = raw.checkedOn.normalize("NFKC").trim().replace(/\//g, "-");
  if (checkedOn) {
    const m = checkedOn.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const iso = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
    if (!iso || !isValidDateStr(iso)) errors.checked_on = "確かめた日は「2026-11-15」の形で入力してください。";
    else if (iso > today) errors.checked_on = "確かめた日に先の日付は入れられません。";
  }

  const sort = parseIntInRange(raw.sortOrder, 0, FAQ_LIMITS.sortOrderMax);
  if (sort === "error") errors.sort_order = `並び順は0〜${FAQ_LIMITS.sortOrderMax}の整数で入力してください。`;

  if (Object.keys(errors).length > 0 || !topic || !sourceName || sort === "error") return { ok: false, errors };
  const m = checkedOn.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return {
    ok: true,
    input: {
      topic,
      question,
      answer,
      keywords: keywords || null,
      sourceName,
      sourceUrl: sourceUrl || null,
      checkedOn: m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null,
      sortOrder: sort ?? 0,
      isActive,
    },
  };
};

// ---- CH-07 同じ質問 ----

// 前後の空白と記号を除いてそろえる(空白・句読点・記号をすべて取る)
export const normalizeQuestion = (value: string): string =>
  value.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
