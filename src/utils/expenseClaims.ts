// 経費精算(E-07)の決まりと計算(01 4.1・4.2・7.2・7.3、03 の 0.2・0.3、04 CH-04〜CH-13・CH-17・CH-19)。
// ファイル名は、みるきーの expenses.ts(保護者への実費の請求)と取り違えないよう expenseClaims にした(03 の 0章)。
// 合計の検算・消費税額の検算・二重計上の疑いの判定・規程の確認はすべてここの計算で行う(AIは読むだけ。01 の 1章)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は expenseClaimsServer.ts。
// みるきーの expenses.ts から、全角の数字の読み取り(normalizeDigits・parsePrice の考え方)と CSV の作りを流用した
// (src/utils/textNormalize.ts の parseNonNegativeInt、src/utils/csv.ts を使う)。
import {
  AMOUNT_CHECK_YEN,
  APPLY_DEADLINE_DAYS,
  ATTENDEE_TITLE_NAMES,
  CREDIT_TITLE_NAME,
  EXPENSE_TAX_TOLERANCE_YEN,
  OLDEST_RECEIPT_YEARS,
  PER_PERSON_MEAL_YEN,
  PURPOSE_REQUIRED,
  SUPPLIES_ASSET_YEN,
  SUPPLIES_TITLE_NAME,
} from "@/utils/expenseRules";
import type { CsvCell } from "@/utils/csv";
import { formatDateShort, formatQuantity, formatYen } from "@/utils/format";
import {
  isValidRegistrationNo,
  normalizeCompanyName,
  normalizeRegistrationNo,
  parseAiAmount,
  parseAiDate,
} from "@/utils/payables";
import { isValidDateStr, parseNonNegativeInt, toHalfWidth } from "@/utils/textNormalize";

// ---- 決まった値 ----

export const EXPENSE_STATUSES = {
  draft: "下書き",
  submitted: "承認待ち",
  returned: "差し戻し",
  approved: "承認済み",
  withdrawn: "取り下げ",
} as const;
export type ExpenseStatus = keyof typeof EXPENSE_STATUSES;
export const isExpenseStatus = (v: string): v is ExpenseStatus => Object.hasOwn(EXPENSE_STATUSES, v);

export const EXPENSE_PAYMENT_METHODS = {
  cash: "現金（立て替え）",
  personal_card: "自分のカード",
  company_card: "会社のカード",
  other: "その他",
} as const;
export type ExpensePaymentMethod = keyof typeof EXPENSE_PAYMENT_METHODS;
export const isExpensePaymentMethod = (v: string): v is ExpensePaymentMethod => Object.hasOwn(EXPENSE_PAYMENT_METHODS, v);

export const TITLE_SOURCES = { history: "履歴", ai: "AIの案", manual: "手で選んだ" } as const;
export type TitleSource = keyof typeof TITLE_SOURCES;

// CH-04・CH-17 の上限
export const EXPENSE_LIMITS = {
  amount: 9_999_999,
  payeeName: 100,
  registrationNo: 20,
  itemsText: 200,
  purpose: 200,
  attendees: 200,
  noReceiptReason: 100,
  approveNote: 200,
  returnReason: 200,
} as const;

// 印(check_flags)にするチェック(03 の 0.3)。一覧で先に出す順(いちばん大事なものを先に)
export const FLAG_ORDER = ["CH-09", "CH-11", "CH-12", "CH-06", "CH-10"] as const;

export type AccountTitle = { id: string; code: string | null; name: string; description: string; isActive: boolean };

// CH-11 相手先・人数が要る科目か
export const needsAttendees = (titleName: string | null | undefined): boolean =>
  !!titleName && (ATTENDEE_TITLE_NAMES as readonly string[]).includes(titleName);

// ---- 01 7.2 支払先の名前のそろえ方 ----

// 全角・半角をそろえ、空白・「株式会社」「(株)」などを除く(E-04 の仕入先の名前と同じそろえ方)。「〇〇店」は残す(【仮】E-07-仮-12)
export const payeeKeyOf = (name: string | null | undefined): string | null => {
  if (!name) return null;
  const key = normalizeCompanyName(name).slice(0, EXPENSE_LIMITS.payeeName);
  return key || null;
};

