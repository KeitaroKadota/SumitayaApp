// EV-11 LINEから戻る。みるきーの /auth/line/link/callback を流用し、シートの読み書きを employees の UPDATE に、
// 戻り先を /settings/line にした(CMN-03 01 7.4)。LINE でログインはさせない(セッションは作らない)。
import { NextResponse, type NextRequest } from "next/server";
import { getCurrentEmployee } from "@/utils/auth";
import { getSiteUrl } from "@/utils/accountEmail";
import { isUniqueViolation } from "@/utils/dbErrors";
import { exchangeCodeForAccessToken, getLineProfile } from "@/utils/line";
import { lineUserIdUsedByOthers, saveLineLink } from "@/utils/lineAccount";
import { LINE_STATE_COOKIE, LINE_STATE_COOKIE_PATH, verifyLineLinkState } from "@/utils/lineLink";
import { loginUrlWithNext } from "@/utils/loginNext";
import { LINKED_MESSAGE, notifyEmployees } from "@/utils/notify";

const SETTINGS_URL = "/settings/line";

export async function GET(request: NextRequest) {
  const siteUrl = getSiteUrl();
  const params = request.nextUrl.searchParams;
  const cookieState = request.cookies.get(LINE_STATE_COOKIE)?.value;

  // 移る先を決めて、合言葉の Cookie を消す(1回しか使えないように。手順4)
  const go = (path: string) => {
    const response = NextResponse.redirect(`${siteUrl}${path}`);
    response.cookies.set(LINE_STATE_COOKIE, "", { path: LINE_STATE_COOKIE_PATH, maxAge: 0, httpOnly: true, secure: true });
    return response;
  };

  // 手順1: 未ログインならログイン画面へ
  const me = await getCurrentEmployee();
  if (!me) return go(loginUrlWithNext(SETTINGS_URL));

  // 手順2: 本人が LINE の画面でキャンセルした
  if (params.get("error")) return go(`${SETTINGS_URL}?error=canceled`);

  // 手順3 CH-12
  const valid = await verifyLineLinkState({ state: params.get("state"), cookieState, currentEmployeeId: me.id });
  if (!valid) return go(`${SETTINGS_URL}?error=expired`);

  const code = params.get("code");
  if (!code) return go(`${SETTINGS_URL}?error=failed`);

  // 手順5: 認可コードで本人の LINE の ID と表示名を取る(アクセストークンは保存しない)
  let profile: { userId: string; displayName: string };
  try {
    const accessToken = await exchangeCodeForAccessToken(code, `${siteUrl}/auth/line/link/callback`);
    profile = await getLineProfile(accessToken);
  } catch (e) {
    console.error("LINE との連携に失敗しました:", e instanceof Error ? e.message : e);
    return go(`${SETTINGS_URL}?error=failed`);
  }

  // 手順6・7 CH-13: ほかの従業員(退職者を含む)と重ならないこと
  try {
    if (await lineUserIdUsedByOthers(profile.userId, me.id)) return go(`${SETTINGS_URL}?error=duplicate`);
    await saveLineLink({ employeeId: me.id, lineUserId: profile.userId, displayName: profile.displayName });
  } catch (e) {
    if (isUniqueViolation(e, "employees_line_user_id_key")) return go(`${SETTINGS_URL}?error=duplicate`);
    console.error("LINE の結び付けを保存できませんでした:", e instanceof Error ? e.message : e);
    return go(`${SETTINGS_URL}?error=failed`);
  }

  // 手順8: 本人に知らせる。送れなくても続ける
  try {
    await notifyEmployees([me.id], LINKED_MESSAGE, { kind: "linked" });
  } catch (e) {
    console.error("連携のお知らせを送れませんでした:", e instanceof Error ? e.message : e);
  }

  // 手順9
  return go(`${SETTINGS_URL}?linked=1`);
}
