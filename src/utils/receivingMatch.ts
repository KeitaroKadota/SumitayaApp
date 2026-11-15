// C-02 発注との照合・検収の決まりと計算(01 5章、04 CH-03〜CH-06・CH-08〜CH-10)。
// DBを読まない計算だけのファイルなので、画面の部品(クライアント)からも使える。DBを読み書きする処理は receiving.ts。

// ---- 仮の値(00_仮決め一覧 C-02-仮-01・02・05・08・09・10。確認したらここを直す。画面からは変えない) ----
export const RECEIVING_RULES = {
  // 一致したら自動で検収する(01 5.4 の4つ目。C-02-仮-02。最初の1か月は全件を人が見るなら false にする)
  autoAccept: true,
  // 単価が同じとみなす差(円。C-02-仮-05)
  priceToleranceYen: 1,
  // 税込の納品書を税抜に直す割合(商品マスタの税率ごと。C-02-仮-05)
  taxDivisors: { 10: 1.1, 8: 1.08, 0: 1 } as Record<number, number>,
  // 検収を取り消せる日数(C-02-仮-09)
  cancelableDays: 60,
  // 判断の理由の長さ(CH-10)
  noteMax: 500,
  // 確認のタスクの期限(翌営業日。C-02-仮-08)
  taskDueBusinessDays: 1,
  // G01 の1ページの件数(C-02-仮-10)
  pageSize: 50,
} as const;

// ---- 照合の結果(01 5.2) ----

export const MATCH_RESULTS = {
  matched: "一致",
  partial: "分納",
  over: "多い",
  price_diff: "単価差",
  no_order_line: "発注に無い",
  negative: "マイナス",
  non_stock: "在庫にしない",
} as const;
export type MatchResult = keyof typeof MATCH_RESULTS;

// 照合の結果のまとめ(delivery_slips.match_status)
export const MATCH_STATUSES = {
  auto_accepted: "自動検収",
  needs_review: "要確認",
  reviewed: "確認して検収",
  no_order: "発注なし",
} as const;
export type MatchStatus = keyof typeof MATCH_STATUSES;
export const isMatchStatus = (v: string): v is MatchStatus => Object.hasOwn(MATCH_STATUSES, v);

// ---- 照合に使う形 ----

export type MatchSlipLine = {
  id: string;
  lineNo: number;
  productId: string | null;
  isNonStock: boolean;
  // 伝票の数量(小数2けた)・金額(伝票の書き方のまま)
  quantity: number | null;
  amount: number | null;
  // 入数(対応表の pack_quantity。無ければ1)
  packQuantity: number;
  // 商品の税率(10・8・0。商品が無ければ10)
  taxRate: number;
};

export type MatchPoLine = { id: string; lineNo: number; productId: string; unitPrice: number; openQty: number };
export type MatchPo = { id: string; orderNo: string; expectedDate: string | null; orderDate: string | null; lines: MatchPoLine[] };

// ---- 5.1 発注を選ぶ ----

// order_no: ①発注番号 / contains: ②商品をすべて含む発注が1つ / candidate: ③候補が複数 / manual: 人が選んだ(EV-05) / none: ④見つからない
export type PoPickMethod = "order_no" | "contains" | "candidate" | "manual" | "none";

const normalizeRef = (v: string) => v.normalize("NFKC").replace(/\s/g, "").toUpperCase();
const dayNumber = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86_400_000;

// 在庫の明細(在庫にしない品を除く)の商品
const stockProductIds = (lines: MatchSlipLine[]) =>
  [...new Set(lines.filter((l) => !l.isNonStock && l.productId).map((l) => l.productId as string))];

// candidates は同じ仕入先の、状態が ordered・partially_received の発注(CH-02 を満たすもの)。
// 返す candidates は G02 の選択肢の並び(③のときは入荷予定日が納品日に近い順)
export const pickPurchaseOrder = ({
  orderRef,
  deliveryDate,
  lines,
  candidates,
  chosenId,
}: {
  orderRef: string | null;
  deliveryDate: string | null;
  lines: MatchSlipLine[];
  candidates: MatchPo[];
  chosenId?: string | null;
}): { po: MatchPo | null; method: PoPickMethod; candidates: MatchPo[] } => {
  if (chosenId) {
    const chosen = candidates.find((c) => c.id === chosenId) ?? null;
    return { po: chosen, method: chosen ? "manual" : "none", candidates };
  }
  // ①
  if (orderRef) {
    const ref = normalizeRef(orderRef);
    const byNo = candidates.find((c) => normalizeRef(c.orderNo) === ref);
    if (byNo) return { po: byNo, method: "order_no", candidates };
  }
  // ②(在庫の明細が無い納品書は、商品で探せないので「見つからない」)
  const products = stockProductIds(lines);
  const containing =
    products.length === 0 ? [] : candidates.filter((c) => products.every((p) => c.lines.some((l) => l.productId === p)));
  if (containing.length === 1) return { po: containing[0], method: "contains", candidates };
  if (containing.length === 0) return { po: null, method: "none", candidates };
  // ③ 入荷予定日が納品日に一番近いものを第一候補に(予定日が無いものは後ろ)
  const distance = (c: MatchPo) =>
    c.expectedDate && deliveryDate ? Math.abs(dayNumber(c.expectedDate) - dayNumber(deliveryDate)) : Number.POSITIVE_INFINITY;
  const sorted = [...containing].sort((a, b) => distance(a) - distance(b));
  const rest = candidates.filter((c) => !containing.includes(c));
  return { po: sorted[0], method: "candidate", candidates: [...sorted, ...rest] };
};

