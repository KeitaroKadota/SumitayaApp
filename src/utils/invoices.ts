// 発行する請求書(E-05)の決まりと計算(01 4.1・4.2・6.3、03 の 0.1〜0.3、04 CH-02〜CH-13)。
// 金額・税額はすべてここの計算で出す(AIは使わない)。画面の表示・保存・発行・印刷で同じ関数を使う。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は invoicesServer.ts。
import { formatQuantity, formatYen } from "@/utils/format";
import { MONTH_END_DAY } from "@/utils/masterRules";
import { TAX_RATES, isTaxRate, isValidRegistrationNo, normalizeRegistrationNo, termsDueDate, type TaxRate } from "@/utils/payables";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

export { TAX_RATES, isTaxRate, type TaxRate };

// ---- 決まった値 ----

export const INVOICE_STATUSES = { draft: "下書き", issued: "発行済み", void: "取消" } as const;
export type InvoiceStatus = keyof typeof INVOICE_STATUSES;
export const isInvoiceStatus = (v: string): v is InvoiceStatus => Object.hasOwn(INVOICE_STATUSES, v);

// 入金の状態(E-06 が書く)
export const PAYMENT_STATUSES = { unpaid: "未入金", partial: "一部入金", paid: "入金済み" } as const;
export type PaymentStatus = keyof typeof PAYMENT_STATUSES;

export const PRICE_BASES = { exclusive: "税抜", inclusive: "税込" } as const;
export type PriceBasis = keyof typeof PRICE_BASES;
export const isPriceBasis = (v: string): v is PriceBasis => Object.hasOwn(PRICE_BASES, v);

// 消費税の端数処理(company_settings.rounding)
export const ROUNDINGS = { floor: "切り捨て", round: "四捨五入", ceil: "切り上げ" } as const;
export type Rounding = keyof typeof ROUNDINGS;
export const isRounding = (v: string): v is Rounding => Object.hasOwn(ROUNDINGS, v);

// 【仮】新しい請求書の単価の入力の初期値: 税抜(外税)(00_仮決め一覧 E-05-仮-02)
export const DEFAULT_PRICE_BASIS: PriceBasis = "exclusive";
// 【仮】自社の情報の行が無いときの下書きの計算に使う端数処理(company_settings の初期値と同じ。E-05-仮-01)
export const DEFAULT_ROUNDING: Rounding = "floor";
// 【仮】請求書の決まった備考。新しい請求書の備考の初期値にする(00_仮決め一覧 E-05-仮-08)
export const INVOICE_NOTE = "振込手数料はご負担くださいますようお願いいたします。";
// 新しい明細の税率の初期値(01 9.2。商品から選んだときは商品の税率)
export const DEFAULT_TAX_RATE: TaxRate = 10;

// 一覧の1ページの件数(00_画面共通ルール 4章)と、印刷できる件数(EV-07)
export const INVOICES_PAGE_SIZE = 50;
export const PRINT_MAX_INVOICES = 100;
// 請求書番号が重なったときに取り直す回数(CH-12)
export const ISSUE_RETRY = 3;

// CH-05・CH-13 入力の上限
export const INVOICE_LIMITS = {
  lines: 100,
  description: 100,
  subject: 100,
  note: 1000,
  unit: 10,
  voidReason: 200,
  // 数量 0.01〜99,999.99(小数2けたまで)を、100倍した整数で持つ
  quantityMin100: 1,
  quantityMax100: 9_999_999,
  unitPrice: 9_999_999,
  // 【仮】明細の金額・ご請求額の上限(DBの integer に入る範囲に収めるため。00_仮決め一覧 E-05-仮-11)
  amount: 99_999_999,
} as const;

// ---- 0.1 金額の計算 ----

// 正の整数の割り算を、端数処理して整数にする(小数の誤差を出さないため、整数のまま計算する)
const divide = (numerator: number, denominator: number, rounding: Rounding): number => {
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  const q = Math.floor(n / denominator);
  const r = n - q * denominator;
  let value = q;
  if (rounding === "ceil" && r > 0) value = q + 1;
  if (rounding === "round" && r * 2 >= denominator) value = q + 1;
  // マイナス(値引きが多い下書き)は、絶対値で端数処理してから符号を戻す
  return sign * value;
};

