// (将来)CROSS MALL の API → 整えた注文・在庫(B-01 01 9章、03 EV-09)。
// 【未】API の有無・仕様はヒアリング No.48 の回答待ち(00_仮決め一覧 B-01-未-02)。今は取り込み元の差し替えの形だけを置く。
// API が使えるようになったら、この関数の中で API を呼び、結果を NormalizedOrder・NormalizedStock にそろえて返す。
// 登録は CSV と同じ関数(orders.ts の applyOrders・inventoryLevels.ts の applyStocks)に渡す(確認の段階は飛ばす)。
// 定期実行は /api/cron/daily(00_共通設計 7.1)の処理の表に登録して呼ぶ。環境変数 CROSSMALL_API_* は仕様が分かってから決める。
import type { NormalizedOrder, NormalizedStock } from "./types";

export type CrossmallApiResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

const NOT_AVAILABLE = "CROSS MALL の API にはまだつないでいません。CSVで取り込んでください。";

// 前回の取り込み以降に更新された注文
export const fetchOrdersFromApi = async (since: Date | null): Promise<CrossmallApiResult<NormalizedOrder>> => {
  void since;
  return { ok: false, error: NOT_AVAILABLE };
};

// 在庫
export const fetchStocksFromApi = async (): Promise<CrossmallApiResult<NormalizedStock>> => ({
  ok: false,
  error: NOT_AVAILABLE,
});
