// 特注(D-04)の入力のチェック(04 CH-02〜CH-04・CH-13・CH-14)。DBを読まない計算だけのファイル。
// errors の名前はフォームの name と同じ。
import {
  CUSTOM_QUOTE_LIMITS,
  CUSTOM_SIZES,
  checkPriceSelection,
  isPriceKind,
  isPriceUnit,
  itemTypeOptions,
  type PriceItem,
  type PriceKind,
  type PriceUnit,
  type QuoteSpec,
  type SizeQty,
} from "@/utils/customQuote";
import { isValidDateStr, isValidEmail, parseIntInRange, toHalfWidth } from "@/utils/textNormalize";

const L = CUSTOM_QUOTE_LIMITS;

// サイズの欄の name(size_S など)
export const sizeFieldName = (size: string): string => `size_${size}`;

export type QuoteContact = {
  organizationName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
};

// ---- CH-02〜CH-04 仕様の入力(EV-05) ----

export const validateQuoteSpecInput = (
  raw: Record<string, string>,
  items: PriceItem[],
  today: string
):
  | { ok: true; contact: QuoteContact; spec: QuoteSpec; warnings: string[] }
  | { ok: false; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  const v = (name: string) => (raw[name] ?? "").trim();

  const shortText = (name: string, label: string): string | null => {
    const s = v(name);
    if (s.length > L.name) errors[name] = `${label}は${L.name}文字以内で入力してください。`;
    return s || null;
  };
  const longText = (name: string, label: string): string | null => {
    const s = v(name);
    if (s.length > L.text) errors[name] = `${label}は${L.text.toLocaleString("ja-JP")}文字以内で入力してください。`;
    return s || null;
  };

  const organizationName = shortText("organization_name", "団体名");
  const customerName = shortText("customer_name", "ご担当の名前");

  // メール: D-01 の CH-03 と同じ(小文字にそろえる)
  const email = v("customer_email").toLowerCase();
  if (email && !isValidEmail(email)) errors.customer_email = "メールアドレスの形を確かめてください（例: yamada@example.com）。";

  // 電話: 数字・ハイフン・空白で20文字以下
  const phone = toHalfWidth(v("customer_phone")).replace(/[‐－ー−]/g, "-");
  if (phone && (!/^[\d\- ]+$/.test(phone) || phone.length > L.phone))
    errors.customer_phone = `電話は数字・ハイフン・空白の${L.phone}文字以内で入力してください。`;

  // CH-04 品目は縫製の行の品目
  const itemType = v("item_type") || null;
  if (itemType && !itemTypeOptions(items).includes(itemType)) errors.item_type = "希望の商品を単価表から選び直してください。";

  // CH-02 デザイン(1,000文字以下。0.4 で足した)
  const designNote = longText("design_note", "デザイン");

  const fabricItemId = v("fabric_item_id") || null;
  if (fabricItemId) {
    const e = checkPriceSelection(items, fabricItemId, "fabric");
    if (e) errors.fabric_item_id = e;
  }
  const fabricNote = longText("fabric_note", "生地の希望");

  // CH-02 枚数、CH-03 サイズの内訳と合計
  const breakdown: SizeQty[] = [];
  for (const size of CUSTOM_SIZES) {
    const name = sizeFieldName(size);
    const n = parseIntInRange(v(name), 0, L.qtyMax);
    if (n === "error") errors[name] = `${size}の枚数は0〜${L.qtyMax.toLocaleString("ja-JP")}の整数で入力してください。`;
    else if (n) breakdown.push({ size, qty: n });
  }
  const qtyRaw = parseIntInRange(v("quantity"), 0, L.qtyMax);
  if (qtyRaw === "error") errors.quantity = `合計の枚数は0〜${L.qtyMax.toLocaleString("ja-JP")}の整数で入力してください。`;
  let quantity = qtyRaw === "error" ? null : qtyRaw;
  if (breakdown.length > 0 && qtyRaw !== "error") {
    const sum = breakdown.reduce((s, b) => s + b.qty, 0);
    if (sum > L.qtyMax) errors.quantity = `サイズの内訳の合計は${L.qtyMax.toLocaleString("ja-JP")}枚までにしてください。`;
    else if (quantity !== null && quantity !== sum)
      errors.quantity = `サイズの内訳の合計（${sum}枚）と合計の枚数（${quantity}枚）が違います。`;
    else quantity = sum;
  }

  // 名入れは「方法を選ぶ」か「なし」のどちらか一方
  const printItemId = v("print_item_id") || null;
  const printNone = v("print_none") === "1";
  if (printItemId && printNone) errors.print_item_id = "名入れは、方法を選ぶか「なし」のどちらか一方にしてください。";
  else if (printItemId) {
    const e = checkPriceSelection(items, printItemId, "print");
    if (e) errors.print_item_id = e;
  }
  const printText = longText("print_text", "名入れの文字・場所");

  // 希望納期: 年-月-日。過去の日は警告(保存はできる)
  const desiredDate = toHalfWidth(v("desired_date")).replace(/\//g, "-") || null;
  if (desiredDate && !isValidDateStr(desiredDate)) errors.desired_date = "希望納期は「2027-05-03」の形で入力してください。";
  else if (desiredDate && desiredDate < today) warnings.push("希望納期が過去の日付です。お客様の文を確かめてください（保存はしました）。");

  const specNote = longText("spec_note", "メモ");

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    contact: { organizationName, customerName, customerEmail: email || null, customerPhone: phone || null },
    spec: {
      itemType,
      designNote,
      fabricItemId,
      fabricNote,
      sizeBreakdown: breakdown.length > 0 ? breakdown : null,
      quantity,
      printItemId,
      printNone,
      printText,
      desiredDate,
      specNote,
    },
    warnings,
  };
};

