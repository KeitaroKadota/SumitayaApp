// 納品書の読み取り(C-01)の決まりと計算(01 7.2〜7.4・9章、04 CH-04〜CH-13)。
// 計算での見直し(数量×単価＝金額、合計、納品日の範囲など)はすべてここで行う(AIは読むだけ。01 の 6章)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読む処理は deliverySlipServer.ts。
// src/utils/deliverySlips.ts は C-02(照合・検収)が E-04 に渡す関数の置き場なので、C-01 の処理はこちらに置く。
import { parseAiDate } from "@/utils/payables";
import { isValidDateStr, toHalfWidth } from "@/utils/textNormalize";

// 日付("YYYY-MM-DD")に日数を足す(holidays.ts の addDays は DB を読むファイルにあるので、画面からも使えるようにここに置く)
const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

// ---- 決まった値 ----

export const SLIP_STATUSES = {
  draft: "確かめ中",
  confirmed: "確定→照合待ち",
  needs_review: "確認待ち（検収）",
  accepted: "検収済み",
  cancelled: "取消",
} as const;
export type SlipStatus = keyof typeof SLIP_STATUSES;
export const isSlipStatus = (v: string): v is SlipStatus => Object.hasOwn(SLIP_STATUSES, v);

export const READ_STATUSES = {
  pending: "待ち",
  reading: "読み取り中",
  done: "済み",
  failed: "失敗",
  manual: "手入力",
} as const;
export type ReadStatus = keyof typeof READ_STATUSES;

// 【仮】1件の納品書のページ数・明細の数(00_仮決め一覧 C-01-仮-02)
export const SLIP_MAX_PAGES = 5;
export const SLIP_MAX_LINES = 100;
// 【仮】読み取りの確かさの基準。伝票か明細のどれかがこれ未満なら「要確認」(C-01-仮-01)
export const CONFIDENCE_THRESHOLD = 0.8;
// 【仮】納品日の範囲: 今日から90日前〜今日(C-01-仮-03)
export const DELIVERY_DATE_PAST_DAYS = 90;
// 【仮】数量×単価と金額で許す差(円。C-01-仮-05)
export const LINE_AMOUNT_TOLERANCE_YEN = 1;
// 税額の見直しに使う税率(CH-08。10% か 8%)
const TAX_RATES_FOR_CHECK = [10, 8] as const;
// 【仮】読み取り中のまま、止まったとみなすまでの分(CH-05、C-01-仮-07)
export const READ_STALE_MINUTES = 2;
// AIの待ち時間(操作の最大時間60秒に収める。03 EV-06 手順5)
export const SLIP_AI_TIMEOUT_MS = 55_000;
// AIに添える、その仕入先の品番の一覧の最大件数(01 7.1)
export const ITEM_CODE_HINT_MAX = 200;
// 一覧の1ページの件数(00_画面共通ルール 4章)
export const SLIP_PAGE_SIZE = 50;

// CH-06・CH-13 入力の上限
export const SLIP_LIMITS = {
  amount: 99_999_999,
  quantity: 99_999.99,
  slipNo: 50,
  orderRef: 50,
  itemCode: 50,
  itemName: 100,
  spec: 100,
  unit: 20,
  note: 1000,
  supplierItemName: 100,
  packQuantity: 9999,
} as const;

// ---- 型 ----

export type SlipHeader = {
  supplierId: string | null;
  slipNo: string | null;
  deliveryDate: string | null;
  orderRef: string | null;
  taxIncluded: boolean;
  subtotal: number | null;
  tax: number | null;
  total: number | null;
  note: string | null;
};

export type SlipLineInput = {
  supplierItemCode: string | null;
  itemName: string;
  spec: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  amount: number | null;
  productId: string | null;
  isNonStock: boolean;
  confidence: number | null;
  isEdited: boolean;
};

// 見直しの印(項目と理由)。項目は header なら "supplier"・"deliveryDate"・"total" など、明細なら "quantity"・"amount" など
export type CheckFlag = { field: string; message: string };

// ---- 文字・数の整え方(CH-06) ----

