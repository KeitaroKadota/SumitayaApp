// ログイン・パスワードの決まり(CMN-01 04)。値を変えるときはこのファイルだけを直す。
// DBを読まない計算だけのファイル。CMN-02 の従業員の保存(CH-04・CH-13)からも使う。
import { isRole, type Role } from "@/utils/permissions";

// CH-02: 続けて5回間違えると15分ログインできない(00_仮決め一覧 CMN01-仮-06)
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

// CH-05: 8文字以上72文字以下。文字の種類は指定しない(CMN01-仮-07)
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const isValidNewPassword = (password: string): boolean =>
  password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;

// CH-04: ログインIDは半角の英字・数字・「-」「_」「.」の3〜20文字。大文字・小文字は区別せず小文字で保存する(CMN01-仮-08)
export const LOGIN_ID_PATTERN = /^[a-z0-9._-]{3,20}$/;

export const normalizeLoginId = (value: string): string => value.trim().toLowerCase();

export const isValidLoginId = (normalized: string): boolean => LOGIN_ID_PATTERN.test(normalized);

// CH-13: 区分は決まった値で1つ以上。重複は取り除く
export const parseRoles = (values: readonly string[]): Role[] | null => {
  const roles = [...new Set(values)];
  if (roles.length === 0 || !roles.every(isRole)) return null;
  return roles as Role[];
};
