// E-04 受け取った請求書の読み取りの指示文と答えの形(01 7.1・7.2)。
// AIは「書いてある数字・文字をそのまま読む」だけ。合計・税額の計算、突合、支払日の計算はしない(payables.ts で計算する)。
// 金額・日付は文字で受け取り、こちらで整える(04 CH-19。「¥」「,」付きや和暦もこちらで直す)。
// 【仮】請求書のサンプルが届いたら言い回しを調整する(00_仮決め一覧 E-04-未-01)。
import type { AiSchema } from "@/utils/aiSchema";

export const RECEIVED_INVOICE_INSTRUCTION = [
  "今回は問い合わせではなく、祭すみたやが仕入先などから受け取った請求書（画像またはPDF）を読み取ります。",
  "請求書に書いてある文字・数字を、そのまま書き写してください。計算して求めた値や、推測した値は入れないでください。",
  "金額は書いてある数字を文字のまま入れてください（例: \"110,000\"）。日付も書いてあるとおりに入れてください（例: \"2026/10/31\"、\"令和8年10月31日\"）。",
  "書いていない項目は null にしてください。書いてあるが読めない項目は null にして、その項目名を unreadable に入れてください。",
  "subtotal_10・tax_10 は10％対象の金額（税抜）とその消費税額、subtotal_8・tax_8 は8％（軽減税率）対象の金額（税抜）とその消費税額、subtotal_exempt は消費税がかからない金額です。",
  "purchase_total は「今回のお買上げ額（税込）」、amount_due は「今回ご請求額」、previous_balance は「前回ご請求額」、payment_received は「ご入金額」、carried_over は「繰越額」です。",
  "due_on は請求書に書いてある支払期限（お支払い期日）です。書いていなければ null にしてください。",
  "registration_no は適格請求書発行事業者の登録番号（T から始まる13けたの数字）です。",
  "lines は明細の行です。1行ごとに、日付（line_date）・伝票番号（slip_no）・品名（description）・品番（item_code）・数量（quantity）・単価（unit_price、税抜）・金額（amount、税抜）・税率（tax_rate: 10・8・0）を入れてください。",
  "明細が「〇月分 お買上げ」のような合計の1行だけなら、その1行を入れてください。",
].join("\n");

const amount = (description: string): AiSchema => ({ type: "string", nullable: true, description, maxLength: 30 });
const date = (description: string): AiSchema => ({ type: "string", nullable: true, description, maxLength: 30 });

export const RECEIVED_INVOICE_SCHEMA: AiSchema = {
  type: "object",
  properties: {
    payee_name: { type: "string", nullable: true, description: "請求元（発行した会社）の名前", maxLength: 200 },
    registration_no: { type: "string", nullable: true, description: "登録番号（T＋13けた）", maxLength: 30 },
    invoice_no: { type: "string", nullable: true, description: "請求書番号", maxLength: 100 },
    invoice_date: date("請求書の日付（発行日）"),
    period_start: date("請求の期間の始め"),
    period_end: date("請求の期間の終わり（締め日）"),
    previous_balance: amount("前回ご請求額"),
    payment_received: amount("ご入金額"),
    carried_over: amount("繰越額"),
    subtotal_10: amount("10％対象の金額（税抜）"),
    tax_10: amount("10％の消費税額"),
    subtotal_8: amount("8％対象の金額（税抜）"),
    tax_8: amount("8％の消費税額"),
    subtotal_exempt: amount("消費税がかからない金額"),
    purchase_total: amount("今回のお買上げ額（税込）"),
    amount_due: amount("今回ご請求額"),
    due_on: date("支払期限"),
    transfer_to: { type: "string", nullable: true, description: "振込先（銀行・支店・口座）", maxLength: 300 },
    lines: {
      type: "array",
      nullable: true,
      description: "明細の行",
      items: {
        type: "object",
        properties: {
          line_date: date("日付"),
          slip_no: { type: "string", nullable: true, description: "伝票番号", maxLength: 100 },
          description: { type: "string", nullable: true, description: "品名・内容", maxLength: 300 },
          item_code: { type: "string", nullable: true, description: "品番", maxLength: 100 },
          quantity: { type: "string", nullable: true, description: "数量", maxLength: 30 },
          unit_price: amount("単価（税抜）"),
          amount: amount("金額（税抜）"),
          tax_rate: { type: "string", nullable: true, description: "税率（10・8・0）", maxLength: 10 },
        },
      },
    },
    unreadable: { type: "array", nullable: true, description: "読めなかった項目の名前", items: { type: "string", maxLength: 50 } },
  },
};

// 仕入先が分かっているときに渡す読み取りの注意(仕入先マスタの ocr_hint)
export const supplierHintText = (name: string, hint: string | null): string =>
  `【仕入先（分かっている場合）】${name}${hint ? `\n【この仕入先の請求書の読み取りの注意】${hint}` : ""}`;
