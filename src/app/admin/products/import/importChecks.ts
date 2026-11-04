// 商品のCSV取り込みのチェック(CMN-02 CH-20・CH-24・CH-25)。登録(route.ts)と取消(actions.ts)で使う。
import type { CurrentEmployee } from "@/utils/auth";
import type { ImportBatch } from "@/utils/csvImport/batches";
import { PRODUCT_CSV_MAX_ROWS } from "@/utils/productCsv";

// 【仮】確認してから登録できるまでの時間(00_仮決め一覧 CMN02-仮-14)
export const PREVIEW_VALID_HOURS = 24;

// CH-20・CH-24
export const PRODUCT_CSV_READ_OPTIONS = {
  extensions: [".csv"],
  fileError: "CSVファイル（4MBまで）を選んでください。",
  maxRows: PRODUCT_CSV_MAX_ROWS,
  maxRowsError: `1回に取り込めるのは${PRODUCT_CSV_MAX_ROWS.toLocaleString("ja-JP")}行までです。ファイルを分けてください。`,
};

// CH-25 取り込みの記録が「確認中」で、種類が products、確認した本人か社長、24時間以内。
// 指紋の確認は登録のときに別に行う。だめなときは画面に出す文を返す
export const checkPreviewBatch = (batch: ImportBatch | null, me: CurrentEmployee, now: Date): string | null => {
  if (!batch || batch.kind !== "products") return "もう一度『内容を確認する』を押してください。";
  if (batch.status !== "previewed") return "この取り込みはすでに登録済み・取消済みです。";
  if (batch.createdBy !== me.id && !me.roles.includes("president"))
    return "ほかの人が確認中の取り込みです。もう一度『内容を確認する』を押してください。";
  if (now.getTime() - batch.createdAt.getTime() > PREVIEW_VALID_HOURS * 60 * 60 * 1000)
    return "確認してから時間がたちました。もう一度『内容を確認する』を押してください。";
  return null;
};
