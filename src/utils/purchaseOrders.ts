// A-03 発注(purchase_orders・purchase_order_lines)の、ほかの機能が使う関数(A-03 01 7.1)。
// 【仮】A-03 はまだ作っていないので、今は「発注のデータなし」(空の対応表)を返すだけにしている(00_仮決め一覧 D-02-仮-14)。
// D-02 は、入荷予定が無い商品を「未発注」として扱う(届くまでの日数があれば入荷見込日、無ければ「確認してご連絡」)。
// A-03 を作るときに、この関数の中身を発注のテーブルを読む処理に置き換える(呼ぶ側の D-02 は変えなくてよい形にしてある)。

// 商品ごとの入荷予定(発注残のある明細1行ずつ)
export type IncomingLine = {
  // 発注残の数(quantity − received_qty。0 より大きいものだけ)
  openQty: number;
  // 入荷予定日 "YYYY-MM-DD"(明細の expected_date → 発注の expected_date → 発注日＋リードタイム の順。A-03 が決める)
  expectedDate: string;
};

// 商品ID → 入荷予定(入荷予定日の早い順)。数えるのは状態が ordered・partially_received の発注だけ(00_共通設計 7.5)。
// 発注残の無い商品は対応表に入れない
export const getIncomingByProduct = async (productIds: string[]): Promise<Map<string, IncomingLine[]>> => {
  void productIds;
  return new Map();
};
