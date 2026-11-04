// 特注の仕様確認・概算見積(D-04)の決まった値と計算(03 の 0章 0.1〜0.3、04 CH-05・CH-06・CH-11・CH-12)。
// DBを読まない計算だけのファイルなので、画面の部品からも使える。ほかのファイルを読み込まない(計算だけを単独で確かめられるように)。
// 概算の金額は、ここの計算だけで出す(AIは使わない。01 の 7章)。

// ---- 4.3 状態 ----

export const CUSTOM_QUOTE_STATUSES = {
  hearing: "聞き取り中",
  estimated: "概算済み",
  factory_requested: "工場に依頼済み",
  won: "受注",
  lost: "失注",
  cancelled: "取消",
} as const;
export type CustomQuoteStatus = keyof typeof CUSTOM_QUOTE_STATUSES;
export const isCustomQuoteStatus = (v: string): v is CustomQuoteStatus => v in CUSTOM_QUOTE_STATUSES;
// 一覧の初めの絞り込み「進行中」(受注・失注・取消以外。02 の G02)
export const OPEN_QUOTE_STATUSES: CustomQuoteStatus[] = ["hearing", "estimated", "factory_requested"];
// 結果が出た状態(仕様を直せない。00_仮決め一覧 D-04-仮-12)
export const isClosedQuoteStatus = (s: CustomQuoteStatus): boolean => s === "won" || s === "lost" || s === "cancelled";

// ---- 6.2 単価表 ----

export const PRICE_KINDS = { sewing: "縫製", fabric: "生地", print: "名入れ", setup: "版代" } as const;
export type PriceKind = keyof typeof PRICE_KINDS;
export const isPriceKind = (v: string): v is PriceKind => v in PRICE_KINDS;
export const PRICE_UNITS = { per_piece: "1枚", per_order: "1回" } as const;
export type PriceUnit = keyof typeof PRICE_UNITS;
export const isPriceUnit = (v: string): v is PriceUnit => v in PRICE_UNITS;

// 【仮】単価表の画面の上に「仮の単価です」を出す(01 の 7章。すみたや様の単価表〔No.22〕を入れたら false にする。
// 00_仮決め一覧 D-04-仮-02)
export const SHOW_PROVISIONAL_PRICE_NOTICE = true;

// 【仮】消費税は10%、1円未満は切り捨て(01 の 4.2、00_仮決め一覧 D-04-仮-03)
export const TAX_RATE_PERCENT = 10;

// 【仮】サイズの内訳の欄(02 の G03 の S・M・L・LL。00_仮決め一覧 D-04-仮-07)
export const CUSTOM_SIZES = ["S", "M", "L", "LL"] as const;

// 長さ・数の上限(04 CH-02・CH-13)
export const CUSTOM_QUOTE_LIMITS = {
  name: 100,
  phone: 20,
  text: 1000,
  qtyMax: 9999,
  reason: 100,
  priceName: 100,
  // 単価は1,000万未満
  unitPriceMax: 9_999_999,
  sortOrderMax: 9999,
} as const;

export type PriceItem = {
  id: string;
  kind: PriceKind;
  itemType: string | null;
  name: string;
  unit: PriceUnit;
  unitPrice: number;
  qtyFrom: number;
  qtyTo: number | null;
  sortOrder: number;
  isActive: boolean;
  note: string | null;
};

// ---- 案件の仕様 ----

export type SizeQty = { size: string; qty: number };

export type QuoteSpec = {
  itemType: string | null;
  fabricItemId: string | null;
  fabricNote: string | null;
  sizeBreakdown: SizeQty[] | null;
  quantity: number | null;
  printItemId: string | null;
  printNone: boolean;
  printText: string | null;
  // 年-月-日
  desiredDate: string | null;
  specNote: string | null;
};

// ---- 0.1 findMissingItems 足りない項目(01 の 4.1 の「聞き返しに使う」項目) ----

