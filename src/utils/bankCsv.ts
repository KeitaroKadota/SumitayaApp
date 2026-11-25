// 銀行の入出金明細CSVの「列の対応表」と、1行の読み取り(E-06 01 7.1、04 CH-03・CH-04)。
// 2026-11-25: No.27 の見本(PayPay銀行・楽天銀行)の形を足した(01 の 11章)。静岡銀行などは見本が届いたら同じように足す。
// 候補はどれか1つが見出しにあればよい(前にある候補を優先)。DBを読まない計算だけのファイル(サーバーで使う)。
import { createHash } from "node:crypto";
import { resolveColumns, type CsvRow } from "@/utils/csvImport/engine";
import { isValidDateStr } from "@/utils/textNormalize";

// 列の候補。形によって使う列が違う(PayPay銀行は日付が年・月・日の3列、楽天銀行は入出金が符号つきの1列。01 の 11章)
type BankColumns = {
  transactionOn?: readonly string[];
  transactionYear?: readonly string[];
  transactionMonth?: readonly string[];
  transactionDay?: readonly string[];
  description: readonly string[];
  deposit?: readonly string[];
  withdrawal?: readonly string[];
  // 入出金(プラスが入金・マイナスが出金)
  signedAmount?: readonly string[];
  balance?: readonly string[];
};
export type BankField = keyof BankColumns;

export type BankCsvFormat = {
  label: string;
  columns: BankColumns;
  // 必ず要る列(見出しの行を探すときに使う。CH-03)
  required: readonly { field: BankField; label: string }[];
  // 見出しの行を探す行数(銀行によっては、見出しの前に口座の情報などの行がある)
  headerSearchRows: number;
  // 読み飛ばす行(合計の行など): 取引日が空で、この言葉のどれかを含む行
  skipKeywords: readonly string[];
};

// 明細CSVの形(bank_accounts.csv_format の値)。
// 初回は汎用の形だけ。取引の多い1口座の形は、見本が届いてから足す(01 7.1 の①)
export const BANK_CSV_FORMATS = {
  // 汎用の形: 取引日,摘要,入金,出金,残高 の5列(どの銀行でも Excel で並べ替えれば取り込める)
  generic: {
    label: "汎用（取引日・摘要・入金・出金・残高）",
    columns: {
      transactionOn: ["取引日", "日付", "お取引日"],
      description: ["摘要", "お取引内容", "内容"],
      deposit: ["入金", "入金額", "お預入金額"],
      withdrawal: ["出金", "出金額", "お引出金額"],
      balance: ["残高", "差引残高"],
    },
    required: [
      { field: "transactionOn", label: "取引日" },
      { field: "description", label: "摘要" },
      { field: "deposit", label: "入金" },
      { field: "withdrawal", label: "出金" },
    ],
    headerSearchRows: 10,
    skipKeywords: ["合計", "小計"],
  },
  // PayPay銀行(No.27 の見本。2026-11-25): 日付は年・月・日の3列、入金＝お預り金額、出金＝お支払金額
  paypay: {
    label: "PayPay銀行",
    columns: {
      transactionYear: ["操作日(年)"],
      transactionMonth: ["操作日(月)"],
      transactionDay: ["操作日(日)"],
      description: ["摘要"],
      deposit: ["お預り金額"],
      withdrawal: ["お支払金額"],
      balance: ["残高"],
    },
    required: [
      { field: "transactionYear", label: "操作日(年)" },
      { field: "transactionMonth", label: "操作日(月)" },
      { field: "transactionDay", label: "操作日(日)" },
      { field: "description", label: "摘要" },
      { field: "deposit", label: "お預り金額" },
      { field: "withdrawal", label: "お支払金額" },
    ],
    headerSearchRows: 10,
    skipKeywords: ["合計", "小計"],
  },
  // 楽天銀行(No.27 の見本。2026-11-25): 取引日は YYYYMMDD、入出金は符号つきの1列、摘要＝入出金先内容
  rakuten: {
    label: "楽天銀行",
    columns: {
      transactionOn: ["取引日"],
      description: ["入出金先内容"],
      signedAmount: ["入出金(円)"],
      balance: ["残高(円)"],
    },
    required: [
      { field: "transactionOn", label: "取引日" },
      { field: "description", label: "入出金先内容" },
      { field: "signedAmount", label: "入出金(円)" },
    ],
    headerSearchRows: 10,
    skipKeywords: ["合計", "小計"],
  },
} as const satisfies Record<string, BankCsvFormat>;
export type BankCsvFormatKey = keyof typeof BANK_CSV_FORMATS;
export const isBankCsvFormat = (v: string): v is BankCsvFormatKey => Object.hasOwn(BANK_CSV_FORMATS, v);
export const bankCsvFormatLabel = (v: string | null): string | null =>
  v && isBankCsvFormat(v) ? BANK_CSV_FORMATS[v].label : null;