// CH-09 の3「支払先の名前が似ている」: 片方がもう片方を含む
export const isSimilarPayee = (a: string | null, b: string | null): boolean =>
  !!a && !!b && (a === b || a.includes(b) || b.includes(a));

// ---- 金額の計算 ----

// 税込の金額に含まれる消費税額(税込 × 税率 ÷(100＋税率)、1円未満は切り捨て。E-05 01 4.2 の4と同じ計算。04 CH-06)
export const taxFromIncluded = (included: number, rate: 10 | 8): number => Math.floor((included * rate) / (100 + rate));

// CH-06 読み取った消費税額と、金額から計算した額の差が1円以内か(端数の処理は店ごとに違うため)
export const isTaxConsistent = (included: number, tax: number, rate: 10 | 8): boolean =>
  Math.abs(tax * (100 + rate) - included * rate) <= EXPENSE_TAX_TOLERANCE_YEN * (100 + rate);

// 「計4名」から人数を読む(CH-11 の2)。読めなければ null
export const parsePeopleCount = (attendees: string | null): number | null => {
  if (!attendees) return null;
  const m = toHalfWidth(attendees).match(/計\s*(\d{1,4})\s*[名人]/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 ? n : null;
};

// ---- CH-13 登録番号(注意だけ。印にはしない) ----

export const registrationNotice = (registrationNo: string | null): string | null => {
  if (!registrationNo) return "⚠ 登録番号なし（インボイスでない可能性）";
  return isValidRegistrationNo(registrationNo) ? null : "登録番号の形が正しくありません。";
};

// ---- CH-19 AIの読み取り結果の形 ----

// 2けたの年(「26/11/20」)は西暦(2026/11/20)にしてから読む。和暦・「2026年11月20日」は E-04 の parseAiDate で読む
export const parseReceiptDate = (v: unknown): string | null | "bad" => {
  if (typeof v === "string") {
    const m = toHalfWidth(v)
      .replace(/\s/g, "")
      .match(/^(\d{2})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m) return parseAiDate(`20${m[1]}/${m[2]}/${m[3]}`);
  }
  return parseAiDate(v);
};

export type ReceiptValues = {
  spentOn: string | null;
  payeeName: string | null;
  registrationNo: string | null;
  total: number | null;
  total10: number | null;
  // 書いていない消費税額は null(CH-06: 計算した値を入れる)
  tax10: number | null;
  total8: number | null;
  tax8: number | null;
  totalExempt: number | null;
  itemsText: string | null;
};

export type NormalizedReceipt = {
  values: ReceiptValues;
  // AIの勘定科目の案(一覧にある名前と完全に同じときだけ。CH-19)
  titleName: string | null;
  titleReason: string | null;
  // ⚠ 要確認を付ける項目(画面の入力欄の name。AIが読めなかった・形を直した項目)
  flags: string[];
};

// AIの項目名 → 画面の入力欄の name(同じ名前にしてある)
const RECEIPT_FIELDS = [
  "spent_on",
  "payee_name",
  "registration_no",
  "total",
  "total_10",
  "tax_10",
  "total_8",
  "tax_8",
  "total_exempt",
  "items_text",
] as const;

const aiText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

// AIが返した JSON を、そのまま信じずに整える(CH-19)。形が全く違うときは null(読み取り失敗として手入力にする)
export const normalizeAiReceipt = (raw: unknown, activeTitleNames: readonly string[]): NormalizedReceipt | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const flags = new Set<string>();
  if (Array.isArray(r.unreadable)) {
    for (const f of r.unreadable) if (typeof f === "string" && (RECEIPT_FIELDS as readonly string[]).includes(f)) flags.add(f);
  }

  // 金額: 0以上の整数(「¥」「,」「円」付きの文字なら数字にする)。だめなら空にして要確認
  const amount = (key: (typeof RECEIPT_FIELDS)[number]): number | null => {
    const v = parseAiAmount(r[key]);
    if (v === "bad" || (typeof v === "number" && v > EXPENSE_LIMITS.amount)) {
      flags.add(key);
      return null;
    }
    return v;
  };
  const spent = parseReceiptDate(r.spent_on);
  if (spent === "bad") flags.add("spent_on");
  const regRaw = aiText(r.registration_no, 100);

  const values: ReceiptValues = {
    spentOn: spent === "bad" ? null : spent,
    payeeName: aiText(r.payee_name, EXPENSE_LIMITS.payeeName),
    // 登録番号は形が違ってもそのまま入れて注意(CH-19)
    registrationNo: regRaw ? normalizeRegistrationNo(regRaw).slice(0, EXPENSE_LIMITS.registrationNo) : null,
    total: amount("total"),
    total10: amount("total_10"),
    tax10: amount("tax_10"),
    total8: amount("total_8"),
    tax8: amount("tax_8"),
    totalExempt: amount("total_exempt"),
    itemsText: aiText(r.items_text, EXPENSE_LIMITS.itemsText),
  };
  const titleName = typeof r.account_title_name === "string" && activeTitleNames.includes(r.account_title_name) ? r.account_title_name : null;
  return {
    values,
    titleName,
    titleReason: titleName ? aiText(r.account_title_reason, 100) : null,
    flags: [...flags],
  };
};

