// 入金消込(E-06)の決まりと計算(01 4.1・7.2、03 の 0.1・0.2、04 CH-06・CH-07・CH-12)。
// 候補は決まりと計算で出す(AIは使わない)。自動では消し込まない(人が「消込する」を押して確定する。E-06-仮-03)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は depositsServer.ts。

// ---- 決まった値 ----

// 【仮】振込手数料として許す差(ご請求額 − 入金額)。1〜880円(00_仮決め一覧 E-06-仮-01)
export const FEE_MIN = 1;
export const FEE_MAX = 880;
// 【仮】候補の点数(00_仮決め一覧 E-06-仮-04)
export const SCORE_PAYER_NAME = 2;
export const SCORE_DUE_WINDOW = 1;
// お支払期限の前後この日数以内なら点数を足す
export const DUE_WINDOW_DAYS = 30;
// 候補の数の上限
export const MAX_CANDIDATES = 3;
// 「含む」で名前を比べるのは、短い方がこの文字数以上のときだけ(03 0.2)
const MIN_CONTAINS_LENGTH = 3;

export const MATCH_STATUSES = { unmatched: "未消込", matched: "消込済み", ignored: "対象外" } as const;
export type MatchStatus = keyof typeof MATCH_STATUSES;

export const ACCOUNT_TYPES = { ordinary: "普通", current: "当座" } as const;
export type AccountType = keyof typeof ACCOUNT_TYPES;
export const isAccountType = (v: string): v is AccountType => Object.hasOwn(ACCOUNT_TYPES, v);

// 対象外の理由(02 G01。選択＋メモ)
export const IGNORE_REASONS = ["利息", "カード売上", "現金の預け入れ", "その他"] as const;
export const isIgnoreReason = (v: string): v is (typeof IGNORE_REASONS)[number] => (IGNORE_REASONS as readonly string[]).includes(v);
// 【仮】対象外のメモの長さ(00_仮決め一覧 E-06-仮-09)
export const MAX_IGNORE_MEMO = 100;
// 出金を登録するときの対象外の理由(CH-05)
export const WITHDRAWAL_REASON = "出金";

// 口座の入力の長さ(CH-12)
export const MAX_BANK_NAME = 50;
export const MAX_BRANCH_NAME = 50;
export const MAX_SORT_ORDER = 999;

// ---- 名前のそろえ方(03 0.2、01 7.2) ----

// 会社の種類の略(振込名義の「カ)」「(カ」「(カ)」など)。カ=株式会社、ユ=有限会社、ド=合同会社 など
const COMPANY_ABBREVIATIONS = ["カ", "ユ", "ド", "メ", "シ", "シヤ", "ザイ", "イ", "フク", "ガク", "トクヒ"];
const ABBR = COMPANY_ABBREVIATIONS.join("|");
const ABBR_PATTERNS = [new RegExp(`\\((?:${ABBR})\\)`, "g"), new RegExp(`^(?:${ABBR})\\)`), new RegExp(`\\((?:${ABBR})$`)];
const SMALL_KANA: Record<string, string> = {
  ァ: "ア", ィ: "イ", ゥ: "ウ", ェ: "エ", ォ: "オ", ッ: "ツ", ャ: "ヤ", ュ: "ユ", ョ: "ヨ", ヮ: "ワ", ヵ: "カ", ヶ: "ケ",
};

// 半角カナ → 全角カナ、ひらがな → カタカナ、空白を除く、会社の種類の略を除く、小さい文字を大きい文字に
export const normalizeKanaName = (text: string): string => {
  let s = text
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .replace(/\s/g, "");
  for (const p of ABBR_PATTERNS) s = s.replace(p, "");
  return s.replace(/[ァィゥェォッャュョヮヵヶ]/g, (ch) => SMALL_KANA[ch] ?? ch);
};