// 仕様が変わったか(03 EV-05 手順3。変わったら概算を空にする)
export const specChanged = (a: QuoteSpec, b: QuoteSpec): boolean =>
  JSON.stringify({ ...a, sizeBreakdown: a.sizeBreakdown ?? [] }) !== JSON.stringify({ ...b, sizeBreakdown: b.sizeBreakdown ?? [] });

// ---- CH-02 失注・取消の理由、依頼のメモ ----

export const checkClosedReason = (reason: string): string | null => {
  if (!reason) return "理由を入力してください。";
  if (reason.length > L.reason) return `理由は${L.reason}文字以内で入力してください。`;
  return null;
};

export const checkRequestMemo = (memo: string): string | null =>
  memo.length > L.text ? `依頼のメモは${L.text.toLocaleString("ja-JP")}文字以内で入力してください。` : null;

// ---- CH-13・CH-14 単価表の行(EV-13) ----

export type PriceItemInput = {
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

export const validatePriceItemInput = (
  raw: Record<string, string>,
  isActive: boolean
): { ok: true; input: PriceItemInput } | { ok: false; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const v = (name: string) => (raw[name] ?? "").trim();

  const kind = v("kind");
  if (!isPriceKind(kind)) errors.kind = kind ? "区分を選び直してください。" : "区分を選んでください。";

  const itemType = v("item_type");
  if (kind === "sewing" && !itemType) errors.item_type = "縫製の行では品目を入力してください。";
  else if (itemType.length > L.priceName) errors.item_type = `品目は${L.priceName}文字以内で入力してください。`;

  const name = v("name");
  if (!name) errors.name = "名前を入力してください。";
  else if (name.length > L.priceName) errors.name = `名前は${L.priceName}文字以内で入力してください。`;

  const unit = v("unit");
  if (!isPriceUnit(unit)) errors.unit = unit ? "単位を選び直してください。" : "単位を選んでください。";
  else if (kind === "setup" && unit !== "per_order") errors.unit = "版代の行は「1回」にしてください。";

  const unitPrice = parseIntInRange(v("unit_price"), 0, L.unitPriceMax);
  if (unitPrice === null || unitPrice === "error")
    errors.unit_price = "単価は0以上1,000万円未満の整数（税抜・円）で入力してください。";

  const qtyFrom = parseIntInRange(v("qty_from"), 1, L.qtyMax);
  if (qtyFrom === "error") errors.qty_from = `枚数の下限は1〜${L.qtyMax.toLocaleString("ja-JP")}の整数で入力してください。`;
  const qtyTo = parseIntInRange(v("qty_to"), 1, L.qtyMax);
  if (qtyTo === "error") errors.qty_to = `枚数の上限は1〜${L.qtyMax.toLocaleString("ja-JP")}の整数で入力してください。`;
  else if (qtyTo !== null && qtyFrom !== "error" && qtyTo < (qtyFrom ?? 1)) errors.qty_to = "枚数の上限は下限以上にしてください。";

  const sortOrder = parseIntInRange(v("sort_order"), 0, L.sortOrderMax);
  if (sortOrder === "error") errors.sort_order = `並び順は0〜${L.sortOrderMax}の整数で入力してください。`;

  const note = v("note");
  if (note.length > L.text) errors.note = `メモは${L.text.toLocaleString("ja-JP")}文字以内で入力してください。`;

  if (
    Object.keys(errors).length > 0 ||
    !isPriceKind(kind) ||
    !isPriceUnit(unit) ||
    unitPrice === null ||
    unitPrice === "error" ||
    qtyFrom === "error" ||
    qtyTo === "error" ||
    sortOrder === "error"
  )
    return { ok: false, errors };
  return {
    ok: true,
    input: {
      kind,
      itemType: itemType || null,
      name,
      unit,
      unitPrice,
      qtyFrom: qtyFrom ?? 1,
      qtyTo,
      sortOrder: sortOrder ?? 0,
      isActive,
      note: note || null,
    },
  };
};

// CH-14 同じ区分・品目・名前の使う行どうしで、枚数の範囲が重ならない。重なる行があれば、その範囲の文を返す
export const findOverlappingRange = (input: PriceItemInput, items: PriceItem[], selfId: string | null): string | null => {
  if (!input.isActive) return null;
  const to = input.qtyTo ?? Infinity;
  const hit = items.find(
    (i) =>
      i.id !== selfId &&
      i.isActive &&
      i.kind === input.kind &&
      i.itemType === input.itemType &&
      i.name === input.name &&
      i.qtyFrom <= to &&
      input.qtyFrom <= (i.qtyTo ?? Infinity)
  );
  return hit ? `${hit.qtyFrom}〜${hit.qtyTo ?? ""}枚` : null;
};