// 読み取った値を、経費の列に入れる形にする(内訳・税額の空は計算で埋める。CH-05 の初期値・CH-06)
export const amountsFromReceipt = (v: ReceiptValues) => {
  const total = v.total ?? 0;
  let total10 = v.total10 ?? 0;
  const total8 = v.total8 ?? 0;
  const totalExempt = v.totalExempt ?? 0;
  // 内訳が全く読めなかったときは、合計を10％対象として入れる(CH-05。画面で検算の結果を出す)
  if (v.total10 === null && v.total8 === null && v.totalExempt === null) total10 = total;
  return {
    total,
    total10,
    tax10: v.tax10 ?? taxFromIncluded(total10, 10),
    total8,
    tax8: v.tax8 ?? taxFromIncluded(total8, 8),
    totalExempt,
  };
};

// ---- CH-04〜CH-08・CH-11 の1・CH-17 入力の確かめ ----

export type ExpenseInput = {
  spentOn: string | null;
  payeeName: string | null;
  registrationNo: string | null;
  total: number;
  total10: number;
  tax10: number;
  total8: number;
  tax8: number;
  totalExempt: number;
  paymentMethod: ExpensePaymentMethod;
  itemsText: string | null;
  purpose: string | null;
  attendees: string | null;
  accountTitleId: string | null;
  noReceiptReason: string | null;
};

export type ParseResult =
  | { ok: true; input: ExpenseInput; notices: string[] }
  | { ok: false; errors: Record<string, string> };

// n年前の同じ日(2/29 の n年前が無ければ 2/28)
export const yearsBefore = (today: string, years: number): string => {
  const y = Number(today.slice(0, 4)) - years;
  const candidate = `${y}-${today.slice(5)}`;
  return isValidDateStr(candidate) ? candidate : `${y}-02-28`;
};

// CH-07 これより前の日付は「1年より前」
export const oldestSpentOn = (today: string): string => yearsBefore(today, OLDEST_RECEIPT_YEARS);

