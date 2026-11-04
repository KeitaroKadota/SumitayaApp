// CROSS MALL の受注CSV・在庫CSVの「列の対応表」と、値の読み替えの表(B-01 01 7.2、04 CH-02・CH-05・CH-06)。
// 【仮】列名・値はすべて仮(00_仮決め一覧 B-01-未-01・B-01-仮-04〜06・B-01-仮-11)。
// ヒアリング No.49 の CSV の見本が届いたら、このファイルだけを直す(右側の候補の並びに実際の列名を入れる)。
// 候補はどれか1つが見出しにあればよい(前にある候補を優先)。DBを読まない定数だけのファイル。
import type { PaymentStatus, Shop } from "./types";

// 受注CSV。1注文が商品ごとの複数の行で出る形にも、1行の形にも対応する(受注番号でまとめる)
export const ORDER_COLUMNS = {
  // ---- 注文の項目(同じ注文の行では同じ値) ----
  crossmallOrderNo: ["受注番号", "管理番号"],
  shop: ["店舗名", "モール"],
  shopOrderNo: ["注文番号"],
  orderedAt: ["受注日時", "注文日時"],
  crossmallStatus: ["受注ステータス", "ステータス"],
  shippedOn: ["出荷日", "発送日"],
  customerName: ["注文者名", "購入者名"],
  customerKana: ["注文者名カナ", "購入者名カナ"],
  customerEmail: ["注文者メールアドレス", "メールアドレス"],
  customerPhone: ["注文者電話番号", "電話番号"],
  shipName: ["送付先名", "お届け先名"],
  shipPostalCode: ["送付先郵便番号", "お届け先郵便番号"],
  shipPrefecture: ["送付先都道府県", "お届け先都道府県"],
  shipAddress1: ["送付先住所1", "お届け先住所1"],
  shipAddress2: ["送付先住所2", "お届け先住所2"],
  shipPhone: ["送付先電話番号", "お届け先電話番号"],
  paymentMethod: ["支払方法", "決済方法"],
  paymentStatus: ["入金状況", "決済状況"],
  requestedDeliveryDate: ["お届け希望日", "配送希望日"],
  customerNote: ["備考", "お客様備考"],
  subtotal: ["商品合計", "商品金額合計"],
  shippingFee: ["送料"],
  discount: ["値引き", "割引額"],
  tax: ["消費税"],
  total: ["合計金額", "総合計"],
  // ---- 明細の項目(行ごと) ----
  productCode: ["商品コード"],
  productName: ["商品名"],
  optionText: ["項目選択肢", "選択肢"],
  // 名入れ・加工の専用の列(あれば CH-06 の1。無ければ選択肢の文字から判定する)
  customization: ["名入れ"],
  quantity: ["数量"],
  unitPrice: ["単価"],
  amount: ["金額", "小計"],
} as const satisfies Record<string, readonly string[]>;
export type OrderField = keyof typeof ORDER_COLUMNS;

// CH-02 受注CSVの必須の項目
export const ORDER_REQUIRED_FIELDS: { field: OrderField; label: string }[] = [
  { field: "crossmallOrderNo", label: "受注番号" },
  { field: "orderedAt", label: "注文日時" },
  { field: "productCode", label: "商品コード" },
  { field: "quantity", label: "数量" },
];

// 在庫CSV
export const STOCK_COLUMNS = {
  productCode: ["商品コード"],
  quantity: ["在庫数"],
  allocatedQuantity: ["引当数", "引当済数"],
  availableQuantity: ["引当可能数", "有効在庫数"],
} as const satisfies Record<string, readonly string[]>;
export type StockField = keyof typeof STOCK_COLUMNS;

// CH-02 在庫CSVの必須の項目
export const STOCK_REQUIRED_FIELDS: { field: StockField; label: string }[] = [
  { field: "productCode", label: "商品コード" },
  { field: "quantity", label: "在庫数" },
];

// 置き場所(【仮】初回は main の1か所だけ。No.38。00_仮決め一覧 B-01-仮-02)
export const DEFAULT_LOCATION_CODE = "main";

// CH-05 販路: CSVの値に含まれる文字 → shop。上から順に調べ、どれにも当たらなければ other(警告)
export const SHOP_RULES: { keywords: string[]; shop: Shop }[] = [
  { keywords: ["楽天"], shop: "rakuten" },
  { keywords: ["yahoo", "ヤフー"], shop: "yahoo" },
  { keywords: ["amazon", "アマゾン"], shop: "amazon" },
  { keywords: ["futureshop", "本店", "自社"], shop: "futureshop" },
];

// CH-06 支払状況: CSVの値に含まれる文字 → payment_status。上から順に調べ、当たらなければ unknown。
// 「未入金」は「入金」も含むので、unpaid を先に書く
export const PAYMENT_STATUS_RULES: { keywords: string[]; status: Exclude<PaymentStatus, "unknown"> }[] = [
  { keywords: ["未入金", "未決済", "未払"], status: "unpaid" },
  { keywords: ["入金済", "決済済", "支払済"], status: "paid" },
];

// CH-06 キャンセル: crossmall_status にこの文字が含まれればキャンセルの注文
export const CANCEL_STATUS_KEYWORDS = ["キャンセル"];

// CH-06 名入れ・加工の列で「なし」とみなす値
export const NO_CUSTOMIZATION_VALUES = ["なし", "無し", "不要"];
