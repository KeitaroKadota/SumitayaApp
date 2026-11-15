// C-02(発注との照合・検収)から E-04 が使う関数(C-02 01 8章・03 EV-10・04 CH-11、E-04 01 5章・8.2)。
// E-04 の呼び方は C-02 を作る前のまま残し、中身を delivery_slips・delivery_slip_lines を読み書きする処理に置き換えた。
// 権限のチェックは呼ぶ側(E-04 の payables)で行う。
import { query, transaction } from "@/utils/db";

// 検収済みの納品書(税込の合計で請求書と比べる)
export type AcceptedSlip = {
  id: string;
  slipNo: string | null;
  // 納品日 "YYYY-MM-DD"
  deliveryDate: string;
  // 税抜・税額・税込
  subtotal: number;
  tax: number;
  total: number;
  // 明細の金額が税込で書かれているか・結び付けた発注・照合の結果のまとめ(C-02 01 8章)
  taxIncluded?: boolean;
  purchaseOrderId?: string | null;
  matchStatus?: string | null;
  // 単価の違いを人が認めて検収したか(E-04 で目立たせてもらう。C-02 01 8章)
  priceDiffApproved?: boolean;
  receivedInvoiceId?: string | null;
  // 明細(在庫にしない品も含む。発注の単価が分からない行は orderUnitPrice が空)
  lines: {
    itemCode: string | null;
    unitPrice: number | null;
    orderUnitPrice: number | null;
    purchaseOrderLineId: string | null;
    itemName?: string;
    quantity?: number | null;
    amount?: number | null;
    productId?: string | null;
  }[];
};

// その仕入先の、期間(from〜to、"YYYY-MM-DD")に納品された検収済みの納品書(納品日の順)。
// ほかの請求書(取消を除く)に結び付いている納品書は外す(excludeInvoiceId の請求書に結び付いているものは含める。CH-12)
export const listAcceptedSlips = async ({
  supplierId,
  from,
  to,
  excludeInvoiceId,
}: {
  supplierId: string;
  from: string;
  to: string;
  excludeInvoiceId: string;
}): Promise<AcceptedSlip[]> => {
  const slips = await query(
    (sql) => sql<
      {
        id: string;
        slip_no: string | null;
        delivery_date: string;
        subtotal: number | null;
        tax: number | null;
        total: number | null;
        tax_included: boolean;
        purchase_order_id: string | null;
        match_status: string | null;
        received_invoice_id: string | null;
      }[]
    >`
      select d.id, d.slip_no, to_char(d.delivery_date, 'YYYY-MM-DD') as delivery_date, d.subtotal, d.tax, d.total,
             d.tax_included, d.purchase_order_id, d.match_status, d.received_invoice_id
      from delivery_slips d
      left join received_invoices r on r.id = d.received_invoice_id
      where d.status = 'accepted' and d.supplier_id = ${supplierId}
        and d.delivery_date between ${from}::date and ${to}::date
        and (d.received_invoice_id is null or d.received_invoice_id = ${excludeInvoiceId} or r.status = 'cancelled')
      order by d.delivery_date, d.slip_no nulls last, d.created_at`
  );
  if (slips.length === 0) return [];
  const lines = await query(
    (sql) => sql<
      {
        slip_id: string;
        supplier_item_code: string | null;
        item_name: string;
        quantity: number | null;
        unit_price: number | null;
        amount: number | null;
        product_id: string | null;
        expected_unit_price: number | null;
        purchase_order_line_id: string | null;
        match_result: string | null;
      }[]
    >`
      select slip_id, supplier_item_code, item_name, quantity::float8 as quantity, unit_price, amount, product_id,
             expected_unit_price, purchase_order_line_id, match_result
      from delivery_slip_lines where slip_id = any(${slips.map((s) => s.id)}::uuid[])
      order by slip_id, line_no`
  );
  return slips.map((s) => {
    const own = lines.filter((l) => l.slip_id === s.id);
    return {
      id: s.id,
      slipNo: s.slip_no,
      deliveryDate: s.delivery_date,
      subtotal: s.subtotal ?? 0,
      tax: s.tax ?? 0,
      total: s.total ?? 0,
      taxIncluded: s.tax_included,
      purchaseOrderId: s.purchase_order_id,
      matchStatus: s.match_status,
      // EV-10: 単価差(price_diff)の明細があるのに人が検収したもの
      priceDiffApproved: s.match_status === "reviewed" && own.some((l) => l.match_result === "price_diff"),
      receivedInvoiceId: s.received_invoice_id,
      lines: own.map((l) => ({
        itemCode: l.supplier_item_code,
        unitPrice: l.unit_price,
        orderUnitPrice: l.expected_unit_price,
        purchaseOrderLineId: l.purchase_order_line_id,
        itemName: l.item_name,
        quantity: l.quantity,
        amount: l.amount,
        productId: l.product_id,
      })),
    };
  });
};

// 請求書に結び付いた納品書を記録する(delivery_slips.received_invoice_id。C-01 が持つ列)。
// slipIds にない納品書でその請求書に結び付いていたものは外す(slipIds が空なら、その請求書との結び付きをすべて外す。取消のとき)。
// CH-11: 結び付けるのは、検収済みで、まだどの請求書にも結び付いていない(または同じ請求書の)、請求書と同じ仕入先の納品書だけ
// (満たさない納品書は結び付けずに飛ばす)
export const linkSlipsToInvoice = async (invoiceId: string, slipIds: string[]): Promise<void> => {
  const ids = [...new Set(slipIds)];
  await transaction(async (tx) => {
    await tx`
      update delivery_slips set received_invoice_id = null
      where received_invoice_id = ${invoiceId} and not (id = any(${ids}::uuid[]))`;
    if (ids.length === 0) return;
    await tx`
      update delivery_slips d set received_invoice_id = ${invoiceId}
      from received_invoices r
      where r.id = ${invoiceId} and d.id = any(${ids}::uuid[]) and d.status = 'accepted'
        and d.supplier_id = r.supplier_id
        and (d.received_invoice_id is null or d.received_invoice_id = ${invoiceId})`;
  });
};