// 振込名義を取り出すときに、摘要の先頭から除く言葉(01 7.1。半角カナは全角にしてから比べる)
const PAYER_PREFIXES = ["振込入金", "振込", "フリコミ"];

// 【仮】1ファイルの行数の上限(04 CH-03。00_仮決め一覧 E-06-仮-05)
export const BANK_CSV_MAX_ROWS = 5000;
// 摘要の長さ(CH-03)
export const MAX_DESCRIPTION = 200;
// 金額の上限(DBの integer に入る範囲の内側)
const MAX_AMOUNT = 999_999_999;

// ---- 値の読み取り ----

const MINUS_SIGNS = /^[-−‐－△▲]/;

// CH-03 取引日: 和暦(R8.11.25・令和8年11月25日)・2026/11/25・2026-11-25・2026年11月25日・20261125 → "YYYY-MM-DD"。読めなければ null
export const parseBankDate = (value: string): string | null => {
  const s = value.normalize("NFKC").replace(/\s/g, "");
  const pad = (n: string) => n.padStart(2, "0");
  let y: number | null = null;
  let m = "";
  let d = "";
  const western = s.match(/^(\d{4})[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$/);
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  const reiwa = s.match(/^(?:R|r|令和)(\d{1,2}|元)[/.\-年](\d{1,2})[/.\-月](\d{1,2})日?$/);
  if (western) [y, m, d] = [Number(western[1]), western[2], western[3]];
  else if (compact) [y, m, d] = [Number(compact[1]), compact[2], compact[3]];
  else if (reiwa) [y, m, d] = [2018 + (reiwa[1] === "元" ? 1 : Number(reiwa[1])), reiwa[2], reiwa[3]];
  if (y === null) return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  return isValidDateStr(date) ? date : null;
};

// CH-03 入金・出金: 0以上の整数(カンマ・円・全角を取り除く)。空は0。読めなければ null
export const parseBankAmount = (value: string): number | null => {
  const s = value.normalize("NFKC").replace(/[,円¥\\\s]/g, "");
  if (s === "") return 0;
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= MAX_AMOUNT ? n : null;
};

// CH-03 残高: 空、または整数(マイナスも可)。空は null、読めなければ "error"
export const parseBankBalance = (value: string): number | null | "error" => {
  const raw = value.normalize("NFKC").replace(/[,円¥\\\s]/g, "");
  if (raw === "") return null;
  const negative = MINUS_SIGNS.test(raw);
  const s = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(s) || Number(s) > 99_999_999_999) return "error";
  return negative ? -Number(s) : Number(s);
};

// 01 7.1 振込名義: 摘要の先頭から「振込」「ﾌﾘｺﾐ」などを除いた残り。半角カナは全角カナにそろえる。空なら null
export const extractPayerName = (description: string): string | null => {
  let s = description.normalize("NFKC").trim();
  for (let changed = true; changed; ) {
    changed = false;
    for (const p of PAYER_PREFIXES) {
      if (s.startsWith(p)) {
        s = s.slice(p.length).trim();
        changed = true;
      }
    }
  }
  return s ? s.slice(0, MAX_DESCRIPTION) : null;
};

// CH-04 同じ明細かを見分ける値(口座ID・取引日・摘要・入金・出金・残高。残高が無い行は、同じ内容の何番目か)
export const bankRowHash = (
  accountId: string,
  row: { transactionOn: string; description: string; deposit: number; withdrawal: number; balance: number | null },
  ordinal: number
): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        accountId,
        row.transactionOn,
        row.description,
        row.deposit,
        row.withdrawal,
        row.balance === null ? `#${ordinal}` : row.balance,
      ])
    )
    .digest("hex");

// ---- 1ファイルの読み取り ----

export type BankRow = {
  line: number;
  transactionOn: string;
  description: string;
  payerName: string | null;
  deposit: number;
  withdrawal: number;
  balance: number | null;
  rowHash: string;
};

export type BankRowError = { line: number; message: string };

export type BankCsvReadResult =
  | { ok: true; rows: BankRow[]; errors: BankRowError[]; skipped: number; unusedColumns: string[] }
  | { ok: false; error: string };

