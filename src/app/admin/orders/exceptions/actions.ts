"use server";

// 例外注文の操作(B-02 03 EV-02・EV-04)。機能キー orders(社長・店舗)。
// スクロール360への出荷の依頼は作らない(2026-11-08 決定)。CROSS MALL 側の注文も変えない。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { RESOLUTION_NOTE_MAX } from "@/utils/orderExceptionRules";
import { ORDER_EXCEPTIONS_URL, orderUrl, recheckRecentOrders, resolveOrderExceptions } from "@/utils/orderExceptions";
import { formText } from "@/utils/textNormalize";

// ---- EV-02 「例外を調べ直す」(G01) ----

export async function recheckOrderExceptions(): Promise<void> {
  await requireAccess("orders", ORDER_EXCEPTIONS_URL);
  let result: Awaited<ReturnType<typeof recheckRecentOrders>>;
  try {
    // 手順2・3
    result = await recheckRecentOrders();
  } catch (e) {
    console.error("例外注文を調べ直せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${ORDER_EXCEPTIONS_URL}?rechecked=failed`);
  }
  // 手順4: 「◯件の注文を調べ、新しい例外が◯件ありました」(?rechecked=調べた数,新しい例外の数)
  revalidatePath(ORDER_EXCEPTIONS_URL);
  revalidatePath("/admin/orders");
  redirect(`${ORDER_EXCEPTIONS_URL}?rechecked=${result.checked},${result.newExceptions}`);
}

// ---- EV-04 「対応済みにする」(G02) ----

// 対応欄の結果(error: 画面に出すエラー / done: 対応済みにできた / note: 入力を残すためのメモ)
export type ResolveState = { error: string | null; done: boolean; note: string };

export async function resolveOrderExceptionsAction(orderId: string, _prev: ResolveState, formData: FormData): Promise<ResolveState> {
  const me = await requireAccess("orders", orderUrl(orderId));

  // 手順3: CH-13 対応のメモ(任意、500文字以下)
  const note = formText(formData, "resolution_note");
  if (note.length > RESOLUTION_NOTE_MAX)
    return { error: `対応のメモは${RESOLUTION_NOTE_MAX}文字以内で入力してください。`, done: false, note };

  // 手順2・4・5: CH-12 未対応が残っていれば、1つのトランザクションでまとめて対応済みにする
  let ok = false;
  try {
    ok = await resolveOrderExceptions(orderId, note || null, me.id);
  } catch (e) {
    console.error("例外を対応済みにできませんでした:", e instanceof Error ? e.message : e);
    return { error: "保存できませんでした。時間をおいてもう一度お試しください。", done: false, note };
  }
  // 手順6(CH-12 で別の人が先に対応済みにしていたら、何もせずに画面を新しくする)
  revalidatePath(orderUrl(orderId));
  revalidatePath(ORDER_EXCEPTIONS_URL);
  revalidatePath("/admin/orders");
  if (!ok) return { error: "すでに対応済みです。", done: false, note: "" };
  return { error: null, done: true, note: "" };
}
