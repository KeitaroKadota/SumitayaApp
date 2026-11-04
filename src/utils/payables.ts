// 受け取った請求書(E-04)の決まりと計算(01 4.1・7.2・7.4、03 の 0.1〜0.3、04 CH-03〜CH-19)。
// 検算・突合・支払予定日はすべてここの計算で出す(AIは読むだけで、一致・不一致の判断はしない。01 の 4.2)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は payablesServer.ts。
import type { AcceptedSlip } from "@/utils/deliverySlips";
import { formatDateShort, formatYen } from "@/utils/format";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

// ---- 決まった値 ----

export const PAYABLE_STATUSES = {
  reading: "読み取り中",
  needs_review: "確認待ち",
  scheduled: "支払予定",
  cancelled: "取消",
} as const;
export type PayableStatus = keyof typeof PAYABLE_STATUSES;
export const isPayableStatus = (v: string): v is PayableStatus => Object.hasOwn(PAYABLE_STATUSES, v);

export const PAYABLE_KINDS = { purchase: "仕入れ", other: "その他" } as const;
export type PayableKind = keyof typeof PAYABLE_KINDS;
export const isPayableKind = (v: string): v is PayableKind => Object.hasOwn(PAYABLE_KINDS, v);

export const MATCH_RESULTS = {
  matched: "一致",
  difference: "差異あり",
  no_data: "データなし",
  not_applicable: "対象外",
} as const;
export type MatchResult = keyof typeof MATCH_RESULTS;

export const LINE_MATCH_STATUSES = {
  matched: "一致",
  amount_diff: "金額差異",
  price_diff: "単価差異",
  not_found: "検収なし",
  manual_ok: "差異を認めた",
  not_applicable: "−",
} as const;
export type LineMatchStatus = keyof typeof LINE_MATCH_STATUSES;

export const DUE_SOURCES = {
  invoice: "請求書から",
  terms: "締め日・支払日から計算",
  manual: "手入力",
} as const;
export type DueSource = keyof typeof DUE_SOURCES;

export const PAYMENT_METHODS = { transfer: "振込", debit: "口座振替", cash: "現金", other: "その他" } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export const isPaymentMethod = (v: string): v is PaymentMethod => Object.hasOwn(PAYMENT_METHODS, v);

export const TAX_RATES = [10, 8, 0] as const;
export type TaxRate = (typeof TAX_RATES)[number];
export const isTaxRate = (v: number): v is TaxRate => (TAX_RATES as readonly number[]).includes(v);

// 【仮】突合で「一致」とみなす差(円。00_仮決め一覧 E-04-仮-01、01 11章 #3)
export const MATCH_TOLERANCE_YEN = 0;
// 【仮】消費税額の検算で許す差(円。E-04-仮-02)
export const TAX_TOLERANCE_YEN = 1;
// 明細の「数量×単価」と金額で許す差(円。CH-06)
export const LINE_AMOUNT_TOLERANCE_YEN = 1;
// 【仮】支払日が銀行の休日のときは前の銀行の営業日にずらす(E-04-仮-03)
export const BANK_SHIFT_DIRECTION = "previous" as const;
// 【仮】確認待ちのタスクの期限: 支払予定日の3営業日前(銀行の営業日で数える)、分からなければ登録の3日後(E-04-仮-08・仮-12)
export const TASK_DUE_BUSINESS_DAYS_BEFORE = 3;
export const TASK_DUE_FALLBACK_DAYS = 3;
// 一覧の1ページの件数(00_画面共通ルール 4章)
export const PAYABLES_PAGE_SIZE = 50;

// CH-17 入力の上限
export const PAYABLE_LIMITS = {
  amount: 99_999_999,
  quantity: 9_999_999.99,
  payeeName: 100,
  description: 200,
  note: 1000,
  lines: 200,
  invoiceNo: 50,
  slipNo: 50,
  itemCode: 50,
  transferTo: 200,
  registrationNo: 20,
  approveNote: 200,
  cancelReason: 200,
} as const;

// 読み取りのときだけ決まる理由(CH-05 読み取ったお買上げ額との違い、CH-19 AIの読み取り結果)。
// 人が「保存する」を押すまで残し、保存したら外す(人が計算の結果を見て直したため。00_仮決め一覧 E-04-仮-13)
export const READ_REASON_CODES = ["CH-05", "CH-19"] as const;

