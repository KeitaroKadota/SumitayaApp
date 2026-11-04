// D-06 返品依頼への回答の、返信文の案の指示文と答えの形(D-06 01 7章、03 EV-04 手順3)。
// 受け付けるか・送料の負担は担当者が決めたものを渡す。AIは「書く」だけで、返品の可否・期限・送料・返金額を決めない。
// 【仮】過去の返品依頼のメールの例が届いたら言い回しを調整する(00_仮決め一覧 D-01-未-04、D-06 01 8章 #3)。
import type { AiSchema } from "@/utils/aiSchema";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";

export const RETURN_REPLY_INSTRUCTION = [
  "お客様からの返品・交換のご依頼に答える返信メールの文案を、丁寧語で書いてください。",
  "受け付けるか・お断りするか・注文番号を伺うかは、こちらが渡した「担当者の決定」のとおりにしてください。自分で決め直さないでください。",
  "ひな形の【決まり】〜【ここまで】で囲まれた文（返送の手順・期限・送料・返送先など）は、一字も変えずにそのまま使ってください。囲みの記号【決まり】【ここまで】は書かないでください。",
  "お客様の事情に合わせて整えてよいのは、前後のあいさつとお詫びの文だけです。",
  "注文番号・注文日・商品・数・送料の負担は、こちらが渡した値だけを使ってください。返金額・金額は書かないでください。",
  "本文の最初の行は、お客様の名前の代わりに「{お客様名} 様」と書いてください。本文の最後の行は「{署名}」とだけ書いてください。",
  "subject は返信メールの件名の案です（50文字以内）。",
].join("\n");

export const RETURN_REPLY_SCHEMA: AiSchema = {
  type: "object",
  required: ["body"],
  properties: {
    subject: { type: "string", nullable: true, description: "返信メールの件名の案", maxLength: 50 },
    body: { type: "string", description: "返信メールの本文", maxLength: INQUIRY_LIMITS.reply },
  },
};

export type ReturnReplyAnswer = { subject?: string | null; body: string };