// mode: draft(下書きを保存する。必須の欠けは止めない) / submit(申請する)
export const parseExpenseForm = (
  values: Record<string, string>,
  mode: "draft" | "submit",
  ctx: { today: string; hasReceipt: boolean; titles: readonly AccountTitle[]; currentTitleId: string | null }
): ParseResult => {
  const errors: Record<string, string> = {};
  const notices: string[] = [];
  const text = (name: string) => (values[name] ?? "").trim();
  const limited = (name: string, max: number, label: string): string | null => {
    const v = text(name);
    if (v.length > max) errors[name] = `${label}は${max}文字以内で入力してください。`;
    return v || null;
  };
  // CH-17 金額: 全角の数字・カンマ・「円」を取り除いてから、0以上の整数として読む
  const amount = (name: string): number | null => {
    const v = parseNonNegativeInt(text(name), EXPENSE_LIMITS.amount);
    if (v === "error") {
      errors[name] = `金額は0〜${formatQuantity(EXPENSE_LIMITS.amount)}の整数で入力してください。`;
      return null;
    }
    return v;
  };

  // 支払った日(CH-07・CH-17)
  const spentRaw = text("spent_on");
  let spentOn: string | null = null;
  if (spentRaw) {
    if (!isValidDateStr(spentRaw)) errors.spent_on = "支払った日の形が正しくありません。";
    else spentOn = spentRaw;
  }

  const payeeName = limited("payee_name", EXPENSE_LIMITS.payeeName, "支払先");
  const regRaw = text("registration_no");
  const registrationNo = regRaw ? normalizeRegistrationNo(regRaw) : null;
  if (registrationNo && registrationNo.length > EXPENSE_LIMITS.registrationNo)
    errors.registration_no = `登録番号は${EXPENSE_LIMITS.registrationNo}文字以内で入力してください。`;
  const itemsText = limited("items_text", EXPENSE_LIMITS.itemsText, "品目");
  const purpose = limited("purpose", EXPENSE_LIMITS.purpose, "用途");
  const attendees = limited("attendees", EXPENSE_LIMITS.attendees, "相手先・人数");
  const noReceiptReason = ctx.hasReceipt ? null : limited("no_receipt_reason", EXPENSE_LIMITS.noReceiptReason, "領収書がない理由");

  const total = amount("total");
  const total10In = amount("total_10");
  const tax10In = amount("tax_10");
  const total8In = amount("total_8");
  const tax8In = amount("tax_8");
  const exemptIn = amount("total_exempt");

  const method = text("payment_method") || "cash";
  if (!isExpensePaymentMethod(method)) errors.payment_method = "支払い方を選んでください。";

  // 勘定科目は申請では任意(CH-04)。選んだときは、使っている科目であること
  const titleId = text("account_title_id") || null;
  const title = titleId ? ctx.titles.find((t) => t.id === titleId) : undefined;
  if (titleId && (!title || (!title.isActive && titleId !== ctx.currentTitleId))) errors.account_title_id = "勘定科目を選び直してください。";

  // CH-05 内訳が空なら、10％対象＝合計(画面にそう出す)
  const breakdownEmpty = !total10In && !total8In && !exemptIn;
  const totalValue = total ?? 0;
  const total10 = breakdownEmpty ? totalValue : (total10In ?? 0);
  const total8 = breakdownEmpty ? 0 : (total8In ?? 0);
  const totalExempt = breakdownEmpty ? 0 : (exemptIn ?? 0);
  if (breakdownEmpty && totalValue > 0) notices.push("内訳を10％として申請します。");
  // CH-06 消費税額が空なら、計算した値(切り捨て)を入れる
  const tax10 = tax10In ?? taxFromIncluded(total10, 10);
  const tax8 = tax8In ?? taxFromIncluded(total8, 8);

  if (mode === "submit") {
    // CH-04 必須の項目
    if (!spentRaw) errors.spent_on = "支払った日を入力してください。";
    if (spentOn) {
      // CH-07 今日より後・1年より前はエラー
      if (spentOn > ctx.today) errors.spent_on = "支払った日が未来の日付です。";
      else if (spentOn < oldestSpentOn(ctx.today)) errors.spent_on = "1年より前の領収書は申請できません。経理にご相談ください。";
    }
    if (!payeeName && !errors.payee_name) errors.payee_name = "支払先を入力してください。";
    if (total === null && !errors.total) errors.total = "合計の金額を入力してください。";
    else if (total !== null && total < 1) errors.total = "合計の金額を入力してください。";
    if (PURPOSE_REQUIRED && !purpose && !errors.purpose) errors.purpose = "用途を入力してください。";
    // CH-05 合計と内訳の検算(合計は人が見て確かめた数字。AIに合計を計算させない)
    if (total !== null && total >= 1 && total10 + total8 + totalExempt !== totalValue && !errors.total_10 && !errors.total_8 && !errors.total_exempt)
      errors.breakdown = "内訳（10％・8％・対象外）の合計が、合計の金額と合いません。";
    // CH-08 領収書がないときの理由
    if (!ctx.hasReceipt && !noReceiptReason && !errors.no_receipt_reason)
      errors.no_receipt_reason = "領収書がない理由を入力してください（例: バス・電車の運賃）。";
    // CH-11 の1 交際費・会議費は相手先・人数が必須
    if (needsAttendees(title?.name) && !attendees && !errors.attendees)
      errors.attendees = "相手先と人数を入力してください（例: 〇〇町内会 山田様ほか2名、計4名）。";
  }

  if (Object.keys(errors).length > 0 || !isExpensePaymentMethod(method)) return { ok: false, errors };
  return {
    ok: true,
    notices: mode === "submit" ? notices : [],
    input: {
      spentOn,
      payeeName,
      registrationNo,
      total: totalValue,
      total10,
      tax10,
      total8,
      tax8,
      totalExempt,
      paymentMethod: method,
      itemsText,
      purpose,
      attendees,
      accountTitleId: titleId,
      noReceiptReason,
    },
  };
};

