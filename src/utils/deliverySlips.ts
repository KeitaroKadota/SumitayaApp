// C-01・C-02(納品書・検収)から E-04 が使う関数の入口(E-04 01 5章・8.2、03 の 0.2)。
// 【仮】C-01・C-02 はまだ作っていないので、今は「検収済みの納品書なし」を返し、結び付けも何もしない
// (B-01 の src/utils/crossmall/laterLinks.ts と同じ考え方)。E-04 の突合は、納品書が無いときは「照合できる検収データなし」
// (no_data)として確認待ちにする(勝手に一致扱いにしない。00_仮決め一覧 E-04-仮-10)。
// C-02 を作るときに、この関数の中身を delivery_slips・delivery_slip_lines を読む処理に置き換える(E-04 は変えなくてよい形にしてある)。

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
  // 明細(単価の突合に使う。発注の単価が分かる行だけ)
  lines: { itemCode: string | null; unitPrice: number | null; orderUnitPrice: number | null; purchaseOrderLineId: string | null }[];
};

// その仕入先の、期間(from〜to、"YYYY-MM-DD")に検収済みの納品書。
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
  void supplierId;
  void from;
  void to;
  void excludeInvoiceId;
  return [];
};

// 請求書に結び付いた納品書を記録する(delivery_slips.received_invoice_id。C-01 が持つ列)。
// slipIds が空なら、その請求書との結び付きを外す(取消のとき)
export const linkSlipsToInvoice = async (invoiceId: string, slipIds: string[]): Promise<void> => {
  void invoiceId;
  void slipIds;
};