// 一覧に出す理由の順(いちばん大事なものを先に)と、短い文(02 G01 の「確認待ちの理由」)
const REASON_ORDER = ["CH-19", "CH-09", "CH-04", "CH-05", "CH-06", "CH-07", "CH-08", "CH-10", "CH-11", "CH-12", "CH-13", "CH-03"];
const REASON_SHORT: Record<string, string> = {
  "CH-03": "登録番号を確認してください",
  "CH-04": "消費税額が合いません",
  "CH-05": "お買上げ額が合いません",
  "CH-06": "明細の合計が合いません",
  "CH-07": "今回ご請求額が合いません",
  "CH-08": "仕入先が分かりません",
  "CH-09": "同じ請求書がすでに登録されている可能性があります",
  "CH-10": "支払予定日を確認してください",
  "CH-11": "検収した合計と合いません",
  "CH-12": "納品書と合わない明細があります",
  "CH-13": "発注の単価と違う明細があります",
  "CH-19": "AIの読み取り結果を確認してください",
};
export const sortReasonCodes = (codes: readonly string[]): string[] =>
  [...new Set(codes)].sort((a, b) => {
    const ia = REASON_ORDER.indexOf(a);
    const ib = REASON_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
export const topReasonText = (codes: readonly string[], matchResult: MatchResult): string | null => {
  const [top] = sortReasonCodes(codes);
  if (!top) return null;
  if (top === "CH-11" && matchResult === "no_data") return "照合できる検収データがありません";
  return REASON_SHORT[top] ?? top;
};

// ---- 型 ----

export type InvoiceHeader = {
  kind: PayableKind;
  supplierId: string | null;
  payeeName: string | null;
  registrationNo: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  previousBalance: number | null;
  paymentReceived: number | null;
  carriedOver: number | null;
  subtotal10: number;
  tax10: number;
  subtotal8: number;
  tax8: number;
  subtotalExempt: number;
  amountDue: number;
  dueOn: string | null;
  dueDateSource: DueSource | null;
  paymentMethod: PaymentMethod | null;
  transferTo: string | null;
};

export type InvoiceLineInput = {
  lineDate: string | null;
  slipNo: string | null;
  description: string;
  itemCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
  taxRate: TaxRate;
};

export type InvoiceLine = InvoiceLineInput & {
  id: string | null;
  lineNo: number;
  deliverySlipId: string | null;
  purchaseOrderLineId: string | null;
  matchStatus: LineMatchStatus;
  diffAmount: number | null;
};

// CH-05 お買上げ額(税込)は税率ごとの金額の合計(画面の値は使わない)
export const purchaseTotalOf = (h: Pick<InvoiceHeader, "subtotal10" | "tax10" | "subtotal8" | "tax8" | "subtotalExempt">): number =>
  h.subtotal10 + h.tax10 + h.subtotal8 + h.tax8 + h.subtotalExempt;

// ---- 表示の小さな関数 ----

const MINUS = "−";
// +2,000円 / −22,000円
export const signedYen = (n: number): string => (n > 0 ? `+${formatYen(n)}` : n < 0 ? `${MINUS}${formatYen(-n)}` : formatYen(0));

// 数量は小数2けたまで。整数のときは小数を省く(02 G03【仮】)
export const formatInvoiceQuantity = (q: number | null): string => {
  if (q === null) return "−";
  const fixed = Number.isInteger(q) ? q.toLocaleString("ja-JP") : q.toLocaleString("ja-JP", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fixed;
};

// ---- CH-03 登録番号 ----

// 全角・空白・ハイフンを取り除き、先頭の t は T にする
export const normalizeRegistrationNo = (value: string): string =>
  toHalfWidth(value)
    .replace(/[\s\-‐－−ー]/g, "")
    .replace(/^t/, "T");
export const isValidRegistrationNo = (value: string): boolean => /^T\d{13}$/.test(value);

// ---- CH-08 仕入先の名前をそろえる ----

const COMPANY_TYPES = /株式会社|有限会社|合同会社|合資会社|合名会社|\(株\)|\(有\)|\(同\)|\(資\)|\(名\)/g;
// 会社の種類(「株式会社」「(株)」「㈱」など)・空白を取り除き、全角・半角をそろえる
export const normalizeCompanyName = (value: string): string =>
  toHalfWidth(value)
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .replace(COMPANY_TYPES, "")
    .replace(/[\s・.,、。]/g, "")
    .toLowerCase();

// ---- CH-19 AIの読み取り結果の形 ----

const AMOUNT_DECORATIONS = /[¥￥,，円\s]/g;

// 金額: 0以上の整数。「¥」「,」「円」付きの文字なら数字にする。だめなら "bad"
export const parseAiAmount = (v: unknown): number | null | "bad" => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= PAYABLE_LIMITS.amount ? v : "bad";
  if (typeof v !== "string") return "bad";
  const s = toHalfWidth(v).replace(AMOUNT_DECORATIONS, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return "bad";
  const n = Number(s);
  return n <= PAYABLE_LIMITS.amount ? n : "bad";
};

// 数量: 0以上、小数2けたまで(3けた目以降は四捨五入して "rounded")
export const parseAiQuantity = (v: unknown): { value: number | null; bad: boolean } => {
  if (v === null || v === undefined || v === "") return { value: null, bad: false };
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? toHalfWidth(v).replace(/[,，\s]/g, "") : "";
  if (!/^\d+(\.\d+)?$/.test(s)) return { value: null, bad: true };
  const n = Number(s);
  if (n > PAYABLE_LIMITS.quantity) return { value: null, bad: true };
  const rounded = Math.round(n * 100) / 100;
  return { value: rounded, bad: rounded !== n };
};

const ERAS: Record<string, number> = { 令和: 2018, R: 2018, 平成: 1988, H: 1988 };

// 日付: YYYY-MM-DD の正しい日付にする。「2026/10/31」「2026年10月31日」「令和8年10月31日」「R8.10.31」も読む
export const parseAiDate = (v: unknown): string | null | "bad" => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return "bad";
  const s = toHalfWidth(v).replace(/\s/g, "");
  const pad = (n: string) => n.padStart(2, "0");
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  let date: string | null = null;
  if (m) date = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(令和|平成|R|H)(元|\d{1,2})[年.](\d{1,2})[月.](\d{1,2})日?$/i);
  if (m) {
    const base = ERAS[m[1].toUpperCase()] ?? ERAS[m[1]];
    const year = base + (m[2] === "元" ? 1 : Number(m[2]));
    date = `${year}-${pad(m[3])}-${pad(m[4])}`;
  }
  return date && isValidDateStr(date) ? date : "bad";
};

// 税率: 10・8・0。だめなら 10 にして印を付ける
export const parseAiTaxRate = (v: unknown): { value: TaxRate; bad: boolean } => {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? toHalfWidth(v).replace(/[%％\s]/g, "") : "";
  if (s === "非課税" || s === "不課税" || s === "対象外") return { value: 0, bad: false };
  const n = Number(s);
  return s !== "" && isTaxRate(n) ? { value: n, bad: false } : { value: 10, bad: true };
};

const aiText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

export type NormalizedAiInvoice = {
  header: Omit<InvoiceHeader, "kind" | "supplierId" | "dueDateSource" | "paymentMethod"> & { dueOnStated: string | null };
  // AIが読み取った「お買上げ額」(CH-05 で計算した値と比べる)
  statedPurchaseTotal: number | null;
  lines: InvoiceLineInput[];
  // ⚠ 要確認を付ける項目(読めなかった・直した。header の項目名、明細は "lines.3.amount" の形)
  flags: string[];
  // 画面に出す注意(明細を200行までにしたなど)
  notes: string[];
};

const HEADER_FIELD_NAMES: Record<string, string> = {
  payee_name: "payeeName",
  registration_no: "registrationNo",
  invoice_no: "invoiceNo",
  invoice_date: "invoiceDate",
  period_start: "periodStart",
  period_end: "periodEnd",
  previous_balance: "previousBalance",
  payment_received: "paymentReceived",
  carried_over: "carriedOver",
  subtotal_10: "subtotal10",
  tax_10: "tax10",
  subtotal_8: "subtotal8",
  tax_8: "tax8",
  subtotal_exempt: "subtotalExempt",
  purchase_total: "purchaseTotal",
  amount_due: "amountDue",
  due_on: "dueOn",
  transfer_to: "transferTo",
};

// AIが返した JSON を、そのまま信じずに整える(CH-19)。形が全く違うときは null(読み取り失敗として手入力にする)
export const normalizeAiInvoice = (raw: unknown): NormalizedAiInvoice | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const flags = new Set<string>();
  const notes: string[] = [];

  // 読めなかった項目(unreadable)
  if (Array.isArray(r.unreadable)) {
    for (const f of r.unreadable) {
      if (typeof f !== "string") continue;
      flags.add(HEADER_FIELD_NAMES[f] ?? f);
    }
  }

  const amount = (key: string, nullable: boolean): number | null => {
    const v = parseAiAmount(r[key]);
    if (v === "bad") {
      flags.add(HEADER_FIELD_NAMES[key]);
      return nullable ? null : 0;
    }
    return v === null && !nullable ? 0 : v;
  };
  const date = (key: string): string | null => {
    const v = parseAiDate(r[key]);
    if (v === "bad") {
      flags.add(HEADER_FIELD_NAMES[key]);
      return null;
    }
    return v;
  };

  const regRaw = aiText(r.registration_no, 100);
  const registrationNo = regRaw ? normalizeRegistrationNo(regRaw).slice(0, PAYABLE_LIMITS.registrationNo) : null;

  const header: NormalizedAiInvoice["header"] = {
    payeeName: aiText(r.payee_name, PAYABLE_LIMITS.payeeName),
    registrationNo,
    invoiceNo: aiText(r.invoice_no, PAYABLE_LIMITS.invoiceNo),
    invoiceDate: date("invoice_date"),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    previousBalance: amount("previous_balance", true),
    paymentReceived: amount("payment_received", true),
    carriedOver: amount("carried_over", true),
    subtotal10: amount("subtotal_10", false) ?? 0,
    tax10: amount("tax_10", false) ?? 0,
    subtotal8: amount("subtotal_8", false) ?? 0,
    tax8: amount("tax_8", false) ?? 0,
    subtotalExempt: amount("subtotal_exempt", false) ?? 0,
    amountDue: amount("amount_due", false) ?? 0,
    dueOn: null,
    dueOnStated: date("due_on"),
    transferTo: aiText(r.transfer_to, PAYABLE_LIMITS.transferTo),
  };
  header.dueOn = header.dueOnStated;
  if (header.periodStart && header.periodEnd && header.periodStart > header.periodEnd) {
    flags.add("periodStart");
    flags.add("periodEnd");
  }
  const statedPurchaseTotal = amount("purchase_total", true);

  // 明細(200行まで)
  const rawLines = Array.isArray(r.lines) ? r.lines : [];
  if (rawLines.length > PAYABLE_LIMITS.lines) notes.push(`明細が多いため${PAYABLE_LIMITS.lines}行までにしました。`);
  const lines: InvoiceLineInput[] = [];
  rawLines.slice(0, PAYABLE_LIMITS.lines).forEach((item) => {
    if (typeof item !== "object" || item === null) return;
    const l = item as Record<string, unknown>;
    const i = lines.length + 1;
    const lineDate = parseAiDate(l.line_date);
    const qty = parseAiQuantity(l.quantity);
    const price = parseAiAmount(l.unit_price);
    const amt = parseAiAmount(l.amount);
    const rate = parseAiTaxRate(l.tax_rate);
    if (lineDate === "bad") flags.add(`lines.${i}.lineDate`);
    if (qty.bad) flags.add(`lines.${i}.quantity`);
    if (price === "bad") flags.add(`lines.${i}.unitPrice`);
    if (amt === "bad" || amt === null) flags.add(`lines.${i}.amount`);
    if (rate.bad) flags.add(`lines.${i}.taxRate`);
    lines.push({
      lineDate: lineDate === "bad" ? null : lineDate,
      slipNo: aiText(l.slip_no, PAYABLE_LIMITS.slipNo),
      description: aiText(l.description, PAYABLE_LIMITS.description) ?? "",
      itemCode: aiText(l.item_code, PAYABLE_LIMITS.itemCode),
      quantity: qty.value,
      unitPrice: price === "bad" ? null : price,
      amount: amt === "bad" || amt === null ? 0 : amt,
      taxRate: rate.value,
    });
  });

  return { header, statedPurchaseTotal, lines, flags: [...flags], notes };
};

