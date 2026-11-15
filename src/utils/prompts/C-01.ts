// C-01 納品書の読み取りの指示文と答えの形(01 7.1・7.2)。
// AIは「書いてある数字・文字をそのまま読む」だけ。数量×単価・合計の計算、仕入先・自社の商品の決め方はしない
// (deliverySlipRules.ts・deliverySlipServer.ts で計算・対応表で決める。01 の 6章)。
// 数量・金額・日付は文字で受け取り、こちらで整える(04 CH-06。「¥」「,」付きや和暦もこちらで直す。E-04 と同じ考え方)。
// 【仮】納品書のサンプルが届いたら言い回しを調整する(00_仮決め一覧 C-01-未-01)。
import type { AiSchema } from "@/utils/aiSchema";

export const DELIVERY_SLIP_INSTRUCTION = [
  "今回は問い合わせではなく、祭すみたやが仕入先から受け取った納品書（画像またはPDF。複数ページのときは1件の納品書のページ順）を読み取ります。",
  "次の形で読み取ってください。読めない項目は null にし、推測で埋めないでください。計算して求めた値も入れないでください。",
  "数量・単価・金額・小計・税・合計は、書いてある数字を文字のまま入れてください（例: \"25,000\"、\"2.5\"、\"-500\"）。日付も書いてあるとおりに入れてください（例: \"2026/11/18\"、\"令和8年11月18日\"）。",
  "supplier_name は納品書を出した会社（仕入先）の名前、supplier_phone はその電話番号です。宛先（祭すみたや）の名前・電話ではありません。",
  "slip_no は伝票番号、delivery_date は納品日、order_ref は発注番号の欄（あれば）です。",
  "lines は明細の行です。1行ごとに、品番（item_code）・品名（item_name）・サイズや色（spec）・数量（quantity）・単位（unit）・単価（unit_price）・金額（amount）を入れてください。送料・値引きの行も明細として入れてください。",
  "subtotal は税抜の合計、tax は消費税額、total は税込の合計です。tax_included は、明細の金額が税込で書かれていれば true、税抜なら false、分からなければ null にしてください。",
  "confidence は、読み取りにどれだけ自信があるかを 0〜1 の数で入れてください（明細ごとと、伝票全体）。",
  "notes には、手書きの訂正がある・一部が読みにくいなど、確かめる人への注意を短く入れてください。",
].join("\n");

const text = (description: string, maxLength = 30): AiSchema => ({ type: "string", nullable: true, description, maxLength });
const confidence = (description: string): AiSchema => ({ type: "number", nullable: true, description });

export const DELIVERY_SLIP_SCHEMA: AiSchema = {
  type: "object",
  properties: {
    supplier_name: text("仕入先（納品書を出した会社）の名前", 200),
    supplier_phone: text("仕入先の電話番号"),
    slip_no: text("伝票番号", 100),
    delivery_date: text("納品日"),
    order_ref: text("発注番号", 100),
    lines: {
      type: "array",
      nullable: true,
      description: "明細の行",
      items: {
        type: "object",
        properties: {
          item_code: text("品番", 100),
          item_name: text("品名", 200),
          spec: text("サイズ・色など", 200),
          quantity: text("数量"),
          unit: text("単位（枚・箱・m など）", 20),
          unit_price: text("単価"),
          amount: text("金額"),
          confidence: confidence("この明細の読み取りの自信（0〜1）"),
        },
      },
    },
    subtotal: text("税抜の合計"),
    tax: text("消費税額"),
    total: text("税込の合計"),
    tax_included: { type: "boolean", nullable: true, description: "明細の金額が税込で書かれているか" },
    confidence: confidence("伝票全体の読み取りの自信（0〜1）"),
    notes: text("確かめる人への注意", 300),
  },
};

// 仕入先が分かっているときに渡す手がかり(01 7.1: 読み取りの注意と、その仕入先の品番の一覧〔最大200件〕)
export const supplierSlipHintText = (name: string, hint: string | null, itemCodes: { code: string; name: string | null }[]): string =>
  [
    `【仕入先（分かっている場合）】${name}`,
    hint ? `【この仕入先の納品書の読み取りの注意】${hint}` : "",
    itemCodes.length > 0
      ? `【この仕入先の品番の一覧（参考。書いてある品番をそのまま読んでください）】\n${itemCodes
          .map((c) => (c.name ? `${c.code} ${c.name}` : c.code))
          .join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
