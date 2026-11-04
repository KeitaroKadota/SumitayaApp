// D-01 問い合わせの種類の見分け・情報の抜き出しの指示文と答えの形(D-01 01 4.1・6.3、03 0.4)。
// 【仮】過去の問い合わせの例が届いたら言い回しを調整する(00_仮決め一覧 D-01-未-04)。
import type { AiSchema } from "@/utils/aiSchema";
import {
  CUSTOM_SPEC_FIELDS,
  FAQ_TOPICS,
  INQUIRY_CATEGORIES,
  INQUIRY_LIMITS,
  RETURN_REASONS,
  type AiConfidence,
  type InquiryExtracted,
} from "@/utils/inquiryRules";

export const CLASSIFY_INSTRUCTION = [
  "お客様から届いた問い合わせ（メール・モールのメッセージ）を読み、種類を1つ選び、必要な情報を抜き出してください。",
  "種類（category）は次のどれか1つです。",
  "- stock: 在庫・納期の確認（例:「地下足袋の25.5cmはありますか」「いつ届きますか」）",
  "- return: 返品・交換の依頼（例:「サイズが合わないので返品したい」）",
  "- faq: よくある質問（サイズの選び方、送料、支払方法、納期の目安、お手入れ など）",
  "- custom: 特注の相談（例:「町内会の法被を30枚作りたい」）",
  "- other: 上のどれにも当てはまらない（営業メールなど）",
  "1通に複数の内容があるときは、主な種類を1つだけ選び、ほかの内容は other_topics に短く書いてください。",
  "confidence は種類の見分けの自信の度合いです（high・medium・low）。",
  `summary は一覧に出す1行の要約です（${INQUIRY_LIMITS.summary}文字以内、です・ます調にしない短い文）。`,
  "extracted には、本文に書かれている情報だけを入れてください。書かれていない項目は null にしてください。",
  "desired_date は希望の到着日・使う日（祭りの日など）で、年-月-日（例: 2026-11-23）の形にしてください。年が書かれていないときは、受信日時から見て次に来るその日にしてください。分からなければ null にしてください。",
  "前の問い合わせの種類・要約が渡されたときは、続きのメッセージとして参考にしてください。",
].join("\n");

const text = (description: string, maxLength: number = INQUIRY_LIMITS.extractedText): AiSchema => ({
  type: "string",
  nullable: true,
  description,
  maxLength,
});

const EXTRACTED_SCHEMA: AiSchema = {
  type: "object",
  nullable: true,
  properties: {
    customer_name: text("署名などから分かるお客様の名前"),
    order_number: text("注文番号"),
    products: {
      type: "array",
      nullable: true,
      description: "商品の候補の一覧",
      maxItems: INQUIRY_LIMITS.extractedProducts,
      items: {
        type: "object",
        properties: {
          name: text("商品名"),
          code: text("商品コード"),
          size: text("サイズ"),
          color: text("色"),
          quantity: { type: "integer", nullable: true, description: "数量" },
        },
      },
    },
    desired_date: text("希望の到着日・使う日（年-月-日）", 10),
    faq_topics: {
      type: "array",
      nullable: true,
      description: "よくある質問の話題",
      items: { type: "string", enum: Object.keys(FAQ_TOPICS) },
    },
    custom_spec: {
      type: "object",
      nullable: true,
      description: "特注の仕様",
      properties: Object.fromEntries(Object.entries(CUSTOM_SPEC_FIELDS).map(([k, label]) => [k, text(label)])),
    },
    return_reason: { type: "string", nullable: true, description: "返品の理由", enum: Object.keys(RETURN_REASONS) },
    other_topics: text("主な種類以外の話題（短く）", INQUIRY_LIMITS.extractedLongText),
  },
};

export const CLASSIFY_SCHEMA: AiSchema = {
  type: "object",
  required: ["category", "confidence", "summary"],
  properties: {
    // CH-09 は呼んだ側で確かめる(決まった値でなければ other・自信 low にする)
    category: { type: "string", enum: Object.keys(INQUIRY_CATEGORIES), enumCheck: "keep", maxLength: 20 },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    summary: { type: "string", maxLength: INQUIRY_LIMITS.summary },
    extracted: EXTRACTED_SCHEMA,
  },
};

export type ClassifyAnswer = {
  category: string;
  confidence: AiConfidence;
  summary: string;
  extracted?: InquiryExtracted | null;
};
