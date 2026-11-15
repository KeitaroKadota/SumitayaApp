// 発注の数の計算(A-03 01 4.2 の手順7〜13、03 の 0.3 planReplenishment)。DBを読まない計算だけのファイル。
// 仮の値は forecast.ts の FORECAST_DEFAULTS を使う。
import type { AbcRank } from "@/utils/abc";
import { FORECAST_DEFAULTS } from "@/utils/forecast";

export type ReplenishmentInput = {
  abcRank: AbcRank | null;
  // 週ごとの予測の数(予測を始める週から順に)
  weeklyForecast: number[];
  onHandQty: number;
  onOrderQty: number;
  productLeadTimeDays: number | null;
  supplierId: string | null;
  supplierLeadTimeDays: number | null;
  isInHouse: boolean;
  orderLot: number | null;
  minOrderQty: number | null;
};

export type ReplenishmentPlan = {
  destination: "purchase" | "production" | "no_supplier";
  leadTimeDays: number;
  reviewWeeks: number;
  onHandQty: number;
  onOrderQty: number;
  leadTimeDemand: number;
  // (リードタイム＋発注の間隔)の間の予測と、1週あたりの予測(G02 の説明に使う)
  coverDemand: number;
  weeklyDemand: number;
  safetyWeeks: number;
  safetyStock: number;
  reorderPoint: number;
  suggestedQty: number;
  // 切り上げる前の数(G02 の説明に使う)
  rawQty: number;
  reason: string;
};

// 手順2 今日から N 日の予測(週ごとの予測を日数で割り振って足す。予測する週数より長いときは最後の週を続けて使う)
export const demandOverDays = (weekly: number[], days: number): number => {
  if (weekly.length === 0 || days <= 0) return 0;
  let total = 0;
  let rest = days;
  for (let i = 0; rest > 0; i++) {
    const w = weekly[Math.min(i, weekly.length - 1)];
    total += w * Math.min(1, rest / 7);
    rest -= 7;
  }
  return total;
};

export const planReplenishment = (input: ReplenishmentInput, d = FORECAST_DEFAULTS): ReplenishmentPlan => {
  const rank: AbcRank = input.abcRank ?? "B";
  // 手順7(1) リードタイム: 商品 → 仕入先 → 既定
  const leadTimeDays = input.productLeadTimeDays ?? input.supplierLeadTimeDays ?? d.defaultLeadTimeDays;
  const reviewWeeks = d.reviewWeeks[rank];
  const coverDays = leadTimeDays + reviewWeeks * 7;
  // (2) リードタイムの間・(リードタイム＋発注の間隔)の間の予測
  const leadTimeDemand = Math.round(demandOverDays(input.weeklyForecast, leadTimeDays));
  const coverDemand = Math.round(demandOverDays(input.weeklyForecast, coverDays));
  // (3) 安全在庫 ＝ 1週あたりの予測 × 安全の週数(切り上げ)
  const weeklyDemand = coverDays > 0 ? coverDemand / (coverDays / 7) : 0;
  const safetyWeeks = d.safetyWeeks[rank];
  const safetyStock = Math.ceil(weeklyDemand * safetyWeeks);
  // (4) 発注点
  const reorderPoint = leadTimeDemand + safetyStock;
  // (5) 使える在庫(在庫数がマイナスなら0)
  const onHandQty = Math.max(0, input.onHandQty);
  const available = onHandQty + input.onOrderQty;
  // (9) 行き先
  const destination: ReplenishmentPlan["destination"] = input.isInHouse ? "production" : input.supplierId ? "purchase" : "no_supplier";
  const base = {
    destination,
    leadTimeDays,
    reviewWeeks,
    onHandQty,
    onOrderQty: input.onOrderQty,
    leadTimeDemand,
    coverDemand,
    weeklyDemand: Math.round(weeklyDemand * 10) / 10,
    safetyWeeks,
    safetyStock,
    reorderPoint,
  };

  // (6) 在庫が足りている
  if (available > reorderPoint)
    return { ...base, suggestedQty: 0, rawQty: 0, reason: `使える在庫 ${available} が発注点 ${reorderPoint} より多いため発注しません（在庫が足りています）` };
  // (7) C ランクで次の期間の予測が0
  if (rank === "C" && coverDemand === 0)
    return { ...base, suggestedQty: 0, rawQty: 0, reason: "C ランクで次の期間の予測が0のため発注しません" };
  // (8) 提案数。発注の単位の倍数に切り上げ、最低の発注数より少なければ最低の発注数
  const rawQty = coverDemand + safetyStock - available;
  if (rawQty <= 0)
    return { ...base, suggestedQty: 0, rawQty, reason: `使える在庫 ${available} が発注点 ${reorderPoint} 以下ですが、次の期間の予測の分はあるため発注しません` };
  const lot = input.orderLot ?? 1;
  let qty = Math.ceil(rawQty / lot) * lot;
  if (input.minOrderQty && qty < input.minOrderQty) qty = input.minOrderQty;
  return { ...base, suggestedQty: qty, rawQty, reason: `使える在庫 ${available} が発注点 ${reorderPoint} 以下のため` };
};