// 明細の金額 = 数量 × 単価。数量は100倍した整数で受け取り、1円未満は切り捨て【仮】(E-05-仮-03。マイナスは0の方へ。E-05-仮-10)
export const calcLineAmount = (quantity100: number | null, unitPrice: number | null): number => {
  if (quantity100 === null || unitPrice === null) return 0;
  return divide(quantity100 * unitPrice, 100, "floor");
};

export type CalcLine = { quantity100: number | null; unitPrice: number | null; taxRate: TaxRate };

export type InvoiceTotals = {
  amounts: number[];
  // 税率ごとの明細の金額の合計(入力したままの値。税込で入力したときは税込)
  gross10: number;
  gross8: number;
  subtotal10: number;
  tax10: number;
  subtotal8: number;
  tax8: number;
  subtotalExempt: number;
  subtotal: number;
  tax: number;
  total: number;
};

// 明細 → 税率ごとの合計・消費税額・ご請求額。消費税は税率ごとの合計に1回だけ端数処理する(CH-07)
export const calcInvoiceTotals = (lines: readonly CalcLine[], priceBasis: PriceBasis, rounding: Rounding): InvoiceTotals => {
  const amounts = lines.map((l) => calcLineAmount(l.quantity100, l.unitPrice));
  const gross = { 10: 0, 8: 0, 0: 0 } as Record<TaxRate, number>;
  lines.forEach((l, i) => {
    gross[l.taxRate] += amounts[i];
  });

  // 消費税の対象の税率(0％ は対象外)
  const byRate = (rate: 10 | 8) => {
    const g = gross[rate];
    if (priceBasis === "exclusive") {
      // 税抜: 消費税 = 合計 × 税率 ÷ 100
      return { subtotal: g, tax: divide(g * rate, 100, rounding) };
    }
    // 税込: 消費税 = 合計 × 税率 ÷ (100 + 税率)、税抜 = 合計 − 消費税
    const tax = divide(g * rate, 100 + rate, rounding);
    return { subtotal: g - tax, tax };
  };
  const r10 = byRate(10);
  const r8 = byRate(8);
  const subtotalExempt = gross[0];
  const subtotal = r10.subtotal + r8.subtotal + subtotalExempt;
  const tax = r10.tax + r8.tax;
  return {
    amounts,
    gross10: gross[10],
    gross8: gross[8],
    subtotal10: r10.subtotal,
    tax10: r10.tax,
    subtotal8: r8.subtotal,
    tax8: r8.tax,
    subtotalExempt,
    subtotal,
    tax,
    total: subtotal + tax,
  };
};

// ---- 数量・単価の読み方(CH-13) ----

// 数量を100倍した整数を、表示・DB用の文字にする(2.5 → "2.5"、20 → "20")
export const quantityText = (quantity100: number): string => {
  const int = Math.floor(quantity100 / 100);
  const frac = quantity100 % 100;
  if (frac === 0) return String(int);
  return `${int}.${String(frac).padStart(2, "0").replace(/0$/, "")}`;
};

// 数量の表示(20 / 2.5。3けたごとの「,」付き)
export const formatInvoiceQty = (quantity100: number | null, unit = ""): string => {
  if (quantity100 === null) return "−";
  const int = Math.floor(quantity100 / 100);
  const frac = quantityText(quantity100).split(".")[1];
  return `${formatQuantity(int)}${frac ? `.${frac}` : ""}${unit}`;
};

