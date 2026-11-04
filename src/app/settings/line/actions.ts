"use server";

// G06 LINE通知の設定(本人)の操作(CMN-03 EV-12・EV-13)。ログインしていればだれでも使える(本人の分だけ)。
import { redirect } from "next/navigation";
import { requireLogin } from "@/utils/auth";
import { clearLineLink } from "@/utils/lineAccount";
import { sendLineTest } from "@/utils/lineTest";

const SETTINGS_URL = "/settings/line";

// EV-12 「連携を解除」(確認のダイアログは画面で出す)
export async function unlinkMyLine() {
  const me = await requireLogin(SETTINGS_URL);
  await clearLineLink(me.id, me.id);
  redirect(`${SETTINGS_URL}?unlinked=1`);
}

// EV-13 「テスト送信」
export async function sendMyLineTest() {
  const me = await requireLogin(SETTINGS_URL);
  const result = await sendLineTest(me.id);
  redirect(`${SETTINGS_URL}?test=${result}`);
}