// 品番: 前後の空白を取り、全角英数字を半角に、大文字にそろえる
export const normalizeItemCode = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const s = toHalfWidth(value).trim().toUpperCase();
  return s ? s.slice(0, SLIP_LIMITS.itemCode) : null;
};

const AMOUNT_DECORATIONS = /[¥￥,，円\s]/g;
// 「−500」「△500」「▲500」もマイナスとして読む(伝票の値引き・返品の書き方)
const MINUS_SIGNS = /^[-‐－−△▲]/;

const signedNumberText = (v: unknown): string | null => {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v !== "string") return "";
  const s = toHalfWidth(v).replace(AMOUNT_DECORATIONS, "");
  if (s === "") return null;
  return MINUS_SIGNS.test(s) ? `-${s.replace(MINUS_SIGNS, "")}` : s;
};

// 金額(整数)。小数は四捨五入して rounded。だめなら bad。min 未満(小計・税・合計は0以上)もだめ
export const parseSlipAmount = (v: unknown, { min = -SLIP_LIMITS.amount } = {}): { value: number | null; bad: boolean; rounded: boolean } => {
  if (v === null || v === undefined || v === "") return { value: null, bad: false, rounded: false };
  const s = signedNumberText(v);
  if (s === null) return { value: null, bad: false, rounded: false };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, bad: true, rounded: false };
  const n = Number(s);
  const r = Math.round(n);
  if (r < min || r > SLIP_LIMITS.amount) return { value: null, bad: true, rounded: false };
  return { value: r, bad: false, rounded: r !== n };
};

// 数量: −99,999.99〜99,999.99、小数2けたまで(3けた目以降は四捨五入して rounded)
export const parseSlipQuantity = (v: unknown): { value: number | null; bad: boolean; rounded: boolean } => {
  if (v === null || v === undefined || v === "") return { value: null, bad: false, rounded: false };
  const s = signedNumberText(v);
  if (s === null) return { value: null, bad: false, rounded: false };
  if (!/^-?\d+(\.\d+)?$/.test(s)) return { value: null, bad: true, rounded: false };
  const n = Number(s);
  const r = Math.round(n * 100) / 100;
  if (Math.abs(r) > SLIP_LIMITS.quantity) return { value: null, bad: true, rounded: false };
  return { value: r, bad: false, rounded: r !== n };
};

// 信頼度: 0〜1 の数。だめなら空(＝低いものとして扱う)
const parseConfidence = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? Math.round(v * 100) / 100 : null;

const aiText = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s.slice(0, max) : null;
};

// 数量の表示: 整数なら小数を付けない(10、2.5。02 G03)
export const formatSlipQuantity = (q: number | null): string =>
  q === null ? "" : q.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

// ---- CH-06 AIの読み取り結果を整える ----

export type NormalizedAiSlip = {
  supplierNameRead: string | null;
  supplierPhoneRead: string | null;
  header: Omit<SlipHeader, "supplierId" | "note">;
  lines: SlipLineInput[];
  confidence: number | null;
  // 整えたときに付けた印(伝票・明細ごと)
  headerFlags: CheckFlag[];
  lineFlags: CheckFlag[][];
  // AIの注意(notes)
  notes: string | null;
};

const READ_FAILED = "読み取れませんでした";
const ROUNDED = "小数を四捨五入しました";

// 読み取りのときに整えて付けた印か(計算の印と違い、直すまで残す。画面で計算の印を作り直すときに使う)
export const isReadFlag = (f: CheckFlag): boolean => f.message === READ_FAILED || f.message.includes("四捨五入") || f.field === "lines";

