// 例外注文のルール(B-02 01 4.1、04 CH-01〜CH-04・CH-16〜CH-19)。DBを読まない計算だけのファイル(試しやすくするため)。
// ルールの決まりとキーワードは、このファイルの先頭の定数に1か所でまとめる。画面からは変えない(B-02 01 0.3)。
// 【仮】キーワード・条件はすべてヒアリング・CSVの見本で直す(00_仮決め一覧 B-02-仮-02〜05・仮-13)。
// B-01 の名入れ・加工の判定(B-01 04 CH-06 の2)も、ここの名入れのキーワード(hasNamePrintKeyword)を使う。
import { katakanaToHiragana, toHalfWidth } from "@/utils/textNormalize";

// ---- ルールの種類(01 4.1。並びは一覧・理由の絞り込みの順) ----

export const ORDER_EXCEPTION_RULES = {
  scroll360_only: "スクロール360だけで出荷できる",
  custom_order: "特注品を含む",
  made_to_order: "受注生産品を含む",
  maker_order: "メーカー取り寄せを含む",
  name_print: "名入れ・刺繍",
  address: "住所の不備",
  unpaid: "決済が済んでいない",
  bundle: "同梱の依頼",
} as const;
export type OrderExceptionRule = keyof typeof ORDER_EXCEPTION_RULES;
export const ORDER_EXCEPTION_RULE_CODES = Object.keys(ORDER_EXCEPTION_RULES) as OrderExceptionRule[];
export const isOrderExceptionRule = (v: string): v is OrderExceptionRule => Object.hasOwn(ORDER_EXCEPTION_RULES, v);

// ---- 【仮】キーワード・条件(04 の各 CH。ここの値を直せば判定が変わる) ----

// CH-01 名入れ・刺繍(name_print)のキーワード
export const NAME_PRINT_KEYWORDS = ["名入れ", "刺繍", "名前入れ", "文字入れ", "染め抜き"] as const;
// CH-01 選択項目で、キーワードの直後に続いたら当てない言葉(「名入れなし」「刺繍不要」など)
const NEGATIVE_SUFFIXES = ["なし", "無し", "不要"];
// CH-03 後払いでよい支払方法(支払方法にこの言葉が含まれれば、未払いでも当てない)
export const DEFERRED_PAYMENT_KEYWORDS = ["代金引換", "代引", "後払い", "請求書"] as const;
// CH-04 同梱の依頼のキーワード(備考)
export const BUNDLE_KEYWORDS = ["同梱", "一緒に", "まとめて", "別注文"] as const;
// 理由の文に入れる、キーワードの前後の文字数(04「文字の比べ方」)
const SNIPPET_CHARS = 10;

// CH-02 47都道府県
const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県",
  "東京都", "神奈川県", "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県",
  "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
];
// CH-02 番地の数字(半角・全角の数字、または漢数字＋「丁目」「番」「号」)
const BANCHI_PATTERN = /[0-9]|[一二三四五六七八九十百千]+(丁目|番|号)/;

// CH-16〜CH-19 商品を見分ける印
export type ProductKind = "scroll360" | "custom" | "made_to_order" | "maker_order";

// スクロール360の商品: CROSS MALL の商品備考が「s_」で始まる(すみたや様の提出資料の説明。00_仮決め一覧 B-02-仮-19)
const SCROLL360_REMARK_PREFIX = "s_";

// 商品の印(B-02 04 の 0.5 追記)。スクロール360は商品備考の写しで見分ける。
// 【仮】特注・受注生産・メーカー取り寄せの印は未決のまま付けない(= CH-17〜CH-19 は当たらない。B-02-未-03・B-02-仮-13)。
// 商品マスタに結び付いていない明細(productId が空)は、印の無い商品として扱う(04 CH-16〜CH-19 共通)。
export const productKindsOf = (item: {
  productId: string | null;
  productCode: string;
  productName: string;
  crossmallRemark: string | null;
}): ProductKind[] => {
  if (!item.productId) return [];
  const kinds: ProductKind[] = [];
  if (item.crossmallRemark?.trim().startsWith(SCROLL360_REMARK_PREFIX)) kinds.push("scroll360");
  return kinds;
};

// ---- 文字の比べ方(04「文字の比べ方」) ----

// 比べる前のそろえ方: 全角英数字を半角に、カタカナをひらがなに、大文字を小文字に
export const normalizeForKeyword = (value: string): string => katakanaToHiragana(toHalfWidth(value)).toLowerCase();

type KeywordHit = { keyword: string; snippet: string };

