// 売上の取り込み(A-01 G02)の、確認の画面に返す形。登録(upload/route.ts)と画面の部品(SalesImportForm)で使う。
// DBを読まない型と定数だけのファイル。
import type { SalesPreviewRow } from "@/utils/salesImport";

export type SalesImportPreview = {
  batchId: string;
  kindLabel: string;
  fileName: string;
  encodingLabel: string;
  // 2026/10/01（木）〜2026/10/31（土）
  periodLabel: string;
  dataRowCount: number;
  channelLabel: string;
  counts: { add: number; change: number; same: number; delete: number; skip: number; error: number };
  unknownProductCount: number;
  warnings: string[];
  unusedColumns: string[];
  rows: SalesPreviewRow[];
};

export type SalesImportResponse =
  | { ok: true; step: "preview"; preview: SalesImportPreview }
  | { ok: true; step: "applied"; message: string }
  | { ok: false; error: string };
