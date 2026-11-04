// EV-10 「LINEと連携する」(G06 → LINEログイン)。みるきーの /auth/line/link を流用し、
// 管理者が発行したリンクではなく、ログイン中の本人が始める形にした(CMN-03 01 7.4)。
import { NextResponse } from "next/server";
import { requireLogin } from "@/utils/auth";
import { getSiteUrl } from "@/utils/accountEmail";
import { buildLineLoginUrl } from "@/utils/line";
import { getLineLinkStatus } from "@/utils/lineAccount";
import { LINE_STATE_COOKIE, LINE_STATE_COOKIE_PATH, LINE_STATE_MAX_AGE_SEC, createLineLinkState } from "@/utils/lineLink";

const SETTINGS_URL = "/settings/line";

export async function GET() {
  // 手順1
  const me = await requireLogin(SETTINGS_URL);
  const siteUrl = getSiteUrl();

  // 手順2: すでに連携済みなら何もしない
  const status = await getLineLinkStatus(me.id);
  if (!status || status.linked) return NextResponse.redirect(`${siteUrl}${SETTINGS_URL}`);

  // 手順3〜5: 署名付きの合言葉を作り、同じものを10分の Cookie に入れて LINE ログインへ移す
  const state = await createLineLinkState(me.id);
  const response = NextResponse.redirect(buildLineLoginUrl(state, `${siteUrl}/auth/line/link/callback`));
  response.cookies.set(LINE_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: LINE_STATE_MAX_AGE_SEC,
    path: LINE_STATE_COOKIE_PATH,
  });
  return response;
}