// ---- CH-04〜CH-07 検算 ----

export type Reason = { code: string; message: string; href?: string };

export const checkArithmetic = (
  h: InvoiceHeader,
  lines: InvoiceLineInput[],
  statedPurchaseTotal: number | null
): Reason[] => {
  const reasons: Reason[] = [];
  const total = purchaseTotalOf(h);

  // CH-04 税率ごとの税額(1円まで許す)
  for (const [rate, subtotal, tax] of [
    [10, h.subtotal10, h.tax10],
    [8, h.subtotal8, h.tax8],
  ] as const) {
    if (subtotal === 0 && tax === 0) continue;
    const exact = (subtotal * rate) / 100;
    if (Math.abs(tax - exact) > TAX_TOLERANCE_YEN) {
      reasons.push({
        code: "CH-04",
        message: `${rate}％の消費税額が、金額から計算した額（${formatYen(Math.floor(exact))}）と合いません。`,
      });
    }
  }

  // CH-05 読み取ったお買上げ額と、税率ごとの金額の合計
  if (statedPurchaseTotal !== null && statedPurchaseTotal !== total) {
    reasons.push({
      code: "CH-05",
      message: `税率ごとの金額の合計（${formatYen(total)}）と、請求書のお買上げ額（${formatYen(statedPurchaseTotal)}）が合いません。`,
    });
  }

  // CH-06 明細の合計(明細があるときだけ)と、数量×単価
  if (lines.length > 0) {
    for (const [rate, subtotal, label] of [
      [10, h.subtotal10, "10％対象の金額"],
      [8, h.subtotal8, "8％対象の金額"],
      [0, h.subtotalExempt, "消費税がかからない金額"],
    ] as const) {
      const sum = lines.filter((l) => l.taxRate === rate).reduce((s, l) => s + l.amount, 0);
      if (sum !== subtotal) {
        reasons.push({ code: "CH-06", message: `明細の合計（${formatYen(sum)}）が、${label}（${formatYen(subtotal)}）と合いません。` });
      }
    }
    lines.forEach((l, i) => {
      if (l.quantity === null || l.unitPrice === null) return;
      if (Math.abs(Math.round(l.quantity * l.unitPrice) - l.amount) > LINE_AMOUNT_TOLERANCE_YEN) {
        reasons.push({ code: "CH-06", message: `${i + 1}行目の金額が、数量×単価と合いません。` });
      }
    });
  }

  // CH-07 ご請求額
  const expected =
    h.previousBalance !== null && h.paymentReceived !== null
      ? h.previousBalance - h.paymentReceived + total
      : (h.carriedOver ?? 0) + total;
  if (h.amountDue !== expected) {
    reasons.push({ code: "CH-07", message: "今回ご請求額が、前回の残り＋今回のお買上げ額と合いません。" });
  }
  return reasons;
};

