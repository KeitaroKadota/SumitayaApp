"use server";

import { redirect } from "next/navigation";
import { destroySession } from "@/utils/session";

// EV-03 ログアウト: Cookie を消してログイン画面へ
export async function logout() {
  await destroySession();
  redirect("/login");
}
