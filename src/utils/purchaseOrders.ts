// A-03 発注(purchase_orders・purchase_order_lines)の、ほかの機能が使う関数(A-03 01 7.1)。
// ・A-03: getOpenQtyByProduct(発注残)
// ・D-02: getIncomingByProduct(入荷予定)
// ・C-02: findOpenPurchaseOrders(照合の相手になる発注を読む)・recordReceipt(入荷済みの数を足し、状態を決める)・
//   cancelReceipt(検収の取消で入荷済みの数を引き、状態を戻す。【仮】C-02 で足した)
// 権限チェックはしない(呼ぶ側の画面・操作で済ませている前提)。発注の画面の処理は purchaseOrdersAdmin.ts。
import { query, queryOn, type TransactionSql } from "@/utils/db";
import { FORECAST_DEFAULTS } from "@/utils/forecast";
import { OPEN_PO_STATUSES, type PoStatus } from "@/utils/purchaseOrderRules";
import { addDays } from "@/utils/salesPeriod";

// ---- 発注残(A-03) ----

// 商品ごとの発注残(状態 ordered・partially_received の明細の quantity − received_qty の合計。0 より小さい明細は 0)。
// productIds を省くと全商品。発注残の無い商品は対応表に入れない
export const getOpenQtyByProduct = async (productIds?: string[], tx?: TransactionSql): Promise<Map<string, number>> => {
  const rows = await queryOn(
    tx,
    (sql) => sql<{ product_id: string; open_qty: number }[]>`
      select l.product_id, sum(greatest(l.quantity - l.received_qty, 0))::int as open_qty
      from purchase_order_lines l join purchase_orders o on o.id = l.purchase_order_id
      where o.status = any(${OPEN_PO_STATUSES}::text[])
        ${productIds ? sql`and l.product_id = any(${productIds}::uuid[])` : sql``}
      group by l.product_id
      having sum(greatest(l.quantity - l.received_qty, 0)) > 0`
  );
  return new Map(rows.map((r) => [r.product_id, r.open_qty]));
};

// ---- 入荷予定(D-02) ----

// 商品ごとの入荷予定(発注残のある明細1行ずつ)
export type IncomingLine = {
  // 発注残の数(quantity − received_qty。0 より大きいものだけ)
  openQty: number;
  // 入荷予定日 "YYYY-MM-DD"(明細の expected_date → 発注の expected_date → 発注日＋リードタイム の順)
  expectedDate: string;
};

// 商品ID → 入荷予定(入荷予定日の早い順)。数えるのは状態が ordered・partially_received の発注だけ(00_共通設計 7.5)。
// 発注残の無い商品は対応表に入れない
export const getIncomingByProduct = async (productIds: string[]): Promise<Map<string, IncomingLine[]>> => {
  if (productIds.length === 0) return new Map();
  const rows = await query(
    (sql) => sql<
      {
        product_id: string;
        open_qty: number;
        line_expected: string | null;
        po_expected: string | null;
        order_date: string | null;
        lead_time_days: number | null;
      }[]
    >`
      select l.product_id, (l.quantity - l.received_qty)::int as open_qty, l.expected_date::text as line_expected,
             o.expected_date::text as po_expected, o.order_date::text as order_date,
             coalesce(p.lead_time_days, s.lead_time_days) as lead_time_days
      from purchase_order_lines l
      join purchase_orders o on o.id = l.purchase_order_id
      join products p on p.id = l.product_id
      left join suppliers s on s.id = o.supplier_id
      where o.status = any(${OPEN_PO_STATUSES}::text[]) and l.product_id = any(${productIds}::uuid[])
        and l.quantity > l.received_qty`
  );
  const result = new Map<string, IncomingLine[]>();
  for (const r of rows) {
    const expectedDate =
      r.line_expected ??
      r.po_expected ??
      (r.order_date ? addDays(r.order_date, r.lead_time_days ?? FORECAST_DEFAULTS.defaultLeadTimeDays) : null);
    if (!expectedDate) continue;
    result.set(r.product_id, [...(result.get(r.product_id) ?? []), { openQty: r.open_qty, expectedDate }]);
  }
  for (const lines of result.values()) lines.sort((a, b) => (a.expectedDate < b.expectedDate ? -1 : a.expectedDate > b.expectedDate ? 1 : 0));
  return result;
};

