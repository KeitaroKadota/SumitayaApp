// 商品の項目ごとの読み取りとチェック(CMN-02 04 CH-08〜CH-12・CH-35・CH-36)。
// 商品の画面(EV-08)とCSVの取り込み(EV-11・CH-22)の両方で同じ決まりを使う。DBを読まない計算だけのファイル。
import {
  MAX_LEAD_TIME_DAYS,
  MAX_ORDER_UNIT,
  MAX_PRICE,
  MIN_ORDER_UNIT,
  PRODUCT_CATEGORIES,
  PRODUCT_CODE_PATTERN,
  TAX_RATES,
  type TaxRate,
} from "@/utils/masterRules";
import { parseIntInRange, parseNonNegativeInt, toHalfWidth } from "@/utils/textNormalize";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// 商品コードの整え方(00_共通設計 7.5・A-01 CH-08): 前後の空白を取り、全角の英数字を半角に。
// Excel で付く先頭の「'」や ="…" の形を外す。大文字・小文字は変えない
export const normalizeProductCode = (value: string): string => {
  let s = toHalfWidth(value).trim();
  const excel = s.match(/^="(.*)"$/);
  if (excel) s = excel[1];
  if (s.startsWith("'")) s = s.slice(1);
  return s.trim();
};

// CH-08 商品コードの形式(重複は呼ぶ側でDBを見る)
export const checkProductCode = (code: string): string | null => {
  if (!code) return "商品コードを入力してください。";
  if (!PRODUCT_CODE_PATTERN.test(code))
    return "商品コードは半角の英数字と「-」「_」「.」「/」の50文字以内で入力してください。";
  return null;
};

// CH-10 JANコード: 数字8桁か13桁。最後の1桁(チェック用の数字)が合わなければ警告
export const checkJanCode = (jan: string): { error: string | null; warning: string | null } => {
  if (!/^(\d{8}|\d{13})$/.test(jan)) return { error: "JANコードは数字8桁か13桁で入力してください。", warning: null };
  const digits = jan.split("").map(Number);
  const check = digits.pop() as number;
  // 右から数えて奇数番目に3を掛ける(チェック用の数字を除いた並びで)
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  const expected = (10 - (sum % 10)) % 10;
  return {
    error: null,
    warning: expected === check ? null : "JANコードの最後の数字が合いません。読み間違いがないか確かめてください。",
  };
};

// CH-11 金額(円)。空は null
export const parsePrice = (value: string, label: string): Parsed<number | null> => {
  const n = parseNonNegativeInt(value, MAX_PRICE);
  return n === "error" ? { ok: false, error: `${label}は0以上の整数（円）で入力してください。` } : { ok: true, value: n };
};

// CH-12 税率: 10・8・0。「10%」「10」どちらでもよい。空は null
export const parseTaxRate = (value: string): Parsed<TaxRate | null> => {
  const s = toHalfWidth(value).replace(/[%％\s]/g, "");
  if (s === "") return { ok: true, value: null };
  const n = Number(s);
  return (TAX_RATES as readonly number[]).includes(n) && /^\d+$/.test(s)
    ? { ok: true, value: n as TaxRate }
    : { ok: false, error: "税率は10・8・0のどれかにしてください。" };
};

// CH-35 発注の単位・最低の発注数: 1〜99,999 の整数。空は null
export const parseOrderUnit = (value: string, label: string): Parsed<number | null> => {
  const n = parseIntInRange(value, MIN_ORDER_UNIT, MAX_ORDER_UNIT);
  return n === "error"
    ? { ok: false, error: `${label}は${MIN_ORDER_UNIT}〜${MAX_ORDER_UNIT.toLocaleString("ja-JP")}の整数で入力してください。` }
    : { ok: true, value: n };
};

// CH-35 最低の発注数が発注の単位で割り切れなければ警告
export const lotWarning = (orderLot: number | null, minOrderQty: number | null): string | null =>
  orderLot !== null && minOrderQty !== null && minOrderQty % orderLot !== 0
    ? "最低の発注数が発注の単位の倍数ではありません。"
    : null;

// CH-19・CH-36 届くまでの日数: 0〜365 の整数(暦の日数)。空は null
export const parseLeadTimeDays = (value: string): Parsed<number | null> => {
  const n = parseIntInRange(value, 0, MAX_LEAD_TIME_DAYS);
  return n === "error"
    ? { ok: false, error: `届くまでの日数は0〜${MAX_LEAD_TIME_DAYS}の整数（日）で入力してください。` }
    : { ok: true, value: n };
};

// 分類: コードか表示名(【仮】表示名でもよい。定数で読み替える)。空は null
export const parseCategory = (value: string): Parsed<string | null> => {
  const s = toHalfWidth(value).trim();
  if (s === "") return { ok: true, value: null };
  if (s in PRODUCT_CATEGORIES) return { ok: true, value: s };
  const byLabel = Object.entries(PRODUCT_CATEGORIES).find(([, label]) => label === s);
  return byLabel ? { ok: true, value: byLabel[0] } : { ok: false, error: `分類「${s}」が見つかりません。` };
};
