// 発注(A-03 01 4.1・6.4・6.5)の決まりと金額の計算(03 の 0.4、04 CH-08・CH-09・CH-12)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は purchaseOrders.ts・purchaseOrdersAdmin.ts。
import type { Rounding } from "@/utils/invoices";

export const PO_STATUSES = {
  draft: "下書き",
  ordered: "発注済み",
  partially_received: "一部入荷",
  received: "入荷済み",
  closed: "打ち切り",
  cancelled: "取消",
} as const;
export type PoStatus = keyof typeof PO_STATUSES;
export const isPoStatus = (v: string): v is PoStatus => Object.hasOwn(PO_STATUSES, v);
// 発注残に数える状態(00_共通設計 7.5)
export const OPEN_PO_STATUSES: PoStatus[] = ["ordered", "partially_received"];

export const SEND_METHODS = { fax: "FAX", email: "メール", web: "Web", phone: "電話", other: "その他" } as const;
export type SendMethod = keyof typeof SEND_METHODS;
export const isSendMethod = (v: string): v is SendMethod => Object.hasOwn(SEND_METHODS, v);

// CH-08 発注の明細の範囲
export const PO_LIMITS = { maxQty: 99_999, maxUnitPrice: 9_999_999, maxNote: 500 } as const;
// CH-12 発注日は今日から30日前まで
export const ORDER_DATE_PAST_DAYS = 30;

// CH-09 状態の移り変わり(表に無い移り変わりはできない)
export type PoOperation = "save" | "print" | "order" | "cancel" | "close";
const ALLOWED: Record<PoOperation, PoStatus[]> = {
  save: ["draft"],
  print: ["draft", "ordered", "partially_received", "received", "closed"],
  order: ["draft"],
  cancel: ["draft"],
  close: ["ordered", "partially_received"],
};
export const canOperate = (status: PoStatus, op: PoOperation): boolean => ALLOWED[op].includes(status);

// 0.4 発注の金額: 明細の金額 ＝ 数 × 単価(税抜)。税は税率ごとに「その税率の金額の合計 × 税率」を出して端数を処理して足す
export type PoTotals = {
  subtotal: number;
  tax: number;
  total: number;
  byRate: { rate: number; amount: number; tax: number }[];
};

const roundBy = (value: number, rounding: Rounding): number =>
  rounding === "ceil" ? Math.ceil(value) : rounding === "round" ? Math.round(value) : Math.floor(value);

export const calcPoTotals = (lines: { quantity: number; unitPrice: number; taxRate: number }[], rounding: Rounding): PoTotals => {
  const byRateMap = new Map<number, number>();
  let subtotal = 0;
  for (const l of lines) {
    const amount = l.quantity * l.unitPrice;
    subtotal += amount;
    byRateMap.set(l.taxRate, (byRateMap.get(l.taxRate) ?? 0) + amount);
  }
  const byRate = [...byRateMap.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, amount]) => ({ rate, amount, tax: roundBy((amount * rate) / 100, rounding) }));
  const tax = byRate.reduce((s, r) => s + r.tax, 0);
  return { subtotal, tax, total: subtotal + tax, byRate };
};

// 発注番号 PO-000123
export const formatPoNo = (seq: number): string => `PO-${String(seq).padStart(6, "0")}`;
