// ABC分析のランクの決め方(A-02 01 4.1、03 の 0.1 calcAbc)。DBを読まない計算だけのファイル。
// 境目・期間・新商品の日数は、設定画面を作らずここの定数 ABC_SETTINGS の1か所に置く
// (【仮】00_仮決め一覧 A-02-仮-01〜03。変えるときは開発者が直す)。

export type AbcRank = "A" | "B" | "C";
export const ABC_RANKS: AbcRank[] = ["A", "B", "C"];

export const ABC_SETTINGS = {
  // 手前までの累積の割合(%)がこれ未満なら A、次の値未満なら B、それ以外は C
  amountThresholds: { a: 70, b: 90 },
  frequencyThresholds: { a: 70, b: 90 },
  // 期間の既定(直近12か月。終わりは先月末)
  periodMonths: 12,
  // 登録からこの日数たっていない商品は「新商品」
  newProductDays: 90,
  // 移行日。この日までに登録した商品(実データの一括の取り込みで入れた商品)は新商品にしない(01 の 4.1 の 6)。
  // 開発DBは 2026-11-26 に取り込んだ。本番に移すときは本番の取り込みの日に直す(00_仮決め一覧 A-02-仮-03)
  migrationDate: "2026-11-26",
} as const;

// 新商品か: 登録が移行日より後で、かつ「今日 − 新商品の日数」より後
export const isNewProductOn = (createdOn: string, newSince: string, settings = ABC_SETTINGS): boolean =>
  createdOn > settings.migrationDate && createdOn > newSince;

export type AbcInput = {
  productId: string | null;
  productCode: string;
  amount: number;
  quantity: number;
  frequency: number;
  // 計算した時点の商品マスタのランク
  currentRank: AbcRank | null;
  isNewProduct: boolean;
};

export type AbcResult = AbcInput & {
  amountShare: number;
  amountCumShare: number;
  frequencyCumShare: number;
  amountRank: AbcRank;
  frequencyRank: AbcRank;
  rank: AbcRank;
};

export type AbcSummary = {
  A: number;
  B: number;
  C: number;
  // 前回からランクが変わった商品(マスタにある商品だけ)
  changed: number;
  up: number;
  down: number;
  unlinked: number;
  newProducts: number;
};

const SCORE: Record<AbcRank, number> = { A: 3, B: 2, C: 1 };

// 手順4 総合のランク: 点数(A=3・B=2・C=1)の合計が5以上なら A、4なら B、3以下なら C
export const combineRanks = (amount: AbcRank, frequency: AbcRank): AbcRank => {
  const total = SCORE[amount] + SCORE[frequency];
  return total >= 5 ? "A" : total === 4 ? "B" : "C";
};

// 手順2・3: 多い順に並べ、手前までの累積の割合で A・B・C を付ける。全体が0なら全商品 C
const rankBy = (
  items: { key: number; value: number; tie: number; code: string }[],
  thresholds: { a: number; b: number }
): Map<number, { cum: number; share: number; rank: AbcRank }> => {
  const sorted = [...items].sort((x, y) => y.value - x.value || y.tie - x.tie || (x.code < y.code ? -1 : x.code > y.code ? 1 : 0));
  const total = sorted.reduce((s, i) => s + i.value, 0);
  const result = new Map<number, { cum: number; share: number; rank: AbcRank }>();
  let running = 0;
  for (const i of sorted) {
    const cum = total > 0 ? (running / total) * 100 : 100;
    const share = total > 0 ? (i.value / total) * 100 : 0;
    const rank: AbcRank = total <= 0 ? "C" : cum < thresholds.a ? "A" : cum < thresholds.b ? "B" : "C";
    result.set(i.key, { cum, share, rank });
    running += i.value;
  }
  return result;
};

// 0.1 calcAbc
export const calcAbc = (inputs: AbcInput[], settings = ABC_SETTINGS): { results: AbcResult[]; summary: AbcSummary } => {
  // 手順1 マイナスは0にする
  const items = inputs.map((i, key) => ({ ...i, amount: Math.max(0, i.amount), frequency: Math.max(0, i.frequency), key }));
  const byAmount = rankBy(
    items.map((i) => ({ key: i.key, value: i.amount, tie: i.frequency, code: i.productCode })),
    settings.amountThresholds
  );
  const byFrequency = rankBy(
    items.map((i) => ({ key: i.key, value: i.frequency, tie: i.amount, code: i.productCode })),
    settings.frequencyThresholds
  );

  const results: AbcResult[] = items.map(({ key, ...i }) => {
    const a = byAmount.get(key) as { cum: number; share: number; rank: AbcRank };
    const f = byFrequency.get(key) as { cum: number; share: number; rank: AbcRank };
    // 手順5・6 新商品は前のランク、無ければ B
    const rank = i.isNewProduct ? (i.currentRank ?? "B") : combineRanks(a.rank, f.rank);
    return {
      ...i,
      amountShare: a.share,
      amountCumShare: a.cum,
      frequencyCumShare: f.cum,
      amountRank: a.rank,
      frequencyRank: f.rank,
      rank,
    };
  });

  // 手順7 件数
  const summary: AbcSummary = { A: 0, B: 0, C: 0, changed: 0, up: 0, down: 0, unlinked: 0, newProducts: 0 };
  for (const r of results) {
    summary[r.rank]++;
    if (!r.productId) summary.unlinked++;
    if (r.isNewProduct) summary.newProducts++;
    if (r.productId && r.currentRank !== r.rank) {
      summary.changed++;
      if (r.currentRank && SCORE[r.rank] > SCORE[r.currentRank]) summary.up++;
      if (r.currentRank && SCORE[r.rank] < SCORE[r.currentRank]) summary.down++;
    }
  }
  return { results, summary };
};
