// 仕入先・取引先の入力のチェックで共通のもの(CMN-02 EV-15 手順2・3、04 CH-04・CH-15〜CH-18)。
// DBを読まない計算だけのファイル。重複(CH-16)は呼ぶ側でDBを見る。
import { MAX_NOTE, MAX_TEXT, MONTH_END_DAY, PARTNER_CODE_PATTERN } from "@/utils/masterRules";
import {
  formText,
  isValidEmail,
  isValidPhone,
  katakanaToHiragana,
  normalizePhone,
  normalizePostalCode,
  toHalfWidth,
} from "@/utils/textNormalize";

export type PartnerCommon = {
  code: string | null;
  name: string;
  nameKana: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  postalCode: string | null;
  address: string | null;
  closingDay: number | null;
  paymentMonthOffset: number | null;
  paymentDay: number | null;
  note: string | null;
};

const parseOptionalInt = (value: string, min: number, max: number): number | null | "error" => {
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return "error";
  const n = Number(value);
  return n >= min && n <= max ? n : "error";
};

// 電話・FAX(CH-17)。空は null
export const parsePhoneField = (
  formData: FormData,
  name: string,
  label: string,
  errors: Record<string, string>
): string | null => {
  const phone = normalizePhone(formText(formData, name));
  if (phone && !isValidPhone(phone)) errors[name] = `${label}は数字と「-」で、10〜11桁の番号を入力してください。`;
  return phone || null;
};

// 共通の項目を読み、エラーを errors に入れる
export const parsePartnerCommon = (formData: FormData, codeName: string, errors: Record<string, string>): PartnerCommon => {
  // CH-16 コード: 空はよい。半角の英数字と「-」「_」、1〜20文字
  const code = toHalfWidth(formText(formData, codeName)).trim();
  if (code && !PARTNER_CODE_PATTERN.test(code))
    errors[codeName] = "コードは半角の英数字と「-」「_」の20文字以内で入力してください。";

  // CH-15 名前
  const name = formText(formData, "name");
  if (!name) errors.name = "名前を入力してください。";
  else if (name.length > MAX_TEXT) errors.name = `名前は${MAX_TEXT}文字以内で入力してください。`;

  // ふりがなはひらがなに
  const nameKana = katakanaToHiragana(formText(formData, "name_kana")).trim();
  if (nameKana.length > MAX_TEXT) errors.name_kana = `ふりがなは${MAX_TEXT}文字以内で入力してください。`;

  const contactName = formText(formData, "contact_name");
  if (contactName.length > MAX_TEXT) errors.contact_name = `担当者は${MAX_TEXT}文字以内で入力してください。`;

  // CH-17 電話・郵便番号
  const phone = parsePhoneField(formData, "phone", "電話", errors);
  const postalRaw = formText(formData, "postal_code");
  const postalCode = postalRaw ? normalizePostalCode(postalRaw) : null;
  if (postalRaw && !postalCode) errors.postal_code = "郵便番号は 123-4567 の形で入力してください。";

  // CH-04 メールアドレス
  const email = formText(formData, "email");
  if (email && !isValidEmail(email)) errors.email = "メールアドレスの形式が正しくありません。";

  const address = formText(formData, "address");
  if (address.length > MAX_TEXT) errors.address = `住所は${MAX_TEXT}文字以内で入力してください。`;

  // CH-18 締め日・支払日(31=月末)、支払月(0〜3)
  const closingDay = parseOptionalInt(formText(formData, "closing_day"), 1, MONTH_END_DAY);
  const paymentMonthOffset = parseOptionalInt(formText(formData, "payment_month_offset"), 0, 3);
  const paymentDay = parseOptionalInt(formText(formData, "payment_day"), 1, MONTH_END_DAY);
  if (closingDay === "error" || paymentMonthOffset === "error" || paymentDay === "error")
    errors.closing_day = "締め日・支払日を選び直してください。";
  else if (closingDay === null && (paymentMonthOffset !== null || paymentDay !== null))
    errors.closing_day = "締め日が空（都度）のときは、支払の月と日を空にしてください。";
  else if (paymentDay !== null && paymentMonthOffset === null) errors.closing_day = "支払の月を選んでください。";

  const note = formText(formData, "note");
  if (note.length > MAX_NOTE) errors.note = `メモは${MAX_NOTE}文字以内で入力してください。`;

  const num = (v: number | null | "error") => (v === "error" ? null : v);
  return {
    code: code || null,
    name,
    nameKana: nameKana || null,
    contactName: contactName || null,
    phone,
    email: email || null,
    postalCode,
    address: address || null,
    closingDay: num(closingDay),
    paymentMonthOffset: num(paymentMonthOffset),
    paymentDay: num(paymentDay),
    note: note || null,
  };
};