// ---- 5.2・5.3 明細ごとに比べる ----

export type LineMatch = {
  lineId: string;
  lineNo: number;
  result: MatchResult;
  purchaseOrderLineId: string | null;
  // 自社の単位の数(数量 × 入数。小数2けた)
  unitsQuantity: number | null;
  // 照合した時点の発注の残り・発注の単価
  expectedQuantity: number | null;
  expectedUnitPrice: number | null;
  // 自社の単位あたりの単価(税抜。比べられないときは空)
  unitPriceExTax: number | null;
  // 自社の単位の数が整数でない(CH-03)
  nonInteger: boolean;
  // 数量の比べた結果(単価が違うときも、理由に数量の違いを書くため)
  quantityResult: MatchResult | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

// 自社の単位の数(数量 × 入数)
export const unitsOf = (quantity: number | null, packQuantity: number): number | null =>
  quantity === null ? null : round2(quantity * packQuantity);

// 自社の単位あたりの単価(税抜)。金額 ÷ 自社の単位の数。税込の伝票は商品の税率で割る(CH-04)
export const unitPriceExTaxOf = (amount: number | null, units: number | null, taxIncluded: boolean, taxRate: number): number | null => {
  if (amount === null || units === null || units === 0) return null;
  const divisor = taxIncluded ? (RECEIVING_RULES.taxDivisors[taxRate] ?? RECEIVING_RULES.taxDivisors[10]) : 1;
  return round2(amount / divisor / units);
};

// 発注の明細と比べる(po が空なら、在庫の明細はすべて「発注に無い」)。
// 同じ商品が2行あれば、数量は合計して比べる(CH-03)。発注の明細に同じ商品が2行あれば、前の行を使う
export const matchLines = (lines: MatchSlipLine[], po: MatchPo | null, taxIncluded: boolean): LineMatch[] => {
  const totalUnitsByProduct = new Map<string, number>();
  for (const l of lines) {
    if (l.isNonStock || !l.productId) continue;
    const u = unitsOf(l.quantity, l.packQuantity) ?? 0;
    totalUnitsByProduct.set(l.productId, round2((totalUnitsByProduct.get(l.productId) ?? 0) + u));
  }
  return lines.map((l): LineMatch => {
    const base = { lineId: l.id, lineNo: l.lineNo };
    if (l.isNonStock) {
      return {
        ...base,
        result: "non_stock",
        purchaseOrderLineId: null,
        unitsQuantity: null,
        expectedQuantity: null,
        expectedUnitPrice: null,
        unitPriceExTax: null,
        nonInteger: false,
        quantityResult: null,
      };
    }
    const units = unitsOf(l.quantity, l.packQuantity);
    const nonInteger = units !== null && !Number.isInteger(units);
    const unitPrice = unitPriceExTaxOf(l.amount, units, taxIncluded, l.taxRate);
    const poLine = po && l.productId ? (po.lines.find((p) => p.productId === l.productId) ?? null) : null;
    const common = { ...base, unitsQuantity: units, unitPriceExTax: unitPrice, nonInteger };
    // CH-03 マイナスは発注の有無より先に見る
    if (units !== null && units < 0) {
      return {
        ...common,
        result: "negative",
        purchaseOrderLineId: poLine?.id ?? null,
        expectedQuantity: poLine?.openQty ?? null,
        expectedUnitPrice: poLine?.unitPrice ?? null,
        quantityResult: "negative",
      };
    }
    // CH-05
    if (!poLine) {
      return {
        ...common,
        result: "no_order_line",
        purchaseOrderLineId: null,
        expectedQuantity: null,
        expectedUnitPrice: null,
        quantityResult: null,
      };
    }
    // CH-03(同じ商品の合計で比べる)。0 は「届いていない」として分納と同じに扱う
    const total = l.productId ? (totalUnitsByProduct.get(l.productId) ?? 0) : 0;
    const quantityResult: MatchResult = total === poLine.openQty ? "matched" : total > poLine.openQty ? "over" : "partial";
    // CH-04(比べられないときは違うものとして人に見せる)
    const priceDiff = unitPrice === null || Math.abs(unitPrice - poLine.unitPrice) > RECEIVING_RULES.priceToleranceYen;
    return {
      ...common,
      result: priceDiff ? "price_diff" : quantityResult,
      purchaseOrderLineId: poLine.id,
      expectedQuantity: poLine.openQty,
      expectedUnitPrice: poLine.unitPrice,
      quantityResult,
    };
  });
};

// ---- 要確認の理由(01 4章・02 G01 の「理由」) ----

export const reviewReasonsOf = ({
  method,
  matches,
  needsCheck,
}: {
  method: PoPickMethod;
  matches: LineMatch[];
  needsCheck: boolean;
}): string[] => {
  const reasons: string[] = [];
  if (method === "none") reasons.push("発注が見つかりません");
  if (method === "candidate") reasons.push("発注を選んでください（候補が複数あります）");
  const stock = matches.filter((m) => m.result !== "non_stock");
  if (stock.length === 0) reasons.push("在庫の明細がありません");
  for (const m of stock) {
    const n = `明細${m.lineNo}`;
    if (m.result === "price_diff") reasons.push(`単価が違う（${n}）`);
    const q = m.result === "price_diff" ? m.quantityResult : m.result;
    if (q === "partial" && m.expectedQuantity !== null && m.unitsQuantity !== null)
      reasons.push(`分納（${n}: 残り${round2(m.expectedQuantity - m.unitsQuantity)}）`);
    if (q === "over") reasons.push(`数が多い（${n}）`);
    if (q === "negative") reasons.push(`数量がマイナス（${n}）`);
    if (m.result === "no_order_line" && method !== "none") reasons.push(`発注に無い品（${n}）`);
    if (m.nonInteger) reasons.push(`数量が整数になりません（${n}）`);
  }
  if (needsCheck) reasons.push("読み取りの要確認あり");
  return reasons;
};

// ---- CH-06 自動で検収してよいか ----

export const canAutoAccept = ({
  method,
  matches,
  needsCheck,
}: {
  method: PoPickMethod;
  matches: LineMatch[];
  needsCheck: boolean;
}): boolean => {
  if (!RECEIVING_RULES.autoAccept) return false;
  if (method !== "order_no" && method !== "contains") return false;
  const stock = matches.filter((m) => m.result !== "non_stock");
  if (stock.length === 0) return false;
  return !needsCheck && stock.every((m) => m.result === "matched" && !m.nonInteger);
};

// ---- CH-09・CH-10 受け入れる数と判断の理由 ----

// 受け入れられる一番大きい数(届いた数の小数以下を切り捨てた整数。マイナス・不明なら0)
export const maxAcceptableOf = (units: number | null): number => (units === null || units <= 0 ? 0 : Math.floor(units));

export type AcceptInputLine = { lineId: string; lineNo: number; result: MatchResult | null; unitsQuantity: number | null };

export type AcceptParsed =
  | { ok: true; quantities: Map<string, number>; note: string | null }
  | { ok: false; errors: Record<string, string> };

// values は画面の値(受け入れる数は qty_<明細ID>、理由は note)。noOrder は「発注なしで検収する」
export const parseAcceptForm = (
  values: Record<string, string>,
  lines: AcceptInputLine[],
  { noOrder }: { noOrder: boolean }
): AcceptParsed => {
  const errors: Record<string, string> = {};
  const quantities = new Map<string, number>();
  let reduced = false;
  for (const l of lines) {
    if (l.result === "non_stock") continue;
    const raw = (values[`qty_${l.lineId}`] ?? "").normalize("NFKC").replace(/,/g, "").trim();
    const max = maxAcceptableOf(l.unitsQuantity);
    if (!/^\d+$/.test(raw)) {
      errors[`qty_${l.lineId}`] = `明細${l.lineNo}: 受け入れる数を0以上の整数で入力してください。`;
      continue;
    }
    const n = Number(raw);
    if (n > max) {
      errors[`qty_${l.lineId}`] = `明細${l.lineNo}: 受け入れる数は、届いた数（${max}）より多くできません。`;
      continue;
    }
    if (l.unitsQuantity === null || n < l.unitsQuantity) reduced = true;
    quantities.set(l.lineId, n);
  }
  const note = (values.note ?? "").trim();
  if (note.length > RECEIVING_RULES.noteMax) errors.note = `判断の理由は${RECEIVING_RULES.noteMax}文字以内で入力してください。`;
  // CH-10 一致していない明細がある・届いた数より少なく受け入れる・発注なし のときは理由が必須
  const mismatch = lines.some((l) => l.result !== "non_stock" && l.result !== "matched");
  if (!note && (noOrder || mismatch || reduced))
    errors.note = "判断の理由を入力してください（一致していない明細・届いた数より少ない数があるとき、発注なしのときは必須です）。";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, quantities, note: note || null };
};

// CH-08 検収を取り消せる日数の内か(acceptedAt から60日)
export const isWithinCancelWindow = (acceptedAt: Date | null, now: Date = new Date()): boolean =>
  acceptedAt !== null && now.getTime() - acceptedAt.getTime() <= RECEIVING_RULES.cancelableDays * 86_400_000;
