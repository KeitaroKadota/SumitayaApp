// E-07 領収書の読み取りと勘定科目の案の指示文と答えの形(01 7.1)。読み取りと勘定科目の案は1回の呼び出しにまとめる。
// AIは「書いてある数字・文字をそのまま読む」と「一覧から科目を1つ選ぶ」だけ。合計・税額の検算、二重計上の判定はしない
// (expenseClaims.ts で計算する)。金額・日付は文字で受け取り、こちらで整える(04 CH-19)。
// 勘定科目の案は、同じ支払先の登録済みの履歴が無いときだけ使う(03 の 0.2)。
// 【仮】領収書のサンプルが届いたら言い回しを調整する(00_仮決め一覧 E-07-未-01)。
import type { AiSchema } from "@/utils/aiSchema";
import type { AccountTitle } from "@/utils/expenseClaims";

export const RECEIPT_INSTRUCTION = [
  "今回は問い合わせではなく、祭すみたやの従業員が立て替えて支払った経費の領収書・レシート（画像）を読み取ります。",
  "領収書に書いてある文字・数字を、そのまま書き写してください。計算して求めた値や、推測した値は入れないでください。",
  "金額は書いてある数字を文字のまま入れてください（例: \"1,320\"）。日付も書いてあるとおりに入れてください（例: \"2026/11/20\"、\"令和8年11月20日\"）。",
  "書いていない項目は null にしてください。書いてあるが読めない項目は null にして、その項目名を unreadable に入れてください。",
  "spent_on は支払った日（領収書・レシートの日付）、payee_name は支払先（店・会社の名前。支店名・店名も含める）です。",
  "total は支払った合計（税込）です。total_10・tax_10 は10％対象の金額（税込）とそのうちの消費税額、total_8・tax_8 は8％（軽減税率）対象の金額（税込）とそのうちの消費税額、total_exempt は消費税がかからないもの（切手・印紙など）の金額です。税率ごとの内訳が書いていなければ null にしてください。",
  "registration_no は適格請求書発行事業者の登録番号（T から始まる13けたの数字）です。宛名は読み取らないでください。",
  "items_text は品目の要約です（例: \"ガムテープ、軍手\"）。50文字くらいまでにしてください。",
  "account_title_name は、渡した【勘定科目の一覧】の名前から、品目に合うものを1つだけ選んでください。一覧に無い名前は使わないでください。合うものが分からなければ null にしてください。",
  "account_title_reason は、その科目を選んだ理由を短く書いてください（例: \"品目「ガムテープ・軍手」から\"）。",
].join("\n");

// 勘定科目の一覧(名前と説明)を、入力の文にする
export const accountTitlesText = (titles: readonly AccountTitle[]): string =>
  ["【勘定科目の一覧】", ...titles.map((t) => `- ${t.name}${t.description ? `: ${t.description}` : ""}`)].join("\n");

const amount = (description: string): AiSchema => ({ type: "string", nullable: true, description, maxLength: 30 });

// 勘定科目の名前は、使っている科目の一覧の値だけを受け付ける(一覧に無い名前はその項目だけ捨てる。CH-19)
export const receiptSchema = (titleNames: readonly string[]): AiSchema => ({
  type: "object",
  properties: {
    spent_on: { type: "string", nullable: true, description: "支払った日（領収書の日付）", maxLength: 30 },
    payee_name: { type: "string", nullable: true, description: "支払先（店の名前）", maxLength: 200 },
    registration_no: { type: "string", nullable: true, description: "登録番号（T＋13けた）", maxLength: 30 },
    total: amount("支払った合計（税込）"),
    total_10: amount("10％対象の金額（税込）"),
    tax_10: amount("10％対象のうちの消費税額"),
    total_8: amount("8％対象の金額（税込）"),
    tax_8: amount("8％対象のうちの消費税額"),
    total_exempt: amount("消費税がかからないものの金額"),
    items_text: { type: "string", nullable: true, description: "品目の要約", maxLength: 200 },
    account_title_name: {
      type: "string",
      nullable: true,
      description: "勘定科目（一覧の名前から1つ）",
      ...(titleNames.length > 0 ? { enum: titleNames } : {}),
    },
    account_title_reason: { type: "string", nullable: true, description: "勘定科目を選んだ理由", maxLength: 100 },
    unreadable: { type: "array", nullable: true, description: "読めなかった項目の名前", items: { type: "string", maxLength: 50 } },
  },
});