// 【仮】必ず聞く項目(No.24 の回答で変える。00_仮決め一覧 D-04-仮-01)
export const MISSING_ITEM_LABELS = {
  itemType: "品目",
  fabric: "生地",
  sizeBreakdown: "サイズの内訳",
  quantity: "枚数",
  print: "名入れ",
  desiredDate: "希望納期",
} as const;

export const findMissingItems = (spec: QuoteSpec): string[] => {
  const missing: string[] = [];
  if (!spec.itemType) missing.push(MISSING_ITEM_LABELS.itemType);
  if (!spec.fabricItemId && !spec.fabricNote) missing.push(MISSING_ITEM_LABELS.fabric);
  if (!spec.sizeBreakdown || spec.sizeBreakdown.length === 0) missing.push(MISSING_ITEM_LABELS.sizeBreakdown);
  if (!spec.quantity) missing.push(MISSING_ITEM_LABELS.quantity);
  if (!spec.printItemId && !spec.printNone) missing.push(MISSING_ITEM_LABELS.print);
  if (!spec.desiredDate) missing.push(MISSING_ITEM_LABELS.desiredDate);
  return missing;
};

// ---- 単価表の行の選び方 ----

const inRange = (item: PriceItem, qty: number): boolean => item.qtyFrom <= qty && (item.qtyTo === null || qty <= item.qtyTo);

// 同じ区分・品目・名前の行(枚数の範囲ごとに分かれた行)をひとまとまりとして扱う(00_仮決め一覧 D-04-仮-08)
const sameGroup = (a: PriceItem, b: PriceItem): boolean => a.kind === b.kind && a.itemType === b.itemType && a.name === b.name;

export type PriceOption = { id: string; name: string; label: string; itemType: string | null };

// まとまりごとの最初の行(使う行のうち、並び順・枚数の下限が最初の行)
const groupHeads = (items: PriceItem[], kind: "fabric" | "print"): PriceItem[] => {
  const heads: PriceItem[] = [];
  for (const item of sortPriceItems(items.filter((i) => i.isActive && i.kind === kind))) {
    if (!heads.some((h) => sameGroup(h, item))) heads.push(item);
  }
  return heads;
};

// 生地・名入れの選ぶ欄: まとまりごとに1つ(値はまとまりの最初の行のID)
export const priceOptions = (items: PriceItem[], kind: "fabric" | "print"): PriceOption[] =>
  groupHeads(items, kind).map((h) => ({
    id: h.id,
    name: h.name,
    label: h.itemType ? `${h.name}（${h.itemType}用）` : h.name,
    itemType: h.itemType,
  }));

// 保存されている行のIDを、選ぶ欄のID(まとまりの最初の行)に置き換える
export const optionIdOf = (items: PriceItem[], id: string | null, kind: "fabric" | "print"): string | null => {
  if (!id) return null;
  const item = items.find((i) => i.id === id);
  if (!item) return id;
  return groupHeads(items, kind).find((h) => sameGroup(h, item))?.id ?? id;
};

// 品目の選ぶ欄: 使う縫製の行の品目(並び順)
export const itemTypeOptions = (items: PriceItem[]): string[] => [
  ...new Set(sortPriceItems(items.filter((i) => i.isActive && i.kind === "sewing")).map((i) => i.itemType ?? "")),
].filter(Boolean);

// 単価表の並び(区分・品目・並び順・枚数の下限。03 EV-13 手順1)
const KIND_ORDER: PriceKind[] = ["sewing", "fabric", "print", "setup"];
export const sortPriceItems = (items: PriceItem[]): PriceItem[] =>
  [...items].sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      (a.itemType ?? "").localeCompare(b.itemType ?? "", "ja") ||
      a.sortOrder - b.sortOrder ||
      a.qtyFrom - b.qtyFrom
  );

// ---- CH-04 選んだ単価表の行が使えるもの ----

export const checkPriceSelection = (items: PriceItem[], id: string, kind: PriceKind): string | null => {
  const item = items.find((i) => i.id === id);
  if (!item || item.kind !== kind) return "単価表から選び直してください。";
  if (!item.isActive) return "選んだ行は「使わない」になっています。選び直してください。";
  return null;
};

