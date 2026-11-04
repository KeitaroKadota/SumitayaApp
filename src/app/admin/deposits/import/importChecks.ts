// 銀行の明細CSVの取り込みの共通のチェックと、確認の画面に返す形(E-06 03 EV-02・EV-03、04 CH-02。
// A-01 の共通の取り込みの「確認中の記録」の確かめ方と同じ)。登録(upload/route.ts)と「やり直す」(actions.ts)で使う。
import type { CurrentEmployee } from "@/utils/auth";
import type { ImportBatch } from "@/utils/csvImport/batches";
import { BANK_CSV_MAX_ROWS } from "@/utils/bankCsv";
// 【仮】確認してから登録できるまでの時間は、商品の取り込みと同じ値を使う(00_仮決め一覧 CMN02-仮-14)
import { PREVIEW_VALID_HOURS } from "@/app/admin/products/import/importChecks";

// ファイルの種類・大きさ(4MB は共通の readUploadedCsv が見る)。CH-03 の件数は 5,000行まで
export const BANK_READ_OPTIONS = {
  extensions: [".csv", ".txt"],
  fileError: "CSVファイル（4MBまで）を選んでください。",
  maxRows: BANK_CSV_MAX_ROWS,
  maxRowsError: `1回に取り込めるのは${BANK_CSV_MAX_ROWS.toLocaleString("ja-JP")}行までです。ファイルを分けてください。`,
};

// EV-02 手順2 で読めなかったとき
export const READ_FAILED = "ファイルを読み取れませんでした。ネットバンキングからダウンロードしたCSVか確かめてください。";

// 取り込みの記録が「確認中」で、種類が合っていて、確認した本人か社長、24時間以内。だめなときは画面に出す文を返す
export const checkBankPreviewBatch = (batch: ImportBatch | null, me: CurrentEmployee, now: Date): string | null => {
  if (!batch || batch.kind !== "bank_transactions") return "この取り込みは登録できません。もう一度『内容を確認する』を押してください。";
  if (batch.status !== "previewed") return "この取り込みはすでに登録済み・取消済みです。";
  if (batch.createdBy !== me.id && !me.roles.includes("president"))
    return "ほかの人が確認中の取り込みです。もう一度『内容を確認する』を押してください。";
  if (now.getTime() - batch.createdAt.getTime() > PREVIEW_VALID_HOURS * 60 * 60 * 1000)
    return "確認してから時間がたちました。もう一度『内容を確認する』を押してください。";
  return null;
};

// 確認の画面の行(先頭の20件)
export type BankPreviewRow = {
  line: number;
  dateLabel: string;
  description: string;
  deposit: number;
  withdrawal: number;
  balance: number | null;
  statusLabel: string;
};

export type BankImportPreview = {
  batchId: string;
  fileName: string;
  encodingLabel: string;
  formatLabel: string;
  // 件数の行(「32件（入金 12件・出金 20件）　うち取り込み済み 5件（取り込まない）」など)
  summary: string[];
  warnings: string[];
  errorCount: number;
  // エラーの行の文(「18行目: 金額が読み取れません。」)
  errors: string[];
  unusedColumns: string[];
  newCount: number;
  rows: BankPreviewRow[];
};

export type BankImportResponse =
  | { ok: true; step: "preview"; preview: BankImportPreview }
  | { ok: true; step: "applied"; redirectTo: string }
  | { ok: false; error: string };
