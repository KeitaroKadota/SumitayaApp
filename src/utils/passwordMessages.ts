// パスワード変更(G02)・再設定(G03)のエラーの文(CH-05〜CH-07、00_画面共通ルール 6.1)
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/utils/accountRules";

export const PASSWORD_ERROR_MESSAGES: Record<string, string> = {
  policy: `新しいパスワードは${PASSWORD_MIN_LENGTH}文字以上、${PASSWORD_MAX_LENGTH}文字以下にしてください。`,
  mismatch: "新しいパスワードと確認が一致しません。もう一度入力してください。",
  current: "今のパスワードが正しくありません。",
  same: "今と同じパスワードは使えません。別のパスワードにしてください。",
};

export const passwordErrorMessage = (error: string | string[] | undefined): string | null =>
  typeof error === "string" ? (PASSWORD_ERROR_MESSAGES[error] ?? null) : null;