// DBの numeric の値("2.50" など)を100倍した整数にする
export const quantity100FromDb = (value: string | number | null): number | null => {
  if (value === null) return null;
  const m = String(value).match(/^(\d+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
};

// 数量の入力を読む。全角の数字・「．」・「,」もよい。空は null、読めなければ文、小数3けた以上も文
export const parseQuantityInput = (value: string): number | null | { error: string } => {
  const s = toHalfWidth(value).replace(/[,\s]/g, "");
  if (s === "") return null;
  const m = s.match(/^(\d+)(?:\.(\d+))?$/);
  if (!m) return { error: "数量は数字で入力してください。" };
  const frac = m[2] ?? "";
  if (frac.length > 2) return { error: "数量は小数2けたまでにしてください。" };
  const q100 = Number(m[1]) * 100 + Number(frac.padEnd(2, "0"));
  if (q100 > INVOICE_LIMITS.quantityMax100) return { error: "数量は0.01〜99,999.99で入力してください。" };
  return q100;
};

// 単価の入力を読む。整数(円)。値引きのマイナスもよい(「−」「ー」も負の印として読む)
export const parseUnitPriceInput = (value: string): number | null | { error: string } => {
  const s = toHalfWidth(value)
    .replace(/[,円¥￥\s]/g, "")
    .replace(/^[−‐ー–]/, "-");
  if (s === "") return null;
  if (!/^-?\d+$/.test(s)) return { error: "単価は整数（円）で入力してください。" };
  const n = Number(s);
  if (Math.abs(n) > INVOICE_LIMITS.unitPrice) return { error: "単価は −9,999,999〜9,999,999 の整数（円）で入力してください。" };
  return n;
};

// ---- 0.2 お支払期限の初期値 ----

export type CustomerTerms = { closingDay: number | null; paymentMonthOffset: number | null; paymentDay: number | null };

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// 発行日を含む締めの期間の締め日 → その payment_month_offset か月後の payment_day 日(31 は月末)。
// 条件が無ければ null(人が入れる)。銀行の休日のずらしはしない(E-05-仮-06)
export const defaultDueDate = (terms: CustomerTerms, issuedOn: string): string | null => {
  if (terms.closingDay === null || terms.paymentMonthOffset === null || terms.paymentDay === null) return null;
  if (!isValidDateStr(issuedOn)) return null;
  const y = Number(issuedOn.slice(0, 4));
  const m = Number(issuedOn.slice(5, 7));
  const d = Number(issuedOn.slice(8, 10));
  const closingThisMonth = terms.closingDay >= MONTH_END_DAY ? lastDayOf(y, m) : Math.min(terms.closingDay, lastDayOf(y, m));
  // 締め日を過ぎていれば、締めは翌月
  const closingMonthOffset = d <= closingThisMonth ? 0 : 1;
  const base = `${issuedOn.slice(0, 7)}-01`;
  return termsDueDate(base, closingMonthOffset + terms.paymentMonthOffset, terms.paymentDay);
};

// ---- 合計の表示(01 9.1 の 4・5: 税率ごとの合計と消費税額) ----

export type TotalsView = Pick<InvoiceTotals, "subtotal10" | "tax10" | "subtotal8" | "tax8" | "subtotalExempt" | "subtotal" | "tax" | "total">;
export type TaxSummaryRow = { key: string; label: string; amount: number; amountNote: string; taxLabel: string | null; tax: number | null };

// 税率ごとの行。税抜で入力したときは「10％対象（税抜）／消費税」、税込のときは「10％対象（税込）／うち消費税」
export const taxSummaryRows = (t: TotalsView, basis: PriceBasis): TaxSummaryRow[] => {
  const inclusive = basis === "inclusive";
  const row = (key: string, label: string, subtotal: number, tax: number): TaxSummaryRow => ({
    key,
    label,
    amount: inclusive ? subtotal + tax : subtotal,
    amountNote: inclusive ? "（税込）" : "（税抜）",
    taxLabel: inclusive ? "うち消費税" : "消費税",
    tax,
  });
  const rows: TaxSummaryRow[] = [];
  if (t.subtotal10 !== 0 || t.tax10 !== 0) rows.push(row("10", "10％対象", t.subtotal10, t.tax10));
  if (t.subtotal8 !== 0 || t.tax8 !== 0) rows.push(row("8", "8％対象（軽減税率）", t.subtotal8, t.tax8));
  if (t.subtotalExempt !== 0)
    rows.push({ key: "0", label: "0％（対象外）", amount: t.subtotalExempt, amountNote: "", taxLabel: null, tax: null });
  if (rows.length === 0) rows.push(row("10", "10％対象", 0, 0));
  return rows;
};

// ---- 請求書番号(CH-12) ----

// 発行日の年月(YYYYMM)
export const invoiceNoPrefix = (issuedOn: string): string => issuedOn.slice(0, 7).replace("-", "");
// 202611-003
export const formatInvoiceNo = (issuedOn: string, seq: number): string => `${invoiceNoPrefix(issuedOn)}-${String(seq).padStart(3, "0")}`;
export const INVOICE_NO_MAX_SEQ = 999;

// ---- 写し・表示(0.3) ----

export type CompanySettings = {
  companyName: string;
  postalCode: string | null;
  address: string | null;
  tel: string | null;
  fax: string | null;
  email: string | null;
  registrationNo: string | null;
  bankName: string | null;
  bankBranch: string | null;
  bankAccountType: string | null;
  bankAccountNo: string | null;
  bankAccountHolder: string | null;
  rounding: Rounding;
};

// 振込先の文(「〇〇銀行 〇〇支店 普通 1234567 カ）マツリスミタヤ」)。空なら null
export const bankTextOf = (c: CompanySettings | null): string | null => {
  if (!c) return null;
  const text = [c.bankName, c.bankBranch, c.bankAccountType, c.bankAccountNo, c.bankAccountHolder]
    .map((v) => (v ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return text || null;
};

// 宛名(取引先名＋敬称)
export const addresseeOf = (name: string | null, honorific: string | null): string =>
  name ? `${name} ${honorific ?? "御中"}` : "（取引先を選んでください）";

// 請求書番号の表示(下書きは「（下書き）」)
export const invoiceNoLabel = (status: InvoiceStatus, invoiceNo: string | null): string =>
  status === "draft" || !invoiceNo ? "（下書き）" : invoiceNo;

// PDF に保存するときのファイル名の例(01 7章)
export const pdfFileName = (invoiceNo: string | null, customerName: string | null): string =>
  `請求書_${invoiceNo ?? "下書き"}_${customerName ?? "取引先"}.pdf`;

// ---- CH-02・CH-03 自社の情報 ----

export const COMPANY_MISSING = "自社の情報が登録されていません。管理者に連絡してください。";

// 会社名・登録番号がそろっているか(CH-02)
export const isCompanyReady = (c: CompanySettings | null): boolean =>
  Boolean(c && c.companyName.trim() && (c.registrationNo ?? "").trim());

// ---- 入力の形(CH-13) ----

export type InvoiceLineInput = {
  transactionOn: string | null;
  productId: string | null;
  description: string;
  quantity100: number | null;
  unit: string | null;
  unitPrice: number | null;
  taxRate: TaxRate;
};

export type InvoiceInput = {
  customerId: string | null;
  subject: string | null;
  issuedOn: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  priceBasis: PriceBasis;
  note: string | null;
  lines: InvoiceLineInput[];
};

export type InvoiceFormResult = { ok: true; input: InvoiceInput } | { ok: false; errors: Record<string, string> };

const text = (values: Record<string, string>, name: string): string => (values[name] ?? "").trim();
const DATE_ERROR = "正しい日付を入力してください。";
const maxText = (label: string, max: number) => `${label}は${max.toLocaleString("ja-JP")}文字以内で入力してください。`;

// 画面から送られた値を読む(画面の合計・金額は使わない。CH-06)。下書きの保存では必須の欠けは止めない
export const parseInvoiceForm = (values: Record<string, string>): InvoiceFormResult => {
  const errors: Record<string, string> = {};
  const date = (name: string): string | null => {
    const v = text(values, name).replace(/\//g, "-");
    if (!v) return null;
    if (!isValidDateStr(v)) {
      errors[name] = DATE_ERROR;
      return null;
    }
    return v;
  };
  const str = (name: string, max: number, label: string): string | null => {
    const v = text(values, name);
    if (v.length > max) errors[name] = maxText(label, max);
    return v || null;
  };

  const customerId = text(values, "customer_id") || null;
  const subject = str("subject", INVOICE_LIMITS.subject, "件名");
  const issuedOn = date("issued_on");
  const periodStart = date("period_start");
  const periodEnd = date("period_end");
  if (periodStart && periodEnd && periodStart > periodEnd) errors.period_end = "取引期間は「開始 ≦ 終わり」にしてください。";
  const dueOn = date("due_on");
  const basisRaw = text(values, "price_basis");
  if (!isPriceBasis(basisRaw)) errors.price_basis = "単価の入力（税抜・税込）を選んでください。";
  const priceBasis: PriceBasis = isPriceBasis(basisRaw) ? basisRaw : DEFAULT_PRICE_BASIS;
  const note = str("note", INVOICE_LIMITS.note, "備考");

  // 明細: 空の行(品名・数量・単価がすべて空)は捨てる(CH-05)
  const count = Math.min(Number(text(values, "line_count")) || 0, INVOICE_LIMITS.lines + 50);
  const lines: InvoiceLineInput[] = [];
  for (let i = 0; i < count; i++) {
    const k = (f: string) => `l${i}_${f}`;
    const desc = text(values, k("desc"));
    const qtyRaw = text(values, k("qty"));
    const priceRaw = text(values, k("price"));
    if (!desc && !qtyRaw && !priceRaw) continue;
    const no = lines.length + 1;
    if (desc.length > INVOICE_LIMITS.description) errors[k("desc")] = `${no}行目の${maxText("品名", INVOICE_LIMITS.description)}`;
    const qty = parseQuantityInput(qtyRaw);
    if (qty !== null && typeof qty === "object") errors[k("qty")] = `${no}行目: ${qty.error}`;
    const price = parseUnitPriceInput(priceRaw);
    if (price !== null && typeof price === "object") errors[k("price")] = `${no}行目: ${price.error}`;
    const unit = text(values, k("unit"));
    if (unit.length > INVOICE_LIMITS.unit) errors[k("unit")] = `${no}行目の${maxText("単位", INVOICE_LIMITS.unit)}`;
    const rate = Number(text(values, k("rate")));
    if (!isTaxRate(rate)) errors[k("rate")] = `${no}行目の税率を選んでください。`;
    const lineDateRaw = text(values, k("date")).replace(/\//g, "-");
    let transactionOn: string | null = null;
    if (lineDateRaw) {
      if (isValidDateStr(lineDateRaw)) transactionOn = lineDateRaw;
      else errors[k("date")] = `${no}行目の日付: ${DATE_ERROR}`;
    }
    const productId = text(values, k("product"));
    lines.push({
      transactionOn,
      productId: /^[0-9a-f-]{36}$/i.test(productId) ? productId : null,
      description: desc,
      quantity100: typeof qty === "number" ? qty : null,
      unit: unit || null,
      unitPrice: typeof price === "number" ? price : null,
      taxRate: isTaxRate(rate) ? rate : DEFAULT_TAX_RATE,
    });
  }
  if (lines.length > INVOICE_LIMITS.lines) errors.lines = `明細は${INVOICE_LIMITS.lines}行までにしてください。`;

  // 金額が DB に入る範囲か(E-05-仮-11)
  const amounts = lines.map((l) => calcLineAmount(l.quantity100, l.unitPrice));
  amounts.forEach((a, i) => {
    if (Math.abs(a) > INVOICE_LIMITS.amount) errors[`amount_${i}`] = `${i + 1}行目の金額が大きすぎます（${formatYen(INVOICE_LIMITS.amount)}まで）。`;
  });

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { customerId, subject, issuedOn, periodStart, periodEnd, dueOn, priceBasis, note, lines } };
};

// ---- CH-09 発行できる条件(CH-02〜CH-05・CH-08) ----

export type IssueCheckCustomer = { name: string; isActive: boolean } | null;

const addYears = (date: string, years: number): string => {
  const y = Number(date.slice(0, 4)) + years;
  const m = Number(date.slice(5, 7));
  const d = Math.min(Number(date.slice(8, 10)), lastDayOf(y, m));
  return `${y}-${date.slice(5, 7)}-${String(d).padStart(2, "0")}`;
};

// 発行するのに満たしていない条件の文を、すべて返す(0件なら発行できる)
export const issueBlockers = (
  input: InvoiceInput,
  ctx: { company: CompanySettings | null; customer: IssueCheckCustomer; today: string; rounding: Rounding }
): string[] => {
  const out: string[] = [];

  // CH-02・CH-03 自社の情報
  if (!isCompanyReady(ctx.company)) out.push(COMPANY_MISSING);
  else if (!isValidRegistrationNo(normalizeRegistrationNo(ctx.company?.registrationNo ?? "")))
    out.push("登録番号は T と数字13けたで入力してください。（自社の情報。管理者に連絡してください）");

  // CH-04 宛先
  if (!input.customerId || !ctx.customer) out.push("取引先を選んでください。");
  else if (!ctx.customer.isActive || !ctx.customer.name.trim())
    out.push("この取引先は使われていません（取引先マスタで確認してください）。");

  // CH-05 明細
  if (input.lines.length === 0) out.push("明細を1行以上入力してください。");
  if (input.lines.length > INVOICE_LIMITS.lines) out.push(`明細は${INVOICE_LIMITS.lines}行までにしてください。`);
  input.lines.forEach((l, i) => {
    const no = i + 1;
    if (!l.description.trim()) out.push(`${no}行目の品名を入力してください。`);
    if (l.quantity100 === null) out.push(`${no}行目の数量を入力してください。`);
    else if (l.quantity100 < INVOICE_LIMITS.quantityMin100 || l.quantity100 > INVOICE_LIMITS.quantityMax100)
      out.push(`${no}行目の数量は0.01〜99,999.99で入力してください。`);
    if (l.unitPrice === null) out.push(`${no}行目の単価を入力してください。`);
  });
  const totals = calcInvoiceTotals(input.lines, input.priceBasis, ctx.rounding);
  if (totals.gross10 < 0) out.push("10％対象の合計がマイナスです。");
  if (totals.gross8 < 0) out.push("8％対象の合計がマイナスです。");
  if (totals.subtotalExempt < 0) out.push("0％（対象外）の合計がマイナスです。");
  if (input.lines.length > 0 && totals.total < 1) out.push("ご請求額が1円以上になるようにしてください。");
  if (Math.abs(totals.total) > INVOICE_LIMITS.amount) out.push(`ご請求額が大きすぎます（${formatYen(INVOICE_LIMITS.amount)}まで）。`);

  // CH-08 日付
  if (!input.issuedOn) out.push("発行日を入力してください。");
  else if (input.issuedOn < addYears(ctx.today, -1) || input.issuedOn > addYears(ctx.today, 1))
    out.push("発行日は今日から前後1年以内にしてください。");
  const hasPeriod = Boolean(input.periodStart && input.periodEnd);
  if (!hasPeriod && input.lines.some((l) => !l.transactionOn))
    out.push("取引の日付（明細の日付か、取引期間）を入力してください。");
  if (input.periodStart && input.periodEnd && input.periodStart > input.periodEnd) out.push("取引期間は「開始 ≦ 終わり」にしてください。");
  if (input.dueOn && input.issuedOn && input.dueOn <= input.issuedOn) out.push("お支払期限は発行日より後にしてください。");
  return out;
};

// CH-08 発行日より後の取引があるか(注意を出すだけ。発行は止めない)
export const hasLaterTransaction = (input: Pick<InvoiceInput, "issuedOn" | "lines">): boolean =>
  Boolean(input.issuedOn && input.lines.some((l) => l.transactionOn && l.transactionOn > (input.issuedOn ?? "")));
export const LATER_TRANSACTION_WARNING = "発行日より後の取引が含まれています。";

// ---- 商品から選ぶ(EV-04) ----

// 商品の売価を、単価の入力(税抜・税込)に合わせる。【仮】換算の1円未満は四捨五入(00_仮決め一覧 E-05-仮-12)
export const productUnitPrice = (
  sellPrice: number | null,
  taxIncluded: boolean,
  taxRate: number,
  basis: PriceBasis
): number | null => {
  if (sellPrice === null) return null;
  if (!isTaxRate(taxRate) || taxRate === 0) return sellPrice;
  if (basis === "inclusive" && !taxIncluded) return divide(sellPrice * (100 + taxRate), 100, "round");
  if (basis === "exclusive" && taxIncluded) return divide(sellPrice * 100, 100 + taxRate, "round");
  return sellPrice;
};

// 品名(商品名・サイズ・色)
export const productDescription = (p: { name: string; size: string | null; color: string | null }): string =>
  [p.name, p.color, p.size].filter((v) => v && v.trim()).join(" ");