// ---- 照合の相手になる発注(C-02) ----

export type OpenPurchaseOrderLine = {
  id: string;
  lineNo: number;
  productId: string;
  supplierItemCode: string | null;
  productName: string;
  quantity: number;
  // 単価(税抜・自社の単位あたり)
  unitPrice: number;
  taxRate: number;
  receivedQty: number;
  // 発注残(quantity − received_qty。0 より小さければ 0)
  openQty: number;
  expectedDate: string | null;
};

export type OpenPurchaseOrder = {
  id: string;
  orderNo: string;
  supplierId: string;
  status: PoStatus;
  orderDate: string | null;
  expectedDate: string | null;
  lines: OpenPurchaseOrderLine[];
};

// C-02 の照合に使える発注(状態 ordered・partially_received)を、仕入先で(発注番号があればその番号で)読む。発注日の新しい順
export const findOpenPurchaseOrders = async (
  { supplierId, orderNo }: { supplierId: string; orderNo?: string },
  tx?: TransactionSql
): Promise<OpenPurchaseOrder[]> => {
  const orders = await queryOn(
    tx,
    (sql) => sql<{ id: string; order_no: string; supplier_id: string; status: PoStatus; order_date: string | null; expected_date: string | null }[]>`
      select id, order_no, supplier_id, status, order_date::text as order_date, expected_date::text as expected_date
      from purchase_orders
      where supplier_id = ${supplierId} and status = any(${OPEN_PO_STATUSES}::text[])
        ${orderNo ? sql`and order_no = ${orderNo.trim()}` : sql``}
      order by order_date desc nulls last, order_no desc`
  );
  if (orders.length === 0) return [];
  const lines = await getPurchaseOrderLines(orders.map((o) => o.id), tx);
  return orders.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    supplierId: o.supplier_id,
    status: o.status,
    orderDate: o.order_date,
    expectedDate: o.expected_date,
    lines: lines.get(o.id) ?? [],
  }));
};

// 発注ID → 明細(行の番号の順)
export const getPurchaseOrderLines = async (
  purchaseOrderIds: string[],
  tx?: TransactionSql
): Promise<Map<string, OpenPurchaseOrderLine[]>> => {
  if (purchaseOrderIds.length === 0) return new Map();
  const rows = await queryOn(
    tx,
    (sql) => sql<
      {
        id: string;
        purchase_order_id: string;
        line_no: number;
        product_id: string;
        supplier_item_code: string | null;
        product_name: string;
        quantity: number;
        unit_price: number;
        tax_rate: number;
        received_qty: number;
        expected_date: string | null;
      }[]
    >`
      select id, purchase_order_id, line_no, product_id, supplier_item_code, product_name, quantity, unit_price, tax_rate,
             received_qty, expected_date::text as expected_date
      from purchase_order_lines where purchase_order_id = any(${purchaseOrderIds}::uuid[])
      order by purchase_order_id, line_no`
  );
  const result = new Map<string, OpenPurchaseOrderLine[]>();
  for (const r of rows) {
    const line: OpenPurchaseOrderLine = {
      id: r.id,
      lineNo: r.line_no,
      productId: r.product_id,
      supplierItemCode: r.supplier_item_code,
      productName: r.product_name,
      quantity: r.quantity,
      unitPrice: r.unit_price,
      taxRate: r.tax_rate,
      receivedQty: r.received_qty,
      openQty: Math.max(0, r.quantity - r.received_qty),
      expectedDate: r.expected_date,
    };
    result.set(r.purchase_order_id, [...(result.get(r.purchase_order_id) ?? []), line]);
  }
  return result;
};

