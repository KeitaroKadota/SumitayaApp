import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { getSessionSecret } from "@/utils/session";

// 社長が発行した初期パスワードを、メールで送れないときに画面へ1回だけ表示するための一時保存(EV-08 手順6)。
// DBには元のパスワードを残さないため、短命なCookieに載せるだけにする(15分で自然に消える)。
// みるきーの issuedCredentials.ts を流用し、Cookieの範囲を従業員の画面(/admin/employees)に変えた。
const COOKIE_NAME = "sumitaya_issued_credentials";
const COOKIE_PATH = "/admin/employees";
const MINUTES = 15;

export type IssuedCredential = { employeeId: string; loginId: string; password: string; name: string };

export const storeIssuedCredential = async (credential: IssuedCredential) => {
  const token = await new SignJWT({ credential })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MINUTES}m`)
    .sign(getSessionSecret());

  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * MINUTES,
    path: COOKIE_PATH,
  });
};

export const readIssuedCredential = async (): Promise<IssuedCredential | null> => {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getSessionSecret());
    const c = payload.credential as Partial<IssuedCredential> | undefined;
    if (!c || typeof c.employeeId !== "string" || typeof c.loginId !== "string" || typeof c.password !== "string") {
      return null;
    }
    return { employeeId: c.employeeId, loginId: c.loginId, password: c.password, name: String(c.name ?? "") };
  } catch {
    return null;
  }
};