// AIが返した JSON を、そのまま信じずに整える。形が全く違うときは null(読み取りの失敗として手入力にする)
export const normalizeAiSlip = (raw: unknown): NormalizedAiSlip | null => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const headerFlags: CheckFlag[] = [];

  const amount = (key: string, field: string) => {
    const p = parseSlipAmount(r[key], { min: 0 });
    if (p.bad) headerFlags.push({ field, message: READ_FAILED });
    if (p.rounded) headerFlags.push({ field, message: ROUNDED });
    return p.value;
  };
  const date = parseAiDate(r.delivery_date);
  if (date === "bad") headerFlags.push({ field: "deliveryDate", message: READ_FAILED });
  const taxIncluded = r.tax_included === true;
  const tax = amount("tax", "tax");
  const total = amount("total", "total");
  let subtotal = amount("subtotal", "subtotal");
  // 税込の伝票で税抜の合計が無ければ、合計 − 税 で出す(01 9.1)
  if (taxIncluded && subtotal === null && total !== null && tax !== null && total >= tax) subtotal = total - tax;

  const rawLines = Array.isArray(r.lines) ? r.lines : [];
  const lines: SlipLineInput[] = [];
  const lineFlags: CheckFlag[][] = [];
  for (const item of rawLines) {
    if (typeof item !== "object" || item === null) continue;
    const l = item as Record<string, unknown>;
    const name = aiText(l.item_name, SLIP_LIMITS.itemName) ?? "";
    const code = normalizeItemCode(aiText(l.item_code, 200));
    const qty = parseSlipQuantity(l.quantity);
    // 品名・品番・数量のどれも無い行は捨てる
    if (!name && !code && qty.value === null) continue;
    if (lines.length >= SLIP_MAX_LINES) {
      headerFlags.push({ field: "lines", message: `明細が${SLIP_MAX_LINES}行を超えたため、${SLIP_MAX_LINES + 1}行目からは捨てました` });
      break;
    }
    const flags: CheckFlag[] = [];
    const price = parseSlipAmount(l.unit_price);
    const amt = parseSlipAmount(l.amount);
    if (!name) flags.push({ field: "itemName", message: READ_FAILED });
    if (qty.bad) flags.push({ field: "quantity", message: READ_FAILED });
    if (qty.rounded) flags.push({ field: "quantity", message: "小数3けた目以降を四捨五入しました" });
    if (price.bad) flags.push({ field: "unitPrice", message: READ_FAILED });
    if (price.rounded) flags.push({ field: "unitPrice", message: ROUNDED });
    if (amt.bad) flags.push({ field: "amount", message: READ_FAILED });
    if (amt.rounded) flags.push({ field: "amount", message: ROUNDED });
    lines.push({
      supplierItemCode: code,
      itemName: name,
      spec: aiText(l.spec, SLIP_LIMITS.spec),
      quantity: qty.value,
      unit: aiText(l.unit, SLIP_LIMITS.unit),
      unitPrice: price.value,
      amount: amt.value,
      productId: null,
      isNonStock: false,
      confidence: parseConfidence(l.confidence),
      isEdited: false,
    });
    lineFlags.push(flags);
  }

  return {
    supplierNameRead: aiText(r.supplier_name, 200),
    supplierPhoneRead: aiText(r.supplier_phone, 30),
    header: {
      slipNo: aiText(r.slip_no, SLIP_LIMITS.slipNo),
      deliveryDate: date === "bad" ? null : date,
      orderRef: aiText(r.order_ref, SLIP_LIMITS.orderRef),
      taxIncluded,
      subtotal,
      tax,
      total,
    },
    lines,
    confidence: parseConfidence(r.confidence),
    headerFlags,
    lineFlags,
    notes: aiText(r.notes, 300),
  };
};

// ---- EV-09 計算で見直す(CH-07〜CH-09) ----

export type SlipCheckResult = {
  headerFlags: CheckFlag[];
  lineFlags: CheckFlag[][];
  needsCheck: boolean;
  // CH-07・CH-08 の合わない項目があるか(EV-10 手順4 の確認に使う)
  hasArithmeticIssue: boolean;
};

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

