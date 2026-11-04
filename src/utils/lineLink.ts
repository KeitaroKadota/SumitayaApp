import { SignJWT, jwtVerify } from "jose";
import { getSessionSecret } from "@/utils/session";

// LINE との結び付けの合言葉(state)。みるきーの lineLink.ts を変えた(CMN-03 01 7.4)。
// みるきーは管理者が7日有効のリンクを発行する形。すみたやは、ログイン中の本人が自分のスマホから始める形にし、
// state に従業員IDと目的を入れ、有効期間を10分にする。同じ state を Cookie にも入れ、戻ったときに突き合わせる(CH-12)。
const PURPOSE = "line-link";
const STATE_MINUTES = 10;

export const LINE_STATE_COOKIE = "sumitaya_line_state";
export const LINE_STATE_COOKIE_PATH = "/auth/line";
export const LINE_STATE_MAX_AGE_SEC = STATE_MINUTES * 60;

// EV-10 手順3: 本人の従業員ID・目的・ランダムな文字列を入れて署名する
export const createLineLinkState = async (employeeId: string): Promise<string> =>
  await new SignJWT({ employeeId, purpose: PURPOSE, nonce: crypto.randomUUID() })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${STATE_MINUTES}m`)
    .sign(getSessionSecret());

// CH-12: Cookie と同じ・署名が正しい・目的が line-link・10分以内・中の従業員IDが今ログイン中の本人と同じ
export const verifyLineLinkState = async ({
  state,
  cookieState,
  currentEmployeeId,
}: {
  state: string | null;
  cookieState: string | undefined;
  currentEmployeeId: string;
}): Promise<boolean> => {
  if (!state || !cookieState || state !== cookieState) return false;
  try {
    const { payload } = await jwtVerify(state, getSessionSecret());
    return payload.purpose === PURPOSE && payload.employeeId === currentEmployeeId;
  } catch {
    return false;
  }
};
