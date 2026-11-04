// 文字コードの判定と読み込み(A-01 04 CH-03)。DBを読まない計算だけのファイル。
// 1. 先頭が UTF-8 の BOM → UTF-8。2. UTF-8 として正しく読める → UTF-8。3. それ以外 → Shift_JIS(CP932)。

export type CsvEncoding = "utf8" | "shift_jis";

export const ENCODING_LABELS: Record<CsvEncoding, string> = { utf8: "UTF-8", shift_jis: "Shift_JIS" };

export const decodeCsvBytes = (
  bytes: Uint8Array,
  encoding: "auto" | CsvEncoding = "auto"
): { text: string; encoding: CsvEncoding } => {
  const hasBom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  const decodeUtf8 = (fatal: boolean) => new TextDecoder("utf-8", { fatal, ignoreBOM: false }).decode(bytes);

  if (encoding === "utf8") return { text: decodeUtf8(false), encoding: "utf8" };
  if (encoding === "shift_jis") return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };

  if (hasBom) return { text: decodeUtf8(false), encoding: "utf8" };
  try {
    return { text: decodeUtf8(true), encoding: "utf8" };
  } catch {
    return { text: new TextDecoder("shift_jis").decode(bytes), encoding: "shift_jis" };
  }
};
