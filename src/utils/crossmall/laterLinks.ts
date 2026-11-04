// B-01 から呼ぶ、まだ作っていない機能の入口(B-01 01 7.5・7.6、03 EV-04 手順4-3・手順6、EV-06 手順5)。
// 【仮】A-01(app_settings・sales_daily)・B-02(order_exceptions)・A-05(inventory_kpi_daily)はまだ作っていないので、
// 今はどれも何もせず null(「していない」)を返す。B-01 の取り込みは、null のときはその処理を飛ばして結果の文から省く。
// それぞれの機能を作るときに、この関数の中身をその機能の処理に置き換える(00_仮決め一覧 B-01-仮-14)。
import type { TransactionSql } from "@/utils/db";

// A-01: 切替日(app_settings のキー sales の crossmall_cutover_date。"YYYY-MM-DD")。
// 未設定なら null(受注から売上を積み上げない。B-01 CH-14)
export const getCrossmallCutoverDate = async (): Promise<string | null> => null;

// A-01・B-01 7.5: 注文日(日本時間の "YYYY-MM-DD")ごとに、sales_daily の source = 'orders' の行を作り直す。
// 受注の登録と同じトランザクション(tx)の中で呼ぶ。積み上げなかった組(A-01 の行がある日・商品コード)の警告の文を返す。
// 確認の段階(tx なし)では、書かずに警告の文だけを返す(CH-14)
export const rebuildOrderSales = async (
  tx: TransactionSql | null,
  orderDates: string[],
  cutoverDate: string
): Promise<string[] | null> => {
  void tx;
  void orderDates;
  void cutoverDate;
  return null;
};

// B-02 EV-01: 例外注文を調べる(detectOrderExceptions。src/utils/orderExceptions.ts に作る予定)。例外になった注文の数を返す
export const detectOrderExceptions = async (orderIds: string[]): Promise<number | null> => {
  void orderIds;
  return null;
};

// B-02: 注文の未対応の例外(G02 の「例外（B-02）」の枠に出す理由の文)
export const listOpenOrderExceptions = async (orderId: string): Promise<string[]> => {
  void orderId;
  return [];
};

// A-05 EV-06: その日の在庫の指標を記録する(recordInventoryKpi)。記録できたら true
export const recordInventoryKpi = async (date: string): Promise<boolean | null> => {
  void date;
  return null;
};
