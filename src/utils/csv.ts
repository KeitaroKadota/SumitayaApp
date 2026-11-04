// CSVの出力(00_共通設計 4章。担当は E-03。CMN-02 の商品のひな形CSV〔EV-10〕で先に使うので、ここで作った)。
// UTF-8(BOM付き)・改行 CRLF・値はすべて「"」で囲む。BOM付きなので Excel でも文字化けしない。
// 「=」「+」「-」「@」で始まる値は、Excel で数式として動かないよう先頭に「'」を付ける(【仮】00_仮決め一覧 共通-仮-12)。

export type CsvCell = string | number | boolean | null | undefined;

const FORMULA_START = /^[=+\-@]/;

const escapeCell = (value: CsvCell): string => {
  if (value === null || value === undefined) return '""';
  // 数は数式にならないのでそのまま出す(マイナスの数を「'」付きにしない)
  const s = String(value);
  const safe = typeof value === "string" && FORMULA_START.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export const toCsv = (rows: CsvCell[][]): string =>
  `﻿${rows.map((row) => row.map(escapeCell).join(",")).join("\r\n")}\r\n`;

// ダウンロードの応答。日本語のファイル名は RFC 5987 の形(filename*)で渡す
export const csvResponse = (fileName: string, rows: CsvCell[][]): Response =>
  new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="download.csv"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