// ---- 0.2 calcEstimate 概算 ----

export type EstimateLine = {
  priceItemId: string;
  kind: PriceKind;
  name: string;
  unit: PriceUnit;
  unitPrice: number;
  qty: number;
  amount: number;
};

export type Estimate = { lines: EstimateLine[]; subtotal: number; tax: number; total: number };

export type EstimateResult = { ok: true; estimate: Estimate } | { ok: false; reasons: string[] };

// CH-06 合う行がちょうど1つ
const pickOne = (label: string, rows: PriceItem[]): PriceItem | string => {
  if (rows.length === 0) return `${label}: この枚数の単価がありません（単価表を確かめてください）。`;
  if (rows.length > 1) return `${label}: 単価表の枚数の範囲が重なっています。`;
  return rows[0];
};

// 選んだ生地・名入れの行のまとまりから、枚数の範囲に入る使う行を選ぶ(手順3・4)
const pickFromGroup = (items: PriceItem[], id: string, kind: PriceKind, itemType: string, qty: number): PriceItem | string => {
  const label = PRICE_KINDS[kind];
  const base = items.find((i) => i.id === id);
  if (!base || base.kind !== kind) return `${label}: 選んだ行が単価表にありません。選び直してください。`;
  if (base.itemType && base.itemType !== itemType) return `${label}: 選んだ「${base.name}」は${base.itemType}用です（品目と合いません）。`;
  return pickOne(`${label}（${base.name}）`, items.filter((i) => i.isActive && sameGroup(i, base) && inRange(i, qty)));
};

const lineOf = (item: PriceItem, quantity: number): EstimateLine => {
  const qty = item.unit === "per_piece" ? quantity : 1;
  return {
    priceItemId: item.id,
    kind: item.kind,
    name: item.name,
    unit: item.unit,
    unitPrice: item.unitPrice,
    qty,
    amount: item.unitPrice * qty,
  };
};

export const calcEstimate = (spec: QuoteSpec, items: PriceItem[]): EstimateResult => {
  // 手順1: CH-05 概算に必要な項目
  const reasons: string[] = [];
  if (!spec.itemType) reasons.push("品目を選んでください。");
  if (!spec.fabricItemId) reasons.push(spec.fabricNote ? "生地を単価表から選んでください。" : "生地を選んでください。");
  if (!spec.quantity) reasons.push("合計の枚数を入れてください。");
  if (!spec.printItemId && !spec.printNone) reasons.push("名入れの方法を選ぶか「なし」にしてください。");
  if (reasons.length > 0 || !spec.itemType || !spec.fabricItemId || !spec.quantity) return { ok: false, reasons };
  const itemType = spec.itemType;
  const quantity = spec.quantity;

  // 手順2: 縫製(品目・枚数の範囲)
  const picked: (PriceItem | string)[] = [
    pickOne(
      `縫製（${itemType}）`,
      items.filter((i) => i.isActive && i.kind === "sewing" && i.itemType === itemType && inRange(i, quantity))
    ),
  ];
  // 手順3: 生地
  picked.push(pickFromGroup(items, spec.fabricItemId, "fabric", itemType, quantity));
  // 手順4・5: 名入れと、名入れに付く版代(同じ品目または品目が空の、使う版代の行。00_仮決め一覧 D-04-仮-09)。「なし」なら0円
  if (!spec.printNone && spec.printItemId) {
    picked.push(pickFromGroup(items, spec.printItemId, "print", itemType, quantity));
    picked.push(
      ...items.filter(
        (i) => i.isActive && i.kind === "setup" && (i.itemType === null || i.itemType === itemType) && inRange(i, quantity)
      )
    );
  }
  const errors = picked.filter((p): p is string => typeof p === "string");
  if (errors.length > 0) return { ok: false, reasons: errors };

  // 手順6・7
  const lines = (picked as PriceItem[]).map((item) => lineOf(item, quantity));
  const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const tax = Math.floor((subtotal * TAX_RATE_PERCENT) / 100);
  return { ok: true, estimate: { lines, subtotal, tax, total: subtotal + tax } };
};

