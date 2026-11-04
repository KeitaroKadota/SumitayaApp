// D-02 在庫照会への回答の、返信文の案の指示文と答えの形(D-02 01 7章、03 EV-04 手順4)。
// 在庫の有無・日付はこちらで計算して渡す。AIは「書く」だけで、数・日付を決めない。
// 【仮】過去の問い合わせの例が届いたら言い回しを調整する(00_仮決め一覧 D-01-未-04)。
import type { AiSchema } from "@/utils/aiSchema";
import { INQUIRY_LIMITS } from "@/utils/inquiryRules";

export const STOCK_REPLY_INSTRUCTION = [
  "お客様の在庫・お届けの問い合わせに答える返信メールの文案を、丁寧語で書いてください。",
  "在庫の有無・出荷できる日・入荷予定日は、こちらが渡した「計算した値」だけを使ってください。書かれていない日付・数・金額は書かないでください。",
  "日付は渡した書き方（例: 11月21日（土））のまま書いてください。",
  "「要確認」の印がある商品は、確定の言い方をしないでください（例: 「◯日ごろの見込みです。確定しましたら改めてご連絡します」）。",
  "「確認が必要」の商品は日付を書かず、「確認して改めてご連絡します」と書いてください。",
  "在庫の数は、渡されたときだけ書いてください。渡されていないときは「在庫がございます」のように有無だけを書いてください。",
  "本文の最初の行は、お客様の名前の代わりに「{お客様名} 様」と書いてください。本文の最後の行は「{署名}」とだけ書いてください。",
  "ひな形が渡されたときは、その言い回しを見本にしてください（ひな形の中の {…} の欄は、お客様名・署名のほかは計算した値で書き換えてください）。",
  "subject は返信メールの件名の案です（50文字以内）。",
].join("\n");

export const STOCK_REPLY_SCHEMA: AiSchema = {
  type: "object",
  required: ["body"],
  properties: {
    subject: { type: "string", nullable: true, description: "返信メールの件名の案", maxLength: 50 },
    body: { type: "string", description: "返信メールの本文", maxLength: INQUIRY_LIMITS.reply },
  },
};

export type StockReplyAnswer = { subject?: string | null; body: string };