// ---- 03 の 0.3 チェックの印(申請は止めない。承認者に目立たせる) ----

export type DuplicateHit = { id: string; applicantName: string; spentOn: string | null; total: number };
export type Flag = { code: (typeof FLAG_ORDER)[number]; message: string };

export type CheckTarget = {
  spentOn: string | null;
  total: number;
  total10: number;
  tax10: number;
  total8: number;
  tax8: number;
  attendees: string | null;
  titleName: string | null;
};

export const duplicateMessage = (d: DuplicateHit): string =>
  `同じ領収書がすでに申請されている可能性があります（${d.spentOn ? `${formatDateShort(d.spentOn)} ` : ""}${d.applicantName} ${formatYen(d.total)}）。`;

// 日付の差(日)
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000);

// CH-06・CH-09・CH-10・CH-11 の2・CH-12。submittedOn は申請した日(日本時間)。二重計上の疑いの相手は呼ぶ側が DB で探して渡す
export const runExpenseChecks = (e: CheckTarget, submittedOn: string, duplicate: DuplicateHit | null): Flag[] => {
  const flags: Flag[] = [];
  // CH-09 二重計上の疑い
  if (duplicate) flags.push({ code: "CH-09", message: duplicateMessage(duplicate) });
  // CH-11 の2 1人あたりの金額(交際費・会議費を飲食として見る。【仮】E-07-仮-17)
  if (needsAttendees(e.titleName)) {
    const people = parsePeopleCount(e.attendees);
    if (people === null) flags.push({ code: "CH-11", message: "人数が分かりません。" });
    else if (e.total > PER_PERSON_MEAL_YEN * people)
      flags.push({
        code: "CH-11",
        message: `1人あたり ${formatYen(Math.floor(e.total / people))}です（1万円を超える飲食費は交際費になります）。`,
      });
  }
  // CH-12 金額の上限(仮)
  if (e.total >= AMOUNT_CHECK_YEN)
    flags.push({ code: "CH-12", message: `${formatQuantity(AMOUNT_CHECK_YEN / 10_000)}万円以上の経費です（事前の相談が必要か確認してください）。` });
  if (e.titleName === SUPPLIES_TITLE_NAME && e.total >= SUPPLIES_ASSET_YEN)
    flags.push({ code: "CH-12", message: `${formatQuantity(SUPPLIES_ASSET_YEN / 10_000)}万円以上の物品は、消耗品費ではなく資産になる可能性があります。` });
  // CH-06 消費税額の検算
  if (!isTaxConsistent(e.total10, e.tax10, 10) || !isTaxConsistent(e.total8, e.tax8, 8))
    flags.push({ code: "CH-06", message: "消費税額が、金額から計算した額と合いません（読み取りの誤りの可能性）。" });
  // CH-10 申請の期限(仮)
  if (e.spentOn && daysBetween(e.spentOn, submittedOn) > APPLY_DEADLINE_DAYS)
    flags.push({ code: "CH-10", message: `支払った日から${APPLY_DEADLINE_DAYS}日を過ぎています。` });
  return flags;
};