export const checkSlip = ({
  header,
  lines,
  slipConfidence,
  hasAiResult,
  today,
}: {
  header: SlipHeader;
  lines: SlipLineInput[];
  slipConfidence: number | null;
  // AIで読み取った伝票か(手入力の伝票は信頼度を見ない)
  hasAiResult: boolean;
  today: string;
}): SlipCheckResult => {
  const headerFlags: CheckFlag[] = [];
  let arithmetic = false;

  // CH-07 数量×単価＝金額(1円の差まで許す)。1つが空なら、ほかの2つから計算した候補を出す(自動では入れない)
  const lineFlags = lines.map((l) => {
    const flags: CheckFlag[] = [];
    const { quantity: q, unitPrice: p, amount: a } = l;
    if (q !== null && p !== null && a !== null) {
      if (Math.abs(Math.round(q * p) - a) > LINE_AMOUNT_TOLERANCE_YEN) {
        arithmetic = true;
        for (const field of ["quantity", "unitPrice", "amount"]) flags.push({ field, message: "数量×単価が金額と合いません" });
      }
    } else if (q !== null && p !== null) {
      flags.push({ field: "amount", message: `金額が空です（候補: ${yen(Math.round(q * p))}）` });
    } else if (q !== null && a !== null && q !== 0) {
      flags.push({ field: "unitPrice", message: `単価が空です（候補: ${yen(Math.round(a / q))}）` });
    } else if (p !== null && a !== null && p !== 0) {
      flags.push({ field: "quantity", message: `数量が空です（候補: ${formatSlipQuantity(Math.round((a / p) * 100) / 100)}）` });
    }
    // CH-09 商品(在庫にしない品は選ばなくてよい)・明細の信頼度(人が直した明細は見ない)
    if (!l.isNonStock && !l.productId) flags.push({ field: "product", message: "自社の商品が決まっていません" });
    if (hasAiResult && !l.isEdited && (l.confidence === null || l.confidence < CONFIDENCE_THRESHOLD))
      flags.push({ field: "confidence", message: "読み取りの確かさが低い明細です" });
    return flags;
  });

  // CH-08 明細の合計・小計・税・合計(送料・値引きの行も明細として足す)
  const linesSum = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  const { subtotal, tax, total } = header;
  if (header.taxIncluded) {
    if (total !== null && lines.length > 0 && linesSum !== total) {
      arithmetic = true;
      headerFlags.push({ field: "total", message: `明細の合計（${yen(linesSum)}）が合計と合いません` });
    }
  } else if (subtotal !== null && lines.length > 0 && linesSum !== subtotal) {
    arithmetic = true;
    headerFlags.push({ field: "subtotal", message: `明細の合計（${yen(linesSum)}）が小計と合いません` });
  }
  if (subtotal !== null && tax !== null && total !== null && subtotal + tax !== total) {
    arithmetic = true;
    headerFlags.push({ field: "total", message: `小計＋税（${yen(subtotal + tax)}）が合計と合いません` });
  }
  if (subtotal !== null && tax !== null) {
    const allowance = lines.length + 1;
    const ok = TAX_RATES_FOR_CHECK.some((rate) => Math.abs((subtotal * rate) / 100 - tax) <= allowance);
    if (!ok) {
      arithmetic = true;
      headerFlags.push({ field: "tax", message: "税率を確かめてください（小計の10%・8%と合いません）" });
    }
  }

  // CH-09 納品日・仕入先・信頼度
  if (!header.deliveryDate) headerFlags.push({ field: "deliveryDate", message: "納品日がありません" });
  else if (header.deliveryDate > today || header.deliveryDate < addDays(today, -DELIVERY_DATE_PAST_DAYS))
    headerFlags.push({ field: "deliveryDate", message: `納品日が今日から${DELIVERY_DATE_PAST_DAYS}日前〜今日の間にありません` });
  if (!header.supplierId) headerFlags.push({ field: "supplier", message: "仕入先が決まっていません（選んでください）" });
  if (hasAiResult && (slipConfidence === null || slipConfidence < CONFIDENCE_THRESHOLD))
    headerFlags.push({ field: "confidence", message: "伝票全体の読み取りの確かさが低いです" });

  const needsCheck = headerFlags.length > 0 || lineFlags.some((f) => f.length > 0);
  return { headerFlags, lineFlags, needsCheck, hasArithmeticIssue: arithmetic };
};

// ---- CH-10 確定に必要な項目 ----

export const confirmBlockers = (header: SlipHeader, lines: SlipLineInput[]): string[] => {
  const blockers: string[] = [];
  if (!header.supplierId) blockers.push("仕入先を選んでください");
  if (!header.deliveryDate) blockers.push("納品日を入力してください");
  if (header.total === null) blockers.push("合計を入力してください");
  if (lines.length === 0) blockers.push("明細を1行以上入力してください");
  lines.forEach((l, i) => {
    const missing = [
      !l.itemName ? "品名" : "",
      l.quantity === null ? "数量" : "",
      l.unitPrice === null ? "単価" : "",
      l.amount === null ? "金額" : "",
    ].filter(Boolean);
    if (missing.length > 0) blockers.push(`明細${i + 1}の${missing.join("・")}を入力してください`);
    if (!l.isNonStock && !l.productId) blockers.push(`明細${i + 1}の自社の商品を選ぶか、「在庫にしない」を付けてください`);
  });
  return blockers;
};