// ---- 入荷の記録(C-02) ----

export type RecordReceiptResult = { purchaseOrderId: string; status: PoStatus };

// C-02 の検収のトランザクション(tx)の中で呼ぶ。明細の received_qty に受け入れた数を足し、発注のすべての明細を見て
// 状態を partially_received(一部入荷)・received(すべて入荷)にする(04 CH-09。ordered・partially_received のときだけ)。
// 発注を FOR UPDATE で読んでから確かめる。決まりに合わなければ例外を投げる(呼ぶ側でロールバックする)
export const recordReceipt = async (lineId: string, receivedQty: number, tx: TransactionSql): Promise<RecordReceiptResult> => {
  if (!Number.isInteger(receivedQty) || receivedQty <= 0) throw new Error("受け入れる数は1以上の整数にしてください");
  const [line] = await tx<{ purchase_order_id: string }[]>`select purchase_order_id from purchase_order_lines where id = ${lineId}`;
  if (!line) throw new Error("発注の明細が見つかりません");
  const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${line.purchase_order_id} for update`;
  if (!po || !OPEN_PO_STATUSES.includes(po.status)) throw new Error("この発注は入荷を記録できる状態ではありません");
  await tx`update purchase_order_lines set received_qty = received_qty + ${receivedQty} where id = ${lineId}`;
  const [agg] = await tx<{ all_received: boolean }[]>`
    select bool_and(received_qty >= quantity) as all_received from purchase_order_lines where purchase_order_id = ${line.purchase_order_id}`;
  const status: PoStatus = agg?.all_received ? "received" : "partially_received";
  await tx`update purchase_orders set status = ${status} where id = ${line.purchase_order_id}`;
  return { purchaseOrderId: line.purchase_order_id, status };
};

// C-02 の検収の取消(C-02 03 EV-08)のトランザクション(tx)の中で呼ぶ。明細の received_qty から取り消す数を引き、
// 発注のすべての明細を見て状態を ordered(すべて0)・partially_received・received に戻す。
// 【仮】A-03 の CH-09 に「入荷の取消」の移り変わりがまだ無いので、C-02 01 9章 #9 の案のとおりに作った(00_仮決め一覧 C-02-仮-12)。
// 取り消せるのは partially_received・received のときだけ(打ち切り・取消の発注は戻さない)。決まりに合わなければ例外を投げる
export const cancelReceipt = async (lineId: string, qty: number, tx: TransactionSql): Promise<RecordReceiptResult> => {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("取り消す数は1以上の整数にしてください");
  const [line] = await tx<{ purchase_order_id: string }[]>`select purchase_order_id from purchase_order_lines where id = ${lineId}`;
  if (!line) throw new Error("発注の明細が見つかりません");
  const [po] = await tx<{ status: PoStatus }[]>`select status from purchase_orders where id = ${line.purchase_order_id} for update`;
  if (!po || (po.status !== "partially_received" && po.status !== "received"))
    throw new Error("この発注は入荷を取り消せる状態ではありません");
  const updated = await tx<{ id: string }[]>`
    update purchase_order_lines set received_qty = received_qty - ${qty}
    where id = ${lineId} and received_qty >= ${qty} returning id`;
  if (updated.length === 0) throw new Error("取り消す数が入荷済みの数より多くなっています");
  const [agg] = await tx<{ none_received: boolean; all_received: boolean }[]>`
    select bool_and(received_qty = 0) as none_received, bool_and(received_qty >= quantity) as all_received
    from purchase_order_lines where purchase_order_id = ${line.purchase_order_id}`;
  const status: PoStatus = agg?.none_received ? "ordered" : agg?.all_received ? "received" : "partially_received";
  await tx`update purchase_orders set status = ${status} where id = ${line.purchase_order_id}`;
  return { purchaseOrderId: line.purchase_order_id, status };
};
