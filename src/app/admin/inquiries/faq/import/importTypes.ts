// よくある質問のCSV取り込み(G04)の、サーバーと画面の間でやりとりする形。DBを読まないファイル。
import type { FaqPreviewRow } from "@/utils/faqCsv";

export type FaqImportPreview = {
  batchId: string;
  fileName: string;
  encodingLabel: string;
  dataRowCount: number;
  counts: { add: number; update: number; error: number };
  unusedColumns: string[];
  // 文字化けしているかもしれないときの注意(A-01 CH-03)
  warnings: string[];
  rows: FaqPreviewRow[];
};

export type FaqImportResponse =
  | { ok: true; step: "preview"; preview: FaqImportPreview }
  | { ok: true; step: "applied"; redirectTo: string }
  | { ok: false; error: string };
