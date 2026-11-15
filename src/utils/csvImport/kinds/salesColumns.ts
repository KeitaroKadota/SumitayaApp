// 売上の取り込み(A-01)の「列の対応表」と種類ごとの定数(A-01 01 6.3・7.1・7.4・7.5、02 G04 の項目の表)。
// 【仮】列名・値はすべて仮(00_仮決め一覧 A-01-未-01・A-01-未-02)。POS・CROSS MALL の売上CSVの見本が届いたら、
// このファイルだけを直す(右側の候補の並びに実際の列名を入れる)。候補はどれか1つが見出しにあればよい(前にある候補を優先)。
// CROSS MALL の受注CSVは B-01 と同じファイルなので、列名・ショップ名・キャンセルの値は B-01 の csvMapping.ts の定数を使う
// (B-01 の定数を直せば、こちらも一緒に直る)。DBを読まない定数だけのファイル。
import { CANCEL_STATUS_KEYWORDS, ORDER_COLUMNS, SHOP_RULES } from "@/utils/crossmall/csvMapping";

// 取り込みの項目(02 G04 の表)
export type SalesField =
  | "salesDate"
  | "productCode"
  | "productName"
  | "quantity"
  | "amount"
  | "amountInclTax"
  | "amountExclTax"
  | "unitPrice"
  | "lineCount"
  | "shop"
  | "status";

export type SalesChannel = "store" | "futureshop" | "rakuten" | "yahoo" | "amazon" | "other";

export type SalesKindDef = {
  kind: "sales_pos" | "sales_crossmall";
  label: string;
  // sales_daily.source に書く値
  source: "pos_csv" | "crossmall_csv";
  // 読み替えの表(product_code_aliases)の取り込み元
  aliasSource: "pos" | "crossmall";
  columnMap: Partial<Record<SalesField, readonly string[]>>;
  // 必須の項目(金額は「金額・税込金額・税抜金額・単価」のどれか1つがあればよい。G04)
  required: { field: SalesField; label: string }[];
  options: {
    // 販路を決めておく(POS=店舗)。無ければショップ名を読み替える
    fixedChannel?: SalesChannel;
    // ショップ名 → 販路(値に含まれる文字で上から調べる。どれにも当たらなければエラー。CH-10)
    channelRules?: readonly { keywords: readonly string[]; shop: SalesChannel }[];
    // 状態にこの文字が含まれれば対象外(キャンセルなど)
    excludeStatusKeywords?: readonly string[];
    // このショップ名の行は対象外(POS と CROSS MALL はつながっていないので空。7.4)
    excludeShops?: readonly string[];
    // 「金額」の列が税込か税抜か(7.5。【仮】税込)
    amountTax: "incl" | "excl";
    // 1行が「1日×1商品の集計」のCSVか。true で明細の数の列が無いときは、売れた日を1回と数える(6.1。A-01-仮-09)。
    // false(レシートの明細)なら行の数を明細の数にする
    rowIsDailySummary: boolean;
  };
};

// POS(東芝テック＋Fubic SI CONPHAS)の売上CSV。【仮】列名はすべて仮(No.37 の見本待ち)
export const SALES_POS_KIND: SalesKindDef = {
  kind: "sales_pos",
  label: "POSの売上",
  source: "pos_csv",
  aliasSource: "pos",
  columnMap: {
    salesDate: ["売上日", "日付", "取引日"],
    productCode: ["商品コード", "商品CD"],
    productName: ["商品名"],
    quantity: ["数量", "売上数量"],
    amount: ["金額", "売上金額"],
    amountInclTax: ["税込金額"],
    amountExclTax: ["税抜金額"],
    unitPrice: ["単価"],
    lineCount: ["件数", "明細数"],
  },
  required: [
    { field: "salesDate", label: "売上日" },
    { field: "productCode", label: "商品コード" },
    { field: "quantity", label: "数量" },
  ],
  options: { fixedChannel: "store", amountTax: "incl", rowIsDailySummary: false },
};

// CROSS MALL の受注CSV(過去分)を売上として。列名は B-01 の ORDER_COLUMNS(【仮】No.49 の見本待ち)
export const SALES_CROSSMALL_KIND: SalesKindDef = {
  kind: "sales_crossmall",
  label: "CROSS MALL の受注（過去分）",
  source: "crossmall_csv",
  aliasSource: "crossmall",
  columnMap: {
    salesDate: ORDER_COLUMNS.orderedAt,
    productCode: ORDER_COLUMNS.productCode,
    productName: ORDER_COLUMNS.productName,
    quantity: ORDER_COLUMNS.quantity,
    amount: ORDER_COLUMNS.amount,
    unitPrice: ORDER_COLUMNS.unitPrice,
    shop: ORDER_COLUMNS.shop,
    status: ORDER_COLUMNS.crossmallStatus,
  },
  required: [
    { field: "salesDate", label: "受注日" },
    { field: "productCode", label: "商品コード" },
    { field: "quantity", label: "数量" },
    { field: "shop", label: "ショップ名" },
  ],
  options: {
    channelRules: SHOP_RULES,
    excludeStatusKeywords: CANCEL_STATUS_KEYWORDS,
    excludeShops: [],
    // 【仮】B-01 と同じく、明細の単価・金額は税込として扱う(B-01 01 7.5)
    amountTax: "incl",
    rowIsDailySummary: false,
  },
};

export const SALES_KINDS = [SALES_POS_KIND, SALES_CROSSMALL_KIND] as const;
export type SalesImportKind = SalesKindDef["kind"];

export const salesKindOf = (kind: string): SalesKindDef | null => SALES_KINDS.find((k) => k.kind === kind) ?? null;

// 販路の表示名(02 G01)
export const SALES_CHANNELS: Record<SalesChannel, string> = {
  store: "店舗",
  futureshop: "futureshop",
  rakuten: "楽天",
  yahoo: "Yahoo!",
  amazon: "Amazon",
  other: "その他",
};
export const isSalesChannel = (v: string): v is SalesChannel => Object.hasOwn(SALES_CHANNELS, v);
