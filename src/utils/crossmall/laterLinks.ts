// B-01 から呼ぶ、まだ作っていない機能の入口(B-01 01 7.5・7.6、03 EV-04 手順4-3・手順6、EV-06 手順5)。
// B-02(order_exceptions)は作ったので、orderExceptions.ts を呼ぶ。
// A-01(app_settings・sales_daily)は salesOrders.ts・appSettings.ts、A-05(inventory_kpi_daily)は inventoryKpi.ts を呼ぶ。
import type { TransactionSql } from "@/utils/db";
import { getSalesSettings } from "@/utils/appSettings";
import { recordInventoryKpi as recordInventoryKpiOfA05 } from "@/utils/inventoryKpi";
import { rebuildSalesFromOrders } from "@/utils/salesOrders";
import { ORDER_EXCEPTION_RULES } from "@/utils/orderExceptionRules";
import { detectOrderExceptions as detectOrderExceptionsOfB02, listOrderExceptions } from "@/utils/orderExceptions";

// A-01: 切替日(app_settings のキー sales の crossmall_cutover_date。"YYYY-MM-DD")。
// 未設定なら null(受注から売上を積み上げない。B-01 CH-14)
export const getCrossmallCutoverDate = async (): Promise<string | null> => (await getSalesSettings()).crossmallCutoverDate;

// A-01・B-01 7.5: 注文日(日本時間の "YYYY-MM-DD")ごとに、sales_daily の source = 'orders' の行を作り直す。
// 受注の登録と同じトランザクション(tx)の中で呼ぶ。積み上げなかった組(A-01 の行がある日・商品コード)の警告の文を返す。
// 確認の段階(tx なし)では、書かずに警告の文だけを返す(CH-14)
export const rebuildOrderSales = async (
  tx: TransactionSql | null,
  orderDates: string[],
  cutoverDate: string
): Promise<string[] | null> => rebuildSalesFromOrders(tx, orderDates, cutoverDate);

// B-02 EV-01: 例外注文を調べる(src/utils/orderExceptions.ts)。いまどれかのルールに当たっている注文の数を返す
export const detectOrderExceptions = async (orderIds: string[]): Promise<number | null> =>
  (await detectOrderExceptionsOfB02(orderIds)).exceptionOrders;

// B-02: 注文の未対応の例外の理由の文(「名入れ・刺繍：備考に『刺繍』があります」)。
// 受注の詳細(G02)の例外の枠は B-02 の OrderExceptionPanel で出すので、今はほかから呼ばれていない
export const listOpenOrderExceptions = async (orderId: string): Promise<string[]> =>
  (await listOrderExceptions(orderId)).filter((e) => e.status === "open").map((e) => `${ORDER_EXCEPTION_RULES[e.rule]}：${e.reason}`);

// A-05 EV-06: その日の在庫の指標を記録する(recordInventoryKpi)。記録できたら true
// 在庫を取り込み直した後なので、5分以内の記録があっても計算し直す(CH-01(4) は画面を開いたときの制限)
export const recordInventoryKpi = async (date: string): Promise<boolean | null> =>
  (await recordInventoryKpiOfA05(date, { force: true })).ok;
