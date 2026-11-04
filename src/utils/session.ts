import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

// ログイン状態(署名付きのCookie)。みるきーの session.ts を流用し、Cookie名を変え、発行時刻を返すようにした(CMN-01 01 7章)。
// 中身は従業員IDと発行時刻だけ。発行時刻は CH-11(パスワード変更より後のログインか)の確認に使う。
const COOKIE_NAME = "sumitaya_session";
// 【仮】ログインしたままでいられる期間は180日(00_仮決め一覧 CMN01-仮-05)
const SESSION_DAYS = 180;

export const getSessionSecret = (): Uint8Array => {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error("SESSION_SECRET が設定されていません(32文字以上)");
  return new TextEncoder().encode(value);
};

export type Session = { employeeId: string; issuedAt: number };

export const createSession = async (employeeId: string) => {
  const token = await new SignJWT({ employeeId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(getSessionSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
    path: "/",
  });
};

// 署名と期限を確かめて中身を返す。だめなら null(未ログイン)
export const getSession = async (): Promise<Session | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    if (typeof payload.employeeId !== "string" || typeof payload.iat !== "number") return null;
    return { employeeId: payload.employeeId, issuedAt: payload.iat };
  } catch {
    return null;
  }
};

export const destroySession = async () => {
  const store = await cookies();
  store.delete(COOKIE_NAME);
};

// CH-08・CH-11: 署名の発行時刻(秒)が、パスワードを変えた時刻(秒に切り捨て)以後か
export const issuedAfterPasswordChange = (issuedAtSec: number, passwordChangedAt: Date | null): boolean =>
  !passwordChangedAt || issuedAtSec >= Math.floor(passwordChangedAt.getTime() / 1000);