// 見出しの行を探し、データの行を1行ずつ確かめる(EV-02 手順2・3)。
// header は CSV の1行目、rows はその後の行(共通の readUploadedCsv の結果)
export const readBankRows = (
  formatKey: BankCsvFormatKey,
  accountId: string,
  header: string[],
  rows: CsvRow[]
): BankCsvReadResult => {
  const format: BankCsvFormat = BANK_CSV_FORMATS[formatKey];
  const lines = [{ line: 1, cells: header }, ...rows];
  let found: { at: number; index: Partial<Record<BankField, number>>; unused: string[] } | null = null;
  for (let at = 0; at < Math.min(format.headerSearchRows, lines.length); at += 1) {
    const resolved = resolveColumns(
      lines[at].cells.map((c) => c.normalize("NFKC").trim()),
      format.columns as Record<BankField, readonly string[]>
    );
    if (format.required.every((f) => resolved.index[f.field] !== undefined)) {
      found = { at, index: resolved.index, unused: resolved.unused };
      break;
    }
  }
  if (!found)
    return {
      ok: false,
      error: `見出しの行が見つかりません（${format.label}の形で必要な列: ${format.required.map((f) => f.label).join("・")}）。ネットバンキングからダウンロードしたCSVか、口座の「CSVの形」が合っているか確かめてください。`,
    };

  const { index } = found;
  const cell = (cells: string[], field: BankField): string => {
    const i = index[field];
    return i === undefined ? "" : (cells[i] ?? "").trim();
  };
  const result: BankRow[] = [];
  const errors: BankRowError[] = [];
  const ordinals = new Map<string, number>();
  let skipped = 0;

  // 日付が年・月・日の3列に分かれている形(PayPay銀行)
  const splitDate = index.transactionYear !== undefined;
  for (const { line, cells } of lines.slice(found.at + 1)) {
    const dateText = splitDate
      ? [cell(cells, "transactionYear"), cell(cells, "transactionMonth"), cell(cells, "transactionDay")].some((v) => v === "")
        ? ""
        : `${cell(cells, "transactionYear")}/${cell(cells, "transactionMonth")}/${cell(cells, "transactionDay")}`
      : cell(cells, "transactionOn");
    // 合計の行などは読み飛ばす
    if (dateText === "" && cells.some((c) => format.skipKeywords.some((k) => c.includes(k)))) {
      skipped += 1;
      continue;
    }
    const transactionOn = parseBankDate(dateText);
    if (!transactionOn) {
      errors.push({ line, message: `${line}行目: 日付が正しくありません。` });
      continue;
    }
    // 入出金が符号つきの1列の形(楽天銀行)は、プラスを入金・マイナスを出金にする(0・読めない値はエラー)
    let deposit: number | null;
    let withdrawal: number | null;
    if (index.signedAmount !== undefined) {
      const signed = parseBankBalance(cell(cells, "signedAmount"));
      const ok = typeof signed === "number" && Math.abs(signed) <= MAX_AMOUNT;
      deposit = ok && signed > 0 ? signed : ok ? 0 : null;
      withdrawal = ok && signed < 0 ? -signed : ok ? 0 : null;
    } else {
      deposit = parseBankAmount(cell(cells, "deposit"));
      withdrawal = parseBankAmount(cell(cells, "withdrawal"));
    }
    if (deposit === null || withdrawal === null || (deposit > 0) === (withdrawal > 0)) {
      errors.push({ line, message: `${line}行目: 金額が読み取れません。` });
      continue;
    }
    const balance = parseBankBalance(cell(cells, "balance"));
    if (balance === "error") {
      errors.push({ line, message: `${line}行目: 残高が読み取れません。` });
      continue;
    }
    const description = cell(cells, "description");
    if (description.length > MAX_DESCRIPTION) {
      errors.push({ line, message: `${line}行目: 摘要が${MAX_DESCRIPTION}文字を超えています。` });
      continue;
    }
    const base = { transactionOn, description, deposit, withdrawal, balance };
    const key = JSON.stringify([transactionOn, description, deposit, withdrawal]);
    const ordinal = balance === null ? (ordinals.get(key) ?? 0) + 1 : 0;
    if (balance === null) ordinals.set(key, ordinal);
    result.push({
      line,
      ...base,
      // 振込名義は入金だけ(出金は相手の名前のため取り出さない)
      payerName: deposit > 0 ? extractPayerName(description) : null,
      rowHash: bankRowHash(accountId, base, ordinal),
    });
  }
  return { ok: true, rows: result, errors, skipped, unusedColumns: found.unused };
};