// 計算と同じ金額か(04 CH-08 で使う、内訳の単価・金額・小計・税・合計)
export const estimateAmounts = (e: { lines: EstimateLine[]; subtotal: number; tax: number; total: number }): Set<number> =>
  new Set([...e.lines.flatMap((l) => [l.unitPrice, l.amount]), e.subtotal, e.tax, e.total]);

// ---- CH-11 工場に依頼できる ----

// 品目・合計の枚数・名入れ(方法または「なし」)・希望納期(生地は未定でもよい)。足りない項目の名前を返す
export const factoryRequestMissing = (spec: QuoteSpec): string[] => {
  const missing: string[] = [];
  if (!spec.itemType) missing.push(MISSING_ITEM_LABELS.itemType);
  if (!spec.quantity) missing.push("合計の枚数");
  if (!spec.printItemId && !spec.printNone) missing.push(MISSING_ITEM_LABELS.print);
  if (!spec.desiredDate) missing.push(MISSING_ITEM_LABELS.desiredDate);
  return missing;
};

export const canRecordFactoryRequest = (status: CustomQuoteStatus): boolean =>
  status === "hearing" || status === "estimated" || status === "factory_requested";

// ---- CH-12 状態の移り方 ----

const TRANSITIONS: Record<CustomQuoteStatus, CustomQuoteStatus[]> = {
  hearing: ["estimated", "factory_requested", "lost", "cancelled"],
  estimated: ["hearing", "factory_requested", "won", "lost", "cancelled"],
  factory_requested: ["factory_requested", "won", "lost", "cancelled"],
  // 間違えたときに工場に依頼済みへ戻す(社長だけ。00_仮決め一覧 D-04-仮-06)
  won: ["factory_requested"],
  lost: ["factory_requested"],
  cancelled: [],
};

export const canChangeQuoteStatus = (from: CustomQuoteStatus, to: CustomQuoteStatus, isPresident: boolean): boolean => {
  if (!TRANSITIONS[from].includes(to)) return false;
  if ((from === "won" || from === "lost") && !isPresident) return false;
  return true;
};

// ---- 0.3 importSpecFromInquiry 問い合わせの仕様を取り込む ----

// D-01 が抜き出した特注の仕様(InquiryExtracted の custom_spec と desired_date)
export type ExtractedCustomSpec = {
  item?: string | null;
  fabric?: string | null;
  size_and_quantity?: string | null;
  name_print?: string | null;
  desired_delivery?: string | null;
  group_name?: string | null;
};

export type SpecCandidateField =
  | "organization_name"
  | "item_type"
  | "fabric_item_id"
  | "fabric_note"
  | "print_item_id"
  | "print_text"
  | "desired_date"
  | "spec_note";

export type SpecCandidate = {
  field: SpecCandidateField;
  // 画面の欄の名前
  label: string;
  // 欄に入れる値(spec_note は書き足す行)
  value: string;
  // 画面に出す値
  display: string;
  // 案件に値があって違う(上書きはしない。担当者が選ぶ)
  changed: boolean;
};

// 前後の空白・全角半角・空白の数をそろえる(手順3)
const normalizeName = (value: string): string => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