// ---- 0.3 支払予定日(締め日・支払日から) ----

const lastDayOf = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// base("YYYY-MM-DD")の月に offset か月を足した月の day 日。31 は月末、その月に無い日は最後の日(00_共通設計 7.5)
export const termsDueDate = (base: string, monthOffset: number, day: number): string => {
  const y = Number(base.slice(0, 4));
  const m = Number(base.slice(5, 7));
  const total = y * 12 + (m - 1) + monthOffset;
  const ty = Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const d = Math.min(day, lastDayOf(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

export type DueOutcome = {
  dueOn: string | null;
  source: DueSource | null;
  // 請求書(読み取り・手入力)の日付と、条件から計算した日付(どちらも銀行の休日をずらした後)
  statedOn: string | null;
  termsOn: string | null;
  // 銀行の休日でずらす前の日付(ずらしたときだけ)
  shiftedFrom: string | null;
};

// ---- 0.2 突合(計算) ----

export type LineMatch = {
  matchStatus: LineMatchStatus;
  deliverySlipId: string | null;
  purchaseOrderLineId: string | null;
  diffAmount: number | null;
  // 結び付いた納品書の金額(税抜)と、発注の単価(文に使う)
  slipAmount: number | null;
  orderUnitPrice: number | null;
};

export type MatchOutcome = {
  matchResult: MatchResult;
  matchedTotal: number | null;
  differenceAmount: number | null;
  lines: LineMatch[];
  // 検収したが請求にない納品書(画面に「検収のみ」として出す。保存しない)
  slipOnly: AcceptedSlip[];
};

const emptyLineMatch = (status: LineMatchStatus): LineMatch => ({
  matchStatus: status,
  deliverySlipId: null,
  purchaseOrderLineId: null,
  diffAmount: null,
  slipAmount: null,
  orderUnitPrice: null,
});

// lines の manualOk が true の行は、人が差異を認めた行(状態を manual_ok のまま残す。理由に入れない)
export const matchDeliverySlips = (
  kind: PayableKind,
  purchaseTotal: number,
  lines: (InvoiceLineInput & { manualOk: boolean })[],
  slips: AcceptedSlip[]
): MatchOutcome => {
  const finish = (m: LineMatch, i: number): LineMatch => (lines[i].manualOk ? { ...m, matchStatus: "manual_ok" } : m);

  // 「その他」の請求書は突合しない
  if (kind === "other") {
    return {
      matchResult: "not_applicable",
      matchedTotal: null,
      differenceAmount: null,
      lines: lines.map(() => emptyLineMatch("not_applicable")),
      slipOnly: [],
    };
  }
  // 手順6: 検収の納品書が0件
  if (slips.length === 0) {
    return {
      matchResult: "no_data",
      matchedTotal: null,
      differenceAmount: null,
      lines: lines.map((_, i) => finish(emptyLineMatch("not_found"), i)),
      slipOnly: [],
    };
  }

  // 手順2: 合計
  const matchedTotal = slips.reduce((s, x) => s + x.total, 0);
  const differenceAmount = purchaseTotal - matchedTotal;
  const totalOk = Math.abs(differenceAmount) <= MATCH_TOLERANCE_YEN;

  // 明細が「1か月分の合計1行」だけ(伝票番号・日付が無い)なら、合計だけで判定する
  const totalOnly = lines.length === 0 || (lines.length === 1 && !lines[0].slipNo && !lines[0].lineDate);
  if (totalOnly) {
    return {
      matchResult: totalOk ? "matched" : "difference",
      matchedTotal,
      differenceAmount,
      lines: lines.map((_, i) => finish(emptyLineMatch("not_applicable"), i)),
      slipOnly: [],
    };
  }

  // 手順3: ① 伝票番号が同じ(同じ番号の明細はまとめて1枚の納品書と比べる) → ② 日付と金額(税抜)が同じ
  const result: LineMatch[] = lines.map(() => emptyLineMatch("not_found"));
  const used = new Set<string>();
  const bySlipNo = new Map<string, number[]>();
  lines.forEach((l, i) => {
    if (!l.slipNo) return;
    bySlipNo.set(l.slipNo, [...(bySlipNo.get(l.slipNo) ?? []), i]);
  });
  for (const [slipNo, idx] of bySlipNo) {
    const slip = slips.find((s) => !used.has(s.id) && s.slipNo === slipNo);
    if (!slip) continue;
    used.add(slip.id);
    const sum = idx.reduce((s, i) => s + lines[i].amount, 0);
    const diff = sum - slip.subtotal;
    idx.forEach((i, k) => {
      result[i] = {
        ...emptyLineMatch(diff !== 0 && k === 0 ? "amount_diff" : "matched"),
        deliverySlipId: slip.id,
        diffAmount: diff !== 0 && k === 0 ? diff : null,
        slipAmount: k === 0 ? slip.subtotal : null,
      };
    });
  }
  lines.forEach((l, i) => {
    if (result[i].deliverySlipId || !l.lineDate) return;
    const slip = slips.find((s) => !used.has(s.id) && s.deliveryDate === l.lineDate && s.subtotal === l.amount);
    if (!slip) return;
    used.add(slip.id);
    result[i] = { ...emptyLineMatch("matched"), deliverySlipId: slip.id, slipAmount: slip.subtotal };
  });

  // 手順4: 品番・単価があれば発注の単価と比べる(CH-13。発注が見つからなければしない)
  lines.forEach((l, i) => {
    const slipId = result[i].deliverySlipId;
    if (!slipId || !l.itemCode || l.unitPrice === null) return;
    const slipLine = slips.find((s) => s.id === slipId)?.lines.find((x) => x.itemCode === l.itemCode && x.orderUnitPrice !== null);
    if (!slipLine || slipLine.orderUnitPrice === null) return;
    result[i].purchaseOrderLineId = slipLine.purchaseOrderLineId;
    result[i].orderUnitPrice = slipLine.orderUnitPrice;
    if (l.unitPrice !== slipLine.orderUnitPrice && result[i].matchStatus === "matched") {
      result[i].matchStatus = "price_diff";
      result[i].diffAmount = Math.round((l.unitPrice - slipLine.orderUnitPrice) * (l.quantity ?? 1));
    }
  });

  // 手順5・6
  const finished = result.map(finish);
  const slipOnly = slips.filter((s) => !used.has(s.id));
  const allOk = finished.every((m) => m.matchStatus === "matched" || m.matchStatus === "manual_ok");
  return {
    matchResult: totalOk && allOk && slipOnly.length === 0 ? "matched" : "difference",
    matchedTotal,
    differenceAmount,
    lines: finished,
    slipOnly,
  };
};

// ---- 0.1 判定(理由を集める) ----

export type DuplicateHit = { id: string; createdAt: Date | string };

export type AssessInput = {
  header: InvoiceHeader;
  lines: InvoiceLineInput[];
  supplier: { registrationNo: string | null } | null;
  match: MatchOutcome;
  due: DueOutcome;
  duplicates: DuplicateHit[];
  // 読み取りの理由(CH-05・CH-19)を入れるか(READ_REASON_CODES の説明)
  readActive: boolean;
  // AIの読み取り結果(整えたもの)。手入力・読み取り失敗のときは null
  ai: NormalizedAiInvoice | null;
  today: string;
};

const lineLabel = (l: InvoiceLineInput) => [l.lineDate ? formatDateShort(l.lineDate) : "", l.slipNo ?? ""].filter(Boolean).join(" ");

export const assessInvoice = (input: AssessInput): Reason[] => {
  const { header: h, lines, match, due } = input;
  const reasons: Reason[] = [];

  // CH-19 AIの読み取り結果
  if (input.readActive) {
    if (!input.ai) reasons.push({ code: "CH-19", message: "AIで読み取れませんでした。請求書を見ながら内容を入力してください。" });
    else if (input.ai.flags.length > 0)
      reasons.push({ code: "CH-19", message: "AIが読めなかった・形を直した項目があります（⚠ 要確認の欄）。" });
  }

  // CH-04〜CH-07 検算(CH-05 は読み取りのときだけ)
  const arithmetic = checkArithmetic(h, lines, input.readActive && input.ai ? input.ai.statedPurchaseTotal : null);
  reasons.push(...arithmetic);

  // CH-03 登録番号(無いときは印だけで、理由にしない)
  if (h.registrationNo) {
    if (!isValidRegistrationNo(h.registrationNo))
      reasons.push({ code: "CH-03", message: "登録番号の形が正しくありません（T＋数字13けた）。" });
    else if (input.supplier?.registrationNo && input.supplier.registrationNo !== h.registrationNo)
      reasons.push({ code: "CH-03", message: `仕入先マスタの登録番号（${input.supplier.registrationNo}）と違います。` });
  }

  // CH-08 仕入先
  if (h.kind === "purchase" && !h.supplierId)
    reasons.push({
      code: "CH-08",
      message: "仕入先が分かりません。仕入先を選んでください（無ければ仕入先マスタに登録してください）。",
    });

  // CH-09 二重登録の疑い
  for (const d of input.duplicates) {
    reasons.push({
      code: "CH-09",
      message: `同じ請求書がすでに登録されている可能性があります（${formatDateShort(d.createdAt)} 登録）。`,
      href: `/admin/payables/${d.id}`,
    });
  }

  // CH-10 支払予定日
  if (!due.dueOn) reasons.push({ code: "CH-10", message: "支払予定日が分かりません。入力してください。" });
  else {
    if (due.statedOn && due.termsOn && due.statedOn !== due.termsOn)
      reasons.push({
        code: "CH-10",
        message: `支払期限（${formatDateShort(due.statedOn)}）が、仕入先の支払日（${formatDateShort(due.termsOn)}）と違います。`,
      });
    if (due.dueOn < input.today) reasons.push({ code: "CH-10", message: "支払予定日が過ぎています。" });
  }

  // CH-11 合計の突合
  if (match.matchResult === "no_data")
    reasons.push({ code: "CH-11", message: "照合できる検収データがありません（C-02 で検収が登録されていません）。" });
  else if (match.matchedTotal !== null && match.differenceAmount !== null && Math.abs(match.differenceAmount) > MATCH_TOLERANCE_YEN)
    reasons.push({
      code: "CH-11",
      message: `請求のお買上げ額（${formatYen(purchaseTotalOf(h))}）と、検収した合計（${formatYen(match.matchedTotal)}）が ${signedYen(match.differenceAmount)}違います。`,
    });

  // CH-12・CH-13 納品ごと・単価(検収のデータがあるときだけ。人が認めた行は入れない)
  if (match.matchResult === "matched" || match.matchResult === "difference") {
    match.lines.forEach((m, i) => {
      const l = lines[i];
      if (!l) return;
      if (m.matchStatus === "amount_diff" && m.diffAmount !== null && m.slipAmount !== null)
        reasons.push({
          code: "CH-12",
          message: `${lineLabel(l)} の金額が納品書（${formatYen(m.slipAmount)}）と ${signedYen(m.diffAmount)}違います。`,
        });
      else if (m.matchStatus === "not_found")
        reasons.push({
          code: "CH-12",
          message: `${l.lineDate ? `${formatDateShort(l.lineDate)} の` : `${i + 1}行目の`}明細（${formatYen(l.amount)}）に合う検収済みの納品書がありません。`,
        });
      else if (m.matchStatus === "price_diff" && m.orderUnitPrice !== null && l.unitPrice !== null)
        reasons.push({
          code: "CH-13",
          message: `${l.description || `${i + 1}行目`} の単価（${formatYen(l.unitPrice)}）が、発注の単価（${formatYen(m.orderUnitPrice)}）と違います。`,
        });
    });
    for (const s of match.slipOnly) {
      reasons.push({
        code: "CH-12",
        message: `検収済みの納品書（${[formatDateShort(s.deliveryDate), s.slipNo].filter(Boolean).join(" ")}・${formatYen(s.total)}）が請求書にありません。`,
      });
    }
  }
  return reasons;
};

// 理由のID(重複なし・大事な順)
export const reasonCodesOf = (reasons: Reason[]): string[] => sortReasonCodes(reasons.map((r) => r.code));

// 0.1 手順8: 状態を決める。cancelled はそのまま。
// 人が確認済みで理由が増えていなければそのまま、増えたら確認待ちに戻す。確認前は理由が0件なら支払予定、1件以上なら確認待ち
export const nextStatus = ({
  current,
  reviewed,
  previousCodes,
  codes,
}: {
  current: PayableStatus;
  reviewed: boolean;
  previousCodes: readonly string[];
  codes: readonly string[];
}): PayableStatus => {
  if (current === "cancelled") return current;
  if (reviewed && current !== "reading") {
    const increased = codes.some((c) => !previousCodes.includes(c));
    return increased ? "needs_review" : current;
  }
  return codes.length === 0 ? "scheduled" : "needs_review";
};

// ---- CH-15 支払予定にできる条件 ----

const ARITHMETIC_CODES = ["CH-04", "CH-05", "CH-06", "CH-07"];
const NOTE_REQUIRED_CODES = ["CH-09", "CH-10", "CH-11", "CH-12", "CH-13"];

export const scheduleBlockers = (
  h: InvoiceHeader,
  status: PayableStatus,
  reasons: Reason[],
  reviewNote: string | null
): string[] => {
  const blockers: string[] = [];
  // 4. 状態
  if (status !== "reading" && status !== "needs_review") blockers.push("確認待ちの請求書ではありません");
  // 1. 必須の項目
  if (!h.payeeName) blockers.push("請求元の名前を入力してください");
  if (!h.invoiceDate) blockers.push("請求日を入力してください");
  if (h.amountDue < 1) blockers.push("今回ご請求額を入力してください");
  if (!h.dueOn) blockers.push("支払予定日を入力してください");
  if (h.kind === "purchase" && !h.supplierId) blockers.push("仕入先を選んでください");
  // 2. 検算で合わない項目が残っていない
  for (const r of reasons.filter((x) => ARITHMETIC_CODES.includes(x.code))) blockers.push(r.message.replace(/。$/, ""));
  // 3. 突合・二重登録の要確認が残っているなら、確認のメモがある
  if (reasons.some((r) => NOTE_REQUIRED_CODES.includes(r.code)) && !reviewNote?.trim())
    blockers.push("差異・二重登録の疑い・支払予定日の要確認が残っているため、確認のメモを入力してください");
  return blockers;
};

// ---- CH-17 入力値の形(G03 の「保存する」) ----

export type InvoiceFormResult =
  | { ok: true; header: InvoiceHeader; lines: (InvoiceLineInput & { originalId: string | null })[]; reviewNote: string | null }
  | { ok: false; errors: Record<string, string> };

const text = (values: Record<string, string>, name: string) => (values[name] ?? "").trim();

const amountOf = (raw: string): number | null | "bad" => {
  const s = toHalfWidth(raw).replace(AMOUNT_DECORATIONS, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return "bad";
  const n = Number(s);
  return n <= PAYABLE_LIMITS.amount ? n : "bad";
};

const quantityOf = (raw: string): number | null | "bad" => {
  const s = toHalfWidth(raw).replace(/[,，\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "bad";
  const n = Number(s);
  return n <= PAYABLE_LIMITS.quantity ? n : "bad";
};

const AMOUNT_ERROR = "0〜99,999,999 の整数（円）で入力してください。";
const DATE_ERROR = "正しい日付を入力してください。";

export const parseInvoiceForm = (
  values: Record<string, string>,
  current: { dueOn: string | null; dueDateSource: DueSource | null }
): InvoiceFormResult => {
  const errors: Record<string, string> = {};
  const kindRaw = text(values, "kind");
  const kind: PayableKind = isPayableKind(kindRaw) ? kindRaw : "purchase";
  if (!isPayableKind(kindRaw)) errors.kind = "種類を選んでください。";

  const str = (name: string, max: number, label: string): string | null => {
    const v = text(values, name);
    if (v.length > max) errors[name] = `${label}は${max.toLocaleString("ja-JP")}文字以内で入力してください。`;
    return v || null;
  };
  const date = (name: string): string | null => {
    const v = text(values, name).replace(/\//g, "-");
    if (!v) return null;
    if (!isValidDateStr(v)) {
      errors[name] = DATE_ERROR;
      return null;
    }
    return v;
  };
  const amount = (name: string, required: boolean): number | null => {
    const v = amountOf(text(values, name));
    if (v === "bad") {
      errors[name] = AMOUNT_ERROR;
      return null;
    }
    return v === null && required ? 0 : v;
  };

  const supplierId = text(values, "supplier_id") || null;
  const registrationRaw = text(values, "registration_no");
  const registrationNo = registrationRaw ? normalizeRegistrationNo(registrationRaw) : null;
  if (registrationNo && registrationNo.length > PAYABLE_LIMITS.registrationNo)
    errors.registration_no = "登録番号は T＋数字13けたで入力してください。";

  const periodStart = date("period_start");
  const periodEnd = date("period_end");
  if (periodStart && periodEnd && periodStart > periodEnd) errors.period_end = "請求の期間は「開始 ≦ 終わり」にしてください。";

  // 支払予定日: 空なら締め日・支払日から計算する。今の値から変えたら手入力
  const dueOn = date("due_on");
  const dueDateSource: DueSource | null = !dueOn
    ? null
    : dueOn === current.dueOn && current.dueDateSource
      ? current.dueDateSource
      : "manual";

  const pm = text(values, "payment_method");
  const header: InvoiceHeader = {
    kind,
    supplierId,
    payeeName: str("payee_name", PAYABLE_LIMITS.payeeName, "請求元の名前"),
    registrationNo,
    invoiceNo: str("invoice_no", PAYABLE_LIMITS.invoiceNo, "請求書番号"),
    invoiceDate: date("invoice_date"),
    periodStart,
    periodEnd,
    previousBalance: amount("previous_balance", false),
    paymentReceived: amount("payment_received", false),
    carriedOver: amount("carried_over", false),
    subtotal10: amount("subtotal_10", true) ?? 0,
    tax10: amount("tax_10", true) ?? 0,
    subtotal8: amount("subtotal_8", true) ?? 0,
    tax8: amount("tax_8", true) ?? 0,
    subtotalExempt: amount("subtotal_exempt", true) ?? 0,
    amountDue: amount("amount_due", true) ?? 0,
    dueOn,
    dueDateSource,
    paymentMethod: isPaymentMethod(pm) ? pm : null,
    transferTo: str("transfer_to", PAYABLE_LIMITS.transferTo, "振込先"),
  };
  if (pm && !isPaymentMethod(pm)) errors.payment_method = "支払方法を選び直してください。";
  if (purchaseTotalOf(header) > PAYABLE_LIMITS.amount) errors.subtotal_10 = "お買上げ額が大きすぎます。";
  const reviewNote = str("review_note", PAYABLE_LIMITS.note, "確認のメモ");

  // 明細(200行まで。品名・金額などがすべて空の行は捨てる)
  const count = Math.min(Number(text(values, "line_count")) || 0, 1000);
  const lines: (InvoiceLineInput & { originalId: string | null })[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = `l${i}_`;
    const fields = ["date", "slip", "desc", "code", "qty", "price", "amount"].map((f) => text(values, p + f));
    if (fields.every((f) => f === "")) continue;
    const n = lines.length + 1;
    const lineDateRaw = text(values, `${p}date`).replace(/\//g, "-");
    let lineDate: string | null = null;
    if (lineDateRaw) {
      if (isValidDateStr(lineDateRaw)) lineDate = lineDateRaw;
      else errors[`${p}date`] = `${n}行目の日付: ${DATE_ERROR}`;
    }
    const qty = quantityOf(text(values, `${p}qty`));
    if (qty === "bad") errors[`${p}qty`] = `${n}行目の数量: 0〜9,999,999.99、小数2けたまでで入力してください。`;
    const price = amountOf(text(values, `${p}price`));
    if (price === "bad") errors[`${p}price`] = `${n}行目の単価: ${AMOUNT_ERROR}`;
    const amt = amountOf(text(values, `${p}amount`));
    if (amt === "bad") errors[`${p}amount`] = `${n}行目の金額: ${AMOUNT_ERROR}`;
    const rate = Number(text(values, `${p}rate`));
    if (!isTaxRate(rate)) errors[`${p}rate`] = `${n}行目の税率: 10・8・0 のどれかを選んでください。`;
    const desc = text(values, `${p}desc`);
    if (desc.length > PAYABLE_LIMITS.description) errors[`${p}desc`] = `${n}行目の品名は200文字以内で入力してください。`;
    const slip = text(values, `${p}slip`);
    if (slip.length > PAYABLE_LIMITS.slipNo) errors[`${p}slip`] = `${n}行目の伝票番号は50文字以内で入力してください。`;
    const code = text(values, `${p}code`);
    if (code.length > PAYABLE_LIMITS.itemCode) errors[`${p}code`] = `${n}行目の品番は50文字以内で入力してください。`;
    lines.push({
      originalId: text(values, `${p}id`) || null,
      lineDate,
      slipNo: slip || null,
      description: desc,
      itemCode: code || null,
      quantity: qty === "bad" ? null : qty,
      unitPrice: price === "bad" ? null : price,
      amount: amt === "bad" || amt === null ? 0 : amt,
      taxRate: isTaxRate(rate) ? rate : 10,
    });
  }
  if (lines.length > PAYABLE_LIMITS.lines) errors.lines = `明細は${PAYABLE_LIMITS.lines}行までにしてください。`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, header, lines, reviewNote };
};

// CH-14 差異を認める理由
export const checkApproveNote = (note: string): string | null => {
  if (!note.trim()) return "差異を認める理由を入力してください。";
  if (note.length > PAYABLE_LIMITS.approveNote) return `差異を認める理由は${PAYABLE_LIMITS.approveNote}文字以内で入力してください。`;
  return null;
};

// EV-08 手順3: 確認のメモに足す文(「11/02（月） 山田: 10/12（月） A-007 単価差 +2,000円（税抜） 値上げの連絡あり」)
export const approveNoteLine = (today: string, lastName: string, target: string, note: string): string =>
  `${formatDateShort(today)} ${lastName}: ${target} ${note.trim()}`;

export const appendReviewNote = (current: string | null, line: string): string | null => {
  const next = current?.trim() ? `${current.trimEnd()}\n${line}` : line;
  return next.length > PAYABLE_LIMITS.note ? null : next;
};
