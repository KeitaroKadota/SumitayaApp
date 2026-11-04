// 商品のCSV取り込み(G06)の、サーバーと画面の間でやりとりする形。DBを読まないファイル。
import type { ProductPreviewRow } from "@/utils/productCsv";

export type ProductImportPreview = {
  batchId: string;
  fileName: string;
  encodingLabel: string;
  dataRowCount: number;
  counts: { add: number; update: number; same: number; error: number };
  unusedColumns: string[];
  // 文字化けしているかもしれないときの注意(A-01 CH-03)
  warnings: string[];
  rows: ProductPreviewRow[];
};

export type ProductImportResponse =
  | { ok: true; step: "preview"; preview: ProductImportPreview }
  | { ok: true; step: "applied"; redirectTo: string }
  | { ok: false; error: string };