// キーワードのどれかが含まれれば、当たったキーワードと前後10文字を返す。negative のときは「なし」「不要」が直後に続く場所は当てない
const findKeyword = (text: string | null, keywords: readonly string[], { negative = false } = {}): KeywordHit | null => {
  if (!text) return null;
  const target = normalizeForKeyword(text);
  // そろえても長さが変わらなければ元の文字で前後を切り出す(変わるときは、そろえた文字で切り出す)
  const source = target.length === text.length ? text : target;
  for (const keyword of keywords) {
    const k = normalizeForKeyword(keyword);
    let from = 0;
    for (;;) {
      const i = target.indexOf(k, from);
      if (i < 0) break;
      const rest = target.slice(i + k.length).replace(/^[\s:：]+/, "");
      if (!negative || !NEGATIVE_SUFFIXES.some((n) => rest.startsWith(normalizeForKeyword(n)))) {
        const start = Math.max(0, i - SNIPPET_CHARS);
        const end = Math.min(source.length, i + k.length + SNIPPET_CHARS);
        const snippet = `${start > 0 ? "…" : ""}${source.slice(start, end).replace(/\s+/g, " ")}${end < source.length ? "…" : ""}`;
        return { keyword, snippet };
      }
      from = i + k.length;
    }
  }
  return null;
};

// 名入れ・刺繍のキーワードが含まれるか(「なし」「不要」が直後に続く場合は当てない)。B-01 の名入れの判定で使う
export const hasNamePrintKeyword = (text: string): boolean => findKeyword(text, NAME_PRINT_KEYWORDS, { negative: true }) !== null;

// ---- ルールの判定 ----

export type ExceptionOrderItem = {
  lineNo: number;
  productId: string | null;
  productCode: string;
  productName: string;
  optionText: string | null;
  hasCustomization: boolean;
  customizationText: string | null;
  // 商品マスタの CROSS MALL の商品備考の写し(products.crossmall_remark。未登録の商品は null)
  crossmallRemark: string | null;
};

export type ExceptionOrderInput = {
  customerNote: string | null;
  shipName: string;
  shipPostalCode: string | null;
  shipPrefecture: string | null;
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipPhone: string | null;
  paymentMethod: string | null;
  paymentStatus: "paid" | "unpaid" | "unknown";
  items: ExceptionOrderItem[];
  // CH-04 の2: 同じ注文者の、未出荷・キャンセルでない別の注文の注文番号
  sameCustomerOpenOrderNos: string[];
};

export type RuleHit = { reason: string; detail: Record<string, unknown> };
type RuleCheck = (order: ExceptionOrderInput) => RuleHit | null;

const digitsOf = (value: string | null): string => (value ? toHalfWidth(value).replace(/\D/g, "") : "");
const itemLabel = (i: ExceptionOrderItem) => `${i.productCode} ${i.productName}`.trim();

// CH-17〜CH-19: 明細に印の商品が1つでもあれば当たる
const containsKind =
  (kind: ProductKind, label: string): RuleCheck =>
  (order) => {
    const hits = order.items.filter((i) => productKindsOf(i).includes(kind));
    if (hits.length === 0) return null;
    return {
      reason: `${label}を含みます（${hits.map(itemLabel).join("、")}）`,
      detail: { lines: hits.map((i) => i.lineNo) },
    };
  };

