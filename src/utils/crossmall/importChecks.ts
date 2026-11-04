// CROSS MALL の受注CSV・在庫CSVの取り込みの共通のチェック(B-01 03 EV-03〜EV-06、04 CH-01・CH-09。
// A-01 の共通の取り込みの「確認中の記録」の確かめ方と同じ)。登録(upload/route.ts)と「やめる」(actions.ts)で使う。
import type { CurrentEmployee } from "@/utils/auth";
import type { ImportBatch } from "@/utils/csvImport/batches";
// 【仮】確認してから登録できるまでの時間は、商品の取り込みと同じ値を使う(00_仮決め一覧 CMN02-仮-14)
import { PREVIEW_VALID_HOURS } from "@/app/admin/products/import/importChecks";

export type CrossmallImportKind = "crossmall_orders" | "crossmall_stock";

// CH-01 ファイルの種類・大きさ(4MB は共通の readUploadedCsv が見る)。
// 【仮】拡張子は .csv と .txt(CROSS MALL の出力の名前に合わせて No.49 で見直す)
export const crossmallReadOptions = (maxRows: number) => ({
  extensions: [".csv", ".txt"],
  fileError: "CSVファイル（4MBまで）を選んでください。",
  maxRows,
  maxRowsError: `1回に取り込めるのは${maxRows.toLocaleString("ja-JP")}行までです。ファイルを分けてください。`,
});

// 取り込みの記録が「確認中」で、種類が合っていて、確認した本人か社長、24時間以内。だめなときは画面に出す文を返す
export const checkCrossmallPreviewBatch = (
  batch: ImportBatch | null,
  kind: CrossmallImportKind,
  me: CurrentEmployee,
  now: Date
): string | null => {
  if (!batch || batch.kind !== kind) return "この取り込みは登録できません。もう一度『読み込む』を押してください。";
  if (batch.status !== "previewed") return "この取り込みはすでに登録済み・取消済みです。";
  if (batch.createdBy !== me.id && !me.roles.includes("president"))
    return "ほかの人が確認中の取り込みです。もう一度『読み込む』を押してください。";
  if (now.getTime() - batch.createdAt.getTime() > PREVIEW_VALID_HOURS * 60 * 60 * 1000)
    return "確認してから時間がたちました。もう一度『読み込む』を押してください。";
  return null;
};

// 別のサイトから送られた要求を受け付けない(Server Action と同じく、送り元が同じサイトかを見る。CMN-02 の取り込みと同じ)
export const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host"))?.split(",")[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
};

// 確認の画面に返す形(受注・在庫で共通。画面の部品 CrossmallImportForm が表示する)
export type CrossmallPreviewRow = {
  line: number;
  kind: string;
  kindLabel: string;
  isError: boolean;
  // 受注番号・商品コード
  key: string;
  // 注文日時・商品名
  sub: string;
  detail: string;
  warning: string | null;
};

export type CrossmallImportPreview = {
  batchId: string;
  fileName: string;
  encodingLabel: string;
  dataRowCount: number;
  // 件数の行(「行数 47行 → 注文 37件（新規 32件・更新 5件・変更なし 0件）」など)
  summary: string[];
  warnings: string[];
  errorCount: number;
  unusedColumns: string[];
  // 登録するものがあるか
  hasChanges: boolean;
  applyLabel: string;
  tabs: { key: string; label: string; count: number }[];
  rows: CrossmallPreviewRow[];
};

export type CrossmallImportResponse =
  | { ok: true; step: "preview"; preview: CrossmallImportPreview }
  | { ok: true; step: "applied"; redirectTo: string }
  | { ok: false; error: string };
