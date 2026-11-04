// 特注の案件の文(工場への見積依頼の仕様のまとめと、概算の内訳)。
// 工場への見積依頼の仕様のまとめ(D-04 03 EV-10 手順2・EV-14 手順2)。印刷用の画面と、依頼の記録の文の両方で使う。
// お客様のメールアドレス・電話番号は出さない。
import type { Estimate, EstimateLine, PriceItem } from "@/utils/customQuote";
import { formatDate, formatQuantity, formatYen } from "@/utils/format";
import type { CustomQuote } from "./quoteData";

export type SummaryRow = { label: string; value: string };

const nameOf = (items: PriceItem[], id: string | null): string | null => (id ? (items.find((i) => i.id === id)?.name ?? null) : null);

export const factorySummaryRows = (quote: CustomQuote, items: PriceItem[]): SummaryRow[] => {
  const s = quote.spec;
  const fabricName = nameOf(items, s.fabricItemId);
  const fabric = [fabricName, s.fabricNote ? `（希望: ${s.fabricNote}）` : null].filter(Boolean).join(" ") || "未定";
  const sizes = (s.sizeBreakdown ?? []).map((b) => `${b.size} ${formatQuantity(b.qty)}枚`).join("／");
  const qty = s.quantity !== null ? `合計 ${formatQuantity(s.quantity)}枚` : "合計 −";
  const printName = s.printNone ? "なし" : (nameOf(items, s.printItemId) ?? "−");
  const print = [printName, s.printText ? `「${s.printText}」` : null].filter(Boolean).join(" ");
  return [
    { label: "番号", value: quote.quoteNumber },
    { label: "団体名", value: quote.organizationName ?? "−" },
    { label: "品目", value: s.itemType ?? "−" },
    { label: "生地", value: fabric },
    { label: "サイズと枚数", value: sizes ? `${sizes}（${qty}）` : qty },
    { label: "名入れ", value: print },
    { label: "希望納期", value: s.desiredDate ? formatDate(s.desiredDate) : "−" },
    { label: "メモ", value: s.specNote ?? "" },
    { label: "概算（税込）", value: quote.estimate ? formatYen(quote.estimate.total) : "−" },
  ];
};

// EV-14 手順2: 仕様のまとめと依頼のメモをつないだ文(factory_request_text に保存する)
export const factoryRequestText = (rows: SummaryRow[], memo: string): string =>
  [...rows.map((r) => `${r.label}: ${r.value}`), ...(memo ? ["", `依頼のメモ: ${memo}`] : [])].join("\n").slice(0, 5000);

// ---- 概算の内訳の文(G03 の表示、ひな形の {概算の内訳}・{概算の合計}、AIに渡す値) ----

export const ESTIMATE_LINE_LABELS: Record<PriceItem["kind"], string> = {
  sewing: "縫製代",
  fabric: "生地代",
  print: "名入れ代",
  setup: "版代",
};

// 例: 「生地代 綿ブロード 紺 1,200円×30枚 36,000円」
export const estimateLineText = (l: EstimateLine): string =>
  `${ESTIMATE_LINE_LABELS[l.kind]} ${l.name} ${formatYen(l.unitPrice)}×${formatQuantity(l.qty)}${l.unit === "per_piece" ? "枚" : "回"} ${formatYen(l.amount)}`;

export const estimateBreakdownText = (e: Estimate): string =>
  [
    ...e.lines.map(estimateLineText),
    `小計 ${formatYen(e.subtotal, "excluded")}`,
    `消費税 ${formatYen(e.tax)}`,
    `合計 ${formatYen(e.total, "included")}`,
  ].join("\n");

export const estimateTotalText = (e: Estimate): string => formatYen(e.total, "included");
