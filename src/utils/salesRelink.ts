// A-01 の「売上の商品の結び付け直し」(A-01 EV-09 手順2。関数名は A-01 で決める。仮 relinkSalesProducts)。
// CMN-02 は商品の一括登録(EV-12 手順7)と読み替えのコードの追加(EV-22 手順5)の後に呼ぶ。
// 【仮】A-01(sales_daily)はまだ作っていないので、今は何もせず null(結び付け直しをしていない)を返す。
// A-01 を作るときに、この関数の中身を A-01 の処理に置き換える(00_仮決め一覧 CMN02-仮-22)。
export const relinkSalesProducts = async (): Promise<number | null> => null;