// ---- CH-06 人の入力(G03 の「保存」「確定する」) ----

export type SlipFormLine = SlipLineInput & {
  // 画面の元の行(読み取った行)のID。新しく足した行は null
  originalId: string | null;
  // 自社の商品コード(サーバーで商品IDに直す)
  productCode: string | null;
};

export type SlipFormResult =
  | { ok: true; header: SlipHeader; lines: SlipFormLine[] }
  | { ok: false; errors: Record<string, string> };

const AMOUNT_ERROR = "整数（円）で入力してください。";

export const parseSlipForm = (values: Record<string, string>): SlipFormResult => {
  const errors: Record<string, string> = {};
  const text = (name: string) => (values[name] ?? "").trim();
  const str = (name: string, max: number, label: string): string | null => {
    const v = text(name);
    if (v.length > max) errors[name] = `${label}は${max.toLocaleString("ja-JP")}文字以内で入力してください。`;
    return v || null;
  };
  const amount = (name: string, label: string, min = 0): number | null => {
    const p = parseSlipAmount(text(name), { min });
    if (p.bad || p.rounded) {
      errors[name] = `${label}は${min === 0 ? "0以上の" : ""}${AMOUNT_ERROR}`;
      return null;
    }
    return p.value;
  };

  const deliveryRaw = text("delivery_date").replace(/\//g, "-");
  let deliveryDate: string | null = null;
  if (deliveryRaw) {
    if (isValidDateStr(deliveryRaw)) deliveryDate = deliveryRaw;
    else errors.delivery_date = "正しい日付を入力してください。";
  }
  const taxIncluded = text("tax_included") === "1";
  const tax = amount("tax", "税");
  const total = amount("total", "合計");
  let subtotal = amount("subtotal", "小計");
  if (taxIncluded && subtotal === null && total !== null && tax !== null && total >= tax) subtotal = total - tax;

  const header: SlipHeader = {
    supplierId: text("supplier_id") || null,
    slipNo: str("slip_no", SLIP_LIMITS.slipNo, "伝票番号"),
    deliveryDate,
    orderRef: str("order_ref", SLIP_LIMITS.orderRef, "発注番号"),
    taxIncluded,
    subtotal,
    tax,
    total,
    note: str("note", SLIP_LIMITS.note, "メモ"),
  };

  // 明細(すべての欄が空の行は捨てる)
  const count = Math.min(Number(text("line_count")) || 0, 1000);
  const lines: SlipFormLine[] = [];
  for (let i = 0; i < count; i += 1) {
    const p = `l${i}_`;
    const fields = ["code", "name", "spec", "qty", "unit", "price", "amount", "product"].map((f) => text(p + f));
    if (fields.every((f) => f === "")) continue;
    const n = lines.length + 1;
    const qty = parseSlipQuantity(text(`${p}qty`));
    if (qty.bad || qty.rounded) errors[`${p}qty`] = `明細${n}の数量: −99,999.99〜99,999.99、小数2けたまでで入力してください。`;
    const price = parseSlipAmount(text(`${p}price`));
    if (price.bad || price.rounded) errors[`${p}price`] = `明細${n}の単価: ${AMOUNT_ERROR}`;
    const amt = parseSlipAmount(text(`${p}amount`));
    if (amt.bad || amt.rounded) errors[`${p}amount`] = `明細${n}の金額: ${AMOUNT_ERROR}`;
    const name = text(`${p}name`);
    if (name.length > SLIP_LIMITS.itemName) errors[`${p}name`] = `明細${n}の品名は${SLIP_LIMITS.itemName}文字以内で入力してください。`;
    const spec = text(`${p}spec`);
    if (spec.length > SLIP_LIMITS.spec) errors[`${p}spec`] = `明細${n}のサイズ・色は${SLIP_LIMITS.spec}文字以内で入力してください。`;
    const unit = text(`${p}unit`);
    if (unit.length > SLIP_LIMITS.unit) errors[`${p}unit`] = `明細${n}の単位は${SLIP_LIMITS.unit}文字以内で入力してください。`;
    const codeRaw = text(`${p}code`);
    if (toHalfWidth(codeRaw).trim().length > SLIP_LIMITS.itemCode)
      errors[`${p}code`] = `明細${n}の品番は${SLIP_LIMITS.itemCode}文字以内で入力してください。`;
    const confidenceRaw = Number(text(`${p}confidence`));
    lines.push({
      originalId: text(`${p}id`) || null,
      supplierItemCode: normalizeItemCode(codeRaw),
      itemName: name,
      spec: spec || null,
      quantity: qty.bad || qty.rounded ? null : qty.value,
      unit: unit || null,
      unitPrice: price.bad || price.rounded ? null : price.value,
      amount: amt.bad || amt.rounded ? null : amt.value,
      productId: null,
      productCode: toHalfWidth(text(`${p}product`)).trim() || null,
      isNonStock: text(`${p}nonstock`) === "1",
      confidence: text(`${p}confidence`) !== "" && Number.isFinite(confidenceRaw) ? confidenceRaw : null,
      isEdited: false,
    });
  }
  if (lines.length > SLIP_MAX_LINES) errors.lines = `明細は${SLIP_MAX_LINES}行までにしてください。`;

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, header, lines };
};

