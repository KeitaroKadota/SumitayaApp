// 商品の画面の入力のチェック(CMN-02 EV-08 手順2・3)。CH-08〜CH-13・CH-35・CH-36。
// abc_rank・abc_ranked_at は送られても読まない(CH-14)。
import { MAX_NOTE, MAX_PRODUCT_NAME, MAX_TEXT, PRODUCT_CATEGORIES } from "@/utils/masterRules";
import {
  checkJanCode,
  checkProductCode,
  lotWarning,
  normalizeProductCode,
  parseLeadTimeDays,
  parseOrderUnit,
  parsePrice,
  parseTaxRate,
} from "@/utils/productRules";
import { formText, toHalfWidth } from "@/utils/textNormalize";
import { productCodeTaken, supplierSelectable, type ProductInput } from "./productData";

export type ProductValidation =
  | { ok: true; productCode: string; input: ProductInput; warnings: string[] }
  | { ok: false; errors: Record<string, string> };

// current: 編集のときの今の値(商品コードは変えない・今の仕入先は取引終了でも残してよい)
export const validateProductForm = async (
  formData: FormData,
  current: { productCode: string; mainSupplierId: string | null } | null
): Promise<ProductValidation> => {
  const errors: Record<string, string> = {};
  const warnings: string[] = [];

  // CH-08 商品コード(編集では受け取った値を無視する)
  const productCode = current ? current.productCode : normalizeProductCode(formText(formData, "product_code"));
  if (!current) {
    const codeError = checkProductCode(productCode);
    if (codeError) errors.product_code = codeError;
    else if (await productCodeTaken(productCode)) errors.product_code = "この商品コードは、すでに登録されています。";
  }

  // CH-09 商品名
  const name = formText(formData, "name");
  if (!name) errors.name = "商品名を入力してください。";
  else if (name.length > MAX_PRODUCT_NAME) errors.name = `商品名は${MAX_PRODUCT_NAME}文字以内で入力してください。`;

  const itemCode = toHalfWidth(formText(formData, "item_code")).trim();
  const size = formText(formData, "size");
  const color = formText(formData, "color");
  for (const [key, value, label] of [
    ["item_code", itemCode, "品番"],
    ["size", size, "サイズ"],
    ["color", color, "色・柄"],
  ] as const) {
    if (value.length > MAX_TEXT) errors[key] = `${label}は${MAX_TEXT}文字以内で入力してください。`;
  }

  // CH-10 JANコード
  const janCode = toHalfWidth(formText(formData, "jan_code")).replace(/\s/g, "");
  if (janCode) {
    const jan = checkJanCode(janCode);
    if (jan.error) errors.jan_code = jan.error;
    if (jan.warning) warnings.push("jan");
  }

  // 分類(画面は定数の選択肢だけ)
  const categoryCode = formText(formData, "category_code");
  if (categoryCode && !(categoryCode in PRODUCT_CATEGORIES)) errors.category_code = "分類を選び直してください。";

  // CH-13 主な仕入先
  const mainSupplierId = formText(formData, "main_supplier_id");
  if (mainSupplierId && !(await supplierSelectable(mainSupplierId, current?.mainSupplierId ?? null)))
    errors.main_supplier_id = "主な仕入先が見つかりません。選び直してください。";

  // CH-11 金額
  const cost = parsePrice(formText(formData, "cost_price"), "原価");
  if (!cost.ok) errors.cost_price = cost.error;
  const sell = parsePrice(formText(formData, "sell_price"), "売価");
  if (!sell.ok) errors.sell_price = sell.error;

  // CH-12 税区分・税率
  const taxIncluded = formText(formData, "sell_price_tax_included");
  if (taxIncluded !== "1" && taxIncluded !== "0") errors.sell_price_tax_included = "売価の税込・税抜を選んでください。";
  const tax = parseTaxRate(formText(formData, "tax_rate"));
  if (!tax.ok) errors.tax_rate = tax.error;
  else if (tax.value === null) errors.tax_rate = "税率を選んでください。";

  // CH-35 発注の単位・最低の発注数
  const lot = parseOrderUnit(formText(formData, "order_lot"), "発注の単位");
  if (!lot.ok) errors.order_lot = lot.error;
  const minQty = parseOrderUnit(formText(formData, "min_order_qty"), "最低の発注数");
  if (!minQty.ok) errors.min_order_qty = minQty.error;
  if (lot.ok && minQty.ok && lotWarning(lot.value, minQty.value)) warnings.push("lot");

  // CH-36 届くまでの日数
  const lead = parseLeadTimeDays(formText(formData, "lead_time_days"));
  if (!lead.ok) errors.lead_time_days = lead.error;

  const note = formText(formData, "note");
  if (note.length > MAX_NOTE) errors.note = `メモは${MAX_NOTE}文字以内で入力してください。`;

  if (Object.keys(errors).length > 0 || !cost.ok || !sell.ok || !tax.ok || !lot.ok || !minQty.ok || !lead.ok)
    return { ok: false, errors };

  return {
    ok: true,
    productCode,
    warnings,
    input: {
      itemCode: itemCode || null,
      name,
      size: size || null,
      color: color || null,
      janCode: janCode || null,
      categoryCode: categoryCode || null,
      mainSupplierId: mainSupplierId || null,
      costPrice: cost.value,
      sellPrice: sell.value,
      sellPriceTaxIncluded: taxIncluded === "1",
      taxRate: tax.value ?? 10,
      isInHouse: formData.get("is_in_house") === "1",
      orderLot: lot.value,
      minOrderQty: minQty.value,
      leadTimeDays: lead.value,
      note: note || null,
    },
  };
};

// 保存の後に出す警告(?warn=jan,lot)
export const PRODUCT_WARNING_MESSAGES: Record<string, string> = {
  jan: "JANコードの最後の数字が合いません。読み間違いがないか確かめてください。",
  lot: "最低の発注数が発注の単位の倍数ではありません。",
  alias_same_code: "この商品コードの商品がすでにあります。読み替えが優先されます。",
};
