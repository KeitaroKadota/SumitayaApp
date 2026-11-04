// 返信のひな形(reply_templates。担当は D-02)の決まった値とチェック(D-02 01 6.2・6.3、04 CH-08〜CH-10)。
// DBを読まない計算だけのファイルなので、画面の部品からも使える。
// 種類ごとの用途は、D-02 01 6.2(在庫)・D-03 01 6.2・D-04 01 6.3・D-06 01 6.4 と、04 CH-10(共通)の表のとおり。
import { parseIntInRange } from "@/utils/textNormalize";

export const TEMPLATE_CATEGORIES = {
  stock: "在庫",
  faq: "よくある質問",
  return: "返品",
  custom: "特注",
  common: "共通",
} as const;
export type TemplateCategory = keyof typeof TEMPLATE_CATEGORIES;
export const isTemplateCategory = (v: string): v is TemplateCategory => v in TEMPLATE_CATEGORIES;

export const TEMPLATE_PURPOSES: Record<TemplateCategory, Record<string, string>> = {
  stock: {
    stock_available: "在庫あり",
    stock_incoming: "発注済み（入荷予定あり）",
    stock_estimate: "未発注（入荷の見込み・要確認）",
    stock_check: "確認してご連絡",
    stock_discontinued: "取り扱い終了",
  },
  faq: { faq_answer: "よくある質問の回答" },
  return: {
    return_accept: "返品の受付",
    exchange_accept: "交換の受付",
    return_ask_order: "注文番号を伺う",
    return_reject: "お断り",
  },
  custom: { custom_ask: "足りない項目の聞き返し", custom_estimate: "概算のご案内" },
  common: { greeting: "あいさつ", signature: "署名", other: "その他" },
};

export const purposeLabel = (category: string, purpose: string): string =>
  (isTemplateCategory(category) ? TEMPLATE_PURPOSES[category][purpose] : undefined) ?? purpose;

// 01 6.3 の差し込み欄と、D-03・D-04・D-06 で足した差し込み欄。種類ごとに「押すと入る」ボタンに出す
const COMMON_PLACEHOLDERS = ["お客様名", "署名"];
export const TEMPLATE_PLACEHOLDERS: Record<TemplateCategory, string[]> = {
  stock: [...COMMON_PLACEHOLDERS, "商品ごとの回答", "商品名", "在庫の有無", "在庫数", "出荷日", "入荷予定日"],
  faq: [...COMMON_PLACEHOLDERS, "FAQの回答"],
  return: [...COMMON_PLACEHOLDERS, "注文番号", "注文日", "返品の商品", "送料の負担", "返品の番号"],
  custom: [...COMMON_PLACEHOLDERS, "団体名", "品目", "枚数", "足りない項目", "概算の内訳", "概算の合計"],
  common: COMMON_PLACEHOLDERS,
};
const ALL_PLACEHOLDERS = new Set(Object.values(TEMPLATE_PLACEHOLDERS).flat());

// CH-09 長さ
export const TEMPLATE_LIMITS = { name: 50, subject: 200, body: 5000, sortOrderMax: 9999 } as const;

// CH-08 本文・件名の {…} のうち、決まった名前でないもの
export const unknownPlaceholders = (text: string): string[] => [
  ...new Set([...text.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]).filter((name) => !ALL_PLACEHOLDERS.has(name))),
];

export type TemplateInput = {
  category: TemplateCategory;
  purpose: string;
  name: string;
  subject: string | null;
  body: string;
  sortOrder: number;
  isActive: boolean;
};

export type TemplateRawInput = { category: string; purpose: string; name: string; subject: string; body: string; sortOrder: string };

// EV-07 手順1: CH-09・CH-10(種類と用途の組み合わせ)・CH-08。errors の名前はフォームの name と同じ。
// 署名を「使う」にできるのは1件だけ(CH-10 の後半)は、DBを見る必要があるため保存の操作で確かめる
export const validateTemplateInput = (
  raw: TemplateRawInput,
  isActive: boolean
): { ok: true; input: TemplateInput } | { ok: false; errors: Record<string, string> } => {
  const errors: Record<string, string> = {};
  const category = raw.category.trim();
  if (!isTemplateCategory(category)) errors.category = category ? "種類を選び直してください。" : "種類を選んでください。";

  const purpose = raw.purpose.trim();
  if (!purpose) errors.purpose = "用途を選んでください。";
  else if (isTemplateCategory(category) && !(purpose in TEMPLATE_PURPOSES[category]))
    errors.purpose = "この種類では選べない用途です。用途を選び直してください。";

  const name = raw.name.trim();
  if (!name) errors.name = "名前を入力してください。";
  else if (name.length > TEMPLATE_LIMITS.name) errors.name = `名前は${TEMPLATE_LIMITS.name}文字以内で入力してください。`;

  const subject = raw.subject.trim();
  if (subject.length > TEMPLATE_LIMITS.subject) errors.subject = `件名は${TEMPLATE_LIMITS.subject}文字以内で入力してください。`;
  else {
    const unknown = unknownPlaceholders(subject);
    if (unknown.length > 0) errors.subject = `決まっていない差し込み欄があります: ${unknown.map((u) => `{${u}}`).join("・")}`;
  }

  // 本文は前後の空白だけ取る(中の改行はそのまま)
  const body = raw.body.replace(/\r\n/g, "\n").trim();
  if (!body) errors.body = "本文を入力してください。";
  else if (body.length > TEMPLATE_LIMITS.body)
    errors.body = `本文は${TEMPLATE_LIMITS.body.toLocaleString("ja-JP")}文字以内で入力してください。`;
  else {
    const unknown = unknownPlaceholders(body);
    if (unknown.length > 0) errors.body = `決まっていない差し込み欄があります: ${unknown.map((u) => `{${u}}`).join("・")}`;
  }

  const sort = parseIntInRange(raw.sortOrder, 0, TEMPLATE_LIMITS.sortOrderMax);
  if (sort === "error") errors.sort_order = `並び順は0〜${TEMPLATE_LIMITS.sortOrderMax}の整数で入力してください。`;

  if (Object.keys(errors).length > 0 || !isTemplateCategory(category) || sort === "error") return { ok: false, errors };
  return {
    ok: true,
    input: { category, purpose, name, subject: subject || null, body, sortOrder: sort ?? 0, isActive },
  };
};

export const isActiveSignature = (input: { category: string; purpose: string; isActive: boolean }): boolean =>
  input.category === "common" && input.purpose === "signature" && input.isActive;
