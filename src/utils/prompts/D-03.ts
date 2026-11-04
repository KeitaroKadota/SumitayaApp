// D-03 よくある質問への回答の、返信文の案の指示文と答えの形(D-03 01 7章、03 EV-03 手順3)。
// 根拠は渡したよくある質問(faq_entries)だけ。AIは「書く」だけで、書かれていないことは答えない。
// 【仮】過去の問い合わせの例が届いたら言い回しを調整する(00_仮決め一覧 D-01-未-04)。
import type { AiSchema } from "@/utils/aiSchema";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";
import { FAQ_LIMITS } from "@/utils/faqRules";

export const FAQ_REPLY_INSTRUCTION = [
  "お客様の問い合わせに答える返信メールの文案を、丁寧語で書いてください。",
  "答えに使ってよいのは、こちらが渡した「よくある質問」に書かれていることだけです。",
  "よくある質問に書かれていない質問には本文で答えず、not_covered にその質問を短く書いてください（例: 「2点買ったときの送料」）。",
  "金額は、よくある質問の回答に書かれているとおりに使ってください。合計などの計算が要る質問は not_covered に入れてください。",
  "used_faq_ids には、答えに使ったよくある質問のIDだけを入れてください。",
  "本文の最初の行は、お客様の名前の代わりに「{お客様名} 様」と書いてください。本文の最後の行は「{署名}」とだけ書いてください。",
  "ひな形が渡されたときは、その言い回しを見本にしてください（ひな形の中の {…} の欄は、お客様名・署名のほかは使わないでください）。",
  "subject は返信メールの件名の案です（50文字以内）。",
].join("\n");

export const FAQ_REPLY_SCHEMA: AiSchema = {
  type: "object",
  required: ["body", "used_faq_ids", "not_covered"],
  properties: {
    subject: { type: "string", nullable: true, description: "返信メールの件名の案", maxLength: 50 },
    body: { type: "string", description: "返信メールの本文", maxLength: INQUIRY_LIMITS.reply },
    used_faq_ids: {
      type: "array",
      description: "答えに使ったよくある質問のID",
      maxItems: FAQ_LIMITS.selectedMax,
      items: { type: "string", maxLength: 36 },
    },
    not_covered: {
      type: "array",
      description: "よくある質問に無かった質問",
      maxItems: 10,
      items: { type: "string", maxLength: 200 },
    },
  },
};

export type FaqReplyAnswer = {
  subject?: string | null;
  body: string;
  used_faq_ids: string[];
  not_covered: string[];
};
