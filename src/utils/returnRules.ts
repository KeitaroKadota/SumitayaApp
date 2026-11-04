// D-06 返品依頼への回答の決まった値・仮の返品の決まり・チェック(D-06 01 4.1・6.2〜6.4、04 CH-01〜CH-08)。
// DBを読まない計算だけのファイルなので、画面の部品からも使える。
// 返品を受けるか・送料をどちらが負担するかは担当者が決める。ここでは判定しない(01 4章)。
import { extractYenAmounts } from "@/utils/faqRules";
import { RETURN_REASONS, type ReturnReason } from "@/utils/inquiryRules";

export { RETURN_REASONS, type ReturnReason };
export const isReturnReason = (v: string): v is ReturnReason => v in RETURN_REASONS;

// ---- 返品の決まり(【仮】すみたや様に未確認) ----
// ひな形の本文と、担当者の目安としてパネルに出すだけ。自動では判定しない(00_仮決め一覧 D-06-仮-01〜03、D-06-未-01)
export const RETURN_POLICY = {
  // 【仮】D-06-仮-01
  deadline: "出荷日から8日以内",
  // 【仮】D-06-仮-02
  notReturnable: "名入れ・特注・裾上げなど加工した商品、肌着・足袋などの使用後の品は返品できません",
  // 【仮】D-06-仮-03
  shippingStore: "不良・違う商品・配送中の破損は、お店の負担",
  shippingCustomer: "サイズが合わない・お客様のご都合は、お客様の負担",
  // 返送先の住所は未確認(D-06-未-01)。分かったらここに書く
  returnAddress: null as string | null,
} as const;

// ---- 4.1 状態 ----
export const RETURN_STATUSES = {
  waiting_item: "返送待ち",
  item_arrived: "到着",
  rejected: "お断り",
  cancelled: "取消",
} as const;
export type ReturnStatus = keyof typeof RETURN_STATUSES;
export const isReturnStatus = (v: string): v is ReturnStatus => v in RETURN_STATUSES;

export const REQUEST_TYPES = { return: "返品", exchange: "交換" } as const;
export type RequestType = keyof typeof REQUEST_TYPES;
export const isRequestType = (v: string): v is RequestType => v in REQUEST_TYPES;

export const SHIPPING_PAID_BY = { customer: "お客様", store: "お店" } as const;
export type ShippingPaidBy = keyof typeof SHIPPING_PAID_BY;
export const isShippingPaidBy = (v: string): v is ShippingPaidBy => v in SHIPPING_PAID_BY;
// 【仮】{送料の負担} に入れる文(00_仮決め一覧 D-06-仮-10)
export const SHIPPING_PAID_BY_REPLY: Record<ShippingPaidBy, string> = {
  customer: "お客様のご負担",
  store: "当店の負担",
};

// 担当者の決定(G01。初めは空)
export const RETURN_DECISIONS = { accept: "受け付ける", reject: "お断りする", ask_order: "注文番号を伺う" } as const;
export type ReturnDecision = keyof typeof RETURN_DECISIONS;
export const isReturnDecision = (v: string): v is ReturnDecision => v in RETURN_DECISIONS;

// EV-04 手順1: 決定に合うひな形の用途(01 6.4)
export const purposeOfDecision = (decision: ReturnDecision, requestType: RequestType): string =>
  decision === "accept" ? (requestType === "exchange" ? "exchange_accept" : "return_accept") : decision === "reject" ? "return_reject" : "return_ask_order";

// EV-06 手順3: 決定に合う状態
export const statusOfDecision = (decision: "accept" | "reject"): ReturnStatus => (decision === "accept" ? "waiting_item" : "rejected");

// ---- 長さ・件数 ----
export const RETURN_LIMITS = {
  // CH-01
  searchMin: 2,
  searchMax: 100,
  // CH-02 手で入れた場合の数
  manualQuantityMax: 99,
  // 【仮】手で入れる商品の行の数・長さ(00_仮決め一覧 D-06-仮-14)
  manualRows: 5,
  productName: 300,
  orderNumber: 100,
  reasonNote: 1000,
  cancelReason: 200,
  memo: 2000,
} as const;

