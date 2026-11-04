// 従業員の入力のチェック(CMN-02 EV-02 手順2・3、EV-04 手順3)。CH-01〜CH-06・CH-30、CMN-01 の CH-04・CH-13。
// DBを見るチェック(重複・勤務場所)もここで行う。CMN-01 の CH-14(社長が残るか)は保存の操作の中で行う。
import { isValidLoginId, normalizeLoginId, parseRoles } from "@/utils/accountRules";
import {
  DEPARTMENTS,
  EMPLOYEE_CODE_PATTERN,
  EMPLOYMENT_TYPES,
  MAX_NOTE,
  MAX_PERSON_NAME,
  MAX_TEXT,
  type Department,
  type EmploymentType,
} from "@/utils/masterRules";
import { formText, isHiraganaReading, isValidDateStr, isValidEmail, katakanaToHiragana } from "@/utils/textNormalize";
import { employeeCodeTaken, isActiveWorkLocation, loginIdTaken, type EmployeeInput } from "./employeeData";

export type EmployeeValidation =
  | { ok: true; input: EmployeeInput }
  | { ok: false; errors: Record<string, string> };

// current: 編集のときの今の値(今の勤務場所が使用中でなくても、そのまま残してよい。CH-30)
export const validateEmployeeForm = async (
  formData: FormData,
  current: { id: string; homeLocationId: string | null } | null
): Promise<EmployeeValidation> => {
  const errors: Record<string, string> = {};

  // 手順2: 前後の空白を取る。ふりがなはカタカナをひらがなに。ログインIDは小文字に
  const employeeCode = formText(formData, "employee_code");
  const lastName = formText(formData, "last_name");
  const firstName = formText(formData, "first_name");
  const lastNameKana = katakanaToHiragana(formText(formData, "last_name_kana")).trim();
  const firstNameKana = katakanaToHiragana(formText(formData, "first_name_kana")).trim();
  const department = formText(formData, "department");
  const employmentType = formText(formData, "employment_type");
  const email = formText(formData, "email");
  const hiredOn = formText(formData, "hired_on");
  const usesTimecard = formData.get("uses_timecard") === "1";
  const homeLocationId = formText(formData, "home_location_id");
  const note = formText(formData, "note");
  const loginId = normalizeLoginId(formText(formData, "login_id"));
  const roles = parseRoles(formData.getAll("roles").map(String));

  // CH-03 社員番号
  if (!employeeCode) errors.employee_code = "社員番号を入力してください。";
  else if (!EMPLOYEE_CODE_PATTERN.test(employeeCode))
    errors.employee_code = "社員番号は半角の英数字と「-」の20文字以内で入力してください。";

  // CH-01 姓・名
  if (!lastName || !firstName) errors.last_name = "姓と名を入力してください。";
  else if (lastName.length > MAX_PERSON_NAME || firstName.length > MAX_PERSON_NAME)
    errors.last_name = `姓と名は、それぞれ${MAX_PERSON_NAME}文字以内で入力してください。`;

  // CH-02 ふりがな
  for (const value of [lastNameKana, firstNameKana]) {
    if (!value) continue;
    if (!isHiraganaReading(value)) errors.last_name_kana = "ふりがなは、ひらがなで入力してください。";
    else if (value.length > MAX_TEXT) errors.last_name_kana = `ふりがなは${MAX_TEXT}文字以内で入力してください。`;
  }

  // CH-05 所属・雇用形態
  if (!(department in DEPARTMENTS)) errors.department = "所属を選んでください。";
  if (!(employmentType in EMPLOYMENT_TYPES)) errors.employment_type = "雇用形態を選んでください。";

  // CH-04 メールアドレス
  if (email && !isValidEmail(email)) errors.email = "メールアドレスの形式が正しくありません。";

  // CH-06 入社日(退職日は退職の登録で入れる。EV-05)
  if (hiredOn && !isValidDateStr(hiredOn)) errors.hired_on = "入社日を正しい日付で入力してください。";

  // CH-30 主な勤務場所(空はよい。今の値はそのまま残してよい)
  if (homeLocationId && homeLocationId !== current?.homeLocationId && !(await isActiveWorkLocation(homeLocationId)))
    errors.home_location_id = "主な勤務場所が見つかりません。選び直してください。";

  // メモ
  if (note.length > MAX_NOTE) errors.note = `メモは${MAX_NOTE}文字以内で入力してください。`;

  // CMN-01 CH-04 ログインID(空でもよい)
  if (loginId && !isValidLoginId(loginId))
    errors.login_id = "ログインIDは半角の英字・数字・「-」「_」「.」の3〜20文字で入力してください。";

  // CMN-01 CH-13 権限の区分
  if (!roles) errors.roles = "権限を1つ以上選んでください。";

  // 重複(DBを読む。形が正しいときだけ)
  const excludeId = current?.id ?? null;
  if (!errors.employee_code && (await employeeCodeTaken(employeeCode, excludeId)))
    errors.employee_code = "この社員番号は、ほかの従業員が使っています。";
  if (loginId && !errors.login_id && (await loginIdTaken(loginId, excludeId)))
    errors.login_id = "このログインIDは、ほかの従業員が使っています。";

  if (Object.keys(errors).length > 0 || !roles) return { ok: false, errors };

  return {
    ok: true,
    input: {
      employeeCode,
      lastName,
      firstName,
      lastNameKana: lastNameKana || null,
      firstNameKana: firstNameKana || null,
      department: department as Department,
      employmentType: employmentType as EmploymentType,
      email: email || null,
      hiredOn: hiredOn || null,
      usesTimecard,
      homeLocationId: homeLocationId || null,
      note: note || null,
      loginId: loginId || null,
      roles,
    },
  };
};
