// CSV取り込みの共通の流れ(A-01 03 の 0章)。確認(EV-02)と登録(EV-03)の両方で同じ関数を呼ぶ。
// ここはDBを読み書きしない。取り込みの記録(import_batches)は batches.ts、種類ごとの分類は各機能が持つ。
// 今は CMN-02 の商品の取り込みで使う分だけを作った(列の対応表・行の読み取りは種類の定義の側に持つ)。
import { createHash } from "node:crypto";
import { decodeCsvBytes, type CsvEncoding } from "./decode";
import { parseCsv } from "./parseCsv";

// 1ファイルの上限(A-01 CH-02・CMN-02 CH-20。サーバー経由で受け取るため 4MB。00_共通設計 7.2)
export const MAX_CSV_BYTES = 4 * 1024 * 1024;

export type CsvRow = { line: number; cells: string[] };

export type ReadCsvResult =
  | {
      ok: true;
      fileName: string;
      fileSize: number;
      fileHash: string;
      encoding: CsvEncoding;
      // 読めなかった文字(�)を含むか(A-01 CH-03 の警告)
      hasReplacementChar: boolean;
      header: string[];
      // データの行(見出しの次から。すべての列が空の行は除く)。line は CSV の行番号(1始まり)
      rows: CsvRow[];
    }
  | { ok: false; error: string };

// 0.1 ファイルを受け取って読む。extensions は小文字の拡張子(例: [".csv"])
export const readUploadedCsv = async (
  file: FormDataEntryValue | null,
  {
    extensions,
    fileError,
    maxRows,
    maxRowsError,
  }: { extensions: string[]; fileError: string; maxRows: number; maxRowsError: string }
): Promise<ReadCsvResult> => {
  // A-01 CH-01・CH-02(CMN-02 CH-20): ファイルが選ばれていて、大きさと拡張子が決まりのとおり
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: fileError };
  const lowerName = file.name.toLowerCase();
  if (file.size > MAX_CSV_BYTES || !extensions.some((ext) => lowerName.endsWith(ext))) return { ok: false, error: fileError };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(bytes).digest("hex");

  // A-01 CH-03 文字コードの判定
  let decoded: { text: string; encoding: CsvEncoding };
  try {
    decoded = decodeCsvBytes(bytes);
  } catch {
    return { ok: false, error: "CSVを読み込めませんでした。文字コードと形式を確かめてください。" };
  }

  const table = parseCsv(decoded.text);
  if (table.length === 0) return { ok: false, error: "ファイルが空です。" };
  const header = table[0].map((h) => h.trim());
  const rows: CsvRow[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c.trim() === "")) return;
    rows.push({ line: i + 2, cells });
  });
  // 件数の上限(CMN-02 CH-24)
  if (rows.length > maxRows) return { ok: false, error: maxRowsError };

  return {
    ok: true,
    fileName: file.name,
    fileSize: file.size,
    fileHash,
    encoding: decoded.encoding,
    hasReplacementChar: decoded.text.includes("�"),
    header,
    rows,
  };
};

// 列の対応表(項目 → 列名の候補の並び)で、見出しの何列目かを決める(A-01 CH-04)。
// 見出しで最初に見つかった候補の列を使う。使わなかった見出しの列名も返す
export const resolveColumns = <F extends string>(
  header: string[],
  columnMap: Record<F, readonly string[]>
): { index: Partial<Record<F, number>>; unused: string[]; duplicated: string[] } => {
  const index: Partial<Record<F, number>> = {};
  const used = new Set<number>();
  for (const field of Object.keys(columnMap) as F[]) {
    for (const candidate of columnMap[field]) {
      const i = header.indexOf(candidate);
      if (i >= 0) {
        index[field] = i;
        used.add(i);
        break;
      }
    }
  }
  const counts = new Map<string, number>();
  for (const h of header) if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1).map(([h]) => h);
  const unused = header.filter((h, i) => h && !used.has(i));
  return { index, unused, duplicated };
};