// ---- CH-01 検索の言葉 ----
export const checkReturnSearchText = (value: string): string | null => {
  const t = value.trim();
  if (t.length < RETURN_LIMITS.searchMin) return `${RETURN_LIMITS.searchMin}文字以上で入力してください。`;
  if (t.length > RETURN_LIMITS.searchMax) return `${RETURN_LIMITS.searchMax}文字以内で入力してください。`;
  return null;
};

// ---- CH-04 担当者の決定 ----
export type DecisionInput = { decision: string; shippingPaidBy: string };

export const checkDecision = (
  input: DecisionInput,
  forRegister: boolean
): { ok: true; decision: ReturnDecision; shippingPaidBy: ShippingPaidBy | null } | { ok: false; message: string } => {
  if (!isReturnDecision(input.decision)) return { ok: false, message: "担当者の決定（受け付ける・お断りする・注文番号を伺う）を選んでください。" };
  if (forRegister && input.decision === "ask_order")
    return { ok: false, message: "「注文番号を伺う」では受付を登録しません。注文が分かってから登録してください。" };
  const shipping = isShippingPaidBy(input.shippingPaidBy) ? input.shippingPaidBy : null;
  // 受け付けるときは送料の負担が要る。登録は状態に関係なく送料の負担の列が要るので、お断りでも選んでもらう
  if ((input.decision === "accept" || forRegister) && !shipping) return { ok: false, message: "送料の負担（お客様・お店）を選んでください。" };
  return { ok: true, decision: input.decision, shippingPaidBy: shipping };
};

// ---- CH-02・CH-03 返品する商品 ----

// 画面から送られた1行(注文の明細から選んだもの、または手で入れたもの)
export type ReturnItemRaw = {
  orderItemId: string | null;
  productName: string;
  quantity: string;
  exchangeProductId: string;
  exchangeProductCode: string;
};

// 注文の明細(CH-02 で数量の上限に使う)
export type OrderItemLimit = {
  id: string;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number;
  // ほかの返品(取消・お断りを除く)で返品済みの数
  returnedQuantity: number;
};

export type ReturnItemInput = {
  orderItemId: string | null;
  productId: string | null;
  productName: string;
  quantity: number;
  unitPrice: number | null;
  // 交換先(商品ID。商品コードで指定したときは、操作の側で商品IDに読み替える)
  exchangeProductId: string | null;
  exchangeProductCode: string | null;
};

const parseQty = (value: string, max: number): number | null => {
  const s = value.normalize("NFKC").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= max ? n : null;
};

export const checkReturnItems = (
  raws: ReturnItemRaw[],
  requestType: RequestType,
  orderItems: OrderItemLimit[] | null
): { ok: true; items: ReturnItemInput[] } | { ok: false; message: string } => {
  if (raws.length === 0) return { ok: false, message: "返品する商品を1つ以上選んでください。" };
  const items: ReturnItemInput[] = [];
  for (const r of raws) {
    let item: ReturnItemInput;
    if (orderItems) {
      const oi = orderItems.find((o) => o.id === r.orderItemId);
      if (!oi) return { ok: false, message: "注文の明細を選び直してください。" };
      if (items.some((i) => i.orderItemId === oi.id)) continue;
      const quantity = parseQty(r.quantity, oi.quantity);
      if (quantity === null) return { ok: false, message: `「${oi.productName}」の数は1〜${oi.quantity}の整数で入力してください。` };
      if (quantity + oi.returnedQuantity > oi.quantity)
        return {
          ok: false,
          message: `「${oi.productName}」は、ほかの返品で${oi.returnedQuantity}点を受け付けています。注文の数（${oi.quantity}点）を超えます。`,
        };
      item = {
        orderItemId: oi.id,
        productId: oi.productId,
        productName: oi.productName,
        quantity,
        unitPrice: oi.unitPrice,
        exchangeProductId: null,
        exchangeProductCode: null,
      };
    } else {
      const name = r.productName.trim();
      if (!name) continue;
      if (name.length > RETURN_LIMITS.productName) return { ok: false, message: `商品名は${RETURN_LIMITS.productName}文字以内で入力してください。` };
      const quantity = parseQty(r.quantity, RETURN_LIMITS.manualQuantityMax);
      if (quantity === null) return { ok: false, message: `「${name}」の数は1〜${RETURN_LIMITS.manualQuantityMax}の整数で入力してください。` };
      item = { orderItemId: null, productId: null, productName: name, quantity, unitPrice: null, exchangeProductId: null, exchangeProductCode: null };
    }
    // CH-03 交換先: 交換なら必ず選ぶ。返品なら空にする
    if (requestType === "exchange") {
      const id = r.exchangeProductId.trim();
      const code = r.exchangeProductCode.trim();
      if (!id && !code) return { ok: false, message: `「${item.productName}」の交換先の商品を選んでください。` };
      item.exchangeProductId = id || null;
      item.exchangeProductCode = id ? null : code;
    }
    items.push(item);
  }
  if (items.length === 0) return { ok: false, message: "返品する商品を1つ以上選んでください。" };
  return { ok: true, items };
};

