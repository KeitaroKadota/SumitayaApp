// CSVの項目の型ごとの読み取り(A-01 01 7.1 の fields.ts、04 CH-07〜CH-09)。DBを読まない計算だけのファイル。
// 全角数字・「,」・「¥」・「円」・「△」「▲」(マイナス)などに対応する。
import { normalizeProductCode } from "@/utils/productRules";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

export type FieldResult<T> = { ok: true; value: T } | { ok: false; error: string };

// CH-07 日付: 年/月/日・年-月-日・8けたの数字。後ろに付いた時刻・曜日は捨てる。
// 実在しない日付、2000-01-01 より前、今日(日本時間)より後はだめ
export const parseCsvDate = (raw: string, today: string): string | null => {
  const s = toHalfWidth(raw).trim();
  let y: number, m: number, d: number;
  const sep = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:$|[\s(（T])/);
  const digits = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|[\s(（])/);
  if (sep) [y, m, d] = [Number(sep[1]), Number(sep[2]), Number(sep[3])];
  else if (digits) [y, m, d] = [Number(digits[1]), Number(digits[2]), Number(digits[3])];
  else return null;
  const date = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (!isValidDateStr(date) || date < "2000-01-01" || date > today) return null;
  return date;
};

// CH-09 整数: 「,」「¥」「円」・前後の空白を取り、全角を半角に。マイナスは「-」「△」「▲」。
// 空は null(任意の項目では「値なし」)。整数でない・範囲の外は "error"
export const parseCsvInt = (raw: string, limit: number): number | null | "error" => {
  let s = toHalfWidth(raw).replace(/[,，¥￥円\s]/g, "");
  if (s === "") return null;
  let negative = false;
  if (/^[-−‐△▲]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+$/.test(s)) return "error";
  const n = Number(s) * (negative ? -1 : 1);
  return Math.abs(n) <= limit ? n : "error";
};

// CH-08 コード: 整える(前後の空白・全角→半角・Excel の「'」「="…"」。大文字・小文字はそのまま)。
// 空・50文字を超える・制御文字を含むものはエラー
export const parseCsvCode = (raw: string): FieldResult<string> => {
  const code = normalizeProductCode(raw);
  if (!code) return { ok: false, error: "商品コードが空です" };
  if (code.length > 50) return { ok: false, error: `商品コード『${code.slice(0, 20)}…』が50文字を超えています` };
  // 制御文字(改行・タブなど)
  if (/\p{Cc}/u.test(code)) return { ok: false, error: "商品コードに改行・タブなどが含まれています" };
  return { ok: true, value: code };
};

// 文字の項目: 前後の空白を取り、長さを切る
export const parseCsvText = (raw: string, max: number): string => raw.trim().slice(0, max);
