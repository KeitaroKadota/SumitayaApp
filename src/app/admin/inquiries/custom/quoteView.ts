// 特注の案件の画面(G01〜G03)で共通に使う表示の値。
import type { BadgeTone } from "@/components/Badge";
import {
  CUSTOM_SIZES,
  MISSING_ITEM_LABELS,
  importSpecFromMessages,
  optionIdOf,
  type CustomQuoteStatus,
  type PriceItem,
  type SpecCandidate,
} from "@/utils/customQuote";
import { sizeFieldName } from "@/utils/customQuoteInput";
import type { CustomQuote, ThreadMessage } from "./quoteData";

export const QUOTE_STATUS_TONES: Record<CustomQuoteStatus, BadgeTone> = {
  hearing: "warning",
  estimated: "neutral",
  factory_requested: "neutral",
  won: "success",
  lost: "danger",
  cancelled: "neutral",
};

// EV-01 手順3・EV-03: 続きのメッセージ(新しい順)の仕様のうち、案件に入っていないもの(00_仮決め一覧 D-04-仮-11)
export const quoteCandidates = (quote: CustomQuote, thread: ThreadMessage[], items: PriceItem[]): SpecCandidate[] =>
  importSpecFromMessages(
    { organizationName: quote.organizationName, spec: quote.spec },
    thread
      .filter((m) => m.parentInquiryId)
      .reverse()
      .map((m) => ({ customSpec: m.extracted?.custom_spec ?? null, desiredDate: m.extracted?.desired_date ?? null })),
    items
  );

// 足りない項目の表示(サイズだけ足りないときは、分かっている合計の枚数を添える。02 の G03)
export const missingItemText = (quote: CustomQuote, item: string): string =>
  item === MISSING_ITEM_LABELS.sizeBreakdown && quote.spec.quantity ? `${item}（合計${quote.spec.quantity}枚は分かる）` : item;

// 仕様のフォームの初めの値(生地・名入れは選ぶ欄のIDにそろえる)
export const specFormValues = (quote: CustomQuote, items: PriceItem[]): Record<string, string> => {
  const s = quote.spec;
  const values: Record<string, string> = {
    organization_name: quote.organizationName ?? "",
    customer_name: quote.customerName ?? "",
    customer_email: quote.customerEmail ?? "",
    customer_phone: quote.customerPhone ?? "",
    item_type: s.itemType ?? "",
    design_note: s.designNote ?? "",
    fabric_item_id: optionIdOf(items, s.fabricItemId, "fabric") ?? "",
    fabric_note: s.fabricNote ?? "",
    quantity: s.quantity === null ? "" : String(s.quantity),
    print_item_id: optionIdOf(items, s.printItemId, "print") ?? "",
    print_none: s.printNone ? "1" : "",
    print_text: s.printText ?? "",
    desired_date: s.desiredDate ?? "",
    spec_note: s.specNote ?? "",
  };
  for (const size of CUSTOM_SIZES) {
    const qty = s.sizeBreakdown?.find((b) => b.size === size)?.qty;
    values[sizeFieldName(size)] = qty ? String(qty) : "";
  }
  return values;
};