// ---- 差し込み欄(01 6.4) ----

// {返品の商品}: 商品名と数の箇条書き(交換なら交換先も)
export const returnItemsText = (items: { productName: string; quantity: number; exchangeName: string | null }[]): string =>
  items.map((i) => `・${i.productName} ${i.quantity}点${i.exchangeName ? `（交換先: ${i.exchangeName}）` : ""}`).join("\n");

// ---- CH-07 ひな形の決まりの文 ----

const RULE_BLOCK = /【決まり】([\s\S]*?)【ここまで】/g;

// ひな形の本文の、【決まり】〜【ここまで】の中の文
export const ruleBlocksOf = (text: string): string[] => [...text.matchAll(RULE_BLOCK)].map((m) => m[1].trim()).filter(Boolean);

// 囲み記号を外す(案を作るとき)
export const stripRuleMarkers = (text: string): string => text.replace(/【決まり】\n?/g, "").replace(/\n?【ここまで】/g, "");

// 空白・改行の違いは見ない
const squash = (text: string): string => text.replace(/\s+/g, "");

export const RULE_CHANGED_WARNING = "返品の手順・期限などの文が変わっています。ひな形の文と比べて確かめてください。";

// AIの本文に、決まりの文がそのまま入っているか(blocks は差し込み欄に値を入れた後の文)
export const checkRuleBlocks = (aiBody: string, blocks: string[]): string[] => {
  const body = squash(stripRuleMarkers(aiBody));
  return blocks.some((b) => !body.includes(squash(b))) ? [RULE_CHANGED_WARNING] : [];
};

// ---- CH-08 AIの文の金額 ----

// 本文の「◯円」が、選んだ明細の単価・小計のどれかであること。
// 【仮】ひな形の本文に書いてある金額(送料など)も、そのまま使ってよい金額として数える(00_仮決め一覧 D-06-仮-11)
export const checkAiReturnAmounts = (
  aiBody: string,
  items: { unitPrice: number | null; quantity: number }[],
  templateBody: string
): string[] => {
  const known = new Set<number>(extractYenAmounts(templateBody));
  for (const i of items) {
    if (i.unitPrice === null) continue;
    known.add(i.unitPrice);
    known.add(i.unitPrice * i.quantity);
  }
  const unknown = [...new Set(extractYenAmounts(aiBody))].filter((n) => !known.has(n));
  return unknown.length > 0
    ? [`注文の明細に無い金額があります（${unknown.map((n) => `${n.toLocaleString("ja-JP")}円`).join("・")}）。返金額はAIに決めさせないため、確かめてください。`]
    : [];
};

// ---- CH-06 状態の移り方 ----
// 画面から変えるのは取消だけ(EV-10)。到着は B-03 が、お断りから受付に戻すのは(社長だけ)作る画面が無い
export const canCancelReturn = (status: ReturnStatus): boolean => status !== "cancelled";