// 人が直した明細か(AIが読んだ値と比べる。読み取り直す前の行と比べるので、元の行が無い〔足した〕行は直したとみなす)
export const isLineEdited = (
  before: Pick<SlipLineInput, "supplierItemCode" | "itemName" | "spec" | "quantity" | "unit" | "unitPrice" | "amount"> | null,
  after: SlipLineInput
): boolean =>
  !before ||
  before.supplierItemCode !== after.supplierItemCode ||
  before.itemName !== after.itemName ||
  (before.spec ?? null) !== (after.spec ?? null) ||
  before.quantity !== after.quantity ||
  (before.unit ?? null) !== (after.unit ?? null) ||
  before.unitPrice !== after.unitPrice ||
  before.amount !== after.amount;

// ---- CH-13 品番の対応表の入力 ----

export type ItemCodeFormResult =
  | { ok: true; supplierItemCode: string; supplierItemName: string | null; productCode: string; packQuantity: number; isActive: boolean }
  | { ok: false; errors: Record<string, string> };

export const parseItemCodeForm = (values: Record<string, string>): ItemCodeFormResult => {
  const errors: Record<string, string> = {};
  const text = (name: string) => (values[name] ?? "").trim();
  const code = normalizeItemCode(text("supplier_item_code"));
  if (!code) errors.supplier_item_code = "仕入先の品番を入力してください。";
  else if (toHalfWidth(text("supplier_item_code")).trim().length > SLIP_LIMITS.itemCode)
    errors.supplier_item_code = `仕入先の品番は${SLIP_LIMITS.itemCode}文字以内で入力してください。`;
  const name = text("supplier_item_name");
  if (name.length > SLIP_LIMITS.supplierItemName)
    errors.supplier_item_name = `仕入先の品名は${SLIP_LIMITS.supplierItemName}文字以内で入力してください。`;
  const productCode = toHalfWidth(text("product_code")).trim();
  if (!productCode) errors.product_code = "自社の商品コードを入力してください。";
  const packRaw = toHalfWidth(text("pack_quantity") || "1");
  const pack = /^\d+$/.test(packRaw) ? Number(packRaw) : NaN;
  if (!Number.isInteger(pack) || pack < 1 || pack > SLIP_LIMITS.packQuantity)
    errors.pack_quantity = `入数は1〜${SLIP_LIMITS.packQuantity.toLocaleString("ja-JP")}の整数で入力してください。`;
  if (Object.keys(errors).length > 0 || !code) return { ok: false, errors };
  return {
    ok: true,
    supplierItemCode: code,
    supplierItemName: name || null,
    productCode,
    packQuantity: pack,
    isActive: text("is_active") === "1",
  };
};