// 振込名義が取引先の振込名義(「、」区切りで複数可)のどれかと一致する・含むか
export const payerNameMatches = (payerName: string | null, payerNamesKana: string | null): boolean => {
  if (!payerName || !payerNamesKana) return false;
  const a = normalizeKanaName(payerName);
  if (!a) return false;
  return payerNamesKana
    .split("、")
    .map(normalizeKanaName)
    .filter(Boolean)
    .some((b) => {
      if (a === b) return true;
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      return short.length >= MIN_CONTAINS_LENGTH && long.includes(short);
    });
};

// ---- 候補の探し方(03 0.1、04 CH-06) ----

const dayNumber = (date: string): number => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;
// to − from の日数("YYYY-MM-DD")
export const daysBetween = (from: string, to: string): number => dayNumber(to) - dayNumber(from);

export type DepositForMatch = { deposit: number; transactionOn: string; payerName: string | null };
export type InvoiceForMatch = {
  id: string;
  invoiceNo: string;
  total: number;
  issuedOn: string;
  dueOn: string | null;
  // 取引先の振込名義(customers.payer_name_kana)
  payerNamesKana: string | null;
};

// CH-06 金額の条件: 同額、または ご請求額 − 入金額 が手数料の範囲。満たせば手数料(0〜)、満たさなければ null
export const feeOf = (deposit: number, total: number): number | null => {
  const diff = total - deposit;
  if (diff === 0) return 0;
  return diff >= FEE_MIN && diff <= FEE_MAX ? diff : null;
};

export type MatchCheck =
  | { ok: true; fee: number }
  | { ok: false; reason: "amount" | "date" };

// CH-06 金額・日付の条件(請求書の状態はDBの読み方で絞る)
export const checkMatch = (t: Pick<DepositForMatch, "deposit" | "transactionOn">, inv: Pick<InvoiceForMatch, "total" | "issuedOn">): MatchCheck => {
  if (t.deposit <= 0) return { ok: false, reason: "amount" };
  if (inv.issuedOn > t.transactionOn) return { ok: false, reason: "date" };
  const fee = feeOf(t.deposit, inv.total);
  return fee === null ? { ok: false, reason: "amount" } : { ok: true, fee };
};

export type Candidate = { invoiceId: string; score: number; fee: number; nameMatched: boolean; nearDue: boolean };

// 0.1 候補を探す: 条件を満たす請求書に点数を付け、点数の高い順(同点なら期限の古い順)に3件まで返す
export const suggestInvoices = (t: DepositForMatch, invoices: InvoiceForMatch[], limit = MAX_CANDIDATES): Candidate[] => {
  if (t.deposit <= 0) return [];
  const scored: (Candidate & { dueOn: string | null; invoiceNo: string })[] = [];
  for (const inv of invoices) {
    const check = checkMatch(t, inv);
    if (!check.ok) continue;
    const nameMatched = payerNameMatches(t.payerName, inv.payerNamesKana);
    const nearDue = inv.dueOn !== null && Math.abs(daysBetween(inv.dueOn, t.transactionOn)) <= DUE_WINDOW_DAYS;
    scored.push({
      invoiceId: inv.id,
      fee: check.fee,
      nameMatched,
      nearDue,
      score: (nameMatched ? SCORE_PAYER_NAME : 0) + (nearDue ? SCORE_DUE_WINDOW : 0),
      dueOn: inv.dueOn,
      invoiceNo: inv.invoiceNo,
    });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      // 期限の古い順(期限の無いものは後ろ)
      (a.dueOn ?? "9999-12-31").localeCompare(b.dueOn ?? "9999-12-31") ||
      a.invoiceNo.localeCompare(b.invoiceNo)
  );
  return scored.slice(0, limit).map(({ invoiceId, score, fee, nameMatched, nearDue }) => ({ invoiceId, score, fee, nameMatched, nearDue }));
};

// 口座の表示(静岡銀行 本店 普通 …1234)
export const accountLabel = (a: { bankName: string; branchName: string | null; accountType: AccountType; last4: string | null }): string =>
  [a.bankName, a.branchName, ACCOUNT_TYPES[a.accountType], a.last4 ? `…${a.last4}` : null].filter(Boolean).join(" ");