export const flagCodesOf = (flags: readonly Flag[]): string[] =>
  FLAG_ORDER.filter((code) => flags.some((f) => f.code === code));

// 一覧(G03)の「印」: いちばん大事な理由を短く(02 G03)
export const topFlagText = (codes: readonly string[], e: Pick<CheckTarget, "total" | "attendees">): string | null => {
  const top = FLAG_ORDER.find((c) => codes.includes(c));
  switch (top) {
    case "CH-09":
      return "二重の疑い";
    case "CH-11": {
      const people = parsePeopleCount(e.attendees);
      return people ? `1人あたり ${formatYen(Math.floor(e.total / people))}` : "人数が分かりません";
    }
    case "CH-12":
      return e.total >= AMOUNT_CHECK_YEN ? `${formatQuantity(AMOUNT_CHECK_YEN / 10_000)}万円以上` : "資産の可能性";
    case "CH-06":
      return "消費税額が合いません";
    case "CH-10":
      return `${APPLY_DEADLINE_DAYS}日を過ぎています`;
    default:
      return null;
  }
};

// ---- CH-14 承認できる条件・CH-15 差し戻しの理由 ----

export const approveBlockers = (e: {
  status: ExpenseStatus;
  titleId: string | null;
  titleActive: boolean;
  flags: readonly string[];
  note: string | null;
}): Record<string, string> => {
  const errors: Record<string, string> = {};
  if (e.status !== "submitted") errors.status = "承認待ちの経費ではありません。画面を開き直してください。";
  if (!e.titleId || !e.titleActive) errors.account_title_id = "勘定科目を選んでください。";
  if (e.flags.length > 0 && !e.note) errors.approve_note = "確認が必要な点があるため、ひとことを入力してください。";
  if (e.note && e.note.length > EXPENSE_LIMITS.approveNote) errors.approve_note = `ひとことは${EXPENSE_LIMITS.approveNote}文字以内で入力してください。`;
  return errors;
};

export const returnReasonError = (reason: string): string | null => {
  if (!reason) return "差し戻す理由を入力してください。本人に通知されます。";
  if (reason.length > EXPENSE_LIMITS.returnReason) return `差し戻す理由は${EXPENSE_LIMITS.returnReason}文字以内で入力してください。`;
  return null;
};

// ---- 01 7.3 承認済みの経費の CSV(汎用の仕訳の形・【仮】E-07-仮-14) ----

export const EXPENSE_CSV_HEADER = [
  "日付",
  "借方勘定科目",
  "借方科目コード",
  "金額（税込）",
  "税率",
  "消費税額",
  "貸方勘定科目",
  "摘要（支払先 用途）",
  "申請者",
  "登録番号",
] as const;

export type CsvExpense = {
  spentOn: string;
  titleName: string;
  titleCode: string | null;
  total10: number;
  tax10: number;
  total8: number;
  tax8: number;
  totalExempt: number;
  payeeName: string;
  purpose: string | null;
  applicantName: string;
  registrationNo: string | null;
};

// 1経費＝1行。10％と8％(と対象外)が混ざるときは税率ごとの行に分ける
export const buildExpenseCsvRows = (items: readonly CsvExpense[]): CsvCell[][] => {
  const rows: CsvCell[][] = [[...EXPENSE_CSV_HEADER]];
  for (const e of items) {
    const summary = [e.payeeName, e.purpose].filter(Boolean).join(" ");
    const parts: { amount: number; rate: string; tax: number }[] = [
      { amount: e.total10, rate: "10%", tax: e.tax10 },
      { amount: e.total8, rate: "8%", tax: e.tax8 },
      { amount: e.totalExempt, rate: "対象外", tax: 0 },
    ].filter((p) => p.amount > 0);
    for (const p of parts) {
      rows.push([
        e.spentOn.replace(/-/g, "/"),
        e.titleName,
        e.titleCode ?? "",
        p.amount,
        p.rate,
        p.tax,
        CREDIT_TITLE_NAME,
        summary,
        e.applicantName,
        e.registrationNo ?? "",
      ]);
    }
  }
  return rows;
};
