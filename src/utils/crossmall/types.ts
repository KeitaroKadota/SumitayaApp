// 取り込み元(CSV・将来の API)に関係ない「整えた注文」「整えた在庫」の形(B-01 01 7.1・9章)。
// csvSource.ts(将来は apiSource.ts も)がこの形にそろえ、orders.ts・inventoryLevels.ts の登録の処理に渡す。
// DBを読まない型だけのファイル。

export const SHOPS = ["futureshop", "rakuten", "yahoo", "amazon", "other"] as const;
export type Shop = (typeof SHOPS)[number];

export const SHOP_LABELS: Record<Shop, string> = {
  futureshop: "自社ショップ",
  rakuten: "楽天",
  yahoo: "Yahoo!",
  amazon: "Amazon",
  other: "その他",
};

export const isShop = (value: string): value is Shop => (SHOPS as readonly string[]).includes(value);

export type PaymentStatus = "paid" | "unpaid" | "unknown";

export type NormalizedOrderItem = {
  lineNo: number;
  productCode: string;
  productName: string;
  optionText: string | null;
  hasCustomization: boolean;
  customizationText: string | null;
  quantity: number;
  unitPrice: number;
  amount: number;
};

export type NormalizedOrder = {
  crossmallOrderNo: string;
  shop: Shop;
  shopOrderNo: string | null;
  orderedAt: Date;
  crossmallStatus: string | null;
  isCancelled: boolean;
  // "YYYY-MM-DD"
  shippedOn: string | null;
  customerName: string;
  customerKana: string;
  customerEmail: string | null;
  customerPhone: string | null;
  customerPhoneDigits: string | null;
  shipName: string;
  shipPostalCode: string | null;
  shipPrefecture: string | null;
  shipAddress1: string | null;
  shipAddress2: string | null;
  shipPhone: string | null;
  paymentMethod: string | null;
  paymentStatus: PaymentStatus;
  // "YYYY-MM-DD"
  requestedDeliveryDate: string | null;
  customerNote: string | null;
  subtotal: number;
  shippingFee: number;
  discount: number;
  tax: number;
  total: number;
  items: NormalizedOrderItem[];
  // 取り込んだ元の行(列名→値)。CSVの1注文が複数の行なら行ごと
  rawRows: Record<string, string>[];
};

export type NormalizedStock = {
  productCode: string;
  locationCode: string;
  quantity: number;
  allocatedQuantity: number | null;
  availableQuantity: number | null;
};
