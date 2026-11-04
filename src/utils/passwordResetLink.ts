import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret, issuedAfterPasswordChange } from "@/utils/session";
import { findAccountById, type EmployeeAccount } from "@/utils/employeeAccount";

// パスワードを忘れた従業員向けの再設定リンク(社長が発行し、本人のメールへ送る。EV-09)。
// 2時間だけ有効な署名付きJWT。みるきーの passwordResetLink.ts を流用し、使い回し防止のチェックを加えた(CH-08)。
const PURPOSE = "password-reset";

export const createPasswordResetToken = async (employeeId: string) => {
  return await new SignJWT({ employeeId, purpose: PURPOSE })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(getSessionSecret());
};

// CH-08 の 1〜3(署名・目的・2時間以内)。DBは読まない
const verifyPasswordResetToken = async (token: string): Promise<{ employeeId: string; issuedAt: number } | null> => {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (payload.purpose !== PURPOSE || typeof payload.employeeId !== "string" || typeof payload.iat !== "number") {
      return null;
    }
    return { employeeId: payload.employeeId, issuedAt: payload.iat };
  } catch {
    return null;
  }
};

// CH-08 再設定リンクが有効か。よければ対象の従業員を返す。
// 4. 対象が存在し在籍中(CH-10)。5. 発行時刻が password_changed_at 以後(一度使ったリンク・発行の後にパスワードが変わったリンクは使えない)
export const findPasswordResetTarget = async (token: string | null | undefined): Promise<EmployeeAccount | null> => {
  if (!token) return null;
  const verified = await verifyPasswordResetToken(token);
  if (!verified) return null;

  const account = await findAccountById(verified.employeeId);
  if (!account || !account.isActive) return null;
  if (!issuedAfterPasswordChange(verified.issuedAt, account.passwordChangedAt)) return null;
  return account;
};
