"use server";

// 照合の結果・検収(C-02 G02)の操作(03 EV-03〜EV-05・EV-07・EV-08、04 CH-02・CH-07〜CH-10)。機能キー purchasing(社長・店舗・経理)。
// 検収の入力のエラー(CH-09・CH-10)は FormState で画面に返す。ほかの操作は ?error= を付けて G02 に戻す。
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAccess } from "@/utils/auth";
import { SLIPS_URL, slipUrl, unconfirmSlip } from "@/utils/deliverySlipServer";
import { errorSummary, formValues, type FormState } from "@/utils/formState";
import {
  RECEIVING_URL,
  acceptSlip,
  cancelAcceptance,
  closeReceivingTasks,
  getReceivingLines,
  getReceivingSlip,
  isUuid,
  matchSlip,
  receivingUrl,
} from "@/utils/receiving";
import { RECEIVING_RULES, parseAcceptForm } from "@/utils/receivingMatch";
import { formText } from "@/utils/textNormalize";

const refresh = (id: string) => {
  revalidatePath(RECEIVING_URL);
  revalidatePath(receivingUrl(id));
  revalidatePath(SLIPS_URL);
  revalidatePath(slipUrl(id));
};

const ACCEPT_ERRORS: Record<string, string> = {
  status: "すでに検収済みか、検収できない状態です。画面を開き直してください。",
  conflict: "ほかの人がこの納品書を更新しました。画面を開き直してください。",
  po: "結び付けた発注が、検収できる状態（発注済み・一部入荷）ではありません。発注を選び直すか、発注なしで検収してください。",
  error: "検収できませんでした。時間をおいてもう一度お試しください。",
};

// ---- EV-03 「この内容で検収する」・EV-04 「発注なしで検収する」(intent = no_order) ----

export async function acceptReceiving(id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const me = await requireAccess("purchasing", receivingUrl(id));
  const values = formValues(formData);
  const noOrder = formData.get("intent") === "no_order";
  // CH-07(状態と版は acceptSlip の中でも、行を押さえてから確かめる)
  const slip = await getReceivingSlip(id);
  if (!slip) return { errors: {}, formError: "この納品書は見つかりません。", values };
  if (slip.status !== "confirmed" && slip.status !== "needs_review") return { errors: {}, formError: ACCEPT_ERRORS.status, values };
  if (!noOrder && !slip.purchaseOrderId) return { errors: {}, formError: ACCEPT_ERRORS.po, values };
  // CH-09・CH-10
  const lines = await getReceivingLines(id);
  const parsed = parseAcceptForm(
    values,
    lines.map((l) => ({
      lineId: l.id,
      lineNo: l.lineNo,
      // 発注なしのときは、発注と比べた結果は使わない(在庫にしない品だけ分ける)
      result: l.isNonStock ? "non_stock" : noOrder ? null : l.matchResult,
      unitsQuantity: l.unitsQuantity,
    })),
    { noOrder }
  );
  if (!parsed.ok) return { errors: parsed.errors, formError: errorSummary(parsed.errors), values };

  const outcome = await acceptSlip(id, {
    mode: noOrder ? "no_order" : "reviewed",
    by: me.id,
    quantities: parsed.quantities,
    note: parsed.note,
    version: formText(formData, "version"),
  });
  if (!outcome.ok) return { errors: {}, formError: ACCEPT_ERRORS[outcome.reason], values };
  // 手順5
  refresh(id);
  redirect(`${RECEIVING_URL}?done=accepted`);
}

// ---- EV-05 発注を選び直す ----

export async function choosePurchaseOrder(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", receivingUrl(id));
  const poId = formText(formData, "purchase_order_id");
  if (!isUuid(poId)) redirect(`${receivingUrl(id)}?error=po`);
  let outcome: Awaited<ReturnType<typeof matchSlip>>;
  try {
    // 人が選んだので自動の検収はしない(結果を見てから押してもらう)
    outcome = await matchSlip(id, { by: me.id, chosenPurchaseOrderId: poId, allowAuto: false });
  } catch (e) {
    console.error("納品書を照合し直せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${receivingUrl(id)}?error=save`);
  }
  if (!outcome.ok) redirect(`${receivingUrl(id)}?error=${outcome.reason === "po" ? "po" : "status"}`);
  refresh(id);
  redirect(`${receivingUrl(id)}?done=rematched`);
}

// ---- 「照合し直す」(EV-01 を G02 から。今の発注のまま、または発注を選ばずに選び直す) ----

export async function rematchSlip(id: string): Promise<void> {
  const me = await requireAccess("purchasing", receivingUrl(id));
  let outcome: Awaited<ReturnType<typeof matchSlip>>;
  try {
    outcome = await matchSlip(id, { by: me.id, allowAuto: false });
  } catch (e) {
    console.error("納品書を照合し直せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${receivingUrl(id)}?error=save`);
  }
  if (!outcome.ok) redirect(`${receivingUrl(id)}?error=status`);
  refresh(id);
  redirect(`${receivingUrl(id)}?done=rematched`);
}

// ---- EV-07 「読み取りを直す」(C-01 EV-11 の確定の取消をして C-01 G03 へ) ----

export async function fixReading(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", receivingUrl(id));
  let ok = false;
  try {
    ok = await unconfirmSlip(id, formText(formData, "version"), me.id);
    if (ok) await closeReceivingTasks(id, "読み取りを直すため確定を取り消した");
  } catch (e) {
    console.error("確定を取り消せませんでした:", e instanceof Error ? e.message : e);
    redirect(`${receivingUrl(id)}?error=save`);
  }
  if (!ok) redirect(`${receivingUrl(id)}?error=unconfirm`);
  refresh(id);
  redirect(`${slipUrl(id)}?done=unconfirmed`);
}

// ---- EV-08 「検収を取り消す」(CH-08・CH-10) ----

export async function cancelReceiving(id: string, formData: FormData): Promise<void> {
  const me = await requireAccess("purchasing", receivingUrl(id));
  const reason = formText(formData, "cancel_reason");
  if (!reason) redirect(`${receivingUrl(id)}?error=cancel_reason`);
  if (reason.length > RECEIVING_RULES.noteMax) redirect(`${receivingUrl(id)}?error=cancel_reason_long`);
  const outcome = await cancelAcceptance(id, formText(formData, "version"), reason, me.id);
  if (!outcome.ok) redirect(`${receivingUrl(id)}?error=cancel_${outcome.reason}`);
  refresh(id);
  redirect(`${receivingUrl(id)}?done=cancelled`);
}