// ルールのコード → 「注文と明細を受け取り、当たったら理由を返す関数」の表(01 7章)。並びは調べる順(03 EV-01 手順3)
export const ORDER_EXCEPTION_CHECKS: Record<OrderExceptionRule, RuleCheck> = {
  // CH-16 明細の商品がすべてスクロール360から出荷できる(1つでもそうでない・未登録の商品があれば当てない)
  scroll360_only: (order) => {
    if (order.items.length === 0) return null;
    if (!order.items.every((i) => productKindsOf(i).includes("scroll360"))) return null;
    return { reason: "すべての商品をスクロール360から出荷できます", detail: { lines: order.items.map((i) => i.lineNo) } };
  },
  // CH-17〜CH-19
  custom_order: containsKind("custom", "特注品"),
  made_to_order: containsKind("made_to_order", "受注生産品"),
  maker_order: containsKind("maker_order", "メーカー取り寄せの商品"),

  // CH-01 名入れ・加工の印、または選択項目・備考のキーワード
  name_print: (order) => {
    const marked = order.items.find((i) => i.hasCustomization);
    if (marked) {
      return {
        reason: `明細${marked.lineNo}に名入れ・加工があります${marked.customizationText ? `（${marked.customizationText.slice(0, 50)}）` : ""}`,
        detail: { line: marked.lineNo, source: "has_customization" },
      };
    }
    for (const i of order.items) {
      const hit = findKeyword(i.optionText, NAME_PRINT_KEYWORDS, { negative: true });
      if (hit) {
        return {
          reason: `明細${i.lineNo}の選択項目に『${hit.keyword}』があります（${hit.snippet}）`,
          detail: { line: i.lineNo, source: "option_text", keyword: hit.keyword },
        };
      }
    }
    const note = findKeyword(order.customerNote, NAME_PRINT_KEYWORDS);
    if (note) return { reason: `備考に『${note.keyword}』があります（${note.snippet}）`, detail: { source: "customer_note", keyword: note.keyword } };
    return null;
  },

  // CH-02 住所の不備(当たった項目をすべて書く)
  address: (order) => {
    // 届け先の項目がすべて空の注文は、住所を取り込んでいない(CSVに届け先の列が無い・店舗の注文)とみなして調べない
    // (B-01 01 11.1。見本の受注CSVには届け先の列が無く、すべての注文が当たってしまうため)
    const shipFields = [order.shipName, order.shipPostalCode, order.shipPrefecture, order.shipAddress1, order.shipAddress2, order.shipPhone];
    if (shipFields.every((v) => !(v ?? "").trim())) return null;
    const problems: string[] = [];
    const postal = digitsOf(order.shipPostalCode);
    if (!postal) problems.push("郵便番号がありません");
    else if (postal.length !== 7) problems.push(`郵便番号が${postal.length}桁です`);
    const pref = (order.shipPrefecture ?? "").trim();
    if (!pref) problems.push("都道府県がありません");
    else if (!PREFECTURES.includes(toHalfWidth(pref))) problems.push(`都道府県『${pref.slice(0, 20)}』が正しくありません`);
    const address = toHalfWidth(`${order.shipAddress1 ?? ""}${order.shipAddress2 ?? ""}`);
    if (!BANCHI_PATTERN.test(address)) problems.push("住所に番地がありません");
    const phone = digitsOf(order.shipPhone);
    if (!phone) problems.push("届け先の電話番号がありません");
    else if (phone.length !== 10 && phone.length !== 11) problems.push(`届け先の電話番号が${phone.length}桁です`);
    if (!order.shipName.trim()) problems.push("届け先の名前がありません");
    if (problems.length === 0) return null;
    return { reason: problems.join("・"), detail: { problems } };
  },

  // CH-03 未払いで、後払いでよい支払方法でない(支払の状態が不明のものは当てない)
  unpaid: (order) => {
    if (order.paymentStatus !== "unpaid") return null;
    const method = order.paymentMethod ?? "";
    if (findKeyword(method, DEFERRED_PAYMENT_KEYWORDS)) return null;
    return { reason: `支払が済んでいません（支払方法: ${method.slice(0, 50) || "不明"}）`, detail: { paymentMethod: method || null } };
  },

  // CH-04 備考のキーワード、または同じ注文者の未出荷の別の注文
  bundle: (order) => {
    const reasons: string[] = [];
    const detail: Record<string, unknown> = {};
    const note = findKeyword(order.customerNote, BUNDLE_KEYWORDS);
    if (note) {
      reasons.push(`備考に『${note.keyword}』があります（${note.snippet}）`);
      detail.keyword = note.keyword;
    }
    if (order.sameCustomerOpenOrderNos.length > 0) {
      reasons.push(`同じ注文者のまだ出荷していない注文があります（注文番号 ${order.sameCustomerOpenOrderNos.slice(0, 5).join("、")}）`);
      detail.orderNos = order.sameCustomerOpenOrderNos.slice(0, 20);
    }
    if (reasons.length === 0) return null;
    return { reason: reasons.join("／"), detail };
  },
};

// 1件の注文を全部のルールで調べる。1つのルールで失敗しても、ほかのルールは続ける(03 EV-01 手順3)
export const checkOrderExceptions = (
  order: ExceptionOrderInput
): { hits: { rule: OrderExceptionRule; hit: RuleHit }[]; failed: OrderExceptionRule[] } => {
  const hits: { rule: OrderExceptionRule; hit: RuleHit }[] = [];
  const failed: OrderExceptionRule[] = [];
  for (const rule of ORDER_EXCEPTION_RULE_CODES) {
    try {
      const hit = ORDER_EXCEPTION_CHECKS[rule](order);
      if (hit) hits.push({ rule, hit });
    } catch (e) {
      console.error(`例外のルール ${rule} で調べられませんでした:`, e instanceof Error ? e.message : e);
      failed.push(rule);
    }
  }
  return { hits, failed };
};

// CH-13 対応のメモ
export const RESOLUTION_NOTE_MAX = 500;

// CH-04 の2 同じ注文者の比べ方(B-01 CH-13: 名前はひらがな・カタカナ・空白の違いを、電話は数字だけで比べる)
export const customerKeyOf = (name: string, phoneDigits: string | null): string | null => {
  const n = katakanaToHiragana(name).replace(/\s/g, "");
  return n && phoneDigits ? `${n}\t${phoneDigits}` : null;
};