const isDateStr = (v: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

export type QuoteForImport = { organizationName: string | null; spec: QuoteSpec };

export const importSpecFromInquiry = (
  quote: QuoteForImport,
  extracted: { customSpec: ExtractedCustomSpec | null; desiredDate: string | null },
  items: PriceItem[]
): SpecCandidate[] => {
  const x = extracted.customSpec ?? {};
  const s = quote.spec;
  const out: SpecCandidate[] = [];
  const notes: string[] = [];
  // 手順2: 案件が空なら候補、両方に値があって違えば「変わった項目」
  const push = (field: SpecCandidateField, label: string, current: string | null, value: string, display = value) => {
    if (current === value) return;
    out.push({ field, label, value, display, changed: !!current });
  };
  const text = (v: string | null | undefined): string | null => (v && v.trim() ? v.trim() : null);

  const groupName = text(x.group_name);
  if (groupName) push("organization_name", "団体名", quote.organizationName, groupName.slice(0, CUSTOM_QUOTE_LIMITS.name));

  // 手順3: 品目・生地・名入れの方法は、単価表の名前と照らし合わせる。無ければメモ欄へ
  const item = text(x.item);
  if (item) {
    const match = itemTypeOptions(items).find((t) => normalizeName(t) === normalizeName(item));
    if (match) push("item_type", "品目", s.itemType, match);
    else notes.push(`品目の希望: ${item}`);
  }
  const fabric = text(x.fabric);
  if (fabric) {
    const match = priceOptions(items, "fabric").find((o) => normalizeName(o.name) === normalizeName(fabric));
    if (match) push("fabric_item_id", "生地", optionIdOf(items, s.fabricItemId, "fabric"), match.id, match.label);
    else push("fabric_note", "生地の希望", s.fabricNote, fabric.slice(0, CUSTOM_QUOTE_LIMITS.text));
  }
  const print = text(x.name_print);
  if (print) {
    const match = priceOptions(items, "print").find((o) => normalizeName(o.name) === normalizeName(print));
    if (match) {
      if (!s.printNone) push("print_item_id", "名入れの方法", optionIdOf(items, s.printItemId, "print"), match.id, match.label);
    } else push("print_text", "名入れの文字・場所", s.printText, print.slice(0, CUSTOM_QUOTE_LIMITS.text));
  }
  // サイズと枚数は文のまま書かれるため、メモ欄に入れる(00_仮決め一覧 D-04-仮-10)
  const sizes = text(x.size_and_quantity);
  if (sizes) notes.push(`サイズと枚数: ${sizes}`);
  // 希望納期: D-01 が年-月-日にした値。無ければ文のままメモ欄へ
  if (extracted.desiredDate && isDateStr(extracted.desiredDate)) push("desired_date", "希望納期", s.desiredDate, extracted.desiredDate);
  else if (text(x.desired_delivery)) notes.push(`希望納期: ${text(x.desired_delivery)}`);

  // メモ欄は、まだ書かれていない行だけを書き足す候補にする
  const newNotes = notes.filter((n) => !(s.specNote ?? "").includes(n));
  if (newNotes.length > 0) out.push({ field: "spec_note", label: "メモ", value: newNotes.join("\n"), display: newNotes.join("／"), changed: false });
  return out;
};

// メモ欄に書き足す(上限を超える分は切る)
export const appendNote = (current: string | null, add: string): string =>
  (current ? `${current}\n${add}` : add).slice(0, CUSTOM_QUOTE_LIMITS.text);

// 続きのメッセージ(新しい順)から候補を集める。同じ欄は新しいメッセージの値を使い、メモ欄の行はまとめる(00_仮決め一覧 D-04-仮-11)
export const importSpecFromMessages = (
  quote: QuoteForImport,
  messages: { customSpec: ExtractedCustomSpec | null; desiredDate: string | null }[],
  items: PriceItem[]
): SpecCandidate[] => {
  const byField = new Map<SpecCandidateField, SpecCandidate>();
  const notes: string[] = [];
  for (const m of messages) {
    for (const c of importSpecFromInquiry(quote, m, items)) {
      if (c.field === "spec_note") notes.push(...c.value.split("\n").filter((n) => !notes.includes(n)));
      else if (!byField.has(c.field)) byField.set(c.field, c);
    }
  }
  const out = [...byField.values()];
  if (notes.length > 0) out.push({ field: "spec_note", label: "メモ", value: notes.join("\n"), display: notes.join("／"), changed: false });
  return out;
};

// ---- CH-10 概算の案内に必ず書く文 ----

// 「概算」と「正式なお見積り(お見積もり)」の両方の語があるか
export const hasEstimateNotice = (text: string): boolean => text.includes("概算") && /正式なお見積(?:り|もり)/.test(text);
