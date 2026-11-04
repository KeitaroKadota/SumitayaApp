// D-04 特注の仕様確認・概算見積の、返信文の案の指示文と答えの形(D-04 01 7章、03 EV-06・EV-09)。
// AIは「聞き返しの文」と「概算の案内の文」を書くだけ。足りない項目は決まりで、概算の金額は計算で出したものを渡す。
// 【仮】過去の問い合わせの例が届いたら言い回しを調整する(00_仮決め一覧 D-01-未-04)。
import type { AiSchema } from "@/utils/aiSchema";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";

const COMMON_LINES = [
  "本文の最初の行は、お客様の名前の代わりに「{お客様名} 様」と書いてください。本文の最後の行は「{署名}」とだけ書いてください。",
  "ひな形が渡されたときは、その言い回しを見本にしてください（ひな形の中の {…} の欄は、お客様名・署名のほかは使わないでください）。",
  "subject は返信メールの件名の案です（50文字以内）。",
];

// EV-06 聞き返し
export const CUSTOM_ASK_INSTRUCTION = [
  "特注（法被・半纏など）のご相談をいただいたお客様へ、お見積りに必要な項目をお聞きする返信メールの文案を、丁寧語で書いてください。",
  "お聞きするのは、こちらが渡した「足りない項目」だけです。「分かっている仕様」に書かれた項目は、聞き直さないでください。",
  "足りない項目は箇条書きにし、お客様が選びやすいように、項目ごとに答え方の例を添えてください（例は一般的なものにしてください）。",
  "金額は書かないでください。在庫・納期のお約束も書かないでください。",
  ...COMMON_LINES,
].join("\n");

// EV-09 概算の案内
export const CUSTOM_ESTIMATE_INSTRUCTION = [
  "特注（法被・半纏など）のご相談をいただいたお客様へ、概算のお見積りをご案内する返信メールの文案を、丁寧語で書いてください。",
  "金額は、こちらが渡した「概算の内訳」と「概算の合計」の値だけを、そのまま使ってください。計算し直したり、ほかの金額を書いたりしないでください。",
  "これは概算であることと、正式なお見積りは工場で確認してからご案内することを、必ず書いてください（「概算」「正式なお見積り」という言葉を使ってください）。",
  "納期のお約束は書かないでください。",
  ...COMMON_LINES,
].join("\n");

export const CUSTOM_REPLY_SCHEMA: AiSchema = {
  type: "object",
  required: ["body"],
  properties: {
    subject: { type: "string", nullable: true, description: "返信メールの件名の案", maxLength: 50 },
    body: { type: "string", description: "返信メールの本文", maxLength: INQUIRY_LIMITS.reply },
  },
};

export type CustomReplyAnswer = { subject?: string | null; body: string };
