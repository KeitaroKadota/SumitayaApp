// 入力の整え方(CMN-02 03 EV-02・EV-08・EV-15、04 CH-02・CH-17・CH-31・CH-34)。DBを読まない計算だけのファイル。

// 全角の英数字・記号を半角にする(NFKC)。半角カナは全角カナになる
export const toHalfWidth = (value: string): string => value.normalize("NFKC");

// カタカナをひらがなに(ふりがな。CH-02)。半角カナは先に全角にする
export const katakanaToHiragana = (value: string): string =>
  value.normalize("NFKC").replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));

// ひらがなをカタカナに(振込名義。CH-34)
export const hiraganaToKatakana = (value: string): string =>
  value.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));

// CH-02 ふりがなは、ひらがな・長音(ー)・空白だけ
export const isHiraganaReading = (value: string): boolean => /^[ぁ-ゖゝゞー\s]+$/.test(value);

// フォームの値を文字にして前後の空白を取る
export const formText = (formData: FormData, name: string): string => String(formData.get(name) ?? "").trim();

// 数の入力から「,」「円」「¥」「枚」と空白を取る(EV-08 手順2・CH-11)
export const stripNumberDecorations = (value: string): string =>
  toHalfWidth(value).replace(/[,，円¥￥枚\s]/g, "");

// 0以上の整数として読む。空は null、読めなければ "error"
export const parseNonNegativeInt = (value: string, max: number): number | null | "error" => {
  const s = stripNumberDecorations(value);
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return "error";
  const n = Number(s);
  return n <= max ? n : "error";
};

// 範囲つきの整数として読む。空は null、読めなければ・範囲外なら "error"
export const parseIntInRange = (value: string, min: number, max: number): number | null | "error" => {
  const s = stripNumberDecorations(value);
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return "error";
  const n = Number(s);
  return n >= min && n <= max ? n : "error";
};

// "YYYY-MM-DD" の正しい日付か(CH-06・CH-26)
export const isValidDateStr = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

// CH-04 メールアドレスの形式(空はよい。呼ぶ側で空を除く)
export const isValidEmail = (value: string): boolean =>
  value.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(value) && value.split("@")[1].includes(".");

// CH-17 電話・FAX: 数字と「-」「(」「)」だけで、数字が10〜11桁。全角は半角に直してから見る
export const normalizePhone = (value: string): string => toHalfWidth(value).replace(/[‐－ー−]/g, "-").trim();
export const isValidPhone = (value: string): boolean => {
  if (!/^[\d()-]+$/.test(value)) return false;
  const digits = value.replace(/\D/g, "").length;
  return digits >= 10 && digits <= 11;
};

// CH-17 郵便番号: 123-4567 か 1234567。保存は 123-4567 にそろえる。形が違えば null
export const normalizePostalCode = (value: string): string | null => {
  const s = toHalfWidth(value).replace(/[‐－ー−]/g, "-").trim();
  const m = s.match(/^(\d{3})-?(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
};

// LIKE の検索語の「%」「_」「\」を文字として扱う(EV-07 手順3)
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
